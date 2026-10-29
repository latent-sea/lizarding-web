// The lizard screen (the brief's section 8.6), opened from a runner: its
// strip along the top - square, name, age, stable, prices, the player's
// stakes, BET, and arrows through the field - and its form: a table of its
// races, newest first, its percentiles shaded, its sprint map drawn, and its
// career under it. Results only: never its genes or its body.

import { Phrase } from "./gd_chime/gd_chime.js?v=d36c354bf1f6";
import { OPENS_BET } from "./card.js?v=d36c354bf1f6";
import { ageSaid, bandStyle, credits, nameSaid, placeSaid, runnersOf, square, stableSaid, stakesSaid, winSaid } from "./parts.js?v=d36c354bf1f6";
import { ordinal } from "./rules.js?v=d36c354bf1f6";

export const LIZARD = "lizard";
export const GOES_EARLIER = "goes_to_the_runner_before";
export const GOES_LATER = "goes_to_the_runner_after";

export const WORDS = {
  [GOES_EARLIER]: ["Previous runner"],
  [GOES_LATER]: ["Next runner"],
};

const seconds = (s) => `${s.toFixed(2)} s`;

/** A sprint map's bars, each as tall as its share of the largest stretch, in eleven steps. */
export function sprintBars(map) {
  const most = Math.max(...map, 0);
  return map.map((v, at) => ({ key: at, up: most > 0 ? Math.round((v / most) * 10) : 0 }));
}

export const sprintMap = (ui, map) => ui.eachAcross(map.map((m) => sprintBars(m ?? [])), (bar) => ui.surface(bar.map((b) => `Bar Up${b?.up ?? 0}`)), (b) => b.key, "SprintMap");

