// The race, then the result (the brief's section 8.4). As the countdown
// reaches 0 the app gives way to the race viewer (viewer.js), which plays
// the race as soon as the game shows it - slower or faster, paused, or from
// anywhere on its slider, following the lizard the player chooses. THE RESULT IS HELD BACK: the batch
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

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=532e313549a4";
import { readTelemetry, secondsAt } from "./telemetry.js?v=532e313549a4";
import { paid, ordinal } from "./rules.js?v=532e313549a4";
import { credits, square } from "./parts.js?v=532e313549a4";
import { sprintMap } from "./lizard.js?v=532e313549a4";
import { CARD } from "./card.js?v=532e313549a4";

export const RACE = "race";
export const RESULT = "result";
export const SKIPS = "skips_to_the_end";
export const CONTINUES = "goes_back_to_the_card";
export const FOLLOWS = "follows_a_lizard";
export const REVIEWS = "shows_the_last_race";
export const SLOWER = "plays_the_race_slower";
export const FASTER = "plays_the_race_faster";
export const PAUSES = "pauses_or_plays_the_race";

export const WORDS = {
  [SKIPS]: ["Skip to the end"],
  [CONTINUES]: ["Continue"],
  [FOLLOWS]: ["Follow"],
  [REVIEWS]: ["See the result"],
  [SLOWER]: ["Slower"],
  [FASTER]: ["Faster"],
  [PAUSES]: ["Pause"],
};

/** The speeds a race may be watched at, the first real speed's quarter, the last eight times it. */
export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);

/** How long a race is waited for once its result is in, before the result is shown without it. */
const UNSEEN_MS = 8000;

export class Watching extends Controller {
  constructor(chimes, play, { timers = globalThis } = {}) {
    super(chimes);
    this.play = play;
    this._timers = timers;
    this.watched = this.value(null); // { race, card, field, bets }: what the race and its result are drawn from
    this.speed = this.value(1); // how many times real speed the race plays at
    this.paused = this.value(false);
    this.follow = this.value(null); // the runner the camera follows, by index on the card: null for the leader
    this.phase = this.value("off"); // "waiting" for the race, "playing" it, "over"
    this.played = null; // the telemetry, read
    this.view = null; // the viewer playing it
    this._unseen = null;
  }

  answers() { return [SKIPS, CONTINUES, FOLLOWS, SLOWER, FASTER, PAUSES, REVIEWS]; }

  would(action) {
    if (action === SKIPS && this.phase.read() === "over") return Phrase.of("The race is over");
    if (action === SLOWER && this.speed.read() === SPEEDS[0]) return Phrase.of("This is the slowest");
    if (action === FASTER && this.speed.read() === SPEEDS.at(-1)) return Phrase.of("This is the fastest");
    return null;
  }

