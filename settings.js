// The player's settings (the brief's section 8.8), kept in localStorage:
// the colour scale every shaded figure wears, what marks a runner in the
// race - its number or its name - and reduced motion. And the sheet of
// colours the shaded figures wear: a class per band of the scale chosen,
// and per runner's number, written again whenever the scale changes.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=dadaf39aa503";
import { DEFAULT_SCALE, SCALES, inkOn, runnerColour, samples, shade } from "./colours.js?v=dadaf39aa503";
import { safeStorage } from "./auth.js?v=dadaf39aa503";
import { ASKS_TO_DELETE, DELETES_ACCOUNT, KEEPS_ACCOUNT, KEEPS_GUEST, SIGNS_OUT, WANTS_GOOGLE_SIGN_IN } from "./play.js?v=dadaf39aa503";
import { CONFIG } from "./config.js?v=dadaf39aa503";
import { describeJoining } from "./joining.js?v=dadaf39aa503";
import { describeNewsSettings } from "./news.js?v=dadaf39aa503";

export const SETTINGS = "settings";
export const PICKS_SCALE = "picks_a_colour_scale";
export const PICKS_MARKS = "picks_how_runners_are_marked";
export const TURNS_MOTION = "turns_reduced_motion";
// the app's own action (T-668), so both read the one table of reminder words
export const SETS_TIPS = "sets_whether_hints_and_tips_show";

export const WORDS = {
  [PICKS_SCALE]: ["Colour scale"],
  [PICKS_MARKS]: ["Runner marks"],
  [TURNS_MOTION]: ["Reduced motion"],
  [SETS_TIPS]: ["Hints and tips"],
};

const KEPT = "lizarding_settings";
const MARKS = { number: "Their number", name: "Their name" };

export class Settings extends Controller {
  constructor(chimes, storage = safeStorage()) {
    super(chimes);
    this._storage = storage;
    let kept = {};
    try { kept = JSON.parse(storage.get(KEPT) ?? "{}") ?? {}; } catch { kept = {}; }
    const askedForLess = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.scale = this.value(SCALES[kept.scale] ? kept.scale : DEFAULT_SCALE);
    this.marks = this.value(kept.marks === "name" ? "name" : "number");
    this.reducedMotion = this.value(typeof kept.reducedMotion === "boolean" ? kept.reducedMotion : askedForLess);
    // hints and tips (T-668): on until the player turns them off
    this.tips = this.value(kept.tips !== false);
  }

  answers() { return [PICKS_SCALE, PICKS_MARKS, TURNS_MOTION, SETS_TIPS]; }

  told(action, payload) {
    if (action === PICKS_SCALE && SCALES[payload.scale]) this.scale.setValue(payload.scale);
    else if (action === PICKS_MARKS && MARKS[payload.marks]) this.marks.setValue(payload.marks);
    else if (action === TURNS_MOTION) this.reducedMotion.update((on) => !on);
    else if (action === SETS_TIPS) this.tips.update((on) => !on);
    this._storage.set(KEPT, JSON.stringify({ scale: this.scale._held, marks: this.marks._held, reducedMotion: this.reducedMotion._held, tips: this.tips._held }));
    return null;
  }
}

/** Deleting the account for good, asked once more; and the privacy policy (the coordinator, 13 Nov). */
export function describeAccountEnd(ui, play) {
  return ui.column([
    ui.text(Phrase.of("Delete your account"), "PartHeading"),
    ui.when(play.deleting, ui.column([
      ui.text(Phrase.of("This deletes your account for good, everywhere you play Lizarding: your name, your credits, your bets, your leagues and all your play. It can't be undone."), "Warn").wraps(),
      ui.row([ui.button(DELETES_ACCOUNT, { style: "Pressable Choice DeleteAccount" }), ui.button(KEEPS_ACCOUNT, { style: "Pressable Choice" })], "Choices"),
    ]), ui.button(ASKS_TO_DELETE, { style: "Pressable" })),
    ui.text(play.accountSaid, "Said").wraps().hidesEmpty(),
    ui.text(Phrase.of("What Lizarding keeps about you, and why:"), "Hint").wraps(),
    privacyLink(ui),
  ], "Part AccountEnd");
}

/** The privacy policy, opened in a new tab: in Settings, and at the foot of every page but the race. */
export function privacyLink(ui) {
  return ui.hyperlink(CONFIG.privacy, [ui.text(Phrase.of("Privacy policy"), "Face")], "PrivacyLink");
}

