// One socket per browser (the brief's section 3.2), shared by every tab of
// the game. The tab holding the "lizarding" lock leads: it alone signs in -
// a refresh token works once, so two tabs renewing would undo each other -
// and holds the socket, and tells every other tab, over a BroadcastChannel,
// what the socket hears. A tab that follows sends its intents through the
// leader and is answered through it. When the leading tab closes, the lock
// passes to another tab, which signs in from the kept refresh token and
// opens a socket of its own; the game it then hears starts from a fresh
// Starting copy, as any reconnect's does.
//
// Every tab sees the same line: listen() for its events (connection.js),
// send() for intents, and the player's choices - chooseName, takeBack,
// startAgain (a new guest), signInAgain, google (keeping a guest with
// Google, or signing in with it) - and drop() for a game that has lost its
// place. Google's ID token, got in a tab that follows, goes to the leader
// over the channel, as an intent does; the platform's own tokens never do. Without locks or channels (an old browser), a tab leads
// on its own.

import { ANSWERED } from "./wire.js?v=4a2c3c9acc21";
import { LOST } from "./connection.js?v=4a2c3c9acc21";

const LOCK = "lizarding";

/** The tab's line to the game: led here, or followed through the tab that leads. */
export function openLine({ local, Channel = globalThis.BroadcastChannel, locks = globalThis.navigator?.locks, name = LOCK }) {
  if (!Channel || !locks) return new Led(local());
  return new Hub({ local, channel: new Channel(name), locks, name });
}

/** The line a leading tab holds: its sign-in and its socket. */
export class Led {
  constructor({ signIn, connection, events }) {
    this.signIn = signIn;
    this.connection = connection;
    this._listeners = [];
    events((event) => this._hear(event));
    this.connection.start();
    this.signIn.start().catch(() => {});
  }

  _hear(event) { for (const listener of this._listeners) listener(event); }
  listen(listener) { this._listeners.push(listener); }
  send(kind, payload) { return this.connection.send(kind, payload); }
  chooseName(name) { this.connection.chooseName(name); }
  takeBack() { this.connection.takeBack(); }
  drop(why) { this.connection.drop(why); }
  startAgain() { this.signIn.startAgain().then(() => this.connection.takeBack(), () => {}); }
  signInAgain() { this.signIn.retryNow().then(() => this.connection.takeBack(), () => {}); }

  /** One of the platform's functions, called as the player: { ok, body } or { ok: false, error }. */
  platform(name, body) { return this.signIn.rpc(name, body).catch(() => ({ ok: false, error: "this browser's guest has gone" })); }

  /** Signed in again and rejoined: as the account this one was joined into, after a join. */
  renew() { this.signIn.renewNow().then(() => this.connection.takeBack(), () => {}); }

  /**
   * Google's ID token used: "link" keeps this guest with Google, "sign in" plays the Google account
   * here instead, on a socket of its own. A promise of { ok } or { error }.
   */
  async google(mode, idToken, nonce) {
    if (mode === "link") {
      // back from Google's own page on a phone, the guest may not have signed in again yet
      try { await this.signIn.ready(); } catch { return { error: "this browser's guest has gone" }; }
      return this.signIn.linkGoogle(idToken, nonce);
    }
    const done = await this.signIn.signInWithGoogle(idToken, nonce);
    if (done.ok) this.connection.takeBack();
    return done;
  }
  close() { this.connection.stop(); this.signIn.stop(); }
}

class Hub {
  constructor({ local, channel, locks, name }) {
    this._local = local;
    this._channel = channel;
    this._tab = Math.random().toString(36).slice(2);
    this._listeners = [];
    this._led = null;
    this._asked = 0;
    this._asking = new Map(); // a follower's: id -> resolve
    // what a leader keeps for a tab that comes late: the last status, the welcome, and the frames since
    this._status = { status: "connecting" };
    this._account = null;
    this._welcome = null;
    this._since = [];
    channel.onmessage = (event) => this._message(event.data);
    channel.postMessage({ type: "hello", tab: this._tab });
    locks.request(name, () => new Promise(() => this._lead())).catch(() => {});
  }

  listen(listener) { this._listeners.push(listener); }
  _hear(event) { for (const listener of this._listeners) listener(event); }

  _lead() {
    // whatever was asked through the tab that led went with it
    for (const resolve of this._asking.values()) resolve({ kind: ANSWERED.FAILED, reason: LOST });
    this._asking.clear();
    const made = this._local();
    made.events((event) => this._fromSocket(event));
    this._led = new Led({ ...made, events: () => {} });
  }

  _fromSocket(event) {
    if (event.status) this._status = event;
    if (event.account) this._account = event;
    if (event.welcome) { this._welcome = event.bytes; this._since = []; }
    if (event.frame) this._keep(event.frame);
    this._hear(event);
    // another tab reads the welcome from its bytes, as this one read them
    this._channel.postMessage({ type: "event", event: event.welcome ? { welcomeBytes: event.bytes } : event });
  }

