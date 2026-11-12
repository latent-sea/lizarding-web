// The tutorial on the web (T-668 in the app, brought to play.lizarding.com;
// Ian, 12 Nov: "website needs the tutorial treatment").
//
// - ONE DIMMED POP-UP for tips and reminders: the rest of the page dimmed, the
//   short message in the middle, the control concerned lit; one press puts it
//   away, or on to the next step.
// - FIRST-TIME TIPS on each view the web game has, with the app's steps and
//   words: Betting's explainer then the race card's, the first time the card
//   shows; a lizard's form; the stage. A step whose control the web game
//   doesn't have is left out, as the app's tip_steps.gd says.
// - REMINDERS of a control not yet used, after 6 s on a page, at most one a
//   visit, in the app's words (reminder_words.txt) and never for a control it
//   lists in reminders_not_needed.txt.
// - THE PRACTICE CARD: while the first tips run over the race card, the clock
//   is stopped and reads PRACTICE, and betting is off (play.practising).
// - THE SWITCH: Settings' "Hints and tips" turns all of it off and on.
//
// The words are the app's, copied by tooling/sync_lizarding_tips.py into
// tutorial/, never written here. The web game names its controls by the app's
// actions (APP_ACTIONS) to find them; what a step lights is the web's own.

export const REMIND_AFTER_MS = 6000;
const SEEN = "lizarding_tips_seen";
const USED = "lizarding_controls_used";

// --- the app's words, read ---

/** reminder_words.txt: { exact: {action: words}, labelled: {"action @ LABEL": words}, prefixes: [[prefix, words]] }. */
export function readReminderWords(text) {
  const exact = {}, labelled = {}, prefixes = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf(" = ");
    if (at < 0) continue;
    const key = line.slice(0, at).trim(), words = line.slice(at + 3).trim();
    if (key.includes(" @ ")) labelled[key.replace(/\s+@\s+/, " @ ")] = words;
    else if (key.endsWith("*")) prefixes.push([key.slice(0, -1), words]);
    else exact[key] = words;
  }
  return { exact, labelled, prefixes };
}

/** reminders_not_needed.txt: the actions never reminded of. */
export const readNotNeeded = (text) => new Set(text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean));

/** What a reminder says of an app action (and its label, for a shared one), or null: no line, no reminder. */
export function reminderSaid(words, action, label = "") {
  if (label && words.labelled[`${action} @ ${label}`]) return words.labelled[`${action} @ ${label}`];
  if (words.exact[action]) return words.exact[action];
  return words.prefixes.find(([prefix]) => action.startsWith(prefix))?.[1] ?? null;
}

// --- the web game's controls, by the app's names ---

/** Each web action, as the app names the same control: its words come from the app's table. */
export const APP_ACTIONS = {
  opens_a_bet: "opens_the_betting",
  opens_the_lizard: "opens_a_lizard",
  goes_to_the_runner_after: "steps_to_another_lizard",
  goes_to_the_runner_before: "steps_to_another_lizard",
  goes_to_the_stage: "goes_to_the_stage",
  goes_to_the_leagues: "goes_to_the_leagues",
  goes_to_the_settings: "goes_to_the_settings",
  opens_the_menu: "shows_the_bar_s_menu_on_card",
  explains_this_page: "shows_what_has_left_the_bar_on_card",
  stakes_a_share: "takes_a_share_of_the_balance",
  types_a_stake: "types_the_stake",
  places_the_bets: "places_the_bets",
  shows_a_league: "shows_a_league",
  refreshes_the_tables: "asks_for_the_league_tables",
  makes_the_league: "makes_a_league",
  aims_to_make_a_league: "makes_a_league",
  types_a_league_name: "types_a_league_name",
  types_a_length: "types_how_long_a_league_runs",
  picks_a_unit: "sets_the_unit_a_league_runs_in",
  enters_the_league: "enters_a_league",
  aims_to_enter_a_league: "enters_a_league",
  types_a_code: "types_a_league_code",
  copies_the_code: "copies_a_league_code",
  leaves_the_league: "leaves_a_league",
  picks_a_colour_scale: "sets_the_colour_scale",
  picks_how_runners_are_marked: "sets_the_marks_over_the_runners",
  turns_reduced_motion: "reduces_motion",
  sets_whether_hints_and_tips_show: "sets_whether_hints_and_tips_show",
  types_an_email_for_news: "types_the_newsletter_address",
};

