// The race drawn (the brief's section 9.3): the course as the stage map
// draws it, each runner a rectangle at its place on the course tick by
// tick, blended between ticks, the one nearer the finish on top; a camera
// following the leader, keeping the field in view where it can, height drawn
// larger than length; and the running order along the top. No sound, no 3D.
//
// It draws into a canvas of its own, given to it, at the speed the player
// chooses, paused or played on, from anywhere they seek to; and says where
// it has reached, and when the race has been watched to its end (or skipped to it).

import { CHANNEL, EVENT, SECONDS_PER_TICK, STATE, at, secondsAt, stepAt } from "./telemetry.js?v=0209206a3b9d";
import { surfaceOf } from "./stage.js?v=0209206a3b9d";
import { inkOn, runnerColour } from "./colours.js?v=0209206a3b9d";

const NARROWEST_M = 24; // the least of the course shown across
const WIDEST_M = 90; // the most, so a runner is never too small to see
const TALLEST_EXAGGERATION = 8;
const HOLD_S = 1.2; // the finish held a moment before the race is over
const FLASH_S = 0.35;
const SPRINT_FLASHES = 3; // a sprinting lizard's flashes a second of watched time
const BAND_M = 25; // the background's bands, each this long, to see the speed by

export class RaceView {
  /**
   * canvas; race: telemetry read (telemetry.js); course: a stage (stage.js);
   * runners: [{ number, name, halfWidth, halfHeight }] in card order;
   * marks: "number" or "name"; still: reduced motion; ended(): watched to the end;
   * backed: the runners (by index) the player has bets on, marked out;
   * following(): the runner (by index) the camera follows, or null for the leader;
   * speed(): how many times real speed it plays at; paused(): whether it stands still;
   * moved(tick): where the playing has reached, each frame drawn.
   */
  constructor(canvas, { race, course, runners, marks = "number", still = false, ended = () => {}, backed = new Set(), following = () => null, speed = () => 1, paused = () => false, moved = () => {}, frames = globalThis.requestAnimationFrame?.bind(globalThis), clock = () => performance.now() }) {
    this.canvas = canvas;
    this.race = race;
    this.course = course;
    this.runners = runners;
    this.marks = marks;
    this.still = still;
    this._ended = ended;
    this.backed = backed;
    this._following = following;
    this._speed = speed;
    this._paused = paused;
    this._moved = moved;
    this.tick = 0; // where the playing has reached
    this.followed = null; // the runner the camera is on, as drawn last: null while it follows the leader
    this._frames = frames;
    this._clock = clock;
    this._camera = null;
    this._done = false;
    this.knockoffs = race.events.filter((e) => e.type === EVENT.KNOCKOFF);
    this.lastTick = Math.max(0, race.ticks - 1);
  }

  start() { this._last = this._clock(); this._loop(); }

