// The game's rules as the client shows them (the brief's section 7), and
// the small sums the screens say: payouts, where a place bet starts to pay,
// the credits bar, the countdown, league titles and their time left. The
// server decides; these must come out the same as its sums.

export const OPENING_CREDITS = 1000;
export const TOP_UP_TO = 50;
export const POINTS = Object.freeze([200, 100, 50, 25, 10, 8, 6, 4, 2, 1]);
export const SHARES = Object.freeze([1, 2, 5, 10, 15, 20, 30, 40, 50, 100]);
export const ORDINALS = Object.freeze(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]);

/** a / b rounded half up, in whole credits: floor, plus one if the remainder is half of b or more. BigInts inside, so no sum overflows. */
export function rounded(a, b) {
  const [top, under] = [BigInt(a), BigInt(b)];
  const whole = top / under;
  return Number((top % under) * 2n >= under ? whole + 1n : whole);
}

/** What a win bet returns if its lizard finishes first: decimal odds, so the stake is in it. */
export const winReturns = (stake, odds) => rounded(BigInt(stake) * BigInt(odds), 100);

/** What a place bet returns at a place (1-based). */
export const placeReturns = (stake, rating, place) => rounded(BigInt(stake) * BigInt(POINTS[place - 1] ?? 0) * 100n, rating);

/** What a bet paid, given where its lizard finished (1-based; 0 for not at all). */
export function paid(bet, odds, rating, place) {
  if (place < 1) return 0;
  if (bet.book === 0) return place === 1 ? winReturns(bet.stake, odds) : 0;
  return placeReturns(bet.stake, rating, place);
}

/** The last place a place bet profits at - the last whose points × 100 beat the rating - or 0 for none. */
export function paysFrom(rating, runners = POINTS.length) {
  let last = 0;
  for (let place = 1; place <= Math.min(runners, POINTS.length); place++) if (POINTS[place - 1] * 100 > rating) last = place;
  return last;
}

export const ordinal = (place) => ORDINALS[place - 1] ?? `${place}th`;
export const oddsSaid = (odds) => (odds / 100).toFixed(2);

/** A share of the balance as a stake: whole credits, never under 1. */
export const shareOf = (balance, percent) => Math.max(1, Math.round((balance * percent) / 100));

/** How full the credits bar is: the amount against the next power of ten at or above it. */
export function creditsFill(amount) {
  if (amount <= 0) return 0;
  let ten = 1;
  while (ten < amount) ten *= 10;
  return amount / ten;
}

/** Seconds until the race, whole, never below 0. */
export const secondsLeft = (runsAt, now) => Math.max(0, Math.ceil((runsAt - now) / 1000));

/** A countdown as it is shown: m:ss, or h:mm:ss for a long wait. */
export function countdownSaid(seconds) {
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

const HOUR = 3600 * 1000;
const OWN_NAMED = [[1, "This hour"], [24, "Today"], [168, "This week"], [744, "This month"]];

/** A league's title: the game's own by their length, a friends' league by its name. */
export function leagueTitle(league) {
  if (!league.everyone) return league.name;
  const length = league.endsAt - league.startsAt;
  return OWN_NAMED.find(([hours]) => length <= hours * HOUR + 1000)?.[1] ?? league.name;
}

/** The order of the league list: the game's own shortest first, then friends' leagues by name. */
export function leagueOrder(a, b) {
  if (a.everyone !== b.everyone) return a.everyone ? -1 : 1;
  if (a.everyone) return (a.endsAt - a.startsAt) - (b.endsAt - b.startsAt) || a.id - b.id;
  return a.name.localeCompare(b.name) || a.id - b.id;
}

/** How long a league has left, as its title says it: [pattern, numbers], or null once it has ended. */
export function timeLeft(endsAt, now) {
  const left = Math.floor((endsAt - now) / 1000);
  if (left <= 0) return null;
  const [d, h, m, s] = [Math.floor(left / 86400), Math.floor((left % 86400) / 3600), Math.floor((left % 3600) / 60), left % 60];
  if (d > 0) return ["%dd %dh left", [d, h]];
  if (h > 0) return ["%dh %dm left", [h, m]];
  return ["%dm %ss left", [m, String(s).padStart(2, "0")]];
}

/** A league score as a whole percentage: 100 is level. */
export const scoreSaid = (score) => `${Math.round(score * 100)}%`;

/** Whether a name may be offered to the server: the help the form gives; the server is the only judge. */
export function nameProblem(name) {
  if (name.length < 3 || name.length > 20) return "A name is 3 to 20 characters";
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return "A name uses letters, digits and spaces only";
  if (/^ | $/.test(name)) return "A name has no space at either end";
  if (/ {2}/.test(name)) return "A name has single spaces only";
  return null;
}

/** The length units a friends' league may be made in, in milliseconds. */
export const UNITS = Object.freeze([["Minutes", 60 * 1000], ["Hours", HOUR], ["Days", 24 * HOUR], ["Weeks", 7 * 24 * HOUR]]);
