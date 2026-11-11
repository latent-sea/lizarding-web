// Lizarding news by email (T-682, latent-productions Projects/Lizarding/design/newsletter/plan.md):
// a forced Yes or No, the same words everywhere Lizarding asks, two equal
// buttons, neither picked out. No changes nothing: the player plays exactly the
// same. Asked once, at the door after the name, when the platform's newsletter
// function says to ask (source web-door); and always in Settings, which shows
// the answer and changes it (web-settings). A Yes asks for the address, filled
// in with a Google account's own. The function keeps every answer with its
// words and time, and hands a Yes to Brevo's double opt-in. Until it is set up
// (or before it is merged), none of this shows.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=0042a87f9e01";

export const SAYS_YES = "says_yes_to_lizarding_news";
export const SAYS_NO = "says_no_to_lizarding_news";
export const TYPES_EMAIL = "types_an_email_for_news";
export const SENDS_EMAIL = "sends_the_email_for_news";
export const STOPS_NEWS = "stops_lizarding_news";

// Version 1, word for word as the function keeps it. A new wording is a new version, never an edit.
export const WORDS_VERSION = 1;
export const QUESTION = "Email me Lizarding news? Get the demo and the Steam launch first: one email at each big moment, nothing else. We email you a link to confirm first, and every email has a link to stop them. Privacy policy: lizarding.com/privacy";

export const WORDS = {
  [SAYS_YES]: ["Yes, email me"],
  [SAYS_NO]: ["No thanks"],
  [TYPES_EMAIL]: ["Your email"],
  [SENDS_EMAIL]: ["Send me the link"],
  [STOPS_NEWS]: ["Stop the emails"],
};

/** How long the door waits for the platform's answer before letting the player in regardless. */
const LOOK_MS = 5000;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export class News extends Controller {
  constructor(chimes, play, { timers = globalThis } = {}) {
    super(chimes);
    this.play = play;
    this._timers = timers;
    this.me = this.value({ configured: false }); // the function's answer as it stands: { configured, state, email, ask }
    this.looking = this.value(false); // the door waits for the platform's first answer, a few seconds at most
    this.asking = this.value(null); // the source whose Yes is asking for the address, or null
    this.typed = this.value("");
    this.busy = this.value(false);
    this.said = this.value("");
    this._looked = false;
  }

  /** The door holds the player for the question: asked now, or the first answer still awaited. */
  holds() { return this.looking.read() || (this.me.read().configured === true && this.me.read().ask === true); }

  answers() { return [SAYS_YES, SAYS_NO, TYPES_EMAIL, SENDS_EMAIL, STOPS_NEWS]; }

  would(action) {
    if (this.busy.read() && action !== TYPES_EMAIL) return Phrase.of("Waiting for the platform…");
    if (action === SENDS_EMAIL && !EMAIL.test(this.typed.read().trim())) return Phrase.of("An email address, as name@example.com");
    return null;
  }

  told(action, payload) {
    if (action === SAYS_YES) {
      this.asking.setValue(payload?.source ?? "web-settings");
      // a Google account's own address, filled in and changeable; a guest has none
      if (!this.typed._held) this.typed.setValue(this.play.account._held?.email ?? "");
    } else if (action === SAYS_NO) this.answer(payload?.source ?? this.asking._held ?? "web-settings", false);
    else if (action === TYPES_EMAIL) this.typed.setValue(payload.line ?? "");
    else if (action === SENDS_EMAIL) this.answer(this.asking._held ?? "web-settings", true);
    else if (action === STOPS_NEWS) this.leave();
    return null;
  }

  /** The player's answer as it stands, asked once a session as the player is signed in; the door waits for it, a few seconds at most. */
  async look() {
    if (this._looked) return;
    this._looked = true;
    this.looking.setValue(true);
    const late = this._timers.setTimeout(() => this.looking.setValue(false), LOOK_MS);
    const done = await this.play.line.platform("newsletter/me", {});
    this._timers.clearTimeout(late);
    if (done.ok && done.body) this.me.setValue({ configured: done.body.configured === true, ...done.body });
    this.looking.setValue(false);
  }

  async answer(source, yes) {
    this.busy.setValue(true);
    this.said.setValue("");
    const body = { source, answer: yes ? "yes" : "no", words_version: WORDS_VERSION, ...(yes ? { email: this.typed._held.trim() } : {}) };
    const done = await this.play.line.platform("newsletter/answer", body);
    this.busy.setValue(false);
    if (!done.ok) { this.said.setValue(Phrase.with("That didn't go through: %s", [done.error ?? ""])); return; }
    if (done.body?.configured === false) { this.me.setValue({ configured: false }); return; }
    this.asking.setValue(null);
    this.me.setValue({ ...this.me._held, configured: true, ask: false, state: done.body?.state ?? (yes ? "waiting" : "no"), email: yes ? body.email : null });
    const listed = done.body?.state === "yes";
    this.said.setValue(Phrase.of(!yes ? "No Lizarding news: nothing else changes." : listed ? "You're on the list already: Lizarding news comes to that address." : "Check your email for the link to confirm."));
  }

  async leave() {
    this.busy.setValue(true);
    const done = await this.play.line.platform("newsletter/leave", { source: "web-settings" });
    this.busy.setValue(false);
    if (!done.ok) { this.said.setValue(Phrase.with("That didn't go through: %s", [done.error ?? ""])); return; }
    this.me.setValue({ ...this.me._held, state: "withdrawn", email: null, ask: false });
    this.said.setValue(Phrase.of("Lizarding news stopped."));
  }
}

