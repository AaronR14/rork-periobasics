import { createClient, type Session, type User } from "@supabase/supabase-js";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabaseConfig } from "@/lib/config";
import type { AuthUser } from "@/lib/auth-provider";

/* ------------------------------------------------------------------ */
/*  Supabase client with native session persistence                    */
/* ------------------------------------------------------------------ */

/**
 * Storage adapter for Supabase Auth on React Native.
 * On web, Supabase uses localStorage automatically.
 */
const storageAdapter =
  Platform.OS === "web"
    ? undefined
    : {
        getItem: (key: string) => AsyncStorage.getItem(key),
        setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
        removeItem: (key: string) => AsyncStorage.removeItem(key),
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
