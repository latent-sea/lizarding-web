// The stage map (the brief's section 8.5): the course side-on, drawn from
// its definition (stage.js), height drawn larger than length - and it says
// so - and under it a key to its colours, how high it rises, each surface's
// share of the ground and how many obstacles there are.

import { Phrase } from "./gd_chime/gd_chime.js?v=0209206a3b9d";
import { summary } from "./stage.js?v=0209206a3b9d";
import { stageOf } from "./nav.js?v=0209206a3b9d";

export const STAGE = "stage";

export function describeStage(ui, play, scale) {
  const stage = ui.bound(() => stageOf(play));
  const said = stage.map((s) => (s ? summary(s) : null));
  return ui.screen(STAGE, [
    ui.text(stage.map((s) => s?.name || Phrase.of("The course")), "Title"),
    ui.when(stage, ui.column([
      ui.surface("StageMap", []).named("stage-map"),
      ui.text(scale.map((n) => (n > 1 ? Phrase.with("Height is drawn %d times larger than length.", [n]) : "")), "Small Quiet").hidesEmpty(),
      ui.eachAcross(said.map((s) => s?.shares ?? []), (share) => ui.row([
        ui.surface(share.map((s) => `Key Surface-${s?.surface ?? ""}`)),
        ui.text(share.map((s) => (s ? Phrase.with("%s, %s of the ground", [Phrase.of(s.label), `${Math.round(s.share * 100)}%`]) : "")), "Small"),
      ], "KeyItem"), (s) => s.surface, "KeyList"),
      ui.text(ui.bound(() => { const s = stage.read(); const t = said.read(); return s && t ? Phrase.with("It rises %s m from its lowest ground to its highest, over %s m.", [t.rises.toFixed(1), Math.round(s.length ?? s.bounds.right - s.bounds.left)]) : ""; }), "Words").wraps(),
      ui.text(said.map((t) => (t ? Phrase.counted("%d obstacle", "%d obstacles", t.obstacles, "No obstacles") : "")), "Words"),
    ], "StagePart"), ui.text(Phrase.of("The course shows once the next card's field has come."), "Quiet")),
  ]);
}