  /** Played from here: anywhere in the race, before or after where it was. */
  seek(tick) {
    this.tick = Math.max(0, Math.min(this.lastTick, tick));
    this._camera = null; // a jump is shown at once, not eased into
    if (!this._done) this.draw(this.tick);
    this._moved(this.tick);
  }

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
    const now = this._clock();
    const seconds = Math.min(0.25, (now - this._last) / 1000); // a tab come back from hiding doesn't leap
    this._last = now;
    if (!this._paused()) this.tick += (seconds * this._speed()) / SECONDS_PER_TICK;
    this.draw(Math.min(this.tick, this.lastTick));
    this._moved(Math.min(this.tick, this.lastTick));
    if (this.tick >= this.lastTick + HOLD_S / SECONDS_PER_TICK) { this._finish(); return; }
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
    // a runner the player chose, while it is still running: it, and whoever is near it; else the field, or its leader
    const chosen = this._following();
    const target = chosen === null ? null : running.find((p) => p.index === chosen) ?? null;
    this.followed = target ? target.index : null;
    const leader = target ?? [...field].sort((a, b) => a.toGo - b.toGo)[0];
    const near = target ? field.filter((p) => Math.abs(p.x - target.x) < WIDEST_M / 2) : field;
    const xs = near.map((p) => p.x);
    const spread = Math.max(...xs) - Math.min(...xs);
    const across = Math.min(WIDEST_M, Math.max(NARROWEST_M, spread + 12));
    // the field all in view if it fits, else the one followed, with room ahead of it
    let middle = (Math.max(...xs) + Math.min(...xs)) / 2;
    if ((spread + 12 > WIDEST_M || target) && leader) {
      // the way it is running: its speed along x, or towards the finish where speed wasn't recorded
      const speed = at(this.race, leader.index, CHANNEL.VEL_X, tick) ?? this.course.finish.x - leader.x;
      const ahead = speed >= 0 ? 1 : -1;
      middle = leader.x - ahead * across * (target ? 0.15 : 0.25);
    }
    // the height the window holds, from the ground in it and the runners near
    const span = (wide) => {
      const ground = this.course.surfaces.filter((s) => s.xEnd >= middle - wide / 2 && s.xStart <= middle + wide / 2).map((s) => s.y);
      const ys = [...ground, ...near.map((p) => p.y)];
      return [Math.min(...ys) - 1, Math.max(...ys) + 2];
    };
    let [low, high] = span(across);
    // height is never drawn smaller than length: a course too tall for the window widens it until it fits
    let along = Math.min(width / across, (height * 0.85) / Math.max(1, high - low));
    if (width / along > across + 1e-6) [low, high] = span(width / along);
    along = Math.min(along, (height * 0.85) / Math.max(1, high - low));
    const left = middle - width / along / 2;
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
    // bands every 25 m of the course, dark blue and black in turn, so the eye sees how fast the field goes;
    // a quiet label at each hundred metres
    const fromBand = Math.floor(cam.left / BAND_M);
    for (let band = fromBand; band * BAND_M < cam.left + width / cam.along; band++) {
      if (band % 2 === 0) continue;
      g.fillStyle = "#101634";
      g.fillRect(x(band * BAND_M), 0, BAND_M * cam.along, height);
    }
    g.fillStyle = "#4a4778";
    g.font = "10px system-ui, sans-serif";
    for (let m = Math.ceil(cam.left / 100) * 100; m < cam.left + width / cam.along; m += 100) g.fillText(`${m} m`, x(m) + 3, height - 22);
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
      // knocked down, it lies flattened on the ground: wider, and a third as tall
      const fallen = p.state === STATE.FALLEN;
      const wide = Math.max(10, runner.halfWidth * 2 * cam.along) * (fallen ? 1.5 : 1);
      const tall = Math.max(8, runner.halfHeight * 2 * cam.along) * (fallen ? 0.35 : 1);
      const left = x(p.x) - wide / 2;
      const bottom = y(p.y - runner.halfHeight);
      const colour = runnerColour(runner.number);
      g.globalAlpha = p.state === STATE.DNF ? 0.35 : 1;
      // sprinting flashes between a lighter shade of its colour and its own - by the race's time, so a pause holds it;
      // with less motion asked for, the lighter shade stands still
      const sprinting = p.state === STATE.SPRINT || p.state === STATE.SWIM_SPRINT;
      const lit = sprinting && (this.still || Math.floor(secondsAt(tick) * SPRINT_FLASHES * 2) % 2 === 0);
      g.fillStyle = flashing.has(p.index) ? "#ffffff" : lit ? lighter(colour) : colour;
      g.fillRect(left, bottom - tall, wide, tall);
      if (p.state === STATE.SWIM_CRUISE || p.state === STATE.SWIM_SPRINT) { g.fillStyle = "rgba(77, 158, 255, 0.45)"; g.fillRect(left, bottom - tall / 2, wide, tall / 2); }
      // the player's own: framed in white, a marker over each
      if (this.backed.has(p.index)) {
        g.strokeStyle = "#ffffff"; g.lineWidth = 3;
        g.strokeRect(left - 3, bottom - tall - 3, wide + 6, tall + 6);
        g.fillStyle = "#ffffff";
        const cx = left + wide / 2;
        g.beginPath(); g.moveTo(cx - 6, bottom - tall - 24); g.lineTo(cx + 6, bottom - tall - 24); g.lineTo(cx, bottom - tall - 16); g.fill();
      }
      g.lineWidth = 1;
      const mark = this.marks === "name" ? runner.name : String(runner.number);
      g.font = "bold 12px system-ui, sans-serif";
      const fits = g.measureText(mark).width + 4 <= wide && tall >= 13;
      g.fillStyle = fits ? inkOn(colour) : "#e9e3d2";
      g.fillText(mark, fits ? left + 2 : left, fits ? bottom - tall / 2 + 4 : bottom - tall - 4);
      g.globalAlpha = 1;
    }
    // the running order: kept for the standings beside the picture (site.js), and said to a screen reader
    const order = this.orderAt(tick);
    this.standing = order.map((p) => ({ index: p.index, out: p.state === STATE.DNF, home: p.finishTick <= tick }));
    const exaggerated = Math.round(cam.up / cam.along);
    if (exaggerated > 1) { g.fillStyle = "#837fb0"; g.font = "11px system-ui, sans-serif"; g.fillText(`Height ×${exaggerated}`, 8, height - 8); }
    canvas.setAttribute("aria-label", `The race. Running order: ${order.map((p) => this.runners[p.index].number).join(", ")}`);
    this.shownOrder = order.map((p) => this.runners[p.index].number);
  }
}

/** A colour lightened halfway to white: a sprinting lizard's flash. */
export function lighter(colour) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
  return `#${[r, g, b].map((c) => Math.round(c + (255 - c) * 0.5).toString(16).padStart(2, "0")).join("")}`;
}
