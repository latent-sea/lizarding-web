// Signing in (the brief's section 2): a guest of the platform's sign-in
// (Supabase Auth), made once and renewed for as long as it is played.
//
// ONLY THE REFRESH TOKEN IS KEPT, in localStorage; the access token lives in
// memory. A refresh token works once, so the one kept is replaced at every
// renewal, and only one tab of a browser ever renews (hub.js). Renewal is
// due at four fifths of the token's life; one that fails for want of the
// server is tried again every 30 seconds, without a word to the player. One
// the platform refuses can't be recovered - a guest not seen for ten days is
// deleted - and the player is told so, and may start again as a new guest.
//
// No token is ever written into a URL, a log or an error.
//
// GOOGLE: a guest may link Google, staying the same player and a guest no
// more (kept for good, never deleted); or a player may sign in with Google
// instead, letting this browser's guest go. Both hand the platform Google's
// ID token. A new guest the platform refuses for having made too many from
// one address (429) is "limited": said, and tried again every five minutes.
// JOINING: an account the platform hasn't marked as Lizarding's joins it
// (platform_join_app) and renews once, so its token carries the mark - once
// the platform says the call is live (config.joinApp).

export const KEPT = "lizarding_refresh_token";
export const RETRY_MS = 30 * 1000;
export const LIMITED_RETRY_MS = 5 * 60 * 1000;

export class SignIn {
  /**
   * config: { auth, key, app, rest, joinApp }; fetch and storage as the browser's (injected for tests);
   * told(state): "signing in", "in", "limited" or "gone", as it changes, or as whether it is a guest does.
   */
  constructor({ config, fetch = globalThis.fetch.bind(globalThis), storage = safeStorage(), timers = globalThis, told = () => {} }) {
    this.config = config;
    this._fetch = fetch;
    this._storage = storage;
    this._timers = timers;
    this._told = told;
    this.state = "signing in";
    this.access = null; // the access token: in memory only
    this.user = null;
    this.guest = true; // an anonymous account: this browser's alone
    this._epoch = 0; // which sign-in an answer belongs to: one superseded - by Google - changes nothing
    this._joined = false;
    this._timer = null;
    this._waiting = [];
    this._stopped = false;
  }

  /** Signed in from what is kept, or as a new guest when nothing is. */
  start() {
    if (this._storage.get(KEPT)) this._renew(true); else this._signUp();
    return this.ready();
  }

  /** The access token, once there is one. */
  ready() {
    if (this.state === "in") return Promise.resolve(this.access);
    return new Promise((resolve, reject) => this._waiting.push({ resolve, reject }));
  }

  /** A renewal now, as when the game turned the token away (4401): the newest token, or a refusal. */
  renewNow() {
    this._clear();
    this._set("signing in");
    this._renew(false);
    return this.ready();
  }

  /** The player's choice, once their guest is gone: a new guest, with nothing of the old. */
  startAgain() {
    this._storage.remove(KEPT);
    this._set("signing in");
    this._signUp();
    return this.ready();
  }

  stop() { this._stopped = true; this._clear(); }

  /** Tried again now: a new guest the platform limited, or a renewal. */
  retryNow() {
    this._clear();
    if (this.state === "limited") this._signUp(); else this._renew(false);
    return this.ready();
  }

  /** Signed in with Google instead: this browser's guest let go. { ok } or { error }, in the platform's words. */
  async signInWithGoogle(idToken, nonce) {
    const epoch = ++this._epoch;
    this._clear();
    const answer = await this._ask("/token?grant_type=id_token", { provider: "google", id_token: idToken, nonce });
    if (this._stopped || epoch !== this._epoch) return { error: "" };
    if (!answer.ok) return { error: answer.error };
    this._kept(answer.body);
    return { ok: true };
  }

  /** This guest's account linked to Google: the same player, kept for good. { ok } or { error }. */
  async linkGoogle(idToken, nonce) {
    if (!this.access) return { error: "Signing in hasn't finished yet" };
    const epoch = this._epoch;
    const answer = await this._ask("/token?grant_type=id_token", { provider: "google", id_token: idToken, nonce, link_identity: true }, this.access);
    if (this._stopped || epoch !== this._epoch) return { error: "" };
    if (!answer.ok) return { error: answer.error };
    this._kept(answer.body);
    return { ok: true };
  }

  async _signUp() {
    const epoch = this._epoch;
    const answer = await this._ask("/signup", { data: { app: this.config.app } });
    if (this._stopped || epoch !== this._epoch) return;
    if (answer.ok) this._kept(answer.body);
    else if (answer.status === 429) { this._set("limited"); this._later(() => this._signUp(), LIMITED_RETRY_MS); }
    else this._later(() => this._signUp());
  }

