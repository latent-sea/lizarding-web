// The leagues (the brief's section 8.7): the tables, fetched only as the
// screen opens or by its Refresh, one request at a time; the game's own
// leagues shortest first, then the friends' leagues the player is in, by
// name; a table's top ten, the player's own row framed and added below if
// they are further down; and making a friends' league, entering one by its
// code, leaving one, and copying its code for a friend.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=4a2c3c9acc21";
import { ANSWERED } from "./wire.js?v=4a2c3c9acc21";
import { UNITS, leagueOrder, leagueTitle, scoreSaid, timeLeft } from "./rules.js?v=4a2c3c9acc21";

export const LEAGUES = "leagues";
export const REFRESHES = "refreshes_the_tables";
export const SELECTS = "shows_a_league";
export const LEAVES = "leaves_the_league";
export const COPIES = "copies_the_code";
export const TYPES_LEAGUE = "types_a_league_name";
export const TYPES_LENGTH = "types_a_length";
export const PICKS_UNIT = "picks_a_unit";
export const MAKES = "makes_the_league";
export const TYPES_CODE = "types_a_code";
export const ENTERS = "enters_the_league";

export const WORDS = {
  [REFRESHES]: ["Refresh"],
  [SELECTS]: ["Show the league"],
  [LEAVES]: ["Leave"],
  [COPIES]: ["Copy"],
  [TYPES_LEAGUE]: ["League name"],
  [TYPES_LENGTH]: ["Length"],
  [PICKS_UNIT]: ["Unit"],
  [MAKES]: ["Make the league"],
  [TYPES_CODE]: ["Code"],
  [ENTERS]: ["Enter the league"],
};

export class Leagues extends Controller {
  constructor(chimes, play, { clipboard = globalThis.navigator?.clipboard, clock = () => Date.now() } = {}) {
    super(chimes);
    this.play = play;
    this._clipboard = clipboard;
    this._clock = clock;
    this.selected = this.value(null); // the league shown: an id
    this.asking = this.value(false);
    this.said = this.value("");
    this.copied = this.value("");
    this.name = this.value("");
    this.length = this.value("1");
    this.unit = this.value("Days");
    this.code = this.value("");
    this.busy = this.value(false); // making, entering or leaving
  }

  answers() { return [REFRESHES, SELECTS, LEAVES, COPIES, TYPES_LEAGUE, TYPES_LENGTH, PICKS_UNIT, MAKES, TYPES_CODE, ENTERS]; }

  /** The tables as listed: the game's own shortest first, then friends' leagues by name. */
  listed() {
    return [...(this.play.tables.read() ?? [])].sort((a, b) => leagueOrder(a.league, b.league));
  }

  /** The table shown: the one chosen, else the first. */
  shown() {
    const list = this.listed();
    return list.find((t) => t.league.id === this.selected.read()) ?? list[0] ?? null;
  }

  would(action) {
    const playing = this.play.game.read() !== null;
    if (!playing && [REFRESHES, LEAVES, MAKES, ENTERS].includes(action)) return Phrase.of("Connecting…");
    if (action === REFRESHES && this.asking.read()) return Phrase.of("Fetching the tables…");
    if ([LEAVES, MAKES, ENTERS].includes(action) && this.busy.read()) return Phrase.of("Waiting for the game…");
    if (action === MAKES) {
      if (!this.name.read().trim()) return Phrase.of("A league needs a name");
      if (!/^\d+$/.test(this.length.read().trim()) || Number(this.length.read()) <= 0) return Phrase.of("The length is a whole number above 0");
    }
    if (action === ENTERS && !this.code.read().trim()) return Phrase.of("Type the code a friend gave you");
    return null;
  }

  told(action, payload) {
    switch (action) {
      case REFRESHES: this.fetch(); break;
      case SELECTS: this.selected.setValue(payload.league); this.copied.setValue(""); break;
      case TYPES_LEAGUE: this.name.setValue(payload.line ?? ""); break;
      case TYPES_LENGTH: this.length.setValue(payload.line ?? ""); break;
      case PICKS_UNIT: this.unit.setValue(payload.unit); break;
      case TYPES_CODE: this.code.setValue(payload.line ?? ""); break;
      case COPIES: this._copy(); break;
      case MAKES: {
        const now = this._clock();
        const unit = UNITS.find(([name]) => name === this.unit._held)[1];
        this._change("make league", { name: this.name._held.trim(), startsAt: now, endsAt: now + Number(this.length._held) * unit }, () => { this.name.setValue(""); return this.play.game._held?.joined; });
        break;
      }
      case ENTERS: this._change("enter league", { code: this.code._held.trim() }, () => { this.code.setValue(""); return this.play.game._held?.joined; }); break;
      case LEAVES: this._change("leave league", { league: this.shown()?.league.id }, () => null); break;
      default: break;
    }
    return null;
  }

  /** The tables asked for: what comes is in play.tables. */
  async fetch() {
    if (this.asking._held) return;
    this.asking.setValue(true);
    const answer = await this.play.send("show tables", {});
    this.asking.setValue(false);
    this.said.setValue(answer.kind === ANSWERED.ACCEPTED ? "" : answer.reason);
  }

  /** A league made, entered or left; accepted, the tables again, and turned to the league it leads to. */
  async _change(kind, payload, then) {
    this.busy.setValue(true);
    this.said.setValue("");
    const answer = await this.play.send(kind, payload);
    this.busy.setValue(false);
    if (answer.kind !== ANSWERED.ACCEPTED) { this.said.setValue(answer.reason); return; }
    this.selected.setValue(then());
    await this.fetch();
  }

