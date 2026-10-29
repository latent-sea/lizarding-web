// The one socket to the game (the brief's section 3): opened with the
// newest access token, the name chosen if it never was, the seat taken, the
// game followed with the no-world FollowAsked, then frames both ways.
//
// What it hands on, through told(event):
//   { status }       "signing in", "connecting", "naming", "playing", "lost", "elsewhere", "refused",
//                    "unsigned" (the token refused twice) or "gone" (the guest deleted), with
//                    { reason } where there are words for the player, and { refusedName } when naming
//   { welcome }      FollowAnswered's welcome, read; and its bytes, for another tab (hub.js)
//   { frame }        a Batch or ToShow frame's bytes: the session reads them. Answers stay here,
//                    each settling the intent it answers.
//
// CLOSES: 4000 to 4999 are refusals and are never retried on their own -
// but for 4401, a token turned away, which is renewed and tried once more.
// 4409 is another device taking the account; the player may take it back.
// 4410 is this account joined into another: renewed - which now signs in as
// the account it joined - and the game rejoined at once.
// Anything else, a network drop above all, is lost: tried again after 2 s,
// doubling to 60 s, with jitter, and the waiting counted from scratch once
// the game welcomes us again. Every intent waiting when a socket goes fails:
// the connection was lost.

import * as Wire from "./wire.js?v=532e313549a4";
import { Malformed } from "./bytes.js?v=532e313549a4";

export const MOST_WAITING = 8;
export const LOST = "the connection was lost";
const FIRST_WAIT = 2000;
const LONGEST_WAIT = 60000;

export class Connection {
  constructor({ url, signIn, WebSocket = globalThis.WebSocket, timers = globalThis, random = Math.random, told }) {
    this.url = url;
    this.signIn = signIn;
    this._Socket = WebSocket;
    this._timers = timers;
    this._random = random;
    this._told = told;
    this.status = "signing in";
    this._socket = null;
    this._seated = false;
    this._followed = false;
    this._call = 0;
    this._waiting = new Map(); // call -> resolve
    this._tries = 0; // reconnections since the last welcome
    this._turnedAway = 0; // 4401s in a row
    this._joinedAway = 0; // 4410s in a row: renewing that never reaches the survivor stops
    this._timer = null;
    this._refusal = "";
    this._reopen = false; // a socket closed to be opened again at once
    this._starting = false; // waiting for the first sign-in, which opens the first socket
    this._stopped = false;
  }

  async start() {
    this._say("signing in");
    this._starting = true;
    try { await this.signIn.ready(); } catch { this._starting = false; this._say("gone"); return; }
    this._starting = false;
    this._open();
  }

  /** A name offered for the server to judge. */
  chooseName(name) {
    if (this.status !== "naming" || !this._socket) return;
    this._socket.send(JSON.stringify({ name }));
  }

  /**
   * An intent sent: a promise of its Answer, { kind, reason } - never a
   * rejection. One that can't be sent, or whose socket goes before it is
   * answered, fails with the words for it.
   */
  send(kind, payload) {
    if (this.status !== "playing" || !this._socket) return Promise.resolve({ kind: Wire.ANSWERED.FAILED, reason: LOST });
    if (this._waiting.size >= MOST_WAITING) return Promise.resolve({ kind: Wire.ANSWERED.FAILED, reason: "too much is waiting for the game: try again in a moment" });
    const call = ++this._call;
    this._socket.send(Wire.intent(call, kind, Wire.PAYLOAD[kind](payload)));
    return new Promise((resolve) => this._waiting.set(call, resolve));
  }

  /**
   * Played here again: after another device took the account (4409), once
   * more after a refusal, or as a new guest - a socket still open, the old
   * guest's, closed first and a new one opened at once with the newest token.
   */
  takeBack() {
    if (this._starting) return; // the first socket opens as signing in finishes
    this._tries = 0;
    this._turnedAway = 0;
    if (this._timer !== null) { this._timers.clearTimeout(this._timer); this._timer = null; }
    if (this._socket) { this._reopen = true; this._socket.close(1000, "playing again"); return; }
    this._open();
  }

  /** The socket dropped by the client - a malformed frame, a batch out of order - and the game rejoined, for a fresh Starting copy. */
  drop(why) {
    console.warn(`the game's socket is dropped: ${why}`);
    if (this._socket) this._socket.close(1000, "rejoining");
  }

