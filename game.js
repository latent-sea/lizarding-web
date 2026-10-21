// The seat's game, as the server's records make it (the brief's sections
// 6.3, 6.6 and 10): built from a Starting copy, moved on by each Batch in
// order. Plain data and no browser: the session (session.js) holds one, and
// a reconnect throws it away for the next Starting copy.
//
// CONTINUITY: reached is the record this copy stands at. A batch follows it
// when its first is reached + 1 and it accounts for every record up to its
// last (the envelopes it carries and those withheld); anything else means a
// record was missed, and apply() throws OutOfOrder, which drops the socket.

export class OutOfOrder extends Error {}

export class Game {
  constructor(starting) {
    this.reached = starting.reached;
    this.seat = starting.seat.id;
    this.player = starting.seat.player;
    this.purse = starting.purse.id;
    this.house = starting.house.id;
    this.balance = starting.balance;
    this.moves = [...starting.moves];
    this.cards = new Map(starting.cards.map((card) => [card.race, card]));
    this.results = new Map(starting.results.map((result) => [result.race, result]));
    this.bets = new Map();
    for (const bet of starting.bets) if (bet.seat === this.seat) this._bet(bet);
    this.leagues = new Map(starting.leagues.map((league) => [league.id, league]));
    this.closed = new Set(starting.closed.map((c) => c.league));
    this.memberships = new Set(starting.members.filter((m) => m.seat === this.seat).map((m) => m.league));
    this.joined = null; // the league this seat joined last, for the league screen to turn to
  }

  _bet(bet) {
    if (!this.bets.has(bet.race)) this.bets.set(bet.race, []);
    this.bets.get(bet.race).push(bet);
  }

  /** The batch applied, every envelope in order; what moved is said back as { cards, results, bets, balance, leagues }. */
  apply(batch) {
    const { first, last, withheld, envelopes } = batch;
    if (first !== this.reached + 1n || last - first + 1n !== BigInt(envelopes.length) + withheld) {
      throw new OutOfOrder(`batch ${batch.id} holds ${first} to ${last} (${envelopes.length} sent, ${withheld} withheld); this copy stands at ${this.reached}`);
    }
    const moved = { cards: false, results: [], bets: false, balance: false, leagues: false };
    for (const envelope of envelopes) this._envelope(envelope, moved);
    this.reached = last;
    return moved;
  }

  _envelope({ owner, kind, fact }, moved) {
    if (!fact) return;
    if (owner === "world") {
      if (kind !== "move") return;
      this.moves.push(fact);
      if (fact.to === this.purse) this.balance += fact.amount;
      if (fact.from === this.purse) this.balance -= fact.amount;
      moved.balance = true;
      return;
    }
    if (owner !== "betting") return;
    switch (kind) {
      case "card": this.cards.set(fact.race, fact); moved.cards = true; break;
      case "bet": if (fact.seat === this.seat) { this._bet(fact); moved.bets = true; } break;
      case "result": this.results.set(fact.race, fact); moved.results.push(fact.race); moved.cards = true; break;
      case "forget":
        this.cards.delete(fact.race); this.results.delete(fact.race); this.bets.delete(fact.race);
        moved.cards = true; moved.bets = true; break;
      case "league": this.leagues.set(fact.id, fact); moved.leagues = true; break;
      case "member":
        if (fact.seat === this.seat) { this.memberships.add(fact.league); this.joined = fact.league; moved.leagues = true; }
        break;
      case "left":
        if (fact.seat === this.seat) {
          this.memberships.delete(fact.league);
          if (this.leagues.get(fact.league)?.everyone === false) this.leagues.delete(fact.league);
          moved.leagues = true;
        }
        break;
      case "closed": this.closed.add(fact.league); moved.leagues = true; break;
      default: break;
    }
  }

  /** The open card: the newest with no result, or null. */
  openCard() {
    let open = null;
    for (const card of this.cards.values()) if (!this.results.has(card.race) && (!open || card.race > open.race)) open = card;
    return open;
  }

  /** The race with the highest number that has a result, or null. */
  lastRace() {
    let last = null;
    for (const race of this.results.keys()) if (this.cards.has(race) && (last === null || race > last)) last = race;
    return last;
  }

  betsOn(race) { return this.bets.get(race) ?? []; }

  /** This seat's stakes on a runner of a race: { win, place }. */
  stakesOn(race, lizard) {
    const held = { win: 0, place: 0 };
    for (const bet of this.betsOn(race)) if (bet.lizard === lizard) held[bet.book === 0 ? "win" : "place"] += bet.stake;
    return held;
  }

  /** The leagues shown: the game's own and the friends' leagues this seat is in, none closed. */
  shownLeagues() {
    return [...this.leagues.values()].filter((l) => !this.closed.has(l.id) && (l.everyone || this.memberships.has(l.id)));
  }
}
