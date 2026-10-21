// The race, then the result (the brief's section 8.4). As the countdown
// reaches 0 the app gives way to the race viewer (viewer.js), which plays
// the race as soon as the game shows it. THE RESULT IS HELD BACK: the batch
// carrying it may come while the race is still playing, and nothing of it is
// shown before the playback ends or is skipped. Then Race finished: each
// runner's place, time, how far behind, its knocks and sprint map, and the
// player's bets on it with what each paid. Continue goes back to the card.
// The game's Result holds every runner in place order, those that didn't
// finish last; a place bet pays at its place even on a runner that didn't
// finish (the game's rule, 7.2: at every place).
//
// What the result is drawn from is kept as the race starts - the card, the
// field and the player's bets - since the game lets go of races older than
// the last.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=45f52efbed9c";
import { readTelemetry, secondsAt } from "./telemetry.js?v=45f52efbed9c";
import { paid, ordinal } from "./rules.js?v=45f52efbed9c";
import { credits, square } from "./parts.js?v=45f52efbed9c";
import { sprintMap } from "./lizard.js?v=45f52efbed9c";
import { CARD } from "./card.js?v=45f52efbed9c";

export const RACE = "race";
export const RESULT = "result";
export const SKIPS = "skips_to_the_end";
export const CONTINUES = "goes_back_to_the_card";

export const WORDS = {
  [SKIPS]: ["Skip to the end"],
  [CONTINUES]: ["Continue"],
};

/** How long a race is waited for once its result is in, before the result is shown without it. */
const UNSEEN_MS = 8000;

export class Watching extends Controller {
  constructor(chimes, play, { timers = globalThis } = {}) {
    super(chimes);
    this.play = play;
    this._timers = timers;
    this.watched = this.value(null); // { race, card, field, bets }: what the race and its result are drawn from
    this.phase = this.value("off"); // "waiting" for the race, "playing" it, "over"
    this.played = null; // the telemetry, read
    this.view = null; // the viewer playing it
    this._unseen = null;
  }

  answers() { return [SKIPS, CONTINUES]; }

  would(action) { return action === SKIPS && this.phase.read() === "over" ? Phrase.of("The race is over") : null; }

  told(action) {
    if (action === SKIPS) { if (this.view) this.view.skip(); else this.over(); }
    if (action === CONTINUES) this.done();
    return null;
  }

  /** The open card's race watched: what its result needs kept now, before the game moves on. */
  start(card) {
    const game = this.play.game._held;
    this.view?.stop();
    this.view = null;
    this.played = null;
    this.watched.setValue({ race: card.race, card, field: this.play.fields._held.get(card.race) ?? null, bets: [...(game?.betsOn(card.race) ?? [])] });
    this.phase.setValue("waiting");
  }

  /** The race the game showed, read, if it is the one watched; null for another, or one that can't be read. */
  telemetryFor(shown) {
    const watched = this.watched._held;
    if (!watched || !shown || shown.race !== watched.race) return null;
    try { this.played = readTelemetry(shown.telemetry); } catch (error) {
      console.warn(`the race could not be read: ${error.message}`);
      this.played = null;
    }
    return this.played;
  }

  /** The result arrived: if the race never shows, the result is shown without it after a while. */
  resultCame() {
    if (this.phase._held !== "waiting" || this._unseen !== null) return;
    this._unseen = this._timers.setTimeout(() => { this._unseen = null; if (this.phase._held === "waiting") this.over(); }, UNSEEN_MS);
  }

  playing() { this.phase.setValue("playing"); }

  over() {
    this.view?.stop();
    this.phase.setValue("over");
  }

  done() {
    this.view?.stop();
    this.view = null;
    this.phase.setValue("off");
  }

  /** The result's rows, 1st down, those that didn't finish last: [] until the result may be shown. */
  rows() {
    const watched = this.watched.read();
    if (!watched || this.phase.read() !== "over") return [];
    const game = this.play.game.read();
    const result = game?.results.get(watched.race) ?? null;
    const outcomes = this.played?.outcomes ?? null;
    const runners = watched.card.runners;
    const finished = (index) => outcomes?.[index]?.finished !== false && !outcomes?.[index]?.dnf;
    // the game's order where it has given it; else the race's own placings
    let order = result ? [...result.order] : null;
    if (!order && outcomes) order = runners.map((r, i) => ({ r, i })).sort((a, b) => (outcomes[a.i].placement || 99) - (outcomes[b.i].placement || 99)).map(({ r }) => r.lizard);
    if (!order) return [];
    const indexOf = (lizard) => runners.findIndex((r) => r.lizard === lizard);
    // every runner in place order, as the game places them: finishers by time, then those that didn't
    // finish, by how near the line they got - a place bet pays at its place either way
    const winner = order.find((lizard) => finished(indexOf(lizard)));
    const winnerTime = outcomes && winner !== undefined ? secondsAt(outcomes[indexOf(winner)].finishTick) : null;
    return order.map((lizard) => {
      const index = indexOf(lizard);
      const runner = runners[index];
      const outcome = outcomes?.[index] ?? null;
      const shown = watched.field?.runners.find((r) => r.lizard === lizard) ?? null;
      const place = order.indexOf(lizard) + 1;
      const done = finished(index);
      const time = done && outcome ? secondsAt(outcome.finishTick) : null;
      const bets = watched.bets.filter((bet) => bet.lizard === lizard).map((bet, at) => ({
        key: at, book: bet.book, stake: bet.stake, paid: result ? paid(bet, runner.odds, runner.rating, place) : null,
      }));
      return {
        lizard, number: index + 1, name: shown?.name ?? null, stable: shown?.stable ?? null, age: shown?.age ?? null, place: done ? place : 0,
        time, behind: time !== null && winnerTime !== null ? time - winnerTime : null,
        downs: outcome?.timesKnockedDown ?? null, knocks: outcome?.knockoffsDealt ?? null, sprints: outcome?.sprintTimeS ?? [], bets,
      };
    });
  }
}