  stop() {
    this._stopped = true;
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    if (this._socket) this._socket.close(1000, "closing");
  }

  _say(status, more = {}) {
    this.status = status;
    this._told({ status, ...more });
  }

  _open() {
    if (this._stopped) return;
    this._timer = null;
    this._say("connecting");
    const token = this.signIn.access;
    if (!token) { this._renewThenOpen(); return; }
    const socket = new this._Socket(this.url);
    socket.binaryType = "arraybuffer";
    this._socket = socket;
    this._seated = false;
    this._followed = false;
    this._call = 0;
    this._refusal = "";
    socket.onopen = () => socket.send(token); // within 3 seconds, or 4401
    socket.onmessage = (event) => { if (this._socket === socket) this._message(event.data); };
    socket.onclose = (event) => { if (this._socket === socket) this._closed(event.code, event.reason ?? ""); };
    socket.onerror = () => {}; // a close always follows
  }

  async _renewThenOpen() {
    try { await this.signIn.renewNow(); } catch { this._say("gone"); return; }
    this._open();
  }

  _message(data) {
    if (typeof data === "string") {
      if (!this._seated) this._text(data);
      return; // after the seat, a text frame is ignored
    }
    const bytes = new Uint8Array(data);
    try {
      if (!this._followed) {
        this._followed = true;
        const answered = Wire.followAnswered(bytes);
        if (answered.refused !== undefined) { this._refusal = answered.refused; this._say("refused", { reason: answered.refused }); return; }
        this._tries = 0;
        this._turnedAway = 0;
        this._joinedAway = 0;
        this._say("playing");
        this._told({ welcome: answered.welcome, bytes });
        return;
      }
      if (bytes[0] === Wire.KIND.ANSWER) {
        const { answer } = Wire.frame(bytes);
        const resolve = this._waiting.get(answer.call);
        this._waiting.delete(answer.call);
        if (resolve) resolve({ kind: answer.kind, reason: answer.reason });
        return;
      }
      this._told({ frame: bytes });
    } catch (error) {
      if (!(error instanceof Malformed)) throw error;
      this.drop(`a malformed frame: ${error.message}`);
    }
  }

  _text(data) {
    let said;
    try { said = JSON.parse(data); } catch { console.warn("the game sent words that are not JSON"); return; }
    if (said && "seat" in said) {
      this._seated = true;
      this._socket.send(Wire.followAsked());
      this._say("connecting", { seat: said.seat, name: said.name });
    } else if (said && "refused" in said) this._say("naming", { refusedName: String(said.refused) });
    else if (said && "name" in said) this._say("naming", {});
  }

  _closed(code, reason) {
    this._socket = null;
    for (const resolve of this._waiting.values()) resolve({ kind: Wire.ANSWERED.FAILED, reason: LOST });
    this._waiting.clear();
    if (this._stopped) return;
    if (this._reopen) { this._reopen = false; this._open(); return; }
    if (code === 4401) {
      if (++this._turnedAway > 1) { this._say("unsigned"); return; }
      this._say("signing in");
      this._renewThenOpen();
      return;
    }
    if (code === 4409) { this._say("elsewhere"); return; }
    // joined into another account: the platform moved this sign-in onto the survivor, so a renewal
    // plays as the survivor - at once, not as a refusal (the game server and the platform, 22 Oct 2026)
    if (code === 4410) {
      if (++this._joinedAway > 2) { this._say("unsigned"); return; }
      this._say("signing in", { joined: true });
      this._renewThenOpen();
      return;
    }
    if (code === 4403) { this._say("refused", { reason: this._refusal || reason || "The game turned this page away: reload it." }); return; }
    if (code === 4404) {
      console.error("the game closed with 4404: this page sent binary before it was seated");
      this._say("refused", { reason: "Something went wrong in this page. Reload it to play." });
      return;
    }
    if (code >= 4000 && code <= 4999) { this._say("refused", { reason: reason || "The game turned this page away." }); return; }
    const wait = Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** this._tries) * (0.75 + this._random() * 0.5);
    this._tries++;
    this._say("lost", { retryIn: Math.round(wait) });
    this._timer = this._timers.setTimeout(() => this._open(), wait);
  }
}
