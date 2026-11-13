// The stage map (the brief's section 8.5): the course side-on, drawn from
// its definition (stage.js), height drawn larger than length - and it says
// so - and under it a key to its colours, how high it rises, each surface's
// share of the ground and how many obstacles there are.
//
// Any stage, not only the next race's (Ian, 13 Nov: "Should be able to click
// stages in the lizard view"): the screen entered with a stage's name shows
// that stage, as the app's stage screen is entered as the stage pressed
// (stage_glass.gd). The game sends the definition of the next race's stage
// only, so another is read from the game's own definitions as copied into
// stages/ (tooling/sync_lizarding_stages.py), fetched as it is first opened.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=2831cc56e2f9";
import { readStage, summary } from "./stage.js?v=2831cc56e2f9";
// the app's press on a stage's name (stage_glass.gd's OPENS) is the nav's own: goes_to_the_stage
import { GOES_STAGE, stageOf } from "./nav.js?v=2831cc56e2f9";

export const STAGE = "stage";

/** The stages copied from the game, fetched by name as each is first wanted: a course, or null for one not copied. */
export class Stages extends Controller {
  constructor(chimes, { fetcher = (path) => fetch(path), base = "stages/" } = {}) {
    super(chimes);
    this._fetch = fetcher;
    this._base = base;
    this._index = null;
    this.read = this.value(new Map()); // name -> its course, or null when the copy hasn't it
  }

  /** Fetched once, kept: a stage asked for again is already held. */
  async want(name) {
    if (!name || this.read._held.has(name)) return;
    this.read.update((held) => new Map(held).set(name, undefined));
    let course = null;
    try {
      this._index ??= this._fetch(`${this._base}index.json`).then((r) => (r.ok ? r.json() : {}));
      const file = (await this._index)[name];
      if (typeof file === "string" && /^[a-z0-9_]+\.toml$/.test(file)) {
        const got = await this._fetch(`${this._base}${file}`);
        if (got.ok) course = readStage(await got.text());
      }
    } catch (error) {
      console.warn(`the stage ${name} could not be fetched: ${error.message}`);
      this._index = null;
    }
    this.read.update((held) => new Map(held).set(name, course));
  }
}

/**
 * The stage the screen shows: entered with a name, that stage - from a field the game sent, else the copy (undefined
 * while it is fetched, null when it has none); entered with none, the next race's.
 */
export function shownStage(play, stages, name) {
  if (!name) return stageOf(play);
  for (const field of play.fields.read().values()) if (field.course?.name === name) return field.course;
  return stages.read.read().get(name);
}

/** A stage's name as the press that opens its screen, in the look of the game's other links. */
export function stageLink(ui, name, style = "CellValue") {
  return ui.link(GOES_STAGE, name.map((n) => n || null), name.map((n) => n ?? ""), { style: "NameLink StageLink", words_style: style }).goesTo(STAGE);
}

export function describeStage(ui, play, stages, scale) {
  const name = ui.parameter(STAGE);
  const stage = ui.bound(() => shownStage(play, stages, name.read()) ?? null);
  const said = stage.map((s) => (s ? summary(s) : null));
  const waiting = ui.bound(() => {
    if (!name.read()) return Phrase.of("The course shows once the next card's field has come.");
    return shownStage(play, stages, name.read()) === undefined ? Phrase.of("Fetching the stage…") : Phrase.of("This stage's map can't be shown here yet.");
  });
  return ui.screen(STAGE, [
    ui.text(ui.bound(() => stage.read()?.name || name.read() || Phrase.of("The course")), "Title"),
    ui.when(stage, ui.column([
      ui.surface("StageMap", []).named("stage-map"),
      ui.text(scale.map((n) => (n > 1 ? Phrase.with("Height is drawn %d times larger than length.", [n]) : "")), "Small Quiet").hidesEmpty(),
      ui.eachAcross(said.map((s) => s?.shares ?? []), (share) => ui.row([
        ui.surface(share.map((s) => `Key Surface-${s?.surface ?? ""}`)),
        ui.text(share.map((s) => (s ? Phrase.with("%s, %s of the ground", [Phrase.of(s.label), `${Math.round(s.share * 100)}%`]) : "")), "Small"),
      ], "KeyItem"), (s) => s.surface, "KeyList"),
      ui.text(ui.bound(() => { const s = stage.read(); const t = said.read(); return s && t ? Phrase.with("It rises %s m from its lowest ground to its highest, over %s m.", [t.rises.toFixed(1), Math.round(s.length ?? s.bounds.right - s.bounds.left)]) : ""; }), "Words").wraps(),
      ui.text(said.map((t) => (t ? Phrase.counted("%d obstacle", "%d obstacles", t.obstacles, "No obstacles") : "")), "Words"),
    ], "StagePart"), ui.text(waiting, "Quiet")),
  ]);
}
