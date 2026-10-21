// Lizarding: the betting game, in a browser (the brief of 20 Oct 2026).
// Players never steer a lizard: they study the runners, bet on the race card
// everyone shares, and try to beat odds that are a little wrong on purpose.
// The game is the server's; this follows it over one socket (hub.js, shared
// by every tab), holds nothing but the refresh token and the settings, and
// draws the race as rectangles.
//
// The screens: the door (signing in, choosing a name, and every way the
// game can turn a page away), the race card, a lizard and its form, the bet
// pop-up, the leagues, the stage map, the settings, the race, and its
// result. The nav bar stands over all of them but the door and the race.
//
// Opened with ?probe the page walks itself against a stand-in for the
// platform and the game (tests/standin.js), never the real ones; opened with
// ?standin it plays against the stand-in, for a person to try.

import { ChimeApp, Chimes, Driver, Frames, Look, Phrase, Ui } from "./gd_chime/gd_chime.js?v=4b687445d506";
import { CONFIG } from "./config.js?v=4b687445d506";
import { SignIn } from "./auth.js?v=4b687445d506";
import { Connection } from "./connection.js?v=4b687445d506";
import { localParts, openLine } from "./hub.js?v=4b687445d506";
import * as Session from "./play.js?v=4b687445d506";
import * as Card from "./card.js?v=4b687445d506";
import * as Bet from "./bet.js?v=4b687445d506";
import * as Lizard from "./lizard.js?v=4b687445d506";
import * as League from "./leagues.js?v=4b687445d506";
import * as Race from "./race.js?v=4b687445d506";
import * as Nav from "./nav.js?v=4b687445d506";
import * as Course from "./course.js?v=4b687445d506";
import * as Prefs from "./settings.js?v=4b687445d506";
import * as Join from "./joining.js?v=4b687445d506";
import * as Help from "./help.js?v=4b687445d506";
import { RaceView } from "./viewer.js?v=4b687445d506";
import { drawStageMap } from "./stage.js?v=4b687445d506";
import { ordinal, paid, secondsLeft } from "./rules.js?v=4b687445d506";
import { credits } from "./parts.js?v=4b687445d506";
import { secondsAt } from "./telemetry.js?v=4b687445d506";
import { drawSignIn, takeGoogleRedirect } from "./backend/google.js?v=4b687445d506";

// ?probe walks the page against the stand-in; ?standin only plays against it, for a person to try
const asked = new URLSearchParams(location.search);
const probing = asked.has("probe") || asked.has("standin");
const STANDIN = probing ? new (await import("./tests/standin.js?v=4b687445d506")).StandIn() : null;
// Google's own button, or the stand-in's; and Google's answer, if the page has just come back from it on a phone
const drawGoogle = STANDIN?.drawGoogle ?? drawSignIn;
const GOOGLE_MODE = "lizarding_google_mode";
const backFromGoogle = STANDIN ? null : takeGoogleRedirect();

const DOOR = "door";
// the desktop's tote cabinet (betting/play/project/cabinet_look.gd): enamel on a night page, brass and amber
const PALETTE = {
  ground: "#08070f", raised: "#1a1733", lit: "#2e2a52", ink: "#e9e3d2", ink_soft: "#837fb0",
  accent: "#9a8043", accent_2: "#ff80b8", warn: "#ff80b8", edge: "#2e2a52",
};
// the statuses the door stands for, whatever was played before
const AT_THE_DOOR = ["naming", "refused", "elsewhere", "gone", "unsigned", "limited"];

class Lizarding extends ChimeApp {
  look() { return Look.make(PALETTE); }

  declare(register) {
    register.declareAll(Object.fromEntries(Object.entries({
      ...Session.WORDS, ...Card.WORDS, ...Bet.WORDS, ...Lizard.WORDS, ...League.WORDS, ...Race.WORDS, ...Nav.WORDS, ...Prefs.WORDS, ...Join.WORDS, ...Help.WORDS,
    })));
  }

