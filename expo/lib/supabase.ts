import { createClient, type Session, type User } from "@supabase/supabase-js";

import { supabaseConfig } from "@/lib/config";
import type { AuthUser } from "@/lib/auth-provider";
import * as secureStorage from "@/lib/secure-storage";

/* ------------------------------------------------------------------ */
/*  Supabase client with native session persistence                    */
/* ------------------------------------------------------------------ */

/**
 * Storage adapter for Supabase Auth. Backed by expo-secure-store (platform
 * keychain/keystore) on native, and localStorage on web — secure-storage.ts
 * already does that platform branching internally, so this adapter is the
 * same on every platform.
 */
const storageAdapter = {
  getItem: (key: string) => secureStorage.getItem(key),
  setItem: (key: string, value: string) => secureStorage.setItem(key, value),
  removeItem: (key: string) => secureStorage.deleteItem(key),
};

export const supabase = createClient(
  supabaseConfig.url,
  supabaseConfig.anonKey,
  {
    auth: {
      persistSession: true,
      storage: storageAdapter,
      autoRefreshToken: true,
      // We handle code exchange manually in useAuth (both native and web),
      // so automatic URL detection is unnecessary and would race with our
      // popup-based web flow.
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  },
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Map a Supabase auth User to the app's AuthUser shape.
 * Supabase stores provider-specific metadata in `user_metadata`.
 */
export function mapUser(supabaseUser: User): AuthUser {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? "",
    name: supabaseUser.user_metadata?.full_name ?? supabaseUser.user_metadata?.name,
    picture: supabaseUser.user_metadata?.avatar_url ?? supabaseUser.user_metadata?.picture,
  };
}

/**
 * Get the current Supabase session (or null if not signed in).
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("getSession error:", error.message);
    return null;
  }
  return data.session;
}

/**
 * Get a valid access token for the current session.
 * Supabase auto-refreshes expired tokens.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.access_token ?? null;
}

/** True when a backend fetch failed specifically because the session is missing or expired. */
export function isUnauthorized(response: Response): boolean {
  return response.status === 401;
}

/** Standard message to show the user when a request fails due to isUnauthorized(). */
export const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró. Vuelve a iniciar sesión.";

/** Sync the user's profile row after sign-in so RLS joins work. */
export async function syncProfile(user: AuthUser) {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.picture,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.warn("Failed to sync profile:", error.message);
  }
}
