// The bet pop-up (the brief's section 8.3): a runner's two books, Win and
// Place, each keeping a stake of its own - typed, or a share of the
// balance - what each returns, and the bets placed: win first, then place
// once the win was accepted. One bet is in flight at a time. A bet the
// game declines says why, here and as a notice; one that failed can be
// tried again, on whichever card is open then. Accepted, the pop-up closes.
// There is no taking a bet back.

import { Controller, Phrase, Ui } from "./gd_chime/gd_chime.js?v=3c28468398f2";
import { ANSWERED, BOOK } from "./wire.js?v=3c28468398f2";
import { POINTS, SHARES, oddsSaid, ordinal, placeReturns, shareOf, threeFigures, winReturns } from "./rules.js?v=3c28468398f2";
import { credits, nameSaid, runnersOf, square } from "./parts.js?v=3c28468398f2";
import { OPENS_BET } from "./card.js?v=3c28468398f2";

export const PICKS_BOOK = "picks_a_book";
export const TYPES_STAKE = "types_a_stake";
export const PICKS_SHARE = "stakes_a_share";
export const PLACES_BETS = "places_the_bets";
export const TRIES_AGAIN = "tries_the_bet_again";

export const WORDS = {
  [PICKS_BOOK]: ["Book"],
  [TYPES_STAKE]: ["Stake"],
  [PICKS_SHARE]: ["Share of the balance"],
  [PLACES_BETS]: ["Place the bet"],
  [TRIES_AGAIN]: ["Try again"],
};

const BOOKS = ["win", "place"];

export class Betting extends Controller {
  constructor(chimes, play) {
    super(chimes);
    this.play = play;
    this.lizard = this.value(null);
    this.book = this.value("win");
    this.stakes = this.value({ win: "", place: "" });
    this.sending = this.value(false);
    this.said = this.value(""); // the game's words on the last bet, or the client's on a lost one
    this.failed = this.value(null); // { book, stake }: a bet that failed, to be tried again
    this.close = () => {}; // set by the site: the pop-up closed
    this._made = 0; // which making-up this is: a bet answered after the pop-up was let go changes nothing
  }

  answers() { return [OPENS_BET, PICKS_BOOK, TYPES_STAKE, PICKS_SHARE, PLACES_BETS, TRIES_AGAIN]; }

  /** Everything being made up let go. */
  reset(lizard = null) {
    this._made++;
    this.sending.setValue(false);
    this.lizard.setValue(lizard);
    this.book.setValue("win");
    this.stakes.setValue({ win: "", place: "" });
    this.said.setValue("");
    this.failed.setValue(null);
  }

  /** The bets as made up: [{ book, stake }] for each book with a stake, win first. */
  made() {
    const stakes = this.stakes.read();
    return BOOKS.filter((book) => stakes[book].trim() !== "").map((book) => ({ book, stake: stakes[book].trim() }));
  }

  /** Why these bets can't be sent, in the client's words, or null. */
  problem(bets) {
    const card = this.play.openCard();
    if (!card) return Phrase.of("No race is open");
    const lizard = this.lizard.read();
    if (!card.runners.some((r) => r.lizard === lizard)) return Phrase.with("Lizard %d is not running in race %d", [lizard ?? 0, card.race]);
    if (!bets.length || bets.some((bet) => !/^\d+$/.test(bet.stake) || Number(bet.stake) <= 0)) return Phrase.of("The stake is a whole number of credits");
    const balance = this.play.game.read().balance;
    if (bets.reduce((sum, bet) => sum + Number(bet.stake), 0) > balance) return Phrase.with("The stake is more than the balance of %s", [credits(balance)]);
    return null;
  }

  would(action, payload) {
    if (action === PLACES_BETS) {
      if (this.sending.read()) return Phrase.of("Placing the bet…");
      return this.problem(this.made());
    }
    if (action === TRIES_AGAIN) {
      if (this.sending.read()) return Phrase.of("Placing the bet…");
      const failed = this.failed.read();
      return failed ? this.problem([failed]) : Phrase.of("Nothing failed");
    }
    if (action === PICKS_SHARE && !this.play.game.read()) return Phrase.of("The balance isn't known yet");
    return null;
  }

  told(action, payload) {
    if (action === OPENS_BET) this.reset(payload.parameter ?? null);
    else if (action === PICKS_BOOK) this.book.setValue(payload.book);
    else if (action === TYPES_STAKE) this._stake(this.book._held, payload.line ?? "");
    else if (action === PICKS_SHARE) this._stake(this.book._held, String(shareOf(this.play.game._held.balance, payload.percent)));
    else if (action === PLACES_BETS) this._send(this.made());
    else if (action === TRIES_AGAIN) this._send([this.failed._held]);
    return null;
  }

  _stake(book, line) { this.stakes.update((held) => ({ ...held, [book]: line })); }