/** What a reminder of this web action says, or null: one the app's table has no line for, or lists as not needed. */
export function webReminder(words, notNeeded, webAction) {
  const app = APP_ACTIONS[webAction];
  if (!app || notNeeded.has(app)) return null;
  return reminderSaid(words, app);
}

// --- the tips: the app's steps, each with what the web game lights ---

const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const firstShown = (root, selector) => [...root.querySelectorAll(selector)].find(shown) ?? null;

/**
 * Each web view's tips: the app's tip, and of its steps those the web game has, each with what it lights (a finder
 * over the page, or null for a step that lights nothing). The rest of the app's steps are left out.
 */
export const WEB_TIPS = {
  card: [
    ["tip_betting", [
      [0, null],
      [1, (root) => firstShown(root, ".Nav .Countdown")],
      [2, (root) => firstShown(root, ".Runner .Book .Engraving")],
      [3, (root) => [...root.querySelectorAll(".Runner .Book .Engraving")].filter(shown)[1] ?? null],
      [4, (root) => firstShown(root, ".Nav .Credits")],
      [5, (root) => firstShown(root, '[data-action="goes_to_the_leagues"]') ?? firstShown(root, '[data-action="opens_the_menu"]')],
    ]],
    ["tip_race_card", [
      [0, (root) => firstShown(root, '[data-action="opens_the_lizard"]')],
      [5, (root) => firstShown(root, ".StageButton")],
    ]],
  ],
  lizard: [
    ["tip_form_tab", [
      [1, (root) => firstShown(root, '[data-action="goes_to_the_runner_after"]') ?? firstShown(root, '[data-action="goes_to_the_runner_before"]')],
    ]],
  ],
  stage: [
    ["tip_stage", [
      [0, (root) => firstShown(root, "#stage-map")],
    ]],
  ],
};

/** A view's tips as steps to show: [{tip, heading, words, faqs: [[q, a]], light}], from the app's copied steps. */
export function stepsFor(view, steps) {
  const out = [];
  for (const [tip, chosen] of WEB_TIPS[view] ?? []) {
    const app = steps.tips[tip];
    if (!app) continue;
    for (const [at, light] of chosen) {
      const step = app[at];
      if (!step) continue;
      out.push({ tip, heading: step[0], words: step[1], faqs: step[2].map((name) => steps.faqs[name]).filter(Boolean), light });
    }
  }
  return out;
}

// --- remembered in the browser ---

function kept(storage, key) {
  try { return new Set(JSON.parse(storage?.getItem(key) ?? "[]")); } catch { return new Set(); }
}
function keep(storage, key, set) {
  try { storage?.setItem(key, JSON.stringify([...set])); } catch { /* a browser that keeps nothing still plays */ }
}

// --- the dimmed pop-up ---

/** The one dimmed pop-up: dims the page, lights a part, says the words; every press goes on, the last puts it away. */
export class Dimmed {
  constructor(doc = document, plates = {}) {
    this.doc = doc;
    this.layer = null;
    this.plates = { onward: "NEXT", closing: "GOT IT", ...plates };
  }

  get open() { return this.layer !== null; }

