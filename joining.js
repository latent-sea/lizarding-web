// Joining two accounts of one player into one (the platform's
// platform/sql/joins.sql, live since 21 Oct 2026): a guest in two browsers,
// a guest and a Google account, a browser and Steam. One device asks for a
// code and shows it; the other, signed in with the other account, enters it.
//
// Which account is kept is the platform's rule: the one with a sign-in of
// its own (Google, Steam or an email) if only one has; otherwise the one that
// asked. The game folds the other's seat in by its own rules - the larger of
// the two purses, the kept account's name - once any bet of it has settled.
// A device whose account was the one let go is signed in again at once,
// which makes it the kept account, and rejoins the game.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=4a2c3c9acc21";

export const ASKS_CODE = "asks_for_a_join_code";
export const CANCELS_CODE = "stops_showing_the_code";
export const TYPES_CODE = "types_a_join_code";
export const JOINS = "joins_the_accounts";

export const WORDS = {
  [ASKS_CODE]: ["Join another account"],
  [CANCELS_CODE]: ["Cancel"],
  [TYPES_CODE]: ["Code"],
  [JOINS]: ["Join the accounts"],
};

/** How often the device showing a code asks whether it has been used. */
const POLL_MS = 3000;

/** The platform's answers to a code handed in, in words for the player. */
const REFUSED = {
  unknown: "That code isn't one we know. Check it, and try again.",
  expired: "That code has run out: ask for a new one on your other device.",
  used: "That code has been used already: ask for a new one.",
  same_account: "That code is this account's own: enter it on your other device, signed in with the other account.",
  too_many_guesses: "Too many wrong codes: wait ten minutes, then try again.",
};

export class Joining extends Controller {
  constructor(chimes, play, { timers = globalThis, clock = () => Date.now() } = {}) {
    super(chimes);
    this.play = play;
    this._timers = timers;
    this._clock = clock;
    this.code = this.value(null); // { code, expiresAt }: the code this device shows
    this.typed = this.value("");
    this.busy = this.value(false);
    this.said = this.value("");
    this._poll = null;
  }

  answers() { return [ASKS_CODE, CANCELS_CODE, TYPES_CODE, JOINS]; }

  would(action) {
    if ((action === ASKS_CODE || action === JOINS) && this.play.account.read().state !== "in") return Phrase.of("Signing in…");
    if ((action === ASKS_CODE || action === JOINS) && this.busy.read()) return Phrase.of("Waiting for the platform…");
    if (action === JOINS && this.typed.read().replace(/[\s-]/g, "").length !== 8) return Phrase.of("A code is 8 letters and digits");
    return null;
  }

  told(action, payload) {
    if (action === ASKS_CODE) this.ask();
    else if (action === CANCELS_CODE) this.stop();
    else if (action === TYPES_CODE) this.typed.setValue(payload.line ?? "");
    else if (action === JOINS) this.accept();
    return null;
  }

  /** A code asked for, shown, and watched until it is used or runs out. */
  async ask() {
    this.busy.setValue(true);
    this.said.setValue("");
    const done = await this.play.line.platform("platform_join_request", {});
    this.busy.setValue(false);
    if (!done.ok || !done.body?.code) { this.said.setValue(Phrase.with("No code could be made: %s", [done.error ?? ""])); return; }
    this.code.setValue({ code: done.body.code, expiresAt: Date.parse(done.body.expires_at) });
    this._watch();
  }

  stop() {
    if (this._poll !== null) this._timers.clearTimeout(this._poll);
    this._poll = null;
    this.code.setValue(null);
  }

  _watch() {
    this._poll = this._timers.setTimeout(async () => {
      this._poll = null;
      const shown = this.code._held;
      if (!shown) return;
      const done = await this.play.line.platform("platform_join_status", { code: shown.code });
      if (this.code._held !== shown) return;
      const status = done.ok ? done.body?.status : null;
      if (status === "joined") { this.stop(); this._joined(done.body.survivor); return; }
      if (status === "expired" || (status === null && this._clock() > shown.expiresAt)) {
        this.stop();
        this.said.setValue(Phrase.of("The code ran out before it was used. Ask for a new one if you still want to join."));
        return;
      }
      this._watch();
    }, POLL_MS);
  }

  /** A code from the other device handed in. */
  async accept() {
    this.busy.setValue(true);
    this.said.setValue("");
    const done = await this.play.line.platform("platform_join_accept", { code: this.typed._held.trim() });
    this.busy.setValue(false);
    const status = done.ok ? done.body?.status : null;
    if (status === "joined") { this.typed.setValue(""); this._joined(done.body.survivor); return; }
    if (status && REFUSED[status]) { this.said.setValue(Phrase.of(REFUSED[status])); return; }
    // the platform raised: a game not ready for joins above all; nothing changed
    this.said.setValue(Phrase.with("The accounts couldn't be joined, and nothing has changed: %s", [done.error ?? status ?? ""]));
  }

  /** Joined: kept, this device plays on; let go, it signs in again as the account kept, and rejoins. */
  _joined(survivor) {
    const kept = survivor === this.play.account._held.user;
    this.said.setValue(Phrase.of(kept
      ? "Joined: the other account's play is folded into this one. Its credits come over once any race it bet on has run."
      : "Joined: this device now plays the other account, with both accounts' play folded in."));
    if (!kept) this.play.line.renew();
  }
}

/** The account's join part: ask for a code, or enter one. */
export function describeJoining(ui, joining) {
  const shown = joining.code;
  return ui.column([
    ui.text(Phrase.of("Two accounts?"), "PartHeading"),
    ui.text(Phrase.of("If you've played in another browser, another device or on Steam, join the two into one. Ask for a code here, then enter it where you're signed in to the other - or the other way round."), "Hint").wraps(),
    ui.when(shown, ui.column([
      ui.text(Phrase.of("Enter this code on your other device, signed in with the other account:"), "Words").wraps(),
      ui.text(shown.map((c) => c?.code ?? ""), "JoinCode"),
      ui.text(Phrase.of("It works once, for ten minutes. This page will notice when it's used."), "Small Quiet").wraps(),
      ui.button(CANCELS_CODE, { style: "Pressable" }),
    ], "CodeShown"), ui.column([
      ui.button(ASKS_CODE, { style: "Pressable" }),
      ui.field(JOINS, "JoinField", { label: Phrase.of("Or enter the code your other device shows"), changes: TYPES_CODE, shows: joining.typed, placeholder: Phrase.of("XXXX-XXXX"), autocomplete: "off" }),
      ui.button(JOINS),
    ])),
    ui.text(Phrase.of("The account signed in with Google or Steam is the one kept; if both are, or neither, the one that asked for the code. You keep the larger of the two purses, and the kept account's name."), "Small Quiet").wraps(),
    ui.text(joining.said, "Said").wraps().hidesEmpty(),
  ], "Part");
}