  /** Each bet sent in turn, win first, the next only once the last was accepted. */
  async _send(bets) {
    const making = this._made;
    const lizard = this.lizard._held;
    this.sending.setValue(true);
    this.said.setValue("");
    this.failed.setValue(null);
    for (const bet of bets) {
      // the card open now: a bet tried again goes on the race open then
      const card = this.play.openCard();
      if (!card) { this.said.setValue(Phrase.of("No race is open")); break; }
      const answer = await this.play.send("bet", { race: card.race, lizard, book: BOOK[bet.book.toUpperCase()], stake: Number(bet.stake) });
      if (making !== this._made) return;
      if (answer.kind === ANSWERED.ACCEPTED) { this._stake(bet.book, ""); continue; }
      this.book.setValue(bet.book);
      this.said.setValue(answer.reason);
      if (answer.kind === ANSWERED.DECLINED) this.play.notice(answer.reason);
      else this.failed.setValue(bet);
      break;
    }
    this.sending.setValue(false);
    if (!this.made().length && !this.said._held) this.close();
  }
}

/** The pop-up: described once, opened by each runner's BET with its lizard. */
export function describeBetPopUp(ui, play, betting) {
  return ui.popUp("bet", () => {
    const row = ui.bound(() => (play.game.read() ? runnersOf(play).find((r) => r.lizard === betting.lizard.read()) ?? null : null));
    const stakeOf = (book) => betting.stakes.map((s) => s[book]);
    const typed = ui.bound(() => betting.stakes.read()[betting.book.read()]);
    // what a stake returns: for the stake typed, or for 1 before there is one
    const stake = ui.bound(() => { const s = typed.read().trim(); return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null; });
    const returns = ui.bound(() => {
      const r = row.read();
      if (!r) return [];
      const s = stake.read();
      if (betting.book.read() === "win") return [{ key: "win", place: Phrase.of("If it wins"), pays: s ? credits(winReturns(s, r.odds)) : Phrase.with("%s for 1", [oddsSaid(r.odds)]) }];
      const places = Math.min(play.openCard()?.runners.length ?? POINTS.length, POINTS.length);
      return Array.from({ length: places }, (_, at) => ({
        key: `p${at}`, place: ordinal(at + 1),
        pays: s ? credits(placeReturns(s, r.rating, at + 1)) : Phrase.with("%s for 1", [threeFigures(POINTS[at] * 100 / r.rating)]),
        profits: POINTS[at] * 100 > r.rating,
      }));
    });
    const tab = (book, words) => ui.pressable(PICKS_BOOK, { book }, [
      ui.text(Phrase.of(words), "Face"),
      ui.text(stakeOf(book).map((s) => (s.trim() ? credits(s.trim()) : "")), "TabStake").hidesEmpty(),
    ], "Tab BookTab").currentWhile(betting.book.map((b) => b === book));
    return ui.column([
      ui.row([
        square(ui, row.map((r) => r?.number ?? 0)),
        ui.text(row.map(nameSaid), "LizardName").grow(),
        ui.text(play.game.map((g) => (g ? credits(g.balance) : Phrase.of("Connecting…"))), "Price"),
      ], "BetTop"),
      ui.row([tab("win", "Win"), tab("place", "Place")], "BookTabs"),
      ui.field(PLACES_BETS, "StakeField", { label: Phrase.of("Stake, in credits"), changes: TYPES_STAKE, shows: typed, placeholder: Phrase.of("Credits"), autocomplete: "off" }),
      ui.row(SHARES.map((percent) => ui.pressable(PICKS_SHARE, { percent }, [ui.text(`${percent}%`, "Small")], "Segment Share")), "Shares"),
      ui.text(stake.map((s) => (s ? Phrase.with("What a stake of %s returns", [credits(s)]) : Phrase.of("What a stake of 1 returns"))), "Engraving"),
      ui.each(returns, (held) => ui.row([
        ui.text(held.map((r) => r?.place ?? ""), "Face").grow(),
        ui.text(held.map((r) => r?.pays ?? ""), held.map((r) => (r?.profits === false ? "Price Losing" : "Price"))),
      ], "Return"), (r) => r.key, "Returns"),
      ui.text(betting.said, "Said").wraps().hidesEmpty(),
      ui.when(betting.failed, ui.button(TRIES_AGAIN)),
      ui.row([
        ui.pressable(Ui.CLOSES, {}, [ui.text(Phrase.of("Cancel"), "Face")], "Pressable Cancel"),
        ui.pressable(PLACES_BETS, {}, [ui.column([
          ui.text(ui.bound(() => Phrase.of(betting.made().length > 1 ? "Place the bets" : "Place the bet")), "Face"),
          ui.reason("Reason"),
        ])], "BellButton").grow(),
      ], "BetActions"),
    ], "BetSheet");
  });
}
