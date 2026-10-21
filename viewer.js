// The race drawn (the brief's section 9.3): the course as the stage map
// draws it, each runner a rectangle at its place on the course tick by
// tick, blended between ticks, the one nearer the finish on top; a camera
// following the leader, keeping the field in view where it can, height drawn
// larger than length; and the running order along the top. No sound, no 3D.
//
// It draws into a canvas of its own, given to it, and says when the race has
// been watched to its end (or skipped to it).

import { CHANNEL, EVENT, SECONDS_PER_TICK, STATE, at, stepAt } from "./telemetry.js?v=45f52efbed9c";
import { surfaceOf } from "./stage.js?v=45f52efbed9c";
import { inkOn, runnerColour } from "./colours.js?v=45f52efbed9c";

const NARROWEST_M = 24; // the least of the course shown across
const WIDEST_M = 90; // the most, so a runner is never too small to see
const TALLEST_EXAGGERATION = 8;
const HOLD_S = 1.2; // the finish held a moment before the race is over
const FLASH_S = 0.35;

export class RaceView {
  /**
   * canvas; race: telemetry read (telemetry.js); course: a stage (stage.js);
   * runners: [{ number, name, halfWidth, halfHeight }] in card order;
   * marks: "number" or "name"; still: reduced motion; ended(): watched to the end.
   */
  constructor(canvas, { race, course, runners, marks = "number", still = false, ended = () => {}, frames = globalThis.requestAnimationFrame?.bind(globalThis), clock = () => performance.now() }) {
    this.canvas = canvas;
    this.race = race;
    this.course = course;
    this.runners = runners;
    this.marks = marks;
    this.still = still;
    this._ended = ended;
    this._frames = frames;
    this._clock = clock;
    this._started = null;
    this._camera = null;
    this._done = false;
    this.knockoffs = race.events.filter((e) => e.type === EVENT.KNOCKOFF);
    this.lastTick = Math.max(0, race.ticks - 1);
  }

  start() { this._started = this._clock(); this._loop(); }

  /** Whether a stretch of ground is the floor: no other stretch beneath any of it. */
  _floor(stretch) {
    this._floors ??= new Map();
    if (!this._floors.has(stretch)) {
      this._floors.set(stretch, !this.course.surfaces.some((o) => o !== stretch && o.y < stretch.y && o.xStart < stretch.xEnd && o.xEnd > stretch.xStart));
    }
    return this._floors.get(stretch);
  }

  /** To the end at once: the race is over. */
  skip() { this._finish(); }

  stop() { this._done = true; }

  _finish() {
    if (this._done) return;
    this._done = true;
    this.draw(this.lastTick);
    this._ended();
  }

  _loop() {
    if (this._done) return;
    const seconds = (this._clock() - this._started) / 1000;
    const tick = seconds / SECONDS_PER_TICK;
    this.draw(Math.min(tick, this.lastTick));
    if (tick >= this.lastTick + HOLD_S / SECONDS_PER_TICK) { this._finish(); return; }
    if (this._frames) this._frames(() => this._loop());
  }

  /** Each runner where it is at this tick, blended: { index, x, y, toGo, state }. */
  placesAt(tick) {
    return this.runners.map((_, index) => ({
      index,
      x: at(this.race, index, CHANNEL.POS_X, tick) ?? 0,
      y: at(this.race, index, CHANNEL.POS_Y, tick) ?? 0,
      toGo: at(this.race, index, CHANNEL.DIST_TO_FINISH_M, tick) ?? Infinity,
      state: stepAt(this.race, index, CHANNEL.STATE, tick) ?? STATE.CRUISE,
      finishTick: this.race.outcomes[index]?.finished ? this.race.outcomes[index].finishTick : Infinity,
    }));
  }

