import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { StyleSheet, View } from "react-native";

import ChatPanel from "@/components/ChatPanel";
import ScreenFade from "@/components/ScreenFade";
import Colors from "@/constants/colors";

export default function AcademicChatScreen() {
  return (
    <ScreenFade style={styles.root}>
      <StatusBar style="dark" />
      <ChatPanel
        title="Tutoría"
        onBack={() => router.back()}
        onClose={() => router.back()}
      />
    </ScreenFade>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.chalk,
  },
});
