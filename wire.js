// The game's messages, as bytes (the brief's sections 4 to 6): what the
// browser sends - FollowAsked, the no-world version 2, and Intents - and
// everything the server sends after the seat - FollowAnswered, then Batch,
// Answer and ToShow frames. Each is read into plain objects; ids and
// credits as Numbers, seeds as BigInts.
//
// A reader consumes exactly the bytes it was given, or throws Malformed
// (bytes.js). A frame of a kind, or a ToShow of a kind or version, this
// client does not read is handed back as { ignored } rather than refused:
// other game modes share the socket.

import { Malformed, Reader, Writer } from "./bytes.js?v=4a2c3c9acc21";

export { Malformed };

export const KIND = Object.freeze({ BATCH: 4, INTENT: 5, ANSWER: 6, TO_SHOW: 7 });
export const WIRE_VERSION = 1;
export const STRUCTURE_VERSION = 3;
export const FOLLOW_ASKED_VERSION = 2; // "a machine with no world"
export const TO_SHOW_LAYOUTS = 2; // the version of ToShow kinds 0 to 4 this client reads
export const OWNER = "betting";

export const ANSWERED = Object.freeze({ ACCEPTED: 0, DECLINED: 1, FAILED: 2 });
export const SHOWN = Object.freeze({ FIELD: 0, RACE: 1, NAMES: 2, TABLES: 3, STAKES: 4, FORM: 8 });
export const BOOK = Object.freeze({ WIN: 0, PLACE: 1 });

// --- what the browser sends ---

/** FollowAsked, version 2: no kind byte, no world, the versions this client reads. */
export function followAsked() {
  return new Writer().u16(FOLLOW_ASKED_VERSION).u32(STRUCTURE_VERSION).u16(WIRE_VERSION).u16(TO_SHOW_LAYOUTS).bytes();
}

/** An intent of the betting game: its call, its kind and its payload's bytes. */
export function intent(call, kind, payload) {
  return new Writer().u8(KIND.INTENT).u16(WIRE_VERSION).u64(call).text(OWNER).text(kind).run(payload).bytes();
}

/** Each intent's payload, by kind (section 5). */
export const PAYLOAD = Object.freeze({
  bet: ({ race, lizard, book, stake }) => new Writer().u64(race).u64(lizard).u8(book).u64(stake).bytes(),
  "show tables": () => new Uint8Array(0),
  "make league": ({ name, startsAt, endsAt }) => new Writer().text(name).i64(startsAt).i64(endsAt).bytes(),
  "enter league": ({ code }) => new Writer().text(code).bytes(),
  "leave league": ({ league }) => new Writer().u64(league).bytes(),
  "show form": ({ lizard, most }) => new Writer().u64(lizard).u16(most).bytes(),
});

// --- the facts (section 6.4) ---

export const FACTS = Object.freeze({
  account: (r) => ({ id: r.num("an account's id"), name: r.text("an account's name"), issue: r.bool("whether it issues") }),
  seat: (r) => ({ id: r.num("a seat's id"), occupant: r.u8("its occupant"), player: r.num("its player"), aiLevel: r.u32("its ai level"), account: r.num("its account") }),
  move: (r) => ({
    id: r.num("a move's id"), from: r.num("the account it leaves"), to: r.num("the account it reaches"), amount: r.num("the amount"),
    reason: r.text("the reason"), race: r.num("the race"), place: r.u16("the place"),
  }),
  card: (r) => {
    const race = r.num("a card's race");
    const stage = r.num("its stage");
    const count = r.u8("its runners");
    const runners = [];
    for (let i = 0; i < count; i++) runners.push({ lizard: r.num("a runner"), odds: r.u32("its odds"), rating: r.u32("its rating") });
    return { race, stage, runners, runsAt: r.time("when it runs") };
  },
  bet: (r) => ({ race: r.num("a bet's race"), number: r.u32("its number"), seat: r.num("its seat"), lizard: r.num("its lizard"), book: r.u8("its book"), stake: r.num("its stake") }),
  result: (r) => {
    const race = r.num("a result's race");
    const seed = r.u64("its seed");
    const count = r.u8("its finishers");
    const order = [];
    for (let i = 0; i < count; i++) order.push(r.num("a finisher"));
    return { race, seed, order };
  },
  forget: (r) => ({ race: r.num("the race forgotten") }),
  league: (r) => ({
    id: r.num("a league's id"), name: r.text("its name"), code: r.text("its code"),
    startsAt: r.time("when it starts"), endsAt: r.time("when it ends"), everyone: r.bool("whether it is everyone's"),
  }),
  member: (r) => ({ league: r.num("the league"), seat: r.num("the seat") }),
  left: (r) => ({ league: r.num("the league"), seat: r.num("the seat") }),
  closed: (r) => ({ league: r.num("the league closed") }),
  "topped up": (r) => ({ seat: r.num("the seat"), amount: r.num("the amount") }),
  mark: (r) => ({ league: r.num("the league"), seat: r.num("the seat"), credits: r.num("the credits"), toppedUp: r.num("the top-ups") }),
  moves_forgotten: () => ({}),
});

