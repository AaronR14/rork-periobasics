import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Cross-platform secure storage.
 *
 * expo-secure-store uses the platform keychain on iOS/Android but its web
 * stub exports an empty object, so getItemAsync is undefined and every call
 * throws. This wrapper falls back to localStorage on web so auth tokens
 * and Supabase calls work in the web preview.
 */

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore quota / private mode errors
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
