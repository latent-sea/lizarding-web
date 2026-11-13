// The game as this tab holds it (the brief's section 10): what the line to
// the game (hub.js) hears, kept as values the screens read - where the
// connection stands, the seat's game (game.js), the field, the race, the
// names, the tables, the stakes, the form - and the intents sent back.
// Everything here lives in memory; a reconnect throws it all away for the
// next Starting copy, and every intent still waiting fails.
//
// The door's actions here are the connection's: choosing the name, taking
// the game back from another device, starting again as a new guest.

import { CONFIG } from "./config.js?v=dadaf39aa503";
import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=dadaf39aa503";
import { Game, OutOfOrder } from "./game.js?v=dadaf39aa503";
import { ANSWERED, Malformed, SHOWN, followAnswered, frame } from "./wire.js?v=dadaf39aa503";
import { nameProblem } from "./rules.js?v=dadaf39aa503";
import { readStage } from "./stage.js?v=dadaf39aa503";

export const TYPES_NAME = "types_a_name";
export const CHOOSES_NAME = "chooses_this_name";
export const TAKES_IT_BACK = "plays_here_instead";
export const STARTS_AGAIN = "starts_again_as_a_new_guest";
export const SIGNS_IN_AGAIN = "signs_in_again";
export const RELOADS = "reloads_the_page";
export const WANTS_GOOGLE_SIGN_IN = "already_plays_with_google";
export const KEEPS_GUEST = "keeps_this_guest";
// the account's own (the coordinator, 13 Nov: a privacy link, sign-out and delete account on the play page)
export const SIGNS_OUT = "signs_out";
const CONTACT = CONFIG.contact;
export const ASKS_TO_DELETE = "asks_to_delete_the_account";
export const DELETES_ACCOUNT = "deletes_the_account";
export const KEEPS_ACCOUNT = "keeps_the_account";

export const WORDS = {
  [TYPES_NAME]: ["Your name"],
  [CHOOSES_NAME]: ["Keep this name"],
  [TAKES_IT_BACK]: ["Play here instead"],
  [STARTS_AGAIN]: ["Start again as a new guest"],
  [SIGNS_IN_AGAIN]: ["Try signing in again"],
  [RELOADS]: ["Reload"],
  [WANTS_GOOGLE_SIGN_IN]: ["I already play with Google"],
  [KEEPS_GUEST]: ["Keep this guest instead"],
  [SIGNS_OUT]: ["Sign out"],
  [ASKS_TO_DELETE]: ["Delete my account"],
  [DELETES_ACCOUNT]: ["Yes, delete it for good"],
  [KEEPS_ACCOUNT]: ["No, keep it"],
};

/** How many of a lizard's latest races are asked for: the lizard screen's table, and the strip's last few. */
export const FORM_MOST = 30;
/** Form asked for at most this many at once: a new card is up to ten asks, and the game lets eight wait. */
const FORM_AT_ONCE = 4;
const NOTICE_MS = 6000;

export class Play extends Controller {
  constructor(chimes, { line, timers = globalThis, clock = () => Date.now(), reload = () => location.reload() }) {
    super(chimes);
    this.line = line;
    this._timers = timers;
    this._clock = clock;
    this._reload = reload;
    this.connection = this.value({ status: "signing in" }); // { status, reason, refusedName, retryIn }
    this.typedName = this.value("");
    this.game = this.value(null); // a Game, set again whenever it moves
    this.fields = this.value(new Map()); // race -> the field (ToShow 0), its course read
    this.race = this.value(null); // the latest race shown (ToShow 1): { race, field, telemetry }
    this.names = this.value(new Map()); // player -> name
    this.tables = this.value(null); // the latest league tables (ToShow 3)
    this.stakes = this.value(null); // the latest stakes (ToShow 4)
    this.forms = this.value(new Map()); // lizard -> its form (ToShow 8)
    // the practice card (T-668): while the first tips run over the race card, its clock stopped and betting off
    this.practising = this.value(null); // while practising, the seconds left when it began (or true, with none open)
    this.now = this.value(clock()); // the time, moved on as each whole second turns
    this.notices = this.value([]); // words shown for a while: a bet declined, above all
    this.account = this.value({ state: "signing in", guest: true }); // the sign-in, as the leading tab's says
    this.googleMode = this.value("link"); // what Google's button does for a guest: "link" keeps it, "sign in" plays another account
    this.googleSaid = this.value(""); // the words on the last use of Google
    this.deleting = this.value(false); // Delete my account pressed: asked once more before it is done
    this.accountBusy = this.value(false); // signing out, or deleting, under way
    this.accountSaid = this.value(""); // what came of it, when the page doesn't start afresh
    this._formAsked = new Set();
    this._formQueue = [];
    this._formOut = 0;
    this._noticed = 0;
    line.listen((event) => this._heard(event));
    this._tick();
  }

