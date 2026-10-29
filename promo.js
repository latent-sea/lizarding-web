// Selling the full game. The betting here is free, and the hook: the full
// game's buying links stand over every page but the race, its socials under
// it, and a short advert comes up as the page opens and between races, a
// different side of the game each time (the next one kept in the browser).
// Until the store pages and the clips are public, each is a placeholder that
// says so (STORES, CLIPS): filling in an address is all it takes.

import { Controller, Phrase } from "./gd_chime/gd_chime.js?v=4a2c3c9acc21";
import { safeStorage } from "./auth.js?v=4a2c3c9acc21";

export const BUYS = "buys_the_full_game";
export const KEEPS_PLAYING = "goes_back_to_the_races";

export const WORDS = { [KEEPS_PLAYING]: ["Back to the races"] };

// the store pages: an address once each is public, null until then
export const STORES = [
  { key: "steam", name: "Steam", call: "Wishlist on Steam", href: null },
  { key: "play", name: "Google Play", call: "Get it on Google Play", href: null },
];

// the socials (marketing/social-handle-sweep.md, all @LizardingGame)
export const SOCIALS = [
  { name: "YouTube", href: "https://www.youtube.com/@LizardingGame" },
  { name: "TikTok", href: "https://www.tiktok.com/@LizardingGame" },
  { name: "X", href: "https://x.com/LizardingGame" },
  { name: "Bluesky", href: "https://bsky.app/profile/lizardinggame.bsky.social" },
  { name: "Reddit", href: "https://www.reddit.com/r/Lizarding" },
];

// a gameplay clip for a side of the game, by its key: an embed's address (a YouTube /embed/ link) once there is one
export const CLIPS = {};

// the sides of the game the advert takes in turn, in the store listing's words (marketing/play-listing/listing.md)
export const ASPECTS = [
  { key: "races", heading: "Every race, in full", said: "The full game shows each race as it really runs: every lizard with its own body, its own form and its own family, on stages of every kind.", art: "promo/race-close.jpg" },
  { key: "ladder", heading: "Battle Ladder", said: "Pick five of your lizards for each of six races against another player or the computer. The most points wins the battle and moves you up the ladder.", art: "promo/race.jpg" },
  { key: "field", heading: "Know every runner", said: "Read the form of the ten lizards in each race, see each one as it is, and back them to win or to place.", art: "promo/card.jpg" },
  { key: "browse", heading: "A whole world to read", said: "Every lizard, stage and race of the world, open to read: families, records and past races played again.", art: "promo/capsule.jpg" },
  { key: "breeding", heading: "Coming: Breeding Challenge", said: "Start with a population of lizards and a race to breed for. Breed through the generations, then enter your best five against another player.", art: "promo/card-lower.jpg" },
  { key: "dynasty", heading: "Coming: Dynasty", said: "Run your own stable in a battle league. Buy, sell and breed lizards, and build a dynasty.", art: "promo/capsule.jpg" },
];

const NEXT = "lizarding_advert";
export const HOLD_S = 5; // the advert stays this long before it can be closed

/** Which side of the game the advert shows, and how long before it can be closed. */
export class Advert extends Controller {
  constructor(chimes, { storage = safeStorage(), timers = globalThis, hold = HOLD_S } = {}) {
    super(chimes);
    this._hold = hold;
    this._storage = storage;
    this._timers = timers;
    this.aspect = this.value(ASPECTS[0]);
    this.held = this.value(0);
    this.close = () => {}; // set by the site: the pop-up closed
    this._ticking = null;
  }

  answers() { return [KEEPS_PLAYING]; }

  /** The next side of the game, held for its seconds: called as the advert is raised. */
  shown() {
    const next = Number(this._storage.get(NEXT)) || 0;
    this.aspect.setValue(ASPECTS[next % ASPECTS.length]);
    this._storage.set(NEXT, String((next + 1) % ASPECTS.length));
    this.held.setValue(this._hold);
    this._timers.clearInterval(this._ticking);
    // each second, one less to wait
    this._ticking = this._timers.setInterval(() => {
      this.held.update((left) => Math.max(0, left - 1));
      if (this.held._held === 0) this._timers.clearInterval(this._ticking);
    }, 1000);
  }

  would(action) {
    if (action === KEEPS_PLAYING && this.held.read() > 0) return Phrase.with("Back to the races in %d", [this.held.read()]);
    return null;
  }

  told(action) {
    if (action === KEEPS_PLAYING) this.close();
    return null;
  }
}

/** A store's button: its page, or while it has none, the same button saying it is coming. */
function storeButton(ui, store, style) {
  const face = [ui.text(Phrase.of(store.call), "StoreCall"), ui.text(Phrase.of(store.href ? store.name : "Store page coming soon"), "StoreSub")];
  if (store.href) return ui.hyperlink(store.href, face, `Store Store-${store.key} ${style}`, { label: Phrase.of(store.call) });
  return ui.surface(`Store Store-${store.key} Soon ${style}`, face);
}

/** The full game's buying links: over every page but the race. */
export function describeBuyBar(ui) {
  return ui.row([
    ui.text(Phrase.of("Get the full game"), "BuyHeading"),
    ...STORES.map((store) => storeButton(ui, store, "")),
  ], "BuyBar");
}

/** The socials, each a named button. */
export function describeSocials(ui, heading = true) {
  return ui.row([
    ...(heading ? [ui.text(Phrase.of("Follow Lizarding"), "Engraving")] : []),
    ...SOCIALS.map((social) => ui.hyperlink(social.href, [ui.text(social.name, "Face")], `Social Social-${social.name}`, { label: Phrase.with("Lizarding on %s", [social.name]) })),
  ], "Socials");
}

/** The advert: one side of the game, its clip or its picture, the stores large, the socials, and back to the races. */
export function describeAdvert(ui, advert) {
  const aspect = advert.aspect;
  const clip = aspect.map((a) => CLIPS[a.key] ?? null);
  return ui.popUp("advert", () => ui.column([
    ui.text(Phrase.of("Lizarding: the full game"), "Engraving"),
    ui.when(clip, ui.embed(clip.map((c) => c ?? ""), { title: aspect.map((a) => Phrase.of(a.heading)) }),
      ui.surface("AdvertPicture", [
        ui.image(aspect.map((a) => a.art), "AdvertArt", aspect.map((a) => Phrase.of(a.heading))),
        ui.text(Phrase.of("Gameplay clip coming"), "ClipSoon"),
      ])),
    ui.text(aspect.map((a) => Phrase.of(a.heading)), "Title AdvertHeading"),
    ui.text(aspect.map((a) => Phrase.of(a.said)), "Words").wraps(),
    ui.row(STORES.map((store) => storeButton(ui, store, "Large")), "AdvertStores"),
    describeSocials(ui, false),
    // the close says how long is left, then lets the player go
    ui.pressable(KEEPS_PLAYING, {}, [ui.text(advert.held.map((left) => (left > 0 ? Phrase.with("Back to the races in %d", [left]) : Phrase.of("Back to the races"))), "Face")], "Pressable AdvertClose"),
  ], "AdvertSheet"));
}