  /** The running order at a tick: nearest the finish first, those home in the order they came home, those out of it last. */
  orderAt(tick) {
    return this.placesAt(tick).sort((a, b) => {
      const outA = a.state === STATE.DNF ? 1 : 0;
      const outB = b.state === STATE.DNF ? 1 : 0;
      if (outA !== outB) return outA - outB;
      const homeA = a.finishTick <= tick ? a.finishTick : Infinity;
      const homeB = b.finishTick <= tick ? b.finishTick : Infinity;
      if (homeA !== homeB) return homeA - homeB;
      return a.toGo - b.toGo;
    });
  }

  /** Where the camera looks: a window of the course, in metres, round the field or ahead of the leader. */
  _look(places, width, height, tick) {
    // the camera stays with the race: those still running, once the first are home
    const running = places.filter((p) => p.state !== STATE.DNF && !(p.finishTick <= tick));
    const field = running.length ? running : places;
    const leader = [...field].sort((a, b) => a.toGo - b.toGo)[0];
    const xs = field.map((p) => p.x);
    const spread = Math.max(...xs) - Math.min(...xs);
    const across = Math.min(WIDEST_M, Math.max(NARROWEST_M, spread + 12));
    // the field all in view if it fits, else the leader, with room ahead of it
    let middle = (Math.max(...xs) + Math.min(...xs)) / 2;
    if (spread + 12 > WIDEST_M && leader) {
      // the way it is running: its speed along x, or towards the finish where speed wasn't recorded
      const speed = at(this.race, leader.index, CHANNEL.VEL_X, tick) ?? this.course.finish.x - leader.x;
      const ahead = speed >= 0 ? 1 : -1;
      middle = leader.x - ahead * across * 0.25;
    }
    const along = width / across;
    const left = middle - across / 2;
    const ground = this.course.surfaces.filter((s) => s.xEnd >= left && s.xStart <= left + across).map((s) => s.y);
    const ys = [...ground, ...field.map((p) => p.y)];
    const low = Math.min(...ys) - 1;
    const high = Math.max(...ys) + 2;
    const up = Math.max(along, Math.min(along * TALLEST_EXAGGERATION, (height * 0.7) / Math.max(1, high - low)));
    const wanted = { left, along, up, middleY: (low + high) / 2 };
    if (!this._camera || this.still) this._camera = wanted;
    else for (const key of Object.keys(wanted)) this._camera[key] += (wanted[key] - this._camera[key]) * 0.15;
    return this._camera;
  }

