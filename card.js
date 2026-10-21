// The race card, the home screen (the brief's section 8.2): a block per
// runner of the open card - its square, name, age and stable; its win
// price and where a place bet pays from; the player's stakes; BET; and its
// form strip. Two rows of five on a wide screen, a column on an upright phone.

import { Phrase } from "./gd_chime/gd_chime.js?v=32817456008e";
import { STRIP, ageSaid, bandStyle, nameSaid, placeCell, placeSaid, runnersOf, square, stableSaid, stakesSaid, winSaid } from "./parts.js?v=32817456008e";

export const CARD = "card";
export const OPENS_LIZARD = "opens_the_lizard";
export const OPENS_BET = "opens_a_bet";
export const GOES_ACCOUNT = "goes_to_your_account";

export const WORDS = {
  [OPENS_LIZARD]: ["Its form"],
  [OPENS_BET]: ["Bet"],
  [GOES_ACCOUNT]: ["Keep your account with Google"],
};

export function describeCard(ui, play, { lizard, betPopUp, account }) {
  const runners = ui.bound(() => (play.game.read() ? runnersOf(play) : []));
  const state = ui.bound(() => (!play.game.read() ? "connecting" : !play.openCard() ? "waiting" : "open"));
  const block = (held) => {
    const lizardOf = held.map((row) => row?.lizard ?? 0);
    const strip = held.map((row) => (row?.form?.starts ?? []).slice(0, STRIP).reverse());
    return ui.surface("Runner", [
      ui.row([
        square(ui, held.map((row) => row?.number ?? 0)),
        ui.column([
          ui.link(OPENS_LIZARD, lizardOf, held.map(nameSaid), { style: "NameLink", words_style: "LizardName" }).goesTo(lizard),
          ui.text(held.map((row) => ageSaid(row?.age)), "Small Quiet").hidesEmpty(),
          ui.text(held.map((row) => stableSaid(row?.stable)), "Small Quiet").hidesEmpty(),
        ], "Who").grow(),
      ], "RunnerTop"),
      ui.row([
        ui.column([ui.text(Phrase.of("Win"), "Engraving"), ui.text(held.map(winSaid), "Price")], "Book"),
        ui.column([ui.text(Phrase.of("Place"), "Engraving"), ui.text(held.map(placeSaid), "PaysFrom").wraps()], "Book").grow(),
      ], "Books"),
      ui.text(held.map((row) => stakesSaid(row?.stakes)), "Stakes").wraps().hidesEmpty(),
      ui.when(strip.map((s) => s.length > 0), ui.eachAcross(strip, (start) => ui.text(start.map((s) => (s ? placeCell(s) : "")),
        start.map((s) => bandStyle(s?.band ?? null, "StripCell"))), (s) => s.race, "Strip")),
      ui.button(OPENS_BET, { opens: betPopUp, with: lizardOf, style: "BellButton BetButton" }),
    ]);
  };
  return ui.screen(CARD, [
    ui.when(state.map((s) => s === "connecting"), ui.text(Phrase.of("Connecting to the game…"), "Quiet Waiting")),
    ui.when(state.map((s) => s === "waiting"), ui.text(Phrase.of("Waiting for the next race"), "Words Waiting")),
    ui.each(runners, block, (row) => row.lizard, "Runners"),
    // a guest is told, quietly, that what it has lives in this browser alone
    ui.when(ui.bound(() => play.account.read().guest && play.game.read() !== null), ui.row([
      ui.text(Phrase.of("You're playing as a guest, in this browser alone."), "Small Quiet").wraps().grow(),
      ui.pressable(GOES_ACCOUNT, {}, [ui.text(ui.words(GOES_ACCOUNT), "Small")], "Pressable").goesTo(account),
    ], "GuestLine")),
  ]);
}