  answers() { return [TYPES_NAME, CHOOSES_NAME, TAKES_IT_BACK, STARTS_AGAIN, SIGNS_IN_AGAIN, RELOADS, WANTS_GOOGLE_SIGN_IN, KEEPS_GUEST, SIGNS_OUT, ASKS_TO_DELETE, DELETES_ACCOUNT, KEEPS_ACCOUNT]; }

  would(action) {
    if (action === CHOOSES_NAME) {
      if (this.connection.read().status !== "naming") return Phrase.of("The game isn't asking for a name");
      const problem = nameProblem(this.typedName.read());
      return problem ? Phrase.of(problem) : null;
    }
    if ((action === SIGNS_OUT || action === DELETES_ACCOUNT) && this.accountBusy.read()) return Phrase.of("A moment…");
    return null;
  }

  told(action, payload) {
    if (action === TYPES_NAME) this.typedName.setValue(payload.line ?? "");
    else if (action === CHOOSES_NAME) this.line.chooseName(this.typedName.read());
    else if (action === TAKES_IT_BACK) this.line.takeBack();
    else if (action === STARTS_AGAIN) this.line.startAgain();
    else if (action === SIGNS_IN_AGAIN) this.line.signInAgain();
    else if (action === RELOADS) this._reload();
    else if (action === WANTS_GOOGLE_SIGN_IN) { this.googleMode.setValue("sign in"); this.googleSaid.setValue(""); }
    else if (action === KEEPS_GUEST) { this.googleMode.setValue("link"); this.googleSaid.setValue(""); }
    else if (action === SIGNS_OUT) this._signOut();
    else if (action === ASKS_TO_DELETE) { this.deleting.setValue(true); this.accountSaid.setValue(""); }
    else if (action === KEEPS_ACCOUNT) this.deleting.setValue(false);
    else if (action === DELETES_ACCOUNT) this._delete();
    return null;
  }

  /** Signed out: the page starts afresh, as a first visit (a guest, or Google's button to sign back in). */
  async _signOut() {
    this.accountBusy.setValue(true);
    await this.line.platform("account/sign-out", {});
    this._reload();
  }

  /**
   * The account deleted for good (platform_delete_me: every part of the platform forgets it, then its sign-in), and
   * the page starts afresh; or, an account another of the platform's apps also holds, said where to ask instead.
   */
  async _delete() {
    this.accountBusy.setValue(true);
    this.accountSaid.setValue(Phrase.of("Deleting your account…"));
    const done = await this.line.platform("account/delete", {});
    this.accountBusy.setValue(false);
    if (done.ok && done.body === true) { this._reload(); return; }
    this.deleting.setValue(false);
    this.accountSaid.setValue(done.ok
      ? Phrase.with("This account is also used by another Latent Sea game, so it can't be deleted from here. Write to %s and it will be.", [CONTACT])
      : Phrase.with("Your account couldn't be deleted: %s. Try again in a moment.", [done.error ?? ""]));
  }

  /** Google's ID token used - "link" or "sign in" - and what came of it said. */
  async google(mode, idToken, nonce) {
    this.googleSaid.setValue(Phrase.of(mode === "link" ? "Keeping your account with Google…" : "Signing in with Google…"));
    const done = await this.line.google(mode, idToken, nonce);
    if (done.ok) {
      this.googleSaid.setValue(Phrase.of(mode === "link" ? "Your account is kept with Google: sign in with it on any device." : "Signed in with Google."));
      this.googleMode.setValue("link");
    } else if (mode === "link" && /identity_already_exists|already/i.test(done.error ?? "")) {
      // the Google account plays already, as another player: what joins them is a join, not a link
      this.googleSaid.setValue(Phrase.of("That Google account already plays Lizarding. To bring this guest's play into it, join the two accounts (below), or sign in with Google instead."));
    } else this.googleSaid.setValue(done.error ? Phrase.with(mode === "link" ? "Your account couldn't be kept with Google: %s" : "Signing in with Google didn't work: %s", [done.error]) : "");
  }

  // --- reading ---

  /** The open card, or null. */
  openCard() { return this.game.read()?.openCard() ?? null; }