  draw(tick) {
    const canvas = this.canvas;
    const scale = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 320;
    if (canvas.width !== Math.round(width * scale)) canvas.width = Math.round(width * scale);
    if (canvas.height !== Math.round(height * scale)) canvas.height = Math.round(height * scale);
    const g = canvas.getContext?.("2d");
    if (!g) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = "#08070f";
    g.fillRect(0, 0, width, height);
    const places = this.placesAt(tick);
    const cam = this._look(places, width, height, tick);
    const x = (m) => (m - cam.left) * cam.along;
    const y = (m) => height * 0.55 - (m - cam.middleY) * cam.up;
    // the ground, each stretch at its height in its surface's colour; only the floor - with nothing
    // under it - filled below, so a platform reads as one, not as a tower
    for (const s of this.course.surfaces) {
      const [x0, x1, top] = [x(s.xStart), x(s.xEnd), y(s.y)];
      if (x1 < 0 || x0 > width) continue;
      const { colour } = surfaceOf(s.surface);
      g.fillStyle = colour;
      if (this._floor(s)) {
        g.globalAlpha = 0.18;
        g.fillRect(x0, top, x1 - x0, height - top);
        g.globalAlpha = 1;
      }
      g.fillRect(x0, top - 3, x1 - x0, 6);
    }
    g.fillStyle = "#837fb0";
    for (const o of this.course.obstacles) g.fillRect(x(o.xStart), y(o.top), Math.max(2, x(o.xEnd) - x(o.xStart)), Math.max(2, y(o.bottom) - y(o.top)));
    for (const [point, words] of [[this.course.start, "Start"], [this.course.finish, "Finish"]]) {
      const [fx, fy] = [x(point.x), y(point.y)];
      g.strokeStyle = "#e9e3d2";
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 34); g.stroke();
      g.fillStyle = "#ffc752";
      g.beginPath(); g.moveTo(fx, fy - 34); g.lineTo(fx + 14, fy - 29); g.lineTo(fx, fy - 24); g.fill();
      g.fillStyle = "#e9e3d2"; g.font = "11px system-ui, sans-serif"; g.fillText(words, fx + 4, fy - 38);
    }
    // the runners, the one nearest the finish drawn last, so on top
    const flashing = new Set(this.still ? [] : this.knockoffs.filter((e) => tick >= e.tick && tick - e.tick < FLASH_S / SECONDS_PER_TICK).flatMap((e) => [e.lizard, e.other]));
    for (const p of [...places].sort((a, b) => b.toGo - a.toGo)) {
      const runner = this.runners[p.index];
      const wide = Math.max(10, runner.halfWidth * 2 * cam.along);
      const tall = Math.max(8, runner.halfHeight * 2 * cam.along);
      const left = x(p.x) - wide / 2;
      const bottom = y(p.y - runner.halfHeight);
      const colour = runnerColour(runner.number);
      g.globalAlpha = p.state === STATE.DNF ? 0.35 : 1;
      g.fillStyle = flashing.has(p.index) ? "#ffffff" : colour;
      g.fillRect(left, bottom - tall, wide, tall);
      if (p.state === STATE.FALLEN) { g.strokeStyle = "#08070f"; g.lineWidth = 2; g.setLineDash([3, 2]); g.strokeRect(left, bottom - tall, wide, tall); g.setLineDash([]); }
      else if (p.state === STATE.SPRINT || p.state === STATE.SWIM_SPRINT) { g.strokeStyle = "#ffc752"; g.lineWidth = 2; g.strokeRect(left - 1, bottom - tall - 1, wide + 2, tall + 2); }
      if (p.state === STATE.SWIM_CRUISE || p.state === STATE.SWIM_SPRINT) { g.fillStyle = "rgba(77, 158, 255, 0.45)"; g.fillRect(left, bottom - tall / 2, wide, tall / 2); }
      g.lineWidth = 1;
      const mark = this.marks === "name" ? runner.name : String(runner.number);
      g.font = "bold 12px system-ui, sans-serif";
      const fits = g.measureText(mark).width + 4 <= wide && tall >= 13;
      g.fillStyle = fits ? inkOn(colour) : "#e9e3d2";
      g.fillText(mark, fits ? left + 2 : left, fits ? bottom - tall / 2 + 4 : bottom - tall - 4);
      g.globalAlpha = 1;
    }
    // the running order, along the top
    const order = this.orderAt(tick);
    order.forEach((p, at) => {
      const runner = this.runners[p.index];
      const colour = runnerColour(runner.number);
      g.globalAlpha = p.state === STATE.DNF ? 0.35 : 1;
      g.fillStyle = colour;
      g.fillRect(8 + at * 26, 8, 22, 22);
      g.fillStyle = inkOn(colour);
      g.font = "bold 12px system-ui, sans-serif";
      g.fillText(String(runner.number), 8 + at * 26 + (runner.number >= 10 ? 4 : 7), 23);
      g.globalAlpha = 1;
    });
    const exaggerated = Math.round(cam.up / cam.along);
    if (exaggerated > 1) { g.fillStyle = "#837fb0"; g.font = "11px system-ui, sans-serif"; g.fillText(`Height ×${exaggerated}`, 8, height - 8); }
    canvas.setAttribute("aria-label", `The race. Running order: ${order.map((p) => this.runners[p.index].number).join(", ")}`);
    this.shownOrder = order.map((p) => this.runners[p.index].number);
  }
}
