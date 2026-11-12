// Three things Ian wanted plainer (12 Nov): "the joining and creating leagues
// needs to be more prominent and the fact that player is playing against
// everybody globally needs to be made more apparent - also any live streams
// need to be prominent too".
//
// - Everyone, worldwide: one line on the card and the result. Its number is a
//   true one the game already sends: the places in the game's own hour league
//   (ToShow 3), "85 players in this hour's league". With no tables yet, the
//   words alone.
// - Leagues: "Make a league" and "Join with a code" where the player is, each
//   opening the leagues page at its form.
// - Live now: who is streaming Lizarding, from the platform's list (the same
//   lizarding_live that lizarding.com draws), asked every two minutes while
//   playing. Nothing is shown while nobody is live.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=a978f762e875";

export const AIMS_MAKE = "aims_to_make_a_league";
export const AIMS_ENTER = "aims_to_enter_a_league";
export const WORDS = {
  [AIMS_MAKE]: ["Make a league"],
  [AIMS_ENTER]: ["Join with a code"],
};

const HOUR = 3600 * 1000;
export const LIVE_EVERY_MS = 2 * 60 * 1000;
export const ALL_STREAMS = "https://lizarding.com/#live";

/** The players in the game's own hour league (its table's places), or null while no table is held. */
export function playersThisHour(tables) {
  const hour = (tables ?? []).filter((t) => t.league.everyone && t.league.endsAt - t.league.startsAt <= HOUR + 1000);
  return hour.length ? Math.max(...hour.map((t) => t.places)) : null;
}

/** The worldwide line: the words, and the true count when there is one. */
export function worldwideSaid(tables) {
  const players = playersThisHour(tables);
  if (!players || players < 2) return Phrase.of("You're racing everyone, worldwide, on this one race");
  return Phrase.with("You're racing everyone, worldwide, on this one race · %d players in this hour's league", [players]);
}

/** Only an https address from the platform is linked: a provider's words are never trusted as an address. */
const safeUrl = (url) => (typeof url === "string" && /^https:\/\//.test(url) ? url : null);

/**
 * Who is live with Lizarding, as the platform lists them, asked while playing and never shown empty; and which
 * league form a press of "Make a league" or "Join with a code" opened the leagues page at.
 */
export class World extends Controller {
  constructor(chimes, play, { timers = globalThis } = {}) {
    super(chimes);
    this.play = play;
    this._timers = timers;
    this.streams = this.value([]);
    this.aim = this.value(null); // the leagues page's form to bring to the player: "make" or "enter", until it has
    this._timer = null;
  }

  answers() { return [AIMS_MAKE, AIMS_ENTER]; }

  told(action) {
    this.aim.setValue(action === AIMS_MAKE ? "make" : "enter");
    return null;
  }

  /** Asked now and every two minutes after, until stopped. */
  follow() {
    if (this._timer !== null) return;
    this.look();
    this._timer = this._timers.setInterval(() => this.look(), LIVE_EVERY_MS);
  }

  async look() {
    const done = await this.play.line.platform("lizarding_live", {});
    // kept as it was when the platform doesn't answer
    if (!done.ok || !Array.isArray(done.body)) return;
    this.streams.setValue(done.body.filter((s) => safeUrl(s.url) && s.name));
  }
}

/** "Make a league" and "Join with a code": each opens the leagues page at its form. */
export function describeLeagueAims(ui, leaguesScreen) {
  return ui.row([
    ui.pressable(AIMS_MAKE, {}, [ui.text(ui.words(AIMS_MAKE), "Face")], "Pressable LeagueAim").goesTo(leaguesScreen),
    ui.pressable(AIMS_ENTER, {}, [ui.text(ui.words(AIMS_ENTER), "Face")], "Pressable LeagueAim").goesTo(leaguesScreen),
  ], "LeagueAims");
}

/** The worldwide line, with the leagues' two presses beside it. */
export function describeWorldwide(ui, play, leaguesScreen) {
  return ui.surface("Worldwide", [
    ui.text(ui.bound(() => worldwideSaid(play.tables.read())), "WorldwideWords").wraps(),
    describeLeagueAims(ui, leaguesScreen),
  ]);
}

/** Live now: the first stream, and how many more, while anyone is live; nothing at all while nobody is. */
export function describeLiveNow(ui, world) {
  const first = world.streams.map((s) => s[0] ?? null);
  const more = world.streams.map((s) => Math.max(0, s.length - 1));
  return ui.when(world.streams.map((s) => s.length > 0), ui.row([
    ui.hyperlink(first.map((s) => safeUrl(s?.url) ?? ALL_STREAMS), [
      ui.text(Phrase.of("Live now"), "LiveBadge"),
      ui.text(first.map((s) => (s ? Phrase.with("%s is live on %s", [s.name, s.platform === "youtube" ? "YouTube" : "Twitch"]) : "")), "LiveWho"),
    ], "LiveLink"),
    ui.when(more.map((n) => n > 0), ui.hyperlink(ALL_STREAMS, [ui.text(more.map((n) => Phrase.with("+%d more", [n])), "Small")], "LiveMore")),
  ], "LiveNow"));
}