/** The answer as it stands, in words. */
export function stateWords(me) {
  switch (me?.state) {
    case "yes": return Phrase.with("Yes: Lizarding news goes to %s.", [me.email ?? ""]);
    case "waiting": return Phrase.with("Waiting for you to confirm: we emailed a link to %s.", [me.email ?? ""]);
    case "no": return Phrase.of("No: you get no Lizarding news.");
    case "withdrawn": return Phrase.of("Stopped: you get no Lizarding news.");
    default: return Phrase.of("Not answered yet.");
  }
}

/** The question from this source: its words, the two equal answers; after a Yes, the address. */
export function describeQuestion(ui, news, source) {
  const askingHere = news.asking.map((a) => a === source);
  return ui.column([
    ui.text(Phrase.of(QUESTION), "Words NewsWords").wraps(),
    ui.when(askingHere, ui.column([
      ui.field(SENDS_EMAIL, "", { label: Phrase.of("Your email"), changes: TYPES_EMAIL, shows: news.typed, autocomplete: "email" }),
      ui.row([ui.button(SENDS_EMAIL, { style: "Pressable Choice" }), ui.button(SAYS_NO, { payload: { source }, style: "Pressable Choice" })], "Choices"),
    ], "NewsAddress"), ui.row([
      ui.button(SAYS_YES, { payload: { source }, style: "Pressable Choice" }),
      ui.button(SAYS_NO, { payload: { source }, style: "Pressable Choice" }),
    ], "Choices")),
    ui.text(news.said, "Said").wraps().hidesEmpty(),
  ], `NewsQuestion NewsQuestion-${source}`);
}

/** At the door, after the name: the one question before the game. */
export function describeDoorQuestion(ui, news) {
  return ui.column([
    ui.text(Phrase.of("One question before you play"), "PartHeading"),
    describeQuestion(ui, news, "web-door"),
  ], "NewsAtTheDoor");
}

/** Settings' part: the answer as it stands, changed, or the emails stopped. Hidden until the platform's newsletter is set up. */
export function describeNewsSettings(ui, news) {
  const set = news.me.map((m) => m.configured === true);
  const on = news.me.map((m) => m.state === "yes" || m.state === "waiting");
  return ui.when(set, ui.column([
    ui.text(Phrase.of("Lizarding news by email"), "PartHeading"),
    ui.text(news.me.map(stateWords), "Words NewsState").wraps(),
    ui.when(on, ui.column([ui.button(STOPS_NEWS, { style: "Pressable" }), ui.text(news.said, "Said").wraps().hidesEmpty()]), describeQuestion(ui, news, "web-settings")),
  ], "Part NewsPart"));
}
