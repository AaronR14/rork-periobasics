import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { supabase, mapUser, getValidAccessToken } from "@/lib/supabase";
import { redirectUrl } from "@/lib/config";
import type { AuthUser } from "@/lib/auth-provider";

// Required for web popup handling.
WebBrowser.maybeCompleteAuthSession();

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isSigningIn: boolean;
  error: string | null;
  signIn: (provider: "google" | "apple") => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  function clearError() {
    setError(null);
  }

  // On mount: restore existing session.
  useEffect(() => {
    isMountedRef.current = true;
    restoreSession();
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for auth state changes (token refresh, sign out, etc.)
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMountedRef.current) return;
        updateUserFromSession(session);
      },
    );
    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function restoreSession() {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.warn("Session restore error:", sessionError.message);
      }
      if (data.session) {
        updateUserFromSession(data.session);
      }
    } catch (err) {
      console.error("Auth restore failed:", err);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }

  function updateUserFromSession(session: { user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } } | null) {
    if (session?.user) {
      setUser(mapUser(session.user as Parameters<typeof mapUser>[0]));
    } else {
      setUser(null);
    }
  }

  async function signIn(provider: "google" | "apple") {
    setIsSigningIn(true);
    setError(null);
    try {
      // Both native and web use skipBrowserRedirect so we control the flow:
      // - Native: openAuthSessionAsync (system browser / Custom Tab)
      // - Web: window.open popup (escapes iframe restrictions)
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (oauthError) throw oauthError;
      if (!data?.url) throw new Error("No auth URL returned");

      if (Platform.OS === "web") {
        await webPopupAuth(data.url);
        return;
      }

      // Native: open the system browser for OAuth.
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUrl,
      );

      if (result.type === "success" && result.url) {
        // Extract the auth code from the redirect URL.
        const url = new URL(result.url);
        // Strip trailing %23 (known Supabase/Go URL parser issue on bare schemes).
        const code = (url.searchParams.get("code") ?? "").replace(/%23$/, "");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;

          // Session is now stored — onAuthStateChange will update user state.
          const { data: sessionData } = await supabase.auth.getSession();
          updateUserFromSession(sessionData.session);
        }
      }
      // If result.type === "cancel" or "dismiss", user closed the browser — no error.
    } catch (err) {
      console.error("Sign in failed:", err);
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      if (isMountedRef.current) setIsSigningIn(false);
    }
  }

  /**
   * Web OAuth via popup. Opens a new tab (escaping any iframe restrictions),
   * then polls the popup's URL until Supabase redirects back with `?code=`.
   * Once we have the code, we exchange it for a session and close the popup.
   */
  async function webPopupAuth(authUrl: string): Promise<void> {
    const popup = window.open(authUrl, "supabase-auth", "width=500,height=700,menubar=no,toolbar=no,location=no");
    if (!popup) {
      throw new Error("Popup blocked. Please allow popups for this site.");
    }

    // Poll the popup window for the redirect back to our origin.
    const code = await waitForPopupCode(popup);

    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;

      const { data: sessionData } = await supabase.auth.getSession();
      updateUserFromSession(sessionData.session);
    }
  }

  /**
   * Poll a popup window until it redirects back to our origin with a `code`
   * query param. Resolves with the code string, or null if the popup closes.
   */
  function waitForPopupCode(popup: Window): Promise<string | null> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        try {
          // Reading popup.location is allowed once the popup is on our origin
          // (same-origin). Before that it throws a SecurityError, which we catch.
          const popupUrl = popup.location.href;
          if (popupUrl && popupUrl.startsWith(window.location.origin)) {
            clearInterval(interval);
            const url = new URL(popupUrl);
            const code = url.searchParams.get("code");
            popup.close();
            resolve(code);
          }
        } catch {
          // SecurityError: popup is still on Google's domain — keep polling.
        }

        // Popup closed by user before completing auth.
        if (popup.closed) {
          clearInterval(interval);
          resolve(null);
        }
      }, 500);
    });
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Sign out failed:", err);
    }
    setUser(null);
  }

  async function getAccessToken(): Promise<string | null> {
    return await getValidAccessToken();
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isSigningIn, error, signIn, signOut, clearError, getAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