  describe() {
    const ui = this.ui;
    const line = STANDIN ? STANDIN.line() : openLine({
      local: () => localParts({ config: CONFIG, fetch: globalThis.fetch.bind(globalThis), WebSocket: globalThis.WebSocket, timers: globalThis, SignIn, Connection }),
    });
    const play = this.play = this.model(new Session.Play(this.chimes, { line, clock: STANDIN?.clock ?? (() => Date.now()) }));
    const settings = this.settings = this.model(new Prefs.Settings(this.chimes));
    const betting = this.betting = this.model(new Bet.Betting(this.chimes, play));
    const leagues = this.leagues = this.model(new League.Leagues(this.chimes, play, { clipboard: STANDIN?.clipboard, clock: STANDIN?.clock }));
    const watching = this.watching = this.model(new Race.Watching(this.chimes, play));
    const joining = this.joining = this.model(new Join.Joining(this.chimes, play));
    this.mapScale = ui.local(1);
    this.hadGame = false;

    const betPopUp = this.betPopUp = Bet.describeBetPopUp(ui, play, betting);
    betting.close = () => Frames.defer(() => this.lower(betPopUp.getPlace()));
    const instruction = ui.bound(() => this.instruction());
    // the i: the page the player is on, explained
    const help = this.helpPopUp = Help.describeHelp(ui);
    const onPage = ui.bound(() => { const path = this.screen(); return path[path.length - 1] ?? Card.CARD; });
    const top = ui.bound(() => this.screen());
    const nav = Nav.describeNav(ui, play, { screens: { card: Card.CARD, stage: Course.STAGE, leagues: League.LEAGUES, settings: Prefs.SETTINGS }, instruction, info: Help.infoButton(ui, help, onPage) });
    const status = play.connection;
    const lost = ui.bound(() => {
      const s = status.read();
      if (s.status === "playing" || AT_THE_DOOR.includes(s.status) || !play.game.read() && !this.hadGame) return "";
      if (s.status === "lost") return Phrase.of("The connection was lost: joining the game again…");
      return Phrase.of("Joining the game again…");
    });
    return ui.app("lizarding", [
      ui.when(top.map((path) => !path.includes(DOOR) && !path.includes(Race.RACE)), nav),
      ui.text(lost, "Banner").wraps().hidesEmpty(),
      ui.each(play.notices, (held) => ui.text(held.map((n) => n?.words ?? ""), "Notice Toast").wraps(), (n) => n.id, "Notices"),
      ui.stack([
        this.door(),
        Card.describeCard(ui, play, { lizard: Lizard.LIZARD, betPopUp, account: Prefs.SETTINGS, result: Race.RESULT }),
        Lizard.describeLizard(ui, play, { betPopUp }),
        League.describeLeagues(ui, play, leagues),
        Course.describeStage(ui, play, this.mapScale),
        Prefs.describeSettings(ui, settings, play, joining),
        Race.describeRace(ui, play, watching, Help.infoButton(ui, help, Race.RACE)),
        Race.describeResult(ui, play, watching),
      ]),
    ]);
  }

