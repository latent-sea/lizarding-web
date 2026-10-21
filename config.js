// Where the game is (the brief's section 1): kept here, the one place to
// change when the game moves to play.lizarding.com.

export const CONFIG = Object.freeze({
  auth: "https://api.latent-sea.com/auth/v1",
  // the platform's publishable key: not a secret, it ships in every page
  key: "sb_publishable_BqVtSYE4ysOb2sHMuFSwMk_HrTAUgLx",
  // the platform's functions: platform_join_app, as the account joins Lizarding
  rest: "https://api.latent-sea.com/rest/v1",
  game: "wss://play.latent-sea.com",
  app: "lizarding",
  // an account without Lizarding's mark joins it (platform_join_app, live since 21 Oct 2026)
  joinApp: true,
  // the factory's Google client (platform/supabase/platform.yml): public, as every page's is
  google: "400837578052-jqnhh565es3a92k58u5r2oggdcf7mrkr.apps.googleusercontent.com",
});
