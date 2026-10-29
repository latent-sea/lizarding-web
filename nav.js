// The nav bar, on every screen but the race (the brief's section 8.1):
// Back, and Home to the race card; the stage's name, which opens its map; Leagues and Settings - behind
// a Menu on an upright phone; a line saying what to do now; the countdown to
// the race; and the credits, a bar against the next power of ten and the
// amount. On a wide screen it is one line, on an upright phone three.

import { Driver, Phrase } from "./gd_chime/gd_chime.js?v=532e313549a4";
import { countdownSaid, creditsFill, secondsLeft } from "./rules.js?v=532e313549a4";
import { credits } from "./parts.js?v=532e313549a4";

export const GOES_BACK = "goes_back";
export const GOES_HOME = "goes_to_the_card";
export const GOES_STAGE = "goes_to_the_stage";
export const GOES_LEAGUES = "goes_to_the_leagues";
export const GOES_SETTINGS = "goes_to_the_settings";
export const OPENS_MENU = "opens_the_menu";

export const WORDS = {
  [GOES_BACK]: ["Back"],
  [GOES_HOME]: ["Home"],
  [GOES_STAGE]: ["The stage"],
  [GOES_LEAGUES]: ["Leagues"],
  [GOES_SETTINGS]: ["Settings"],
  [OPENS_MENU]: ["Menu"],
};

/** The stage the nav names: the open card's, else the last race's. */
export function stageOf(play) {
  const game = play.game.read();
  if (!game) return null;
  const race = game.openCard()?.race ?? game.lastRace();
  return race === null ? null : play.fieldOf(race)?.course ?? null;
}

/** The countdown to the open card's race, in whole seconds, or null with none open. */
export function countdown(play) {
  const card = play.openCard();
  return card ? secondsLeft(card.runsAt, play.now.read()) : null;
}

export function describeNav(ui, play, { screens, instruction, info }) {
  const stage = ui.bound(() => stageOf(play));
  const left = ui.bound(() => countdown(play));
  const balance = play.game.map((g) => g?.balance ?? null);
  // the credits: a bar against the next power of ten, and the amount - at the end of the line, or a line of their own
  const purse = (where) => ui.row([
    ui.surface("CreditsBar", [ui.surface(balance.map((b) => `Fill Fill${b === null ? 0 : Math.round(creditsFill(b) * 20) * 5}`))]).grow(),
    ui.text(balance.map((b) => (b === null ? Phrase.of("Connecting…") : credits(b))), "Credits"),
  ], `CreditsLine ${where}`);
  const go = (action, to, style) => ui.pressable(action, {}, [ui.text(ui.words(action), "Face")], `Pressable NavLink ${style}`).goesTo(to);
  const menu = ui.popUp("menu", () => ui.column([
    ui.pressable(GOES_LEAGUES, {}, [ui.text(ui.words(GOES_LEAGUES), "Face")], "Pressable MenuItem").goesTo(screens.leagues),
    ui.pressable(GOES_SETTINGS, {}, [ui.text(ui.words(GOES_SETTINGS), "Face")], "Pressable MenuItem").goesTo(screens.settings),
  ], "Menu"));
  return ui.surface("Nav", [
    ui.row([
      ui.pressable(GOES_BACK, {}, [ui.text("‹", "Arrow"), ui.text(ui.words(GOES_BACK), "Face BackWords")], "Pressable NavLink BackButton").goesTo(Driver.BACK).absentWhenRefused(),
      // straight to the race card from anywhere; gone while already there
      ui.pressable(GOES_HOME, {}, [ui.text("⌂", "Arrow"), ui.text(ui.words(GOES_HOME), "Face BackWords")], "Pressable NavLink BackButton").goesTo(screens.card).absentWhenRefused(),
      info,
      ui.when(stage, ui.pressable(GOES_STAGE, {}, [ui.text(stage.map((s) => s?.name || Phrase.of("The course")), "StageName")], "Pressable NavLink StageButton").goesTo(screens.stage)),
      ui.text(instruction, "Instruction Wide").grow(),
      go(GOES_LEAGUES, screens.leagues, "Wide"),
      go(GOES_SETTINGS, screens.settings, "Wide"),
      ui.pressable(OPENS_MENU, {}, [ui.text(ui.words(OPENS_MENU), "Face")], "Pressable NavLink Narrow").opens(menu),
      ui.text(left.map((s) => (s === null ? "" : countdownSaid(s))), left.map((s) => `Countdown${s === 0 ? " Closed" : ""}`)).hidesEmpty(),
      purse("Wide"),
    ], "NavLine"),
    purse("Narrow"),
    ui.text(instruction, "Instruction Narrow"),
  ]);
}