  async _copy() {
    const code = this.shown()?.league.code;
    if (!code) return;
    try {
      await this._clipboard.writeText(code);
      this.copied.setValue(Phrase.of("The code is copied: paste it to a friend"));
    } catch {
      this.copied.setValue(Phrase.with("Copying was refused: the code is %s", [code]));
    }
  }
}

export function describeLeagues(ui, play, leagues) {
  const list = ui.bound(() => leagues.listed());
  const shown = ui.bound(() => leagues.shown());
  const own = play.game.map((g) => g?.seat ?? null);
  // the top rows, then the player's own if further down
  const rows = ui.bound(() => {
    const table = shown.read();
    if (!table) return [];
    const seat = own.read();
    const made = table.rows.map((row, at) => ({ key: `r${at}`, place: at + 1, player: row.player, score: row.score, own: row.seat === seat }));
    if (table.ownPlace > table.rows.length && !made.some((row) => row.own)) {
      made.push({ key: "own", place: table.ownPlace, player: play.game.read()?.player, score: table.ownScore, own: true, apart: true });
    }
    return made;
  });
  const left = ui.bound(() => { const t = shown.read(); if (!t) return ""; const l = timeLeft(t.league.endsAt, play.now.read()); return l ? Phrase.with(...l) : Phrase.of("Ended"); });
  const nameOf = (player) => play.nameOf(player) ?? Phrase.with("Player %d", [player ?? 0]);
  const unitChoice = (name) => ui.pressable(PICKS_UNIT, { unit: name }, [ui.text(Phrase.of(name), "Small")], "Segment").currentWhile(leagues.unit.map((u) => u === name));
  return ui.screen(LEAGUES, [
    ui.text(Phrase.of("Leagues"), "Title"),
    ui.when(ui.bound(() => leagues.asking.read() && !play.tables.read()), ui.text(Phrase.of("Fetching the tables…"), "Quiet")),
    ui.text(leagues.said, "Said").wraps().hidesEmpty(),
    ui.when(ui.bound(() => play.tables.read() !== null && list.read().length === 0), ui.text(Phrase.of("No league is running just now."), "Quiet")),
    ui.row([
      ui.eachAcross(list, (held) => ui.pressable(SELECTS, held.map((t) => ({ league: t?.league.id ?? null })), [
        ui.text(held.map((t) => (t ? leagueTitle(t.league) : "")), "Face"),
        ui.text(held.map((t) => (t ? scoreSaid(t.ownScore) : "")), "Small Quiet"),
      ], "Pressable LeagueChoice").currentWhile(ui.bound(() => shown.read()?.league.id === held.read()?.league.id)), (t) => t.league.id, "LeagueList"),
      ui.when(shown, ui.surface("Card LeagueTable", [
        ui.row([
          ui.text(shown.map((t) => (t ? leagueTitle(t.league) : "")), "Words").grow(),
          ui.text(left, "Small Quiet"),
        ], "TableTop"),
        ui.text(shown.map((t) => (t ? Phrase.with("Your score %s", [scoreSaid(t.ownScore)]) : "")), "Price"),
        ui.when(shown.map((t) => t && !t.league.everyone), ui.column([
          ui.row([ui.text(shown.map((t) => (t ? Phrase.with("Code %s", [t.league.code]) : "")), "Code").grow(), ui.button(COPIES, { style: "Pressable" })], "CodeRow"),
          ui.text(leagues.copied, "Small Notice").wraps().hidesEmpty(),
        ])),
        ui.each(rows, (held) => ui.surface(held.map((r) => `TableRow${r?.own ? " Own" : ""}${r?.apart ? " Apart" : ""}`), [ui.row([
          ui.text(held.map((r) => String(r?.place ?? "")), "Place"),
          ui.text(ui.bound(() => nameOf(held.read()?.player)), "Face").grow(),
          ui.text(held.map((r) => (r ? scoreSaid(r.score) : "")), "Score"),
        ])]), (r) => r.key, "TableRows"),
        ui.text(shown.map((t) => (t && t.ownPlace > 0 ? Phrase.with("Place %d of %d", [t.ownPlace, t.places]) : "")), "Small Quiet").hidesEmpty(),
        ui.row([
          ui.button(REFRESHES, { style: "Pressable" }),
          ui.when(shown.map((t) => t && !t.league.everyone), ui.button(LEAVES, { style: "Pressable Danger" })),
        ], "TableActions"),
      ])),
    ], "LeaguesBody"),
    ui.surface("Card LeagueForm", [
      ui.text(Phrase.of("Make a league"), "PartHeading"),
      ui.field(MAKES, "", { label: Phrase.of("Its name"), changes: TYPES_LEAGUE, shows: leagues.name, autocomplete: "off" }),
      ui.row([
        ui.field(MAKES, "LengthField", { label: Phrase.of("How long"), changes: TYPES_LENGTH, shows: leagues.length, kind: "number", autocomplete: "off" }),
        ui.row(UNITS.map(([name]) => unitChoice(name)), "Segments Units"),
      ], "LengthRow"),
      ui.button(MAKES),
      ui.text(Phrase.of("You are in it as you make it; give its code to friends."), "Small Quiet").wraps(),
    ]),
    ui.surface("Card LeagueForm", [
      ui.text(Phrase.of("Enter a code"), "PartHeading"),
      ui.field(ENTERS, "", { label: Phrase.of("The code a friend gave you"), changes: TYPES_CODE, shows: leagues.code, autocomplete: "off" }),
      ui.button(ENTERS),
    ]),
  ]);
}
