// A stage, read from its definition (the brief's section 9.1): the TOML the
// field carries, turned into what the stage map and the race viewer draw -
// stretches of ground by surface, obstacles as blocks, the start and the
// finish - and what is said under the map. The world is 2D, in metres, x
// along the course and y up; a course may double back, so nothing here
// assumes it runs left to right.

import { parseToml } from "./toml.js?v=3c28468398f2";

export const SURFACES = Object.freeze({
  hard_rock: { label: "Rock", colour: "#9EA1B3" },
  standard_dirt: { label: "Dirt", colour: "#BD854D" },
  mud: { label: "Mud", colour: "#75543A" },
  wood: { label: "Wood", colour: "#E0AD5C" },
  water: { label: "Water", colour: "#4D9EFF" },
});
const UNKNOWN_SURFACE = { label: "Ground", colour: "#837fb0" };

export const surfaceOf = (id) => SURFACES[id] ?? UNKNOWN_SURFACE;

const number = (held, fallback = null) => (typeof held === "number" && Number.isFinite(held) ? held : fallback);

/** The course a definition describes; one that cannot be read is a course of nothing but its name. */
export function readStage(definition) {
  let held;
  try { held = parseToml(definition ?? ""); } catch (error) {
    console.warn(`a stage definition could not be read: ${error.message}`);
    held = {};
  }
  const surfaces = [];
  const obstacles = [];
  for (const primitive of Array.isArray(held.primitives) ? held.primitives : []) {
    if (primitive?.type === "surface") {
      const [xStart, xEnd, y] = [number(primitive.x_start), number(primitive.x_end), number(primitive.y)];
      if (xStart === null || xEnd === null || y === null) continue;
      surfaces.push({ xStart: Math.min(xStart, xEnd), xEnd: Math.max(xStart, xEnd), y, surface: String(primitive.surface_id ?? "") });
    } else if (primitive?.type === "hard_obstacle") {
      const [xStart, xEnd, bottom, top] = [number(primitive.x_start), number(primitive.x_end), number(primitive.bottom_y), number(primitive.top_y)];
      if (xStart === null || xEnd === null || bottom === null || top === null) continue;
      obstacles.push({ xStart: Math.min(xStart, xEnd), xEnd: Math.max(xStart, xEnd), bottom: Math.min(bottom, top), top: Math.max(bottom, top) });
    }
  }
  // the game's definitions keep the name and length under [stage] and the start and finish under [race];
  // the brief has them at the top, and either is read
  const about = { ...held, ...(held.stage && typeof held.stage === "object" ? held.stage : {}) };
  const race = { ...held, ...(held.race && typeof held.race === "object" ? held.race : {}) };
  const start = { x: number(race.paddock_x, surfaces[0]?.xStart ?? 0), y: number(race.paddock_y, surfaces[0]?.y ?? 0) };
  const finish = { x: number(race.finish_x, surfaces.at(-1)?.xEnd ?? 0), y: number(race.finish_y, surfaces.at(-1)?.y ?? 0) };
  const name = typeof about.name === "string" ? about.name : "";
  return { name, length: number(about.nominal_length_m), start, finish, surfaces, obstacles, bounds: boundsOf(surfaces, obstacles, start, finish) };
}

function boundsOf(surfaces, obstacles, start, finish) {
  const xs = [start.x, finish.x, ...surfaces.flatMap((s) => [s.xStart, s.xEnd]), ...obstacles.flatMap((o) => [o.xStart, o.xEnd])];
  const ys = [start.y, finish.y, ...surfaces.map((s) => s.y), ...obstacles.flatMap((o) => [o.bottom, o.top])];
  return { left: Math.min(...xs), right: Math.max(...xs), low: Math.min(...ys), high: Math.max(...ys) };
}

/** What is said under the map: how high it rises, each surface's share of the ground, how many obstacles. */
export function summary(stage) {
  const ground = stage.surfaces.map((s) => s.y);
  const rises = ground.length ? Math.max(...ground) - Math.min(...ground) : 0;
  const lengths = new Map();
  let total = 0;
  for (const s of stage.surfaces) {
    const length = s.xEnd - s.xStart;
    lengths.set(s.surface, (lengths.get(s.surface) ?? 0) + length);
    total += length;
  }
  const shares = [...lengths].map(([surface, length]) => ({ surface, ...surfaceOf(surface), share: total > 0 ? length / total : 0 }))
    .sort((a, b) => b.share - a.share);
  return { rises, shares, obstacles: stage.obstacles.length };
}