export function describeLizard(ui, play, { betPopUp }) {
  const lizard = ui.parameter(LIZARD);
  const runners = ui.bound(() => (play.game.read() ? runnersOf(play) : []));
  const row = ui.bound(() => runners.read().find((r) => r.lizard === lizard.read()) ?? null);
  const form = ui.bound(() => play.forms.read().get(lizard.read()) ?? null);
  const neighbour = (by) => ui.bound(() => {
    const list = runners.read();
    const at = list.findIndex((r) => r.lizard === lizard.read());
    return at < 0 || list.length < 2 ? null : list[(at + by + list.length) % list.length].lizard;
  });
  const starts = form.map((f) => f?.starts ?? []);
  // a figure of the table: on a narrow screen, where the heading row is gone, it says what it is
  const cell = (label, words, style = "", shaded = null) => ui.surface(`Cell ${style}`, [
    ...(label ? [ui.text(Phrase.of(label), "CellLabel")] : []),
    ui.text(words, shaded ?? "CellValue"),
  ]);
  const startRow = (held) => ui.surface("FormRow", [
    cell("", held.map((s) => (s ? Phrase.with("S%d R%d", [s.season, s.round]) : "")), "When"),
    cell("", held.map((s) => s?.stageName ?? ""), "Stage"),
    cell("Place", held.map((s) => (!s ? "" : s.finished ? ordinal(s.place) : Phrase.of("DNF"))), "Place"),
    cell("Time", held.map((s) => (s?.finished ? seconds(s.time) : "–")), "Time"),
    cell("Behind", held.map((s) => (s?.finished && s.behind > 0 ? `+${seconds(s.behind)}` : "–")), "Behind"),
    cell("Prize", held.map((s) => (s ? (s.prize ? credits(s.prize) : "–") : "")), "Prize"),
    cell("Pct", held.map((s) => (s?.band == null ? "–" : String(s.band))), "Pct", held.map((s) => bandStyle(s?.band ?? null, "CellValue Shade"))),
    cell("For age", held.map((s) => (s?.bandForAge == null ? "–" : String(s.bandForAge))), "Pct", held.map((s) => bandStyle(s?.bandForAge ?? null, "CellValue Shade"))),
    cell("Downs", held.map((s) => (s?.knockedDown == null ? "–" : String(s.knockedDown))), "Knocks"),
    cell("Knocks", held.map((s) => (s?.knockedOthers == null ? "–" : String(s.knockedOthers))), "Knocks"),
    ui.surface("Cell Sprints", [sprintMap(ui, held.map((s) => s?.sprintMap ?? []))]),
  ]);
  const heading = (words, style = "") => ui.text(Phrase.of(words), `Head ${style}`);
  return ui.screen(LIZARD, [
    ui.surface("LizardStrip", [
      ui.row([
        ui.when(neighbour(-1), ui.pressable(GOES_EARLIER, neighbour(-1).map((l) => ({ parameter: l })), [ui.text("‹", "Arrow")], "Pressable ArrowButton").goesTo(LIZARD)),
        square(ui, row.map((r) => r?.number ?? 0), "Large"),
        ui.column([
          ui.text(ui.bound(() => (row.read() ? nameSaid(row.read()) : form.read()?.name ?? nameSaid({ lizard: lizard.read() }))), "LizardNameLarge"),
          ui.text(ui.bound(() => [ageSaid(row.read()?.age ?? form.read()?.age ?? null), stableSaid(row.read()?.stable ?? form.read()?.stable ?? null)]
            .filter((w) => w !== "").reduce((all, w, at) => (at ? Phrase.joined([all, " · ", w]) : w), "")), "Quiet").hidesEmpty(),
        ]).grow(),
        ui.when(neighbour(1), ui.pressable(GOES_LATER, neighbour(1).map((l) => ({ parameter: l })), [ui.text("›", "Arrow")], "Pressable ArrowButton").goesTo(LIZARD)),
      ], "StripTop"),
      ui.when(row, ui.row([
        ui.column([ui.text(Phrase.of("Win"), "Engraving"), ui.text(row.map(winSaid), "Price")], "Book"),
        ui.column([ui.text(Phrase.of("Place"), "Engraving"), ui.text(row.map(placeSaid), "PaysFrom")], "Book").grow(),
        ui.button(OPENS_BET, { opens: betPopUp, with: lizard, style: "BellButton BetButton" }),
      ], "Books")),
      ui.text(row.map((r) => stakesSaid(r?.stakes)), "Stakes").wraps().hidesEmpty(),
    ]),
    ui.text(Phrase.of("Form"), "Tab FormTab"),
    ui.when(form, ui.column([
      ui.text(form.map((f) => careerSaid(f?.career)), "Career").wraps(),
      // the table holds its latest races only (FORM_MOST): said, so a long career isn't taken for a short one
      ui.text(form.map((f) => shownSaid(f)), "Small Quiet").hidesEmpty(),
      ui.when(starts.map((s) => s.length === 0), ui.text(Phrase.of("No races yet."), "Quiet")),
      ui.when(starts.map((s) => s.length > 0), ui.column([
        ui.surface("FormRow FormHead", [
          heading("Season"), heading("Stage", "Stage"), heading("Place"), heading("Time"), heading("Behind"), heading("Prize"),
          heading("Pct", "Pct"), heading("For age", "Pct"), heading("Downs"), heading("Knocks"), heading("Sprints"),
        ]),
        ui.each(starts, startRow, (s) => s.race, "FormRows"),
      ], "FormTable")),
    ]), ui.text(Phrase.of("Fetching its form…"), "Quiet")),
  ]);
}

/** The career line: races, wins, top threes, prize, and the average percentile of the races it finished. */
export function careerSaid(career) {
  if (!career) return "";
  const parts = [
    Phrase.counted("%d race", "%d races", career.races), Phrase.counted("%d win", "%d wins", career.wins),
    Phrase.with("%d in the top three", [career.topThree]), Phrase.with("%s won", [credits(career.prize)]),
  ];
  if (career.averageBand != null) parts.push(Phrase.with("percentile %d on average", [career.averageBand]));
  return Phrase.joined(parts.flatMap((part, at) => (at ? [" · ", part] : [part])));
}

/** How much of its history the table shows: all of it, or its latest so many of its career. */
export function shownSaid(form) {
  if (!form || !form.starts.length) return "";
  const shown = form.starts.length;
  const all = form.career.races;
  return shown < all ? Phrase.with("Its latest %d of %d races", [shown, all]) : Phrase.counted("Its only race", "All %d of its races", shown, "");
}