/** The settings screen: the account, then each choice shown as what it does. */
export function describeSettings(ui, settings, play, joining, news) {
  const guest = play.account.map((a) => a.guest);
  const signingIn = play.googleMode.map((m) => m === "sign in");
  return ui.screen(SETTINGS, [
    ui.text(Phrase.of("Settings"), "Title"),
    ui.column([
      ui.text(Phrase.of("Your account"), "PartHeading"),
      ui.when(guest, ui.column([
        ui.when(signingIn, ui.column([
          ui.text(Phrase.of("Sign in with the Google account you already play with."), "Words").wraps(),
          ui.text(Phrase.of("This guest - its credits and its name - stays behind, and can't be come back to. To keep its play, join the two accounts instead (below)."), "Warn").wraps(),
        ]), ui.column([
          ui.text(Phrase.of("You're playing as a guest."), "Words").wraps(),
          ui.text(Phrase.of("A guest lives in this browser alone: clear its data or change device and it's gone, and one not played for ten days is deleted. Keep it with Google to play it anywhere, for good."), "Hint").wraps(),
        ])),
        ui.surface("GoogleButton", []).named("google-account"),
        ui.when(signingIn, ui.button(KEEPS_GUEST, { style: "Pressable" }), ui.button(WANTS_GOOGLE_SIGN_IN, { style: "Pressable" })),
      ]), ui.column([
        ui.text(Phrase.of("Your account is kept with Google: sign in with it to play on any device."), "Words").wraps(),
        // signing out: only for an account kept with Google (a guest signed out would be lost: it lives in this browser)
        ui.button(SIGNS_OUT, { style: "Pressable" }),
        ui.text(Phrase.of("Signs this browser out. Sign in with Google to play again, here or anywhere."), "Hint").wraps(),
      ])),
      ui.text(play.googleSaid, "Said").wraps().hidesEmpty(),
    ], "Part"),
    describeAccountEnd(ui, play),
    describeJoining(ui, joining),
    describeNewsSettings(ui, news),
    ui.column([
      ui.text(Phrase.of("Colour scale"), "PartHeading"),
      ui.text(Phrase.of("Every shaded figure - P-Nums above all - runs from bad to good on this scale."), "Hint").wraps(),
      ...Object.entries(SCALES).map(([key, scale]) => ui.pressable(PICKS_SCALE, { scale: key }, [
        ui.text(Phrase.of(scale.name), "Face").grow(),
        ui.row(samples(key).map((_, at) => ui.surface(`Sample Sample${at} ${key}`)), "Samples"),
      ], "Choice ScaleChoice").currentWhile(settings.scale.map((s) => s === key))),
    ], "Part"),
    ui.column([
      ui.text(Phrase.of("Runner marks"), "PartHeading"),
      ui.text(Phrase.of("What each lizard's rectangle carries in the race."), "Hint").wraps(),
      ui.row(Object.entries(MARKS).map(([key, words]) => ui.pressable(PICKS_MARKS, { marks: key }, [ui.text(Phrase.of(words), "Face")], "Segment")
        .currentWhile(settings.marks.map((m) => m === key))), "Segments"),
    ], "Part"),
    ui.column([
      ui.text(Phrase.of("Reduced motion"), "PartHeading"),
      ui.pressable(TURNS_MOTION, {}, [ui.text(settings.reducedMotion.map((on) => Phrase.of(on ? "On: the race has no flashes, and the camera moves without easing" : "Off")), "Face").wraps()],
        settings.reducedMotion.map((on) => (on ? "Segment ToggleOn" : "Segment"))),
    ], "Part"),
    ui.column([
      ui.text(Phrase.of("Hints and tips"), "PartHeading"),
      ui.pressable(SETS_TIPS, {}, [ui.text(settings.tips.map((on) => Phrase.of(on ? "On: a tip the first time you see each page, and a reminder of anything not yet tried" : "Off")), "Face").wraps()],
        settings.tips.map((on) => (on ? "Segment ToggleOn" : "Segment"))),
    ], "Part"),
  ]);
}

/**
 * The colours as a sheet: Band0 to Band99 on the scale chosen, as grounds
 * with words that read on them; Runner1 to Runner10 in their hues; and the
 * settings' own samples of every scale.
 */
export function colourSheet(scale) {
  const rules = [];
  for (let band = 0; band < 100; band++) {
    const ground = shade(scale, band / 99);
    rules.push(`#app .Band${band} { background: ${ground}; color: ${inkOn(ground)}; }`);
  }
  for (let number = 1; number <= 10; number++) {
    const ground = runnerColour(number);
    rules.push(`#app .Runner${number} { background: ${ground}; color: ${inkOn(ground)}; }`);
  }
  for (const key of Object.keys(SCALES)) samples(key).forEach((colour, at) => rules.push(`#app .Sample${at}.${key} { background: ${colour}; }`));
  return rules.join("\n");
}