/** A fact read from all of these bytes. */
export function fact(name, bytes) {
  const reader = new Reader(bytes);
  const made = FACTS[name](reader);
  reader.end(`a ${name}`);
  return made;
}

// --- FollowAnswered and the Starting copy ---

function starting(r) {
  const reached = r.u64("the record reached");
  const house = r.inside(FACTS.account, "the house's account");
  const purse = r.inside(FACTS.account, "the purse");
  const balance = r.num("the balance");
  const seat = r.inside(FACTS.seat, "the seat");
  const movesForgotten = r.bool("whether moves were forgotten");
  const many = (name) => r.list((each) => each.inside(FACTS[name], `a ${name}`), `the ${name}s`);
  return {
    reached, house, purse, balance, seat, movesForgotten,
    moves: many("move"), cards: many("card"), results: many("result"), bets: many("bet"),
    leagues: many("league"), closed: many("closed"), members: many("member"),
  };
}

/** FollowAnswered: { refused: reason } or { welcome: { structureVersion, playthrough, starting } }. */
export function followAnswered(bytes) {
  const r = new Reader(bytes);
  const which = r.u8("FollowAnswered's kind");
  const version = r.u16("FollowAnswered's version");
  if (version !== 1) throw new Malformed(`FollowAnswered version ${version}; this client reads 1`);
  let made;
  if (which === 0) made = { refused: r.text("the reason") };
  else if (which === 1) {
    const structureVersion = r.u32("the structure version");
    if (structureVersion !== STRUCTURE_VERSION) throw new Malformed(`structure version ${structureVersion}; this client reads ${STRUCTURE_VERSION}`);
    made = { welcome: { structureVersion, playthrough: r.u64("the playthrough"), starting: r.inside(starting, "the Starting copy") } };
  } else throw new Malformed(`FollowAnswered of kind ${which}`);
  r.end("FollowAnswered");
  return made;
}

// --- the framed messages ---

function envelope(r) {
  const version = r.u16("an envelope's version");
  if (version !== 1) throw new Malformed(`envelope version ${version}`);
  const sequence = r.u64("its sequence");
  const playthrough = r.u64("its playthrough");
  r.hash("its manifest");
  const structureVersion = r.u32("its structure version");
  const owner = r.text("its owner");
  const kind = r.text("its kind");
  const audience = r.u8("its audience");
  const seat = r.num("its seat");
  const payload = r.run("its payload");
  const known = (owner === "betting" || owner === "world") && FACTS[kind] && !IGNORED.has(`${owner}/${kind}`);
  return { sequence, playthrough, structureVersion, owner, kind, audience, seat, fact: known ? fact(kind, payload) : null };
}

// facts the client applies nothing of: not read, beyond their envelope
const IGNORED = new Set(["betting/topped up", "betting/mark", "world/account", "world/seat", "world/moves_forgotten"]);

function batch(r) {
  const id = r.text("the batch's id");
  const first = r.u64("its first");
  const last = r.u64("its last");
  const withheld = r.u64("how many are withheld");
  const envelopes = r.list((each) => each.inside(envelope, "an envelope"), "its envelopes");
  return { id, first, last, withheld, envelopes };
}

function answer(r) {
  return { call: r.num("the call answered"), kind: r.u8("the answer"), reason: r.text("the reason") };
}

function numbers(r, what) {
  const held = {};
  for (const _ of Array(r.u32(what))) held[r.text("a name")] = r.f64("its number");
  return held;
}

function runner(r) {
  const lizard = r.num("a runner");
  const name = r.text("its name");
  const stable = r.text("its stable");
  const age = r.f64("its age");
  const fields = numbers(r, "its fields");
  numbers(r, "its body's numbers");
  for (const _ of Array(r.u32("its body's lists"))) { r.text("a path"); for (const __ of Array(r.u32("a list"))) r.f64("a value"); }
  for (const _ of Array(r.u32("its body's words"))) { r.text("a path"); r.text("a word"); }
  return { lizard, name, stable, age, fields };
}

