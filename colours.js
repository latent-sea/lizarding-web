// The colours the figures wear, as the desktop game has them: each runner's
// number its own hue, and the shaded figures on the scale the player chooses
// (betting/play/project/colour_scale.gd, race_card_screen.gd).

/** A runner's number colour, by its 1-based place on the card: hues round the wheel, as the desktop's. */
export function runnerColour(number) {
  const [r, g, b] = hsv(((number - 1) % 10) / 10, 0.65, 0.85);
  return hex(r, g, b);
}

/** Words on a runner's square: black on a light colour, white on a dark one. */
export function inkOn(colour) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "#000000" : "#ffffff";
}

/** The three scales a player may choose, bad, middle and good, as the desktop's. */
export const SCALES = Object.freeze({
  red_to_green: { name: "Red to green", stops: [[0.8, 0.22, 0.2], [0.78, 0.68, 0.24], [0.2, 0.7, 0.3]] },
  orange_to_blue: { name: "Orange to blue", stops: [[0.9, 0.48, 0.1], [0.62, 0.62, 0.66], [0.16, 0.5, 0.9]] },
  dark_to_light: { name: "Dark to light", stops: [[0.14, 0.13, 0.26], [0.42, 0.44, 0.66], [0.86, 0.9, 1.0]] },
});
export const DEFAULT_SCALE = "red_to_green";

/** A share from bad (0) to good (1) on a scale: bad to middle, then middle to good. */
export function shade(scale, share) {
  const [bad, mid, good] = (SCALES[scale] ?? SCALES[DEFAULT_SCALE]).stops;
  const s = Math.max(0, Math.min(1, share));
  const [from, to, t] = s < 0.5 ? [bad, mid, s * 2] : [mid, good, s * 2 - 1];
  return hex(...from.map((c, i) => c + (to[i] - c) * t));
}

/** A percentile band, 0 to 99, shaded. */
export const bandColour = (scale, band) => shade(scale, band / 99);

/** Ten samples of a scale, bad to good: what the settings show. */
export const samples = (scale) => Array.from({ length: 10 }, (_, i) => shade(scale, i / 9));

function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const [p, q, t] = [v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)];
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

function hex(r, g, b) {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("")}`;
}