  /** A frame kept for a tab that comes late: every batch, and of what is shown, what is still worth showing. */
  _keep(bytes) {
    if (bytes[0] === 7 && [0, 1, 3, 4].includes(bytes[7])) {
      this._since = this._since.filter((held) => !(held[0] === 7 && held[7] === bytes[7]));
    }
    this._since.push(bytes);
  }

  _message(said) {
    if (!said || typeof said !== "object") return;
    if (this._led) this._asLeader(said); else this._asFollower(said);
  }

  _asLeader(said) {
    const led = this._led;
    if (said.type === "hello") {
      const events = [this._status, ...(this._account ? [this._account] : []), ...(this._welcome ? [{ welcomeBytes: this._welcome }, ...this._since.map((frame) => ({ frame }))] : [])];
      this._channel.postMessage({ type: "sync", to: said.tab, events });
    } else if (said.type === "intent") {
      led.send(said.kind, said.payload).then((answer) => this._channel.postMessage({ type: "answer", to: said.tab, id: said.id, answer }));
    } else if (said.type === "name") led.chooseName(said.name);
    else if (said.type === "take back") led.takeBack();
    else if (said.type === "start again") led.startAgain();
    else if (said.type === "sign in again") led.signInAgain();
    else if (said.type === "google") led.google(said.mode, said.idToken, said.nonce).then((done) => this._channel.postMessage({ type: "google done", to: said.tab, id: said.id, done }));
    else if (said.type === "platform") led.platform(said.name, said.body).then((done) => this._channel.postMessage({ type: "platform done", to: said.tab, id: said.id, done }));
    else if (said.type === "renew") led.renew();
  }

  _asFollower(said) {
    if (said.type === "event") this._hear(said.event);
    else if (said.type === "sync" && said.to === this._tab) for (const event of said.events) this._hear(event);
    else if (["answer", "google done", "platform done"].includes(said.type) && said.to === this._tab) {
      const resolve = this._asking.get(said.id);
      this._asking.delete(said.id);
      if (resolve) resolve(said.type === "answer" ? said.answer : said.done);
    }
  }

  send(kind, payload) {
    if (this._led) return this._led.send(kind, payload);
    const id = ++this._asked;
    this._channel.postMessage({ type: "intent", tab: this._tab, id, kind, payload });
    return new Promise((resolve) => this._asking.set(id, resolve));
  }

  /** Google's ID token, used by the tab that signs in - this one, or the leader, through the channel. */
  google(mode, idToken, nonce) {
    if (this._led) return this._led.google(mode, idToken, nonce);
    const id = ++this._asked;
    this._channel.postMessage({ type: "google", tab: this._tab, id, mode, idToken, nonce });
    return new Promise((resolve) => this._asking.set(id, resolve));
  }

  /** One of the platform's functions, called by the tab that signs in. */
  platform(name, body) {
    if (this._led) return this._led.platform(name, body);
    const id = ++this._asked;
    this._channel.postMessage({ type: "platform", tab: this._tab, id, name, body });
    return new Promise((resolve) => this._asking.set(id, resolve));
  }

  renew() { if (this._tell("renew")) this._led.renew(); }

  _tell(type, more = {}) { if (this._led) return true; this._channel.postMessage({ type, tab: this._tab, ...more }); return false; }
  chooseName(name) { if (this._tell("name", { name })) this._led.chooseName(name); }
  takeBack() { if (this._tell("take back")) this._led.takeBack(); }
  startAgain() { if (this._tell("start again")) this._led.startAgain(); }
  signInAgain() { if (this._tell("sign in again")) this._led.signInAgain(); }

  close() { this._led?.close(); this._channel.close(); }

  /** The game lost its place: a leader rejoins; a follower asks the leader for everything again. */
  drop(why) {
    if (this._led) this._led.drop(why);
    else this._channel.postMessage({ type: "hello", tab: this._tab });
  }
}

/** What a leading tab makes: its sign-in and its socket, and one way to hear both. */
export function localParts({ config, fetch, storage, WebSocket, timers, SignIn, Connection }) {
  const listeners = [];
  const tell = (event) => { for (const listener of listeners) listener(event); };
  // what the sign-in says, for every tab: whether it is a guest above all; gone and limited are the door's
  const signIn = new SignIn({ config, fetch, storage, timers, told: (state) => {
    tell({ account: { state, guest: signIn.guest, user: signIn.user } });
    if (state === "gone" || state === "limited") tell({ status: state });
  } });
  const connection = new Connection({ url: config.game, signIn, WebSocket, timers, told: tell });
  return { signIn, connection, events: (listener) => listeners.push(listener) };
}