  /** The door: signing in, a name chosen once and for good, and every way the game turns a page away. */
  door() {
    const ui = this.ui;
    const play = this.play;
    const is = (...statuses) => play.connection.map((s) => statuses.includes(s.status));
    const said = play.connection.map((s) => s.reason ?? "");
    return ui.screen(DOOR, [
      ui.row([Help.infoButton(ui, this.helpPopUp, DOOR)], "DoorTop"),
      ui.column([
        ui.text("Lizarding", "Wordmark"),
        ui.text(Phrase.of("Study the runners. Beat the odds."), "Hint"),
        ui.when(is("signing in"), ui.text(Phrase.of("Signing in…"), "Quiet")),
        ui.when(is("connecting"), ui.text(Phrase.of("Connecting to the game…"), "Quiet")),
        ui.when(is("lost"), ui.text(play.connection.map((s) => Phrase.with("The game can't be reached. Trying again in %d s…", [Math.ceil((s.retryIn ?? 0) / 1000)])), "Quiet").wraps()),
        ui.when(is("naming"), ui.column([
          ui.text(Phrase.of("Choose the name other players will see."), "Words").wraps(),
          ui.text(Phrase.of("A name is chosen once and for good: it can't be changed later."), "Warn").wraps(),
          ui.text(Phrase.of("3 to 20 letters, digits and single spaces."), "Small Quiet").wraps(),
          ui.field(Session.CHOOSES_NAME, "", { label: Phrase.of("Your name"), changes: Session.TYPES_NAME, shows: play.typedName, autocomplete: "nickname" }),
          ui.text(play.connection.map((s) => s.refusedName ?? ""), "Said").wraps().hidesEmpty(),
          ui.button(Session.CHOOSES_NAME),
          // a player coming back on a new device signs in, rather than naming a guest they don't want
          ui.text(Phrase.of("Already play Lizarding with Google?"), "Small Quiet DoorOr"),
          ui.surface("GoogleButton", []).named("google-naming"),
        ], "Naming")),
        ui.when(is("refused"), ui.column([ui.text(said, "Words").wraps(), ui.button(Session.RELOADS)])),
        ui.when(is("elsewhere"), ui.column([
          ui.text(Phrase.of("You're playing somewhere else"), "Words").wraps(),
          ui.text(Phrase.of("This account was opened on another device or browser."), "Quiet").wraps(),
          ui.button(Session.TAKES_IT_BACK),
        ])),
        ui.when(is("gone"), ui.column([
          ui.text(Phrase.of("Your guest account has gone"), "Words").wraps(),
          ui.text(Phrase.of("A guest that isn't played for ten days is deleted, and this one can't be brought back. You can start again as a new guest; your credits and your name don't come with you."), "Quiet").wraps(),
          ui.button(Session.STARTS_AGAIN),
          ui.text(Phrase.of("Or, if you play with Google:"), "Small Quiet"),
        ])),
        ui.when(is("limited"), ui.column([
          ui.text(Phrase.of("Too many new players have joined from your network this hour"), "Words").wraps(),
          ui.text(Phrase.of("Try again later - this page tries again every few minutes - or sign in with Google."), "Quiet").wraps(),
          ui.button(Session.SIGNS_IN_AGAIN, { style: "Pressable" }),
        ])),
        ui.when(is("gone", "limited"), ui.surface("GoogleButton", []).named("google-door")),
        ui.text(play.googleSaid, "Said").wraps().hidesEmpty(),
        ui.when(is("unsigned"), ui.column([
          ui.text(Phrase.of("The game turned your sign-in away."), "Words").wraps(),
          ui.button(Session.SIGNS_IN_AGAIN),
        ])),
      ], "Door"),
    ]);
  }

  /** The nav's one line: what to do now, on the screen the player is on. */
  instruction() {
    const play = this.play;
    const path = this.screen();
    if (!play.game.read()) return Phrase.of("Connecting…");
    if (path.includes(League.LEAGUES)) return Phrase.of("Beat the others over an hour, a day, a week or a month");
    if (path.includes(Race.RESULT)) return Phrase.of("Continue to the next race");
    if (path.includes(Course.STAGE)) return Phrase.of("The course the next race runs");
    if (path.includes(Prefs.SETTINGS)) return Phrase.of("Your settings, kept in this browser");
    const card = play.openCard();
    if (!card) return Phrase.of("Waiting for the next race");
    if (secondsLeft(card.runsAt, play.now.read()) === 0) return Phrase.of("Betting has closed");
    if (path.includes(Lizard.LIZARD)) return Phrase.of("Study its form, then bet");
    return Phrase.of("Pick a lizard to bet on");
  }

  // --- what follows what ---

  /** The path to the screen the player is on, beneath any pop-up raised over it: a pop-up opened is not a screen left. */
  screen() { return this.driver.where().path; }

  /** A pop-up closed, if it is the one on top. */
  lower(popUp) { if (this.driver.getTop().includes(popUp)) this.commands.dispatch(popUp, Ui.CLOSES, {}); }

