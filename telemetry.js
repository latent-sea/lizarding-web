// A race's telemetry (the brief's section 9.2): what every runner did, tick
// by tick, as the server's simulation recorded it - C struct layouts,
// little-endian, read exactly. The viewer plays it; the result reads its
// outcomes.

import { Malformed, Reader } from "./bytes.js?v=0c62b5326e86";

export const CHANNEL = Object.freeze({
  POS_X: 0, POS_Y: 1, VEL_X: 2, VEL_Y: 3, YAW: 4, EXHAUSTION: 5, BREATH_RATE: 6, FUEL_PCT: 7, SPRINTED_M: 8,
  IMPACT_VELOCITY: 9, IS_GROUNDED: 10, STATE: 11, INTENT_SPRINT: 12, IS_ATTACKING: 13, HIT_IMMUNE: 14, DIST_TO_FINISH_M: 15,
});

export const STATE = Object.freeze({ IDLE: 0, CRUISE: 1, SPRINT: 2, FALLEN: 3, AIRBORNE: 4, SWIM_CRUISE: 5, SWIM_SPRINT: 6, DNF: 7 });

export const EVENT = Object.freeze({
  RACE_START: 0, PLAN_REPLAN: 1, HIT_DELIVERED: 2, HIT_RECEIVED: 3, KNOCKOFF: 4, FALLEN_RECOVERY: 5, FINISH: 6, DNF: 7, DECISION_SPRINT: 8,
});

/** Ticks are 0.05 s of the simulation, watched at 1.2 times the speed: seconds of watched time at a tick. */
export const SECONDS_PER_TICK = 0.05 / 1.2;
export const secondsAt = (tick) => tick * SECONDS_PER_TICK;

const FORM_FACTOR = 12;
const EVENT_SIZE = 32;
const OUTCOME_SIZE = 212;

function count64(r, what) { return r.num(what); }

function outcome(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, OUTCOME_SIZE);
  const sprints = [];
  for (let i = 0; i < 10; i++) sprints.push(v.getFloat32(172 + i * 4, true));
  return {
    finished: v.getUint8(0) === 1, dnf: v.getUint8(1) === 1, finishTick: v.getUint32(4, true), finalXProgress: v.getFloat32(8, true),
    placement: v.getUint8(12), finishMarginS: v.getFloat32(16, true), hitsDelivered: v.getUint16(20, true), hitsReceived: v.getUint16(22, true),
    knockoffsDealt: v.getUint16(24, true), knockoffsSuffered: v.getUint16(26, true), attackAttempts: v.getUint16(28, true),
    timesKnockedDown: v.getUint16(30, true), sprintTimeS: sprints,
  };
}

function event(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, EVENT_SIZE);
  const other = v.getUint32(12, true);
  return {
    type: v.getUint16(0, true), tick: v.getUint32(4, true), lizard: v.getUint32(8, true), other: other === 0xffffffff ? null : other,
    payload: [0, 1, 2, 3].map((i) => v.getFloat32(16 + i * 4, true)),
  };
}

/** The telemetry read from all of these bytes: { lizards, ticks, seed, channels: [Map(id -> Float32Array)], events, outcomes }. */
export function readTelemetry(bytes) {
  const r = new Reader(bytes);
  const layout = r.u32("the telemetry's layout");
  if (layout !== 1) throw new Malformed(`telemetry of layout ${layout}; this client reads 1`);
  const lizards = r.u32("the lizards");
  const ticks = r.u32("the ticks");
  const seed = r.u64("the seed");
  r.skip(count64(r, "the form factors") * FORM_FACTOR, "the form factors");
  const recorded = count64(r, "the lizards recorded");
  if (recorded !== lizards) throw new Malformed(`telemetry of ${lizards} lizards records ${recorded}`);
  const channels = [];
  for (let l = 0; l < recorded; l++) {
    const held = new Map();
    const count = count64(r, "a lizard's channels");
    for (let c = 0; c < count; c++) {
      const id = r.u16("a channel's id");
      const values = count64(r, "its values");
      const from = r.at;
      r.skip(values * 4, "a channel's values");
      const read = new Float32Array(values);
      const view = new DataView(r.bytes.buffer, r.bytes.byteOffset + from, values * 4);
      for (let i = 0; i < values; i++) read[i] = view.getFloat32(i * 4, true);
      held.set(id, read);
    }
    channels.push(held);
  }
  const events = [];
  for (let i = count64(r, "the events"); i > 0; i--) { const at = r.at; r.skip(EVENT_SIZE, "an event"); events.push(event(r.bytes.subarray(at, at + EVENT_SIZE))); }
  const outcomes = [];
  const told = count64(r, "the outcomes");
  if (told !== lizards) throw new Malformed(`telemetry of ${lizards} lizards has ${told} outcomes`);
  for (let i = 0; i < told; i++) { const at = r.at; r.skip(OUTCOME_SIZE, "an outcome"); outcomes.push(outcome(r.bytes.subarray(at, at + OUTCOME_SIZE))); }
  r.end("the telemetry");
  return { lizards, ticks, seed, channels, events, outcomes };
}

/** A channel's value for a lizard at a moment between ticks, from the ticks either side; null if it was not recorded. */
export function at(race, lizard, channel, tick) {
  const values = race.channels[lizard]?.get(channel);
  if (!values || values.length === 0) return null;
  const last = values.length - 1;
  if (tick <= 0) return values[0];
  if (tick >= last) return values[last];
  const below = Math.floor(tick);
  const share = tick - below;
  return values[below] + (values[below + 1] - values[below]) * share;
}

/** A channel's value at the tick reached or passed: for what doesn't blend, a state or a flag. */
export function stepAt(race, lizard, channel, tick) {
  const values = race.channels[lizard]?.get(channel);
  if (!values || values.length === 0) return null;
  return values[Math.max(0, Math.min(values.length - 1, Math.floor(tick)))];
}

/** How long the race takes to watch, in seconds: to its last tick. */
export function lasts(race) { return secondsAt(Math.max(0, race.ticks - 1)); }