function table(r) {
  const league = r.inside(FACTS.league, "a table's league");
  const ownScore = r.f64("the seat's score");
  const ownPlace = r.num("the seat's place");
  const places = r.num("the table's places");
  const rows = r.list((row) => ({ seat: row.num("a row's seat"), player: row.num("its player"), score: row.f64("its score") }), "the top rows");
  return { league, ownScore, ownPlace, places, rows };
}

function staked(r) { return { lizard: r.num("a staked lizard"), toWin: r.num("staked to win"), toPlace: r.num("staked to place") }; }

function start(r) {
  const race = r.num("a start's race");
  const season = r.u32("its season");
  const round = r.u32("its round");
  const stage = r.num("its stage");
  const stageName = r.text("its stage's name");
  const place = r.u16("its place");
  const finished = r.bool("whether it finished");
  const time = r.f64("its time");
  const behind = r.f64("how far behind");
  const prize = r.num("its prize");
  const age = r.f64("its age at the off");
  const hasBand = r.bool("whether it has bands");
  const band = r.u8("its band");
  const bandForAge = r.u8("its band for its age");
  const hasKnocks = r.bool("whether it has knocks");
  const knockedDown = r.u16("times knocked down");
  const knockedOthers = r.u16("others knocked");
  const cup = r.bool("whether it was a cup");
  const cells = r.u8("its sprint map");
  if (cells !== 0 && cells !== 10) throw new Malformed(`a sprint map of ${cells} cells`);
  const sprintMap = [];
  for (let i = 0; i < cells; i++) sprintMap.push(r.f64("a stretch's sprinting"));
  return {
    race, season, round, stage, stageName, place, finished, time, behind, prize, age,
    band: hasBand ? band : null, bandForAge: hasBand ? bandForAge : null,
    knockedDown: hasKnocks ? knockedDown : null, knockedOthers: hasKnocks ? knockedOthers : null, cup, sprintMap,
  };
}

const SHOWS = {
  [SHOWN.FIELD]: [2, (r) => ({ race: r.num("the field's race"), stage: r.text("the stage's definition"), runners: r.list(runner, "the runners") })],
  [SHOWN.RACE]: [2, (r) => ({
    race: r.num("the race"), stage: r.num("its stage"),
    field: r.list((each) => each.num("a lizard"), "its field"), telemetry: r.run("its telemetry"),
  })],
  [SHOWN.NAMES]: [2, (r) => ({ names: r.list((each) => ({ player: each.num("a player"), name: each.text("their name") }), "the names") })],
  [SHOWN.TABLES]: [2, (r) => ({ tables: r.list(table, "the tables") })],
  [SHOWN.STAKES]: [2, (r) => ({
    race: r.num("the race staked on"), everyone: r.list(staked, "everyone's stakes"),
    leagues: r.list((each) => ({ league: each.num("a league"), stakes: each.list(staked, "its stakes") }), "the leagues' stakes"),
  })],
  [SHOWN.FORM]: [1, (r) => {
    const lizard = r.num("the lizard");
    const name = r.text("its name");
    const stable = r.text("its stable");
    const age = r.f64("its age");
    const career = { races: r.u32("its races"), wins: r.u32("its wins"), topThree: r.u32("its top threes"), prize: r.num("its prize") };
    const hasAverage = r.bool("whether it has an average band");
    const average = r.u8("its average band");
    career.averageBand = hasAverage ? average : null;
    return { lizard, name, stable, age, career, starts: r.list(start, "its starts") };
  }],
};

function toShow(r) {
  return r.inside((inner) => {
    const kind = inner.u8("the shown kind");
    const version = inner.u16("its version");
    const known = SHOWS[kind];
    if (!known || known[0] !== version) { inner.skip(inner.left); return { kind, version, ignored: true }; }
    return { kind, version, ...known[1](inner) };
  }, "what is shown");
}

/** A framed message from the server: { batch }, { answer }, { shown } or { ignored }. */
export function frame(bytes) {
  const r = new Reader(bytes);
  const kind = r.u8("the frame's kind");
  const version = r.u16("its version");
  if (version !== WIRE_VERSION) throw new Malformed(`a frame of version ${version}; this client reads ${WIRE_VERSION}`);
  let made;
  if (kind === KIND.BATCH) made = { batch: batch(r) };
  else if (kind === KIND.ANSWER) made = { answer: answer(r) };
  else if (kind === KIND.TO_SHOW) made = { shown: toShow(r) };
  else { r.skip(r.left); made = { ignored: kind }; }
  r.end(`a frame of kind ${kind}`);
  return made;
}
