/**
 * PostHog analytics configuration.
 *
 * Single file to edit for PostHog setup, mirroring lib/config.ts — the API
 * key and host come from env vars, nothing else in the app reads them
 * directly.
 *
 * Until EXPO_PUBLIC_POSTHOG_API_KEY is set (in expo/.env, gitignored),
 * PostHogProvider is still mounted (see app/_layout.tsx) but with an empty
 * key: the SDK has nowhere to send events and no-ops instead of crashing —
 * same "fails gracefully, costs nothing" pattern as the Worker's optional
 * dev-only keys (see functions/.dev.vars in CLAUDE.md).
 */

import type { PostHogAutocaptureOptions } from "posthog-react-native";

/**
 * Expo only guarantees compile-time replacement of `EXPO_PUBLIC_*` vars for
 * static property access, not dynamic indexing like `process.env[key]` —
 * see the fix in lib/config.ts (commit cf13a8f). Mirrored here with an
 * explicit switch per var, for the same reason: without this, these two
 * vars would resolve fine in the local dev server (where process.env is
 * live at runtime) but silently stay undefined in an EAS production build.
 */
function env(key: "EXPO_PUBLIC_POSTHOG_API_KEY" | "EXPO_PUBLIC_POSTHOG_HOST"): string | undefined {
  if (typeof process === "undefined") return undefined;
  switch (key) {
    case "EXPO_PUBLIC_POSTHOG_API_KEY":
      return process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
    case "EXPO_PUBLIC_POSTHOG_HOST":
      return process.env.EXPO_PUBLIC_POSTHOG_HOST;
    default:
      return undefined;
  }
}

export const posthogConfig = {
  apiKey: env("EXPO_PUBLIC_POSTHOG_API_KEY") ?? "",
  /**
   * "https://us.i.posthog.com" or "https://eu.i.posthog.com" depending on
   * the project region chosen at signup — must match that choice exactly,
   * PostHog projects are region-locked.
   */
  host: env("EXPO_PUBLIC_POSTHOG_HOST") ?? "https://eu.i.posthog.com",
} as const;

/**
 * Autocapture: touches + screen views only, never raw content.
 *
 * - captureTouches: opt-in in this SDK (default false) — turned on here so
 *   we get "which button was tapped" events.
 * - captureScreens: on by default; kept explicit for clarity ("which
 *   screen opened").
 * - propsToCapture: narrowed to static UI-chrome props. Whatever the SDK's
 *   own default list includes, we don't rely on it — this stops a future
 *   TextInput's `value`/`defaultValue` from ever being swept up by a touch
 *   event fired on (or inside) it.
 *
 * The chat message input (components/ChatPanel.tsx) additionally carries
 * the `ph-no-capture` prop — noCaptureProp's default name — which excludes
 * it and its children from autocapture *entirely*, regardless of
 * propsToCapture. Belt and suspenders: what a student types to the tutor
 * (and, by extension, any free-text exam answer) must never leave the
 * device as analytics data.
 *
 * Session replay (screen recording) is never enabled anywhere in this
 * app — there's no `enableSessionReplay` option passed to PostHogProvider —
 * so there's no pixel-capture path to worry about either.
 */
export const posthogAutocapture: PostHogAutocaptureOptions = {
  captureTouches: true,
  captureScreens: true,
  propsToCapture: ["accessibilityLabel", "title"],
};

/**
 * Manually tracked business events. Keep every payload free of user-authored
 * text (chat messages, quiz/exam answers) — ids, counts, durations, and
 * booleans only. See CLAUDE.md for the full list of suggested events and
 * which ones are wired up vs. suggestion-only.
 */
export const AnalyticsEvent = {
  UserSignedUp: "user_signed_up",
  VideoCompleted: "video_completed",
  QuizCompleted: "quiz_completed",
  TutorMessageSent: "tutor_message_sent",
} as const;