  go(place, parameter = null) { this.commands.dispatch(Chimes.GLOBAL, Driver.GO, { place, parameter }); }

  /** Back no further than here: the door, a race and its result are not places to go back to. */
  forget() { if (this.driver.canGoBack() && !this.driver.isRaised()) this.commands.dispatch(Chimes.GLOBAL, Driver.FORGETS, {}); }

  mount(element) {
    super.mount(element);
    this.started.then((stood) => { if (stood) this.follows(); });
    return this;
  }

  follows() {
    const { play, watching, settings, leagues } = this;
    const follow = (key, work) => this.chimes.follow({ region: Chimes.GLOBAL }, key, work);
    const sheet = document.createElement("style");
    document.head.appendChild(sheet);
    follow("colours", () => { sheet.textContent = Prefs.colourSheet(settings.scale.read()); });

    // the door, as the connection stands
    follow("door", () => {
      const status = play.connection.read().status;
      const game = play.game.read();
      if (game) this.hadGame = true;
      const atDoor = this.screen().includes(DOOR);
      Frames.defer(() => {
        if (AT_THE_DOOR.includes(status) || (!game && !this.hadGame)) { if (!atDoor) { this.go(DOOR); this.forget(); } }
        else if (atDoor && game) { this.go(Card.CARD); this.forget(); }
      });
    });

    // the countdown reaching 0: any bet being made up let go, and the race. The card counted down is
    // watched once it is no longer open with time left - its time came, or its result or the next card
    // came first, all within a second - but never a card already closed when the page opened.
    let counting = null; // the open card, while its countdown runs
    follow("off", () => {
      const game = play.game.read();
      const card = play.openCard();
      const open = card && secondsLeft(card.runsAt, play.now.read()) > 0 ? card.race : null;
      const ran = counting !== null && counting !== open ? game?.cards.get(counting) ?? null : null;
      counting = open;
      if (!ran) return;
      Frames.defer(() => {
        this.lower(this.betPopUp.getPlace());
        this.betting.reset();
        watching.start(ran);
        this.go(Race.RACE);
      });
    });

    // the race shown: played as soon as it is the one being watched
    follow("race", () => {
      const shown = play.race.read();
      const phase = watching.phase.read();
      const onRace = this.screen().includes(Race.RACE);
      if (phase !== "waiting" || !onRace) return;
      Frames.defer(() => {
        const telemetry = watching.telemetryFor(shown);
        if (!telemetry) return;
        const place = document.getElementById("race-view");
        const watched = watching.watched._held;
        const runners = watched.card.runners.map((r, index) => {
          const field = watched.field?.runners.find((f) => f.lizard === r.lizard);
          return { number: index + 1, name: field?.name ?? `Lizard ${r.lizard}`, halfWidth: field?.fields.body_half_width ?? 0.5, halfHeight: field?.fields.body_half_height ?? 0.5 };
        });
        const canvas = document.createElement("canvas");
        canvas.className = "RaceCanvas";
        // the slider: where the race has reached, dragged to anywhere in it; and the time so far and in all
        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "RaceSlider";
        slider.min = "0";
        slider.max = String(Math.max(0, telemetry.ticks - 1));
        slider.step = "1";
        slider.value = "0";
        slider.setAttribute("aria-label", "Where in the race");
        const clock = document.createElement("p");
        clock.className = "chime-text RaceClock";
        const said = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
        const total = said(secondsAt(Math.max(0, telemetry.ticks - 1)));
        let dragging = false;
        slider.addEventListener("pointerdown", () => { dragging = true; });
        slider.addEventListener("pointerup", () => { dragging = false; });
        slider.addEventListener("input", () => watching.view?.seek(Number(slider.value)));
        const bar = document.createElement("div");
        bar.className = "RaceBar";
        bar.append(slider, clock);
        // the standings, beside the picture: position, number and name, in race order; pressed, followed
        const standings = document.createElement("ol");
        standings.className = "Standings";
        standings.setAttribute("aria-label", "Positions");
        const backed = watching.backed();
        const rows = runners.map((runner, index) => {
          const row = document.createElement("li");
          const press = document.createElement("button");
          press.type = "button";
          press.className = `StandingRow${backed.has(index) ? " Backed" : ""}`;
          press.innerHTML = `<span class="StandingPlace"></span><span class="Square Runner${runner.number}">${runner.number}</span><span class="StandingName"></span>`;
          press.querySelector(".StandingName").textContent = runner.name;
          press.addEventListener("click", () => this.commands.dispatch(Race.RACE, Race.FOLLOWS, { index }));
          row.append(press);
          return row;
        });
        // what the player's bets would pay were they to finish as they run now: top right of the picture
        const bets = watched.bets;
        const staked = bets.reduce((sum, bet) => sum + bet.stake, 0);
        const winnings = document.createElement("p");
        winnings.className = "chime-text LiveWinnings";
        winnings.hidden = bets.length === 0;
        const payNow = (standing) => {
          if (!bets.length) return;
          const placeOf = new Map(standing.map((s, at) => [s.index, at + 1]));
          const paying = bets.reduce((sum, bet) => {
            const index = watched.card.runners.findIndex((r) => r.lizard === bet.lizard);
            const runner = watched.card.runners[index];
            return sum + paid(bet, runner.odds, runner.rating, placeOf.get(index) ?? 0);
          }, 0);
          winnings.textContent = `As they run: ${credits(paying)} of ${credits(staked)} staked`;
          winnings.classList.toggle("Up", paying > staked);
          winnings.classList.toggle("Down", paying < staked);
        };
        let standingShown = "";
        const stand = (standing) => {
          const now = standing.map((s) => `${s.index}${s.out ? "x" : s.home ? "h" : ""}`).join(",") + `|${watching.follow._held}`;
          if (now === standingShown) return;
          standingShown = now;
          payNow(standing);
          let place = 0;
          standings.replaceChildren(...standing.map((s) => {
            const row = rows[s.index];
            const at = row.querySelector(".StandingPlace");
            at.textContent = s.out ? "DNF" : ordinal(++place);
            at.dataset.place = s.out ? "–" : String(place);
            row.firstChild.classList.toggle("Home", s.home);
            row.firstChild.classList.toggle("Out", s.out);
            row.firstChild.classList.toggle("Followed", watching.follow._held === s.index);
            return row;
          }));
        };
        const stage = document.createElement("div");
        stage.className = "RaceStage";
        const picture = document.createElement("div");
        picture.className = "RacePicture";
        picture.append(canvas, bar, winnings);
        stage.append(standings, picture);
        place.replaceChildren(stage);
        const course = watched.field?.course ?? { surfaces: [], obstacles: [], start: { x: 0, y: 0 }, finish: { x: 0, y: 0 }, bounds: { left: 0, right: 1, low: 0, high: 1 } };
        watching.view = new RaceView(canvas, {
          race: telemetry, course, runners, marks: settings.marks._held, still: settings.reducedMotion._held,
          ended: () => watching.over(), clock: STANDIN?.frameClock,
          backed: watching.backed(), following: () => watching.follow._held,
          speed: () => watching.speed._held, paused: () => watching.paused._held,
          moved: (tick) => {
            if (watching.view?.standing) stand(watching.view.standing);
            if (!dragging) slider.value = String(Math.round(tick));
            const now = `${said(secondsAt(tick))} / ${total}`;
            if (clock.textContent !== now) clock.textContent = now;
          },
        });
        watching.playing();
        watching.view.start();
      });
    });

    // the result held back until the race has been watched; one that never shows its race is shown after a while
    follow("result", () => {
      const game = play.game.read();
      const watched = watching.watched.read();
      if (game && watched && game.results.has(watched.race)) Frames.defer(() => watching.resultCame());
    });
    let phaseWas = "off";
    follow("over", () => {
      const phase = watching.phase.read();
      const onRace = this.screen().includes(Race.RACE);
      if (phase === "over" && onRace) Frames.defer(() => { this.go(Race.RESULT); this.forget(); });
      // continued to the card: Back leads nowhere into the race
      if (phase === "off" && phaseWas === "over") Frames.defer(() => this.forget());
      phaseWas = phase;
      // left the race some other way (the door): the race is let go
      if (phase !== "off" && !onRace && !this.screen().includes(Race.RESULT)) Frames.defer(() => watching.done());
    });

    // the tables, fetched as the leagues open, never in the background
    let atLeagues = false;
    follow("leagues", () => {
      const now = this.screen().includes(League.LEAGUES);
      if (now && !atLeagues) Frames.defer(() => leagues.fetch());
      atLeagues = now;
    });

    // form: each runner of the open card's, and the lizard looked at
    follow("form", () => {
      const card = play.openCard();
      const status = play.connection.read().status;
      const looked = this.driver.getParameter(Lizard.LIZARD);
      play.forms.read();
      if (status !== "playing") return;
      Frames.defer(() => {
        if (looked != null) play.askForm(looked);
        for (const runner of card?.runners ?? []) play.askForm(runner.lizard);
      });
    });

    // Google's button, where one shows: the door's signs in; the account's keeps the guest, or signs in instead
    follow("google", () => {
      const status = play.connection.read().status;
      const account = play.account.read();
      const mode = play.googleMode.read();
      const top = this.screen();
      const wanted = [];
      if (["gone", "limited"].includes(status) && top.includes(DOOR)) wanted.push(["google-door", "sign in"]);
      if (status === "naming" && top.includes(DOOR)) wanted.push(["google-naming", "sign in"]);
      if (account.guest && account.state === "in" && top.includes(Prefs.SETTINGS)) wanted.push(["google-account", mode]);
      Frames.defer(() => {
        for (const [id, use] of wanted) {
          const place = document.getElementById(id);
          if (!place || place.dataset.drawn === use) continue;
          place.dataset.drawn = use;
          // on a phone the button goes to Google and back: what it was for is kept for the page's return
          try { sessionStorage.setItem(GOOGLE_MODE, use); } catch { /* without it, a return links */ }
          const words = use === "link" ? "Keep with Google" : "Sign in with Google";
          drawGoogle(place, CONFIG.google, (credential, nonce) => play.google(use, credential, nonce), { text: use === "link" ? "continue_with" : "signin_with" }, words)
            .catch(() => { place.dataset.drawn = ""; play.googleSaid.setValue(Phrase.of("Google's sign-in couldn't be loaded.")); });
        }
      });
    });

    // back from Google on a phone: its answer used as the button that went there meant it
    if (backFromGoogle?.credential) {
      let mode = "link";
      try { mode = sessionStorage.getItem(GOOGLE_MODE) ?? "link"; } catch { /* a return links */ }
      play.google(mode, backFromGoogle.credential, backFromGoogle.nonce);
    } else if (backFromGoogle?.error) play.googleSaid.setValue(backFromGoogle.error);

    // the stage map, drawn as its screen shows
    follow("map", () => {
      const open = this.screen().includes(Course.STAGE);
      const stage = Nav.stageOf(play);
      if (!open || !stage) return;
      Frames.defer(() => {
        const place = document.getElementById("stage-map");
        if (!place) return;
        // drawn at the width it is shown, so its words stay legible on a phone
        const width = Math.max(320, Math.round(place.clientWidth || 960));
        const drawn = drawStageMap(stage, { width, height: Math.round(Math.min(320, Math.max(220, width * 0.4))) });
        place.innerHTML = drawn.svg;
        if (this.mapScale._held !== drawn.scale) this.mapScale.setValue(drawn.scale);
      });
    });
  }

  probe() { return import("./probe.js?v=4b687445d506").then((made) => new made.Probe(this, STANDIN)); }
}

ChimeApp.start(Lizarding, document.getElementById("app")).then((app) => { if (probing) Object.assign(globalThis, { lizarding: app, standin: STANDIN }); });