  async _renew(starting) {
    const kept = this._storage.get(KEPT);
    if (!kept) { this._gone(); return; }
    const epoch = this._epoch;
    const answer = await this._ask("/token?grant_type=refresh_token", { refresh_token: kept });
    if (this._stopped || epoch !== this._epoch) return;
    if (answer.ok) this._kept(answer.body);
    else if (answer.refused) this._gone();
    // the platform out of reach: tried again, and meanwhile the token held stays good for the socket open
    else this._later(() => this._renew(starting));
  }

  _kept(body) {
    this._storage.set(KEPT, body.refresh_token);
    this.access = body.access_token;
    const wasUser = this.user;
    this.user = body.user?.id ?? null;
    const wasGuest = this.guest;
    this.guest = body.user?.is_anonymous !== false;
    const life = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    this._clear();
    this._timer = this._timers.setTimeout(() => this._renew(false), life * 800);
    if (this.config.joinApp && !this._joined && !appsOf(this.access).includes(this.config.app)) { this._join(); return; }
    if (this.state === "in" && (wasGuest !== this.guest || wasUser !== this.user)) this._told(this.state);
    this._set("in");
    for (const { resolve } of this._waiting.splice(0)) resolve(this.access);
  }

  /** One of the platform's functions called as the player (POST /rest/v1/rpc/<name>): { ok, body } or { ok: false, error }. */
  async rpc(name, body) {
    await this.ready();
    return this._ask(`/rpc/${name}`, body, this.access, this.config.rest);
  }

  /** The account joined to Lizarding, then renewed once so its token carries the mark; tried once a session. */
  async _join() {
    this._joined = true;
    const answer = await this._ask("/rpc/platform_join_app", { app: this.config.app }, this.access, this.config.rest);
    if (!answer.ok) console.warn("joining Lizarding: the platform refused; playing on without the mark");
    this._renew(false);
  }

  _gone() {
    this.access = null;
    this._set("gone");
    for (const { reject } of this._waiting.splice(0)) reject(new Error("the guest is gone"));
  }

  _later(work, wait = RETRY_MS) { this._clear(); this._timer = this._timers.setTimeout(work, wait); }

  _clear() { if (this._timer !== null) this._timers.clearTimeout(this._timer); this._timer = null; }

  _set(state) { if (this.state === state) return; this.state = state; this._told(state); }

  /**
   * A request to the platform: { ok, body } or { ok: false, status, refused, error } - refused for good
   * on a 4xx but 408 and 429, error the platform's words for a person. The sign-in's own answers carry
   * tokens; the platform's functions (base given) answer anything.
   */
  async _ask(path, body, bearer = null, base = this.config.auth) {
    const headers = { apikey: this.config.key, "Content-Type": "application/json" };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      const response = await this._fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const read = await response.json().catch(() => null);
      const tokens = base === this.config.auth;
      if (response.ok && (!tokens || (read?.access_token && read?.refresh_token))) return { ok: true, body: read };
      const refused = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
      // the platform's words, never a token: a refusal's body holds none
      console.warn(`signing in: the platform answered ${response.status}${refused ? ", refusing" : ""}`);
      return { ok: false, status: response.status, refused, error: wordsOf(read) || `The platform answered ${response.status}` };
    } catch {
      console.warn("signing in: the platform could not be reached");
      return { ok: false, status: 0, refused: false, error: "The platform couldn't be reached. Try again in a moment." };
    }
  }
}

/** The platform's words in a refusal. */
function wordsOf(read) {
  for (const field of ["msg", "message", "error_description", "error"]) if (typeof read?.[field] === "string") return read[field];
  return "";
}

/** The apps an access token says its account has joined (app_metadata.apps): read, never logged. */
export function appsOf(token) {
  try {
    const part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
    return Array.isArray(claims?.app_metadata?.apps) ? claims.app_metadata.apps : [];
  } catch { return []; }
}

/** localStorage, or this visit's memory where the browser refuses it (a private window). */
export function safeStorage(store = globalThis.localStorage) {
  const memory = new Map();
  return {
    get(key) { try { return store.getItem(key); } catch { return memory.get(key) ?? null; } },
    set(key, value) { try { store.setItem(key, value); } catch { memory.set(key, value); } },
    remove(key) { try { store.removeItem(key); } catch { memory.delete(key); } },
  };
}