  /** Show these steps one after another; `done` when the last is put away. */
  show(steps, done = () => {}) {
    this.close();
    const doc = this.doc;
    const layer = doc.createElement("div");
    layer.className = "Dimmed";
    // the game's own type: the pop-up stands outside #app, whose look sets it
    layer.style.fontFamily = getComputedStyle(doc.getElementById("app") ?? doc.body).fontFamily;
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    const spot = doc.createElement("div");
    spot.className = "DimmedSpot";
    const card = doc.createElement("div");
    card.className = "DimmedCard";
    layer.append(spot, card);
    doc.body.append(layer);
    this.layer = layer;
    let at = 0;
    const place = () => {
      // gone, or moved past the last step, by the time a frame or a scroll calls
      if (this.layer !== layer || !steps[at]) return;
      const target = steps[at].light?.(doc) ?? null;
      if (target) {
        const r = target.getBoundingClientRect();
        const pad = 6;
        Object.assign(spot.style, { display: "block", left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        layer.classList.add("Lit");
        // the message away from what it lights
        card.classList.toggle("Low", r.top + r.height / 2 < innerHeight / 2);
      } else {
        spot.style.display = "none";
        layer.classList.remove("Lit");
        card.classList.remove("Low");
      }
    };
    const draw = () => {
      const step = steps[at];
      const target = step.light?.(doc) ?? null;
      target?.scrollIntoView?.({ block: "center", inline: "nearest" });
      card.replaceChildren();
      // a step with no heading of its own is headed PRACTICE on the practice card, as in the app
      const heading = step.heading || (step.practised ? this.plates.practice ?? "" : "");
      if (heading) card.append(Object.assign(doc.createElement("div"), { className: "DimmedHeading", textContent: heading }));
      card.append(Object.assign(doc.createElement("p"), { className: "DimmedWords", textContent: step.words }));
      for (const [question, answer] of step.faqs ?? []) {
        const faq = doc.createElement("button");
        faq.type = "button";
        faq.className = "DimmedFaq";
        faq.textContent = `▸ ${question}`;
        faq.addEventListener("click", (event) => {
          event.stopPropagation();
          if (faq.nextElementSibling?.classList.contains("DimmedAnswer")) faq.nextElementSibling.remove();
          else faq.after(Object.assign(doc.createElement("p"), { className: "DimmedAnswer", textContent: answer }));
        });
        card.append(faq);
      }
      const foot = doc.createElement("div");
      foot.className = "DimmedFoot";
      // the app's own words (dimmed_message.gd's ONWARD and CLOSING, as copied): "NEXT  n / m", then "GOT IT"
      foot.append(Object.assign(doc.createElement("span"), { className: "DimmedGo", textContent: at < steps.length - 1 ? `${this.plates.onward}  ${at + 1} / ${steps.length}` : this.plates.closing }));
      card.append(foot);
      requestAnimationFrame(place);
      place();
    };
    layer.addEventListener("click", () => {
      at += 1;
      if (at >= steps.length) { this.close(); done(); return; }
      draw();
    });
    this._onMove = () => place();
    addEventListener("resize", this._onMove);
    addEventListener("scroll", this._onMove, true);
    draw();
  }

  close() {
    if (!this.layer) return;
    this.layer.remove();
    this.layer = null;
    removeEventListener("resize", this._onMove);
    removeEventListener("scroll", this._onMove, true);
  }
}

// --- the tutorial ---

/**
 * The tutorial over the web game: `view()` says the page the player is on, `on()` whether hints and tips are on,
 * `quiet()` whether something else holds the page (a pop-up up, the race running, the door); `practise(bool)` holds
 * or lets go of the practice card. Started once the words are read.
 */
export class Tutorial {
  constructor({ doc = document, storage = globalThis.localStorage, timers = globalThis, view, on, quiet, practise, words, notNeeded, steps, remindAfter = REMIND_AFTER_MS }) {
    Object.assign(this, { doc, storage, timers, view, on, quiet, practise, words, notNeeded, steps, remindAfter });
    this.dimmed = new Dimmed(doc, steps.plates ?? {});
    this.seen = kept(storage, SEEN);
    this.used = kept(storage, USED);
    this.reminded = false; // at most one reminder a visit
    this._timer = null;
    this._shownView = null;
    // a control used is never reminded of again
    doc.addEventListener("click", (event) => this._use(event.target), true);
    doc.addEventListener("input", (event) => this._use(event.target), true);
  }

  _use(target) {
    const action = target?.closest?.("[data-action]")?.getAttribute("data-action");
    if (!action || this.used.has(action)) return;
    this.used.add(action);
    keep(this.storage, USED, this.used);
  }

  /** The page settled: its first-time tips if unseen, else a reminder waits 6 s. */
  settled() {
    const view = this.view();
    if (view === this._shownView) return;
    this.timers.clearTimeout(this._timer);
    if (!this.on()) { this._shownView = view; this.dimmed.close(); this.practise(false); return; }
    // held by something else (the door, a pop-up, the race, a card not yet come): tried again in a moment
    if (this.dimmed.open || this.quiet()) {
      this.timers.clearTimeout(this._again);
      this._again = this.timers.setTimeout(() => this.settled(), 1000);
      return;
    }
    this._shownView = view;
    if (this.tipsFor(view)) return;
    this._timer = this.timers.setTimeout(() => this.remind(view), this.remindAfter);
  }

  /** The switch moved: off puts away what is up; on lets the page's unseen tips come back. */
  switched() {
    if (!this.on()) { this.dimmed.close(); this.practise(false); this.timers.clearTimeout(this._timer); }
    this._shownView = null;
  }

  /** This view's unseen tips shown, over the practice card on the race card; whether any were. */
  tipsFor(view) {
    if (this.seen.has(view)) return false;
    const all = stepsFor(view, this.steps);
    const steps = all.filter((s) => s.light === null || s.light(this.doc));
    // a part not drawn yet (the runners, just after the card comes): waited for a moment, then left out
    if (steps.length < all.length && (this._waits = (this._waits ?? 0) + 1) <= 6) {
      this.timers.clearTimeout(this._again);
      this._again = this.timers.setTimeout(() => { if (this.view() === view && !this.dimmed.open) this.tipsFor(view); }, 500);
      return true;
    }
    this._waits = 0;
    if (!steps.length) return false;
    const practising = view === "card";
    if (practising) this.practise(true);
    this.dimmed.show(practising ? steps.map((s) => ({ ...s, practised: true })) : steps, () => {
      this.seen.add(view);
      keep(this.storage, SEEN, this.seen);
      if (practising) this.practise(false);
      // the tips put away, a reminder may follow on this page as on any other
      this.timers.clearTimeout(this._timer);
      this._timer = this.timers.setTimeout(() => this.remind(view), this.remindAfter);
    });
    return true;
  }

  /** One reminder this visit, of the first control on the page not yet used that the app's table has words for. */
  remind(view) {
    if (this.reminded || !this.on() || this.dimmed.open || this.quiet() || this.view() !== view) return false;
    const root = this.doc.getElementById("app") ?? this.doc;
    for (const el of root.querySelectorAll("[data-action]")) {
      if (!shown(el) || el.closest(".chime-layer")) continue;
      const action = el.getAttribute("data-action");
      if (this.used.has(action)) continue;
      const words = webReminder(this.words, this.notNeeded, action);
      if (!words) continue;
      this.reminded = true;
      this.dimmed.show([{ heading: "", words, faqs: [], light: () => el }]);
      return true;
    }
    return false;
  }
}

/** The app's words, as copied into tutorial/: read over the network in a browser. */
export async function loadWords(base = "tutorial/") {
  const [words, notNeeded, steps] = await Promise.all([
    fetch(`${base}reminder_words.txt`).then((r) => r.text()),
    fetch(`${base}reminders_not_needed.txt`).then((r) => r.text()),
    fetch(`${base}tip_steps.json`).then((r) => r.json()),
  ]);
  return { words: readReminderWords(words), notNeeded: readNotNeeded(notNeeded), steps };
}
