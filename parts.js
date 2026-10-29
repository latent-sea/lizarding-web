// What several screens show of a runner, worked out once: the open card's
// runners as rows - number, name, prices, the player's stakes, the form -
// and the small words they're said in.

import { Phrase } from "./gd_chime/gd_chime.js?v=4a2c3c9acc21";
import { oddsSaid, ordinal, paysFrom } from "./rules.js?v=4a2c3c9acc21";

export const CREDITS = "¤";
export const credits = (n) => `${CREDITS}${Number(n).toLocaleString("en-GB")}`;
/** How many of its latest races a runner's form strip shows, newest at the right. */
export const STRIP = 6;

/** The open card's runners, as rows the card and the lizard screen read; [] with no card open. */
export function runnersOf(play) {
  const card = play.openCard();
  if (!card) return [];
  const field = play.fieldOf(card.race);
  const game = play.game.read();
  const forms = play.forms.read();
  return card.runners.map((runner, index) => {
    const shown = field?.runners.find((r) => r.lizard === runner.lizard) ?? null;
    const form = forms.get(runner.lizard) ?? null;
    return {
      race: card.race, lizard: runner.lizard, number: index + 1, odds: runner.odds, rating: runner.rating,
      paysFrom: paysFrom(runner.rating, card.runners.length),
      name: shown?.name ?? form?.name ?? null, stable: shown?.stable ?? form?.stable ?? null, age: shown?.age ?? form?.age ?? null,
      fields: shown?.fields ?? {}, stakes: game.stakesOn(card.race, runner.lizard), form,
    };
  });
}

export const nameSaid = (row) => row?.name ?? Phrase.with("Lizard %d", [row?.lizard ?? 0]);
export const ageSaid = (age) => (age == null ? "" : Phrase.with("%s years old", [age.toFixed(1)]));
export const stableSaid = (stable) => (stable == null ? "" : stable === "" ? Phrase.of("From the wild") : Phrase.with("%s stable", [stable]));
export const winSaid = (row) => (row ? oddsSaid(row.odds) : "");
export const placeSaid = (row) => (!row ? "" : row.paysFrom === 0 ? Phrase.of("Never pays more than it stakes") : Phrase.with("Pays from %s", [ordinal(row.paysFrom)]));

/** The player's stakes on a runner, in words, or nothing while there are none. */
export function stakesSaid(stakes) {
  if (!stakes || (stakes.win === 0 && stakes.place === 0)) return "";
  const parts = [];
  if (stakes.win) parts.push(Phrase.with("%s to win", [credits(stakes.win)]));
  if (stakes.place) parts.push(Phrase.with("%s to place", [credits(stakes.place)]));
  return Phrase.joined([Phrase.of("Your stakes: "), ...parts.flatMap((part, at) => (at ? [" · ", part] : [part]))]);
}

/** A runner's square: its number in its hue. */
export const square = (ui, number, size = "") => ui.text(number.map((n) => (n ? String(n) : "")), number.map((n) => `Square ${size} Runner${n}`));

/** Where a race was finished, as a strip's cell says it: the place, or F for a race not finished. */
export const placeCell = (start) => (start.finished ? String(start.place) : "F");
/** A shaded cell's style: its band on the scale, or unshaded. */
export const bandStyle = (band, base) => `${base} ${band == null ? "Unshaded" : `Band${band}`}`;
