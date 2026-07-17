import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { useAuth } from "@/hooks/useAuth";

/**
 * First screen of the app. Rendered by RootLayout whenever there is no
 * active session — blocks all navigation until the user signs in.
 */
export default function LoginScreen() {
  const { signIn, isSigningIn, error, clearError } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Image source={require("@/assets/images/icon.png")} style={styles.logo} />
        <Text style={styles.appName}>PerioBasics</Text>
        <Text style={styles.title}>Inicia sesión para continuar</Text>
        <Text style={styles.subtitle}>
          Necesitamos saber quién eres para guardar tu progreso, tus evaluaciones y tus conversaciones con el tutor.
        </Text>

        {error ? (
          <Pressable onPress={clearError} style={styles.errorBox} hitSlop={8}>
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => signIn("google")}
          disabled={isSigningIn}
          style={[styles.button, isSigningIn && styles.buttonDisabled]}
        >
          {isSigningIn ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Continuar con Google</Text>
          )}
        </Pressable>
        {/* TODO(App Store release): Apple exige ofrecer "Sign in with Apple" como
            alternativa en cuanto la app se distribuya a testers externos de
            TestFlight o se publique en la App Store (no aplica con testers
            internos únicamente). El plumbing ya soporta "apple" como provider
            en useAuth().signIn — ver el comentario junto a esa función. Solo
            falta agregar el botón aquí cuando llegue el momento.
        */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  content: {
    alignItems: "center",
    maxWidth: 360,
    width: "100%",
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 20,
  },
  appName: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.light.purple,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    marginBottom: 32,
  },
  errorBox: {
    marginBottom: 20,
    width: "100%",
  },
  errorText: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
  },
  button: {
    backgroundColor: Colors.light.purple,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    minWidth: 220,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
});