export function describeRace(ui, play, watching) {
  const watched = watching.watched;
  const stageName = watched.map((w) => w?.field?.course.name || "");
  return ui.screen(RACE, [
    ui.row([
      ui.text(ui.bound(() => (watched.read() ? Phrase.with("Race %d", [watched.read().race]) : "")), "Engraving"),
      ui.text(stageName, "Words").grow(),
      ui.button(SKIPS, { style: "Pressable" }),
    ], "RaceTop"),
    ui.when(watching.phase.map((p) => p === "waiting"), ui.text(Phrase.of("The race is about to run…"), "Quiet Waiting")),
    ui.surface("RaceView", []).named("race-view"),
  ]);
}

export function describeResult(ui, play, watching) {
  const rows = ui.bound(() => watching.rows());
  const watched = watching.watched;
  const winner = rows.map((list) => list[0] ?? null);
  const everyone = ui.bound(() => { const s = play.stakes.read(); return s && s.race === watched.read()?.race ? s : null; });
  const paidSaid = (bet) => {
    const book = bet.book === 0 ? Phrase.of("to win") : Phrase.of("to place");
    if (bet.paid === null) return Phrase.joined([credits(bet.stake), " ", book, Phrase.of(": settling…")]);
    return Phrase.joined([credits(bet.stake), " ", book, Phrase.with(": paid %s", [credits(bet.paid)])]);
  };
  const row = (held) => ui.surface(held.map((r) => `ResultRow${r?.bets.length ? " Backed" : ""}`), [
    ui.row([
      ui.text(held.map((r) => (!r ? "" : r.place ? ordinal(r.place) : Phrase.of("DNF"))), "Place"),
      square(ui, held.map((r) => r?.number ?? 0)),
      ui.column([
        ui.text(held.map((r) => r?.name ?? Phrase.with("Lizard %d", [r?.lizard ?? 0])), "LizardName"),
        ui.text(held.map((r) => [r?.stable === "" ? Phrase.of("From the wild") : r?.stable ?? "", r?.age != null ? Phrase.with("%s years old", [r.age.toFixed(1)]) : ""]
          .filter((w) => w !== "").reduce((all, w, at) => (at ? Phrase.joined([all, " · ", w]) : w), "")), "Small Quiet").hidesEmpty(),
      ]).grow(),
      ui.column([
        ui.text(held.map((r) => (r?.time != null ? `${r.time.toFixed(2)} s` : "–")), "Price"),
        ui.text(held.map((r) => (r?.behind ? `+${r.behind.toFixed(2)} s` : "")), "Small Quiet").hidesEmpty(),
      ], "Times"),
    ], "ResultTop"),
    ui.row([
      ui.text(held.map((r) => (r?.downs != null ? Phrase.with("Downs %d", [r.downs]) : "")), "Small").hidesEmpty(),
      ui.text(held.map((r) => (r?.knocks != null ? Phrase.with("Knock-downs %d", [r.knocks]) : "")), "Small").hidesEmpty(),
      sprintMap(ui, held.map((r) => r?.sprints ?? [])),
    ], "ResultStats"),
    ui.each(held.map((r) => r?.bets ?? []), (bet) => ui.text(bet.map((b) => (b ? paidSaid(b) : "")), "Paid"), (b) => b.key, "ResultBets"),
    ui.text(ui.bound(() => {
      const s = everyone.read();
      const lizard = held.read()?.lizard;
      const staked = s?.everyone.find((e) => e.lizard === lizard);
      return staked ? Phrase.with("Everyone staked %s to win, %s to place", [credits(staked.toWin), credits(staked.toPlace)]) : "";
    }), "Small Quiet").hidesEmpty(),
  ]);
  return ui.screen(RESULT, [
    ui.text(Phrase.of("Race finished"), "Title"),
    ui.text(watched.map((w) => w?.field?.course.name || (w ? Phrase.with("Race %d", [w.race]) : "")), "Words"),
    ui.text(winner.map((w) => (w?.time != null ? Phrase.with("Won in %s seconds", [w.time.toFixed(2)]) : "")), "Quiet").hidesEmpty(),
    ui.text(play.game.map((g) => (g ? Phrase.with("Your balance is %s", [credits(g.balance)]) : "")), "Price").hidesEmpty(),
    ui.each(rows, row, (r) => r.lizard, "ResultRows"),
    ui.button(CONTINUES, { goes_to: CARD }),
  ]);
}