  told(action, payload = {}) {
    if (action === SKIPS) { if (this.view) this.view.skip(); else this.over(); }
    if (action === CONTINUES) this.done();
    if (action === FOLLOWS) this.follow.setValue(payload.index ?? null);
    if (action === REVIEWS) this.review(payload.race);
    if (action === SLOWER || action === FASTER) {
      const at = SPEEDS.indexOf(this.speed._held);
      this.speed.setValue(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + (action === FASTER ? 1 : -1)))]);
    }
    if (action === PAUSES) this.paused.update((paused) => !paused);
    return null;
  }

  /** The open card's race watched: what its result needs kept now, before the game moves on. */
  start(card) {
    const game = this.play.game._held;
    this.view?.stop();
    this.view = null;
    this.played = null;
    const bets = [...(game?.betsOn(card.race) ?? [])];
    this.watched.setValue({ race: card.race, card, field: this.play.fields._held.get(card.race) ?? null, bets });
    this.follow.setValue(mostStakedOn(card, bets));
    this.paused.setValue(false);
    this.phase.setValue("waiting");
  }

  /**
   * A race that has run, its result shown without the race itself: a race
   * missed while away. The game shows a race only as it runs, so there is
   * nothing to play; names come from the field, or from form asked for.
   */
  review(race) {
    const game = this.play.game._held;
    const card = game?.cards.get(race);
    if (!card) return;
    this.view?.stop();
    this.view = null;
    this.played = null;
    this.watched.setValue({ race, card, field: this.play.fields._held.get(race) ?? null, bets: [...game.betsOn(race)] });
    for (const runner of card.runners) this.play.askForm(runner.lizard);
    this.phase.setValue("over");
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

  /** The runners the player has bets on, by their index on the card. */
  backed() {
    const watched = this.watched._held;
    if (!watched) return new Set();
    return new Set(watched.bets.map((bet) => watched.card.runners.findIndex((r) => r.lizard === bet.lizard)).filter((at) => at >= 0));
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
      const shown = watched.field?.runners.find((r) => r.lizard === lizard) ?? this.play.forms.read().get(lizard) ?? null;
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

/** The runner (by index on the card) the player has staked most on, win and place together; null with no bets: the leader is followed. */
export function mostStakedOn(card, bets) {
  const staked = card.runners.map((r) => bets.filter((bet) => bet.lizard === r.lizard).reduce((sum, bet) => sum + bet.stake, 0));
  const most = Math.max(0, ...staked);
  return most > 0 ? staked.indexOf(most) : null;
}

export function describeRace(ui, play, watching, info = null) {
  const watched = watching.watched;
  const stageName = watched.map((w) => w?.field?.course.name || "");
  return ui.screen(RACE, [
    ui.row([
      ui.text(ui.bound(() => (watched.read() ? Phrase.with("Race %d", [watched.read().race]) : "")), "Engraving"),
      ui.text(stageName, "Words").grow(),
      ...(info ? [info] : []),
      ui.button(SKIPS, { style: "Pressable" }),
    ], "RaceTop"),
    ui.when(watching.phase.map((p) => p === "waiting"), ui.text(Phrase.of("The race is about to run…"), "Quiet Waiting")),
    ui.surface("RaceView", []).named("race-view"),
    ui.text(Phrase.of("White frame and marker: your bet · flashing: sprinting · flattened: knocked down · blue: swimming"), "Small Quiet RaceKey").wraps(),
    // how it plays: slower, paused or played on, faster; the slider under the picture is drawn with it (site.js)
    ui.row([
      ui.button(SLOWER, { style: "Pressable" }),
      ui.pressable(PAUSES, {}, [ui.text(watching.paused.map((p) => Phrase.of(p ? "Play" : "Pause")), "Face")], "Pressable"),
      ui.button(FASTER, { style: "Pressable" }),
      ui.text(watching.speed.map((s) => `${s}×`), "Price SpeedSaid"),
    ], "SpeedRow"),
    // who the camera follows: the leader, or any runner - the player's own framed
    ui.row([
      ui.text(Phrase.of("Follow"), "Engraving"),
      ui.pressable(FOLLOWS, { index: null }, [ui.text(Phrase.of("Leader"), "Small")], "Segment FollowLeader").currentWhile(watching.follow.map((f) => f === null)),
      ui.eachAcross(ui.bound(() => {
        const watched = watching.watched.read();
        const backed = watched ? new Set(watched.bets.map((bet) => bet.lizard)) : new Set();
        return (watched?.card.runners ?? []).map((r, index) => ({ index, number: index + 1, backed: backed.has(r.lizard) }));
      }), (held) => ui.pressable(FOLLOWS, held.map((r) => ({ index: r?.index ?? null })), [
        ui.text(held.map((r) => String(r?.number ?? "")), held.map((r) => `Square Runner${r?.number ?? 0}`)),
      ], held.map((r) => `FollowRunner${r?.backed ? " Backed" : ""}`)).currentWhile(ui.bound(() => watching.follow.read() === held.read()?.index)), (r) => r.index, "FollowList"),
    ], "FollowRow"),
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
    // Continue at the top, beside the title: back to the card without scrolling past the field
    ui.row([ui.text(Phrase.of("Race finished"), "Title").grow(), ui.button(CONTINUES, { goes_to: CARD })], "ResultHead"),
    ui.text(watched.map((w) => w?.field?.course.name || (w ? Phrase.with("Race %d", [w.race]) : "")), "Words"),
    ui.text(winner.map((w) => (w?.time != null ? Phrase.with("Won in %s seconds", [w.time.toFixed(2)]) : "")), "Quiet").hidesEmpty(),
    ui.text(play.game.map((g) => (g ? Phrase.with("Your balance is %s", [credits(g.balance)]) : "")), "Price").hidesEmpty(),
    ui.each(rows, row, (r) => r.lizard, "ResultRows"),
  ]);
}

/** The last race that ran, if the player had bets on it: { race, staked, paid }, else null. */
export function lastRaceOf(game) {
  const race = game?.lastRace();
  if (race === null || race === undefined) return null;
  const bets = game.betsOn(race);
  if (!bets.length) return null;
  const card = game.cards.get(race);
  const order = game.results.get(race)?.order ?? [];
  const staked = bets.reduce((sum, bet) => sum + bet.stake, 0);
  const won = bets.reduce((sum, bet) => {
    const runner = card.runners.find((r) => r.lizard === bet.lizard);
    return sum + paid(bet, runner.odds, runner.rating, order.indexOf(bet.lizard) + 1);
  }, 0);
  return { race, staked, paid: won };
}
