/**
 * Centralized app configuration.
 *
 * This is the SINGLE file to edit when porting outside of Rork/Expo.
 * Every other module reads from here — no env var is referenced
 * anywhere else in the codebase.
 *
 * ── Porting guide ──────────────────────────────────────────────
 * 1. Replace the `env` accessor with your own env-reading mechanism.
 * 2. Set `functionsUrl` to your backend URL.
 * 3. Set `expo.scheme` in app.json to your app's custom scheme (Linking.
 *    createURL() in this file reads it from there automatically).
 * 4. Set `heroImageUri` to a bundled asset or your own CDN URL.
 * 5. The rest of the app (Supabase client, auth hook, UI) stays as-is.
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from "react-native";
import * as Linking from "expo-linking";

/* ------------------------------------------------------------------ */
/*  Env accessor                                                       */
/* ------------------------------------------------------------------ */

/**
 * Read a public env var. Expo inlines `EXPO_PUBLIC_*` at build time.
 */
function env(key: string): string | undefined {
  if (typeof process === "undefined") return undefined;

  // Expo only guarantees compile-time replacement for static property access,
  // not dynamic indexing like process.env[key].
  switch (key) {
    case "EXPO_PUBLIC_PROJECT_ID":
      return process.env.EXPO_PUBLIC_PROJECT_ID;
    case "EXPO_PUBLIC_SUPABASE_URL":
      return process.env.EXPO_PUBLIC_SUPABASE_URL;
    case "EXPO_PUBLIC_SUPABASE_ANON_KEY":
      return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    case "EXPO_PUBLIC_AUTH_REDIRECT_URL":
      return process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL;
    case "EXPO_PUBLIC_RORK_FUNCTIONS_URL":
      return process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;
    case "EXPO_PUBLIC_FUNCTIONS_URL":
      return process.env.EXPO_PUBLIC_FUNCTIONS_URL;
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  Supabase configuration                                             */
/* ------------------------------------------------------------------ */

export const supabaseConfig = {
  url: env("EXPO_PUBLIC_SUPABASE_URL") ?? "",
  anonKey: env("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "",
} as const;

/** Headers to send Supabase credentials to the Cloudflare Worker. */
export const supabaseHeaders = {
  "X-Supabase-URL": supabaseConfig.url,
  "X-Supabase-Anon-Key": supabaseConfig.anonKey,
};

/* ------------------------------------------------------------------ */
/*  Deep-link / OAuth redirect                                         */
/* ------------------------------------------------------------------ */

/**
 * OAuth redirect URL.
 * Native, standalone/dev-client build: `<scheme>://auth/callback`.
 * Native, Expo Go: `exp://<lan-ip>:<port>/--/auth/callback` — Expo Go can't
 * register the app's custom scheme in its manifest (it's a single shared
 * app), so a hardcoded `<scheme>://` redirect never reaches it. Linking.
 * createURL() detects Expo Go vs. a standalone build and picks the right
 * form; unlike Android, iOS's ASWebAuthenticationSession intercepts the
 * callback scheme directly within the auth session, which is why this
 * only ever broke on Android.
 * Web: current page origin + path. Supabase redirects the popup back to
 * the same page, where we extract the `code` param and exchange it.
 *
 * IMPORTANT: Every form this can take must be added to Supabase Dashboard →
 * Authentication → URL Configuration → Redirect URLs (the Expo Go form is
 * dynamic per dev session, so that entry has to be a wildcard).
 */
export const redirectUrl: string =
  Platform.OS === "web"
    ? (typeof window !== "undefined"
        ? window.location.origin + window.location.pathname
        : "")
    : (env("EXPO_PUBLIC_AUTH_REDIRECT_URL") ?? Linking.createURL("auth/callback"));

/* ------------------------------------------------------------------ */
/*  Backend functions URL                                              */
/* ------------------------------------------------------------------ */

/**
 * The Cloudflare Worker / backend API base URL.
 */
export const functionsUrl: string =
  env("EXPO_PUBLIC_RORK_FUNCTIONS_URL") ||
  env("EXPO_PUBLIC_FUNCTIONS_URL") ||
  "https://periodontal-surgery-ui-backend.rork.app";

/* ------------------------------------------------------------------ */
/*  Static assets                                                      */
/* ------------------------------------------------------------------ */

/**
 * Hero image for the library tab.
 */
export const heroImageUri: string =
  "https://r2-pub.rork.com/attachments/9njewsl7qesvffgyi904k.png";
