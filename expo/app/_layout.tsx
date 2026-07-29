// template
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PostHogProvider, usePostHog } from "posthog-react-native";
import { LogBox } from "react-native";

import Colors from "@/constants/colors";
import LoginScreen from "@/components/LoginScreen";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ChatSessionsProvider } from "@/hooks/useChatSessions";
import { ProgressProvider } from "@/hooks/useProgress";
import { posthogAutocapture, posthogConfig, SafePostHogContext, noopPostHog } from "@/lib/posthog";

// PostHog flush failures are non-fatal and should not show a red error screen
// to the user. They're logged to the console instead.
LogBox.ignoreLogs(["Error while flushing PostHog", "PostHogFetchNetworkError"]);

/**
 * When PostHog is enabled, this inner component grabs the real client from
 * PostHogProvider and re-provides it through SafePostHogContext so all
 * useSafePostHog() callers get the real client.
 */
function PostHogBridge({ children }: { children: React.ReactNode }) {
  const client = usePostHog();
  return (
    <SafePostHogContext.Provider value={client}>
      {children}
    </SafePostHogContext.Provider>
  );
}

/**
 * Wraps children in PostHogProvider only when an API key is configured.
 * Without a key, provides a no-op client via SafePostHogContext so that
 * useSafePostHog() returns a harmless no-op instead of throwing.
 */
function OptionalPostHog({ children }: { children: React.ReactNode }) {
  if (!posthogConfig.apiKey) {
    return (
      <SafePostHogContext.Provider value={noopPostHog}>
        {children}
      </SafePostHogContext.Provider>
    );
  }
  return (
    <PostHogProvider
      apiKey={posthogConfig.apiKey}
      options={{ host: posthogConfig.host }}
      autocapture={posthogAutocapture}
    >
      <PostHogBridge>{children}</PostHogBridge>
    </PostHogProvider>
  );
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Disable aggressive refetching defaults. React Query v5 enables
// refetchOnWindowFocus, refetchOnMount, and refetchOnReconnect by
// default — in the Rork web preview, iframe focus events fire
// constantly, causing unnecessary network calls (and AI costs
// for the progress-report query) while the user is idle.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60 * 5, // 5 min default
      retry: 1,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back", animation: "none" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="library" options={{ headerShown: false }} />
      <Stack.Screen name="chat" options={{ headerShown: false }} />
      <Stack.Screen name="quiz" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * Gates the entire app behind a session: shows a loading state while the
 * persisted session is being restored (so returning users don't see a
 * flash of the login screen), then either LoginScreen (no user) or the
 * real navigator (user present). No route is reachable without a session.
 */
function AuthGate() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.bootLoading}>
        <ActivityIndicator size="large" color={Colors.light.purple} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <RootLayoutNav />;
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Above AuthProvider (not inside AuthGate) on purpose: this way
        PostHog also captures pre-login screen views on LoginScreen (how
        many people see it vs. actually sign in), tagged to an anonymous
        distinct_id. useAuth() calls posthog.identify() with the real
        Supabase user_id once login succeeds, which merges those anonymous
        events into the identified user's timeline.
      */}
      {/* PostHog is only mounted when an API key is configured; without
          one the SDK throws a runtime error, so we skip the provider entirely
          and analytics are simply disabled. */}
      <OptionalPostHog>
        <AuthProvider>
          <ProgressProvider>
            <ChatSessionsProvider>
              <GestureHandlerRootView>
                <AuthGate />
              </GestureHandlerRootView>
            </ChatSessionsProvider>
          </ProgressProvider>
        </AuthProvider>
      </OptionalPostHog>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  bootLoading: {
    flex: 1,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
  },
});
