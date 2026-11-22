import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "@/src/store/i18n-store";
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from "@/src/constants/privacy-policy";
import { colors, spacing, font } from "@/src/theme/tokens";

export default function PrivacyPolicy() {
  const router = useRouter();
  const { locale } = useI18n();
  const sections = PRIVACY_SECTIONS[locale] ?? PRIVACY_SECTIONS.tr;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="privacy-back">
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>{locale === "en" ? "Privacy Policy" : "Gizlilik Politikası"}</Text>
        <View style={{ width: 26 }} />
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.updated}>{PRIVACY_UPDATED[locale] ?? PRIVACY_UPDATED.tr}</Text>
        {sections.map(([heading, body]) => (
          <View key={heading} style={styles.section}>
            <Text style={styles.heading}>{heading}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontSize: font.lg, fontWeight: "700" },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2, maxWidth: 760, width: "100%", alignSelf: "center", gap: spacing.lg },
  updated: { color: colors.textMuted, fontSize: font.sm },
  section: { gap: spacing.xs },
  heading: { color: colors.onSurface, fontSize: font.base, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: font.base, lineHeight: 22 },
});
