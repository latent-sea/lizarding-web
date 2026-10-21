// The i on every page: what can be done on it, and what its figures,
// colours and marks mean. One pop-up, opened with the page it explains.

import { Phrase, Ui } from "./gd_chime/gd_chime.js?v=0c62b5326e86";

export const OPENS_HELP = "explains_this_page";

export const WORDS = { [OPENS_HELP]: ["What's on this page"] };

/** Each page's guide: [heading, what it says], in the order a player meets them. */
export const HELP = {
  door: [
    ["Getting in", "The first time you come, you play as a guest of this browser. Choose the name other players will see: it is yours for good and can't be changed."],
    ["Coming back on another device", "If you already play with Google, sign in with it here rather than choosing a new name."],
  ],
  card: [
    ["The race card", "Everyone shares one card. When the countdown at the top reaches 0, betting closes and the race runs for everyone at once."],
    ["Win", "The decimal odds: a win bet returns its stake times this if the lizard finishes 1st. The odds are a little wrong on purpose - finding where is the game."],
    ["Place", "A place bet pays something at every position. \"Pays from 3rd\" means it returns more than its stake if the lizard finishes 3rd or better."],
    ["The form strip", "The lizard's last six races, oldest on the left and newest on the right. The figure is where it finished (F: it didn't finish). The colour is how well it ran against every lizard, from red (poor) to green (good) - a 7th in a strong race can still be green."],
    ["Bet", "Opens the bet: choose Win or Place, type a stake or take a share of your credits, and see what it would return. A bet can't be taken back."],
    ["Your stakes", "What you have bet on each lizard in this race."],
    ["Credits", "Your balance, top right. The bar fills towards the next power of ten. Under 50 after a race, you are topped up to 50."],
    ["A lizard's form", "Tap a lizard's name to see its races, its percentiles and its career."],
  ],
  lizard: [
    ["The lizard", "Its number, name, age and stable, its prices in this race, and your stakes on it. The arrows go to the runner before or after it on the card."],
    ["Form", "Its races, newest first. The line under its career says how many of its races are shown."],
    ["Pct and For age", "How well it ran that day, as a percentile from 0 (worst) to 99 (best): against every lizard, and against lizards of its own age. Shaded red to green."],
    ["Downs and Knocks", "How often it was knocked down, and how often it knocked others down."],
    ["Sprints", "Ten bars, one for each tenth of the course: the taller the bar, the longer it sprinted there."],
  ],
  race: [
    ["The standings", "On the left: every lizard in its current position, with its number and name. Yours are framed in white; a tick means it has finished. Tap one to follow it."],
    ["As they run", "Top right: what your bets would pay if the race finished in the current order, against what you staked."],
    ["The marks", "A white frame and marker: your bet. Flashing: sprinting. Flattened: knocked down. Blue: swimming."],
    ["The stripes", "The background is striped every 25 m, so you can see how fast the field is going."],
    ["Follow", "Who the camera follows: the leader, or any lizard. It starts on the lizard you staked most on."],
    ["Speed and the slider", "Slower, Pause and Faster change how the race plays. Drag the slider to go anywhere in it. Skip to the end goes straight to the result."],
  ],
  result: [
    ["Race finished", "Every lizard in finishing order, those that didn't finish last."],
    ["Time and behind", "How long it took, and how far behind the winner it was."],
    ["Downs and knock-downs", "How often it was knocked down, and how often it knocked others down."],
    ["The bars", "Its sprinting through each tenth of the course: the taller, the longer it sprinted."],
    ["Your bets", "What each of your bets on it paid. Everyone staked: what all players put on it, to win and to place."],
  ],
  leagues: [
    ["Leagues", "Your score against other players over an hour, a day, a week or a month, and in friends' leagues."],
    ["The score", "100% is level: what you have now, less any top-ups, against what you had when the league began (or when you joined it)."],
    ["The table", "The top ten, and your own row framed - added below if you're further down."],
    ["Friends' leagues", "Make one with a name and a length, then copy its code to friends; they enter it to join. Leave takes you out of it."],
  ],
  stage: [
    ["The course", "The next race's course, side on. Each stretch of ground is coloured by its surface, obstacles are blocks, and the flags are the start and finish."],
    ["Height", "Height is drawn larger than length, so the rises show: the map says by how much."],
  ],
  settings: [
    ["Your account", "As a guest, your play lives in this browser only. Keep it with Google to play it anywhere and for good, or sign in with Google if you already play."],
    ["Two accounts", "If you've played somewhere else too, join the two: ask for a code here and enter it on the other device, or the other way round. You keep the larger purse."],
    ["Colour scale", "The colours every shaded figure runs through, from bad to good."],
    ["Runner marks and motion", "What each lizard carries in the race - its number or its name - and whether the race flashes and eases."],
  ],
};

/** The pop-up, opened with the page to explain as its parameter. */
export function describeHelp(ui) {
  return ui.popUp("help", (page) => ui.column([
    ui.text(Phrase.of("What's on this page"), "Title"),
    ui.each(page.map((name) => (HELP[name] ?? []).map(([heading, said], at) => ({ key: `${name}-${at}`, heading, said }))), (held) => ui.column([
      ui.text(held.map((h) => (h ? Phrase.of(h.heading) : "")), "PartHeading"),
      ui.text(held.map((h) => (h ? Phrase.of(h.said) : "")), "Hint").wraps(),
    ], "HelpPart"), (h) => h.key, "HelpParts"),
    ui.pressable(Ui.CLOSES, {}, [ui.text(Phrase.of("Close"), "Face")], "Pressable"),
  ], "HelpSheet"));
}

/** The i: the help, opened on this page (a name, or a bound value reading one). */
export function infoButton(ui, popUp, page) {
  const payload = typeof page === "string" ? { parameter: page } : page.map((name) => ({ parameter: name }));
  return ui.pressable(OPENS_HELP, payload, [ui.text("i", "InfoMark")], "Pressable InfoButton").opens(popUp);
}