/**
 * How much taller than long a map is drawn, so a course hundreds of metres
 * long and a few high shows its rises: the height made a share of the
 * picture, and never drawn smaller than true.
 */
export function heightScale(stage, width, height) {
  const long = Math.max(1, stage.bounds.right - stage.bounds.left);
  const high = Math.max(1, stage.bounds.high - stage.bounds.low);
  const along = width / long;
  const up = (height * 0.6) / high;
  return Math.max(1, Math.round(up / along));
}

/** A round step for the metres marked along the bottom: about a tenth of the length. */
export function metreStep(length) {
  const rough = Math.max(1, length / 8);
  const ten = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((m) => m * ten).find((step) => step >= rough) ?? ten * 10;
}

const escapeXml = (words) => String(words).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

/**
 * The side-on map as SVG: each stretch of ground at its height in its
 * surface's colour, named where the name fits; obstacles as blocks; flags at
 * the start and the finish; metres along the bottom. Height is drawn larger
 * than length, by the scale given back, which the screen says.
 */
export function drawStageMap(stage, { width = 960, height = 300, ink = "#e9e3d2", soft = "#837fb0", flag = "#ffc752" } = {}) {
  const pad = { left: 16, right: 16, top: 28, bottom: 30 };
  const inner = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
  const { left, right, low, high } = stage.bounds;
  const long = Math.max(1, right - left);
  const along = inner.w / long;
  const scale = heightScale(stage, inner.w, inner.h);
  const up = along * scale;
  // the course stands in the middle of the height it is given
  const middle = (low + high) / 2;
  const x = (m) => pad.left + (m - left) * along;
  const y = (m) => pad.top + inner.h / 2 - (m - middle) * up;
  const parts = [];
  const thick = 6;
  for (const s of stage.surfaces) {
    const { label, colour } = surfaceOf(s.surface);
    const [x0, x1, at] = [x(s.xStart), x(s.xEnd), y(s.y)];
    parts.push(`<rect x="${x0.toFixed(1)}" y="${(at - thick / 2).toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${thick}" fill="${colour}"><title>${escapeXml(label)}</title></rect>`);
    if (x1 - x0 > label.length * 7 + 8) parts.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(at - thick).toFixed(1)}" fill="${soft}" font-size="11" text-anchor="middle">${escapeXml(label)}</text>`);
  }
  for (const o of stage.obstacles) {
    const [x0, x1, top, bottom] = [x(o.xStart), x(o.xEnd), y(o.top), y(o.bottom)];
    parts.push(`<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${Math.max(2, bottom - top).toFixed(1)}" fill="${soft}" stroke="${ink}" stroke-width="1"><title>Obstacle</title></rect>`);
  }
  const flagAt = (point, words) => {
    const [fx, fy] = [x(point.x), y(point.y) - thick / 2];
    return `<g class="flag"><line x1="${fx.toFixed(1)}" y1="${fy.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${(fy - 20).toFixed(1)}" stroke="${ink}" stroke-width="1.5"/>`
      + `<path d="M${fx.toFixed(1)} ${(fy - 20).toFixed(1)} l12 4 l-12 4 z" fill="${flag}"/>`
      // its words kept inside the picture, near either edge
      + `<text x="${(fx + 3).toFixed(1)}" y="${(fy - 23).toFixed(1)}" fill="${ink}" font-size="11"${fx > width - 60 ? ' text-anchor="end"' : ""}>${escapeXml(words)}</text></g>`;
  };
  parts.push(flagAt(stage.start, "Start"), flagAt(stage.finish, "Finish"));
  const step = metreStep(long);
  const base = height - pad.bottom + 8;
  parts.push(`<line x1="${pad.left}" y1="${base}" x2="${width - pad.right}" y2="${base}" stroke="${soft}" stroke-width="1"/>`);
  for (let m = Math.ceil(left / step) * step; m <= right + 1e-9; m += step) {
    const at = x(m);
    parts.push(`<line x1="${at.toFixed(1)}" y1="${base}" x2="${at.toFixed(1)}" y2="${base + 4}" stroke="${soft}"/>`
      + `<text x="${at.toFixed(1)}" y="${base + 16}" fill="${soft}" font-size="11" text-anchor="middle">${Math.round(m)} m</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`A side-on map of ${stage.name || "the course"}`)}">${parts.join("")}</svg>`;
  return { svg, scale };
}