  /** The field of a race, once it has come. */
  fieldOf(race) { return this.fields.read().get(race) ?? null; }

  /** A player's name, or null when none is held. */
  nameOf(player) { return this.names.read().get(player) ?? null; }

  // --- sending ---

  /** An intent sent: its answer, { kind, reason }. */
  send(kind, payload) { return this.line.send(kind, payload); }

  /** Form asked for, once a session, paced: what has come is in forms. */
  askForm(lizard) {
    if (this._formAsked.has(lizard) || this.connection._held.status !== "playing") return;
    this._formAsked.add(lizard);
    this._formQueue.push(lizard);
    this._nextForm();
  }

  _nextForm() {
    while (this._formOut < FORM_AT_ONCE && this._formQueue.length) {
      const lizard = this._formQueue.shift();
      this._formOut++;
      this.send("show form", { lizard, most: FORM_MOST }).then((answer) => {
        this._formOut--;
        // asked again on a later look, unless the game said it never will be
        if (answer.kind === ANSWERED.FAILED) this._formAsked.delete(lizard);
        this._nextForm();
      });
    }
  }

  /** Words shown for a while, in the notices. */
  notice(words) {
    const id = ++this._noticed;
    this.notices.update((list) => [...list, { id, words }]);
    this._timers.setTimeout(() => this.notices.update((list) => list.filter((n) => n.id !== id)), NOTICE_MS);
  }

  // --- hearing ---

  _heard(event) {
    if (event.account) { this.account.setValue(event.account); return; }
    if (event.status) {
      const was = this.connection._held.status;
      this.connection.setValue(event);
      if (event.status !== "playing" && was === "playing") this._forget();
      return;
    }
    try {
      if (event.welcome || event.welcomeBytes) this._welcome(event.welcome ?? followAnswered(event.welcomeBytes).welcome);
      else if (event.frame) this._frame(frame(event.frame));
    } catch (error) {
      if (!(error instanceof Malformed) && !(error instanceof OutOfOrder)) throw error;
      this._forget();
      this.line.drop(error.message);
    }
  }

  /** Everything held let go: the next Starting copy rebuilds it. */
  _forget() {
    this.game.setValue(null);
    this.fields.setValue(new Map());
    this.race.setValue(null);
    this.tables.setValue(null);
    this.stakes.setValue(null);
    this.forms.setValue(new Map());
    this._formAsked.clear();
    this._formQueue = [];
  }

  _welcome(welcome) {
    this._forget();
    this.game.setValue(new Game(welcome.starting));
    if (this.connection._held.status !== "playing") this.connection.setValue({ status: "playing" });
  }

  _frame(message) {
    const game = this.game._held;
    if (message.batch) {
      if (!game) return;
      const moved = game.apply(message.batch);
      // a lizard that has just run has a race more in its form: asked for again when next it is looked at
      if (moved.results.length) {
        const ran = new Set(moved.results.flatMap((race) => game.results.get(race)?.order ?? []));
        if (ran.size) {
          this.forms.update((held) => new Map([...held].filter(([lizard]) => !ran.has(lizard))));
          for (const lizard of ran) this._formAsked.delete(lizard);
        }
      }
      this.game.setValue(game);
      return;
    }
    const shown = message.shown;
    if (!shown || shown.ignored) return;
    switch (shown.kind) {
      case SHOWN.FIELD: {
        const kept = new Map(this.fields._held);
        kept.set(shown.race, { ...shown, course: readStage(shown.stage) });
        // the game keeps nothing older than the last race; nor does this
        for (const race of [...kept.keys()].sort((a, b) => a - b).slice(0, -2)) kept.delete(race);
        this.fields.setValue(kept);
        break;
      }
      case SHOWN.RACE: this.race.setValue(shown); break;
      case SHOWN.NAMES: this.names.update((held) => { const kept = new Map(held); for (const { player, name } of shown.names) kept.set(player, name); return kept; }); break;
      case SHOWN.TABLES: this.tables.setValue(shown.tables); break;
      case SHOWN.STAKES: this.stakes.setValue(shown); break;
      case SHOWN.FORM: this.forms.update((held) => new Map(held).set(shown.lizard, shown)); break;
      default: break;
    }
  }

  /** The clock moved on at each whole second, for the countdown. */
  _tick() {
    const now = this._clock();
    this.now.setValue(now);
    this._timers.setTimeout(() => this._tick(), 1000 - (now % 1000) + 5);
  }
}
