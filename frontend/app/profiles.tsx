import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";

import { useProfiles, MAX_PROFILES, KID_DEFAULT_BLOCKED, type Profile } from "@/src/store/profile-store";
import { useIPTV } from "@/src/store/iptv-store";
import { useI18n } from "@/src/store/i18n-store";
import { ProfileAvatar, withAlpha } from "@/src/components/profile/ProfileAvatar";
import { useProfileSwitch } from "@/src/components/profile/useProfileSwitch";
import { colors, spacing, font } from "@/src/theme/tokens";

const EASE = Easing.bezier(0.4, 0, 0.2, 1); // Compose FastOutSlowInEasing

// "Who's watching?" — modelled on Nuvio's ProfileSelectionScreen: animated title,
// 150px avatar cards that lift on hover/focus, a backdrop tinted with the hovered
// profile's color, and a "Manage profiles" mode that turns cards into edit links.
export default function Profiles() {
  const router = useRouter();
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeProfileId);
  const playlist = useIPTV((s) => s.playlist);
  const { t } = useI18n();
  const { requestSwitch, pinPad } = useProfileSwitch();

  const [editMode, setEditMode] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // /login only ever routes here once a profile is picked/created; if there's no
  // playlist yet (first run, or arrived via the "Kayıt ol" flow) send them into the
  // add-a-source wizard instead of the empty home tab.
  function continueAfterProfile() {
    if (playlist) router.replace("/(tabs)");
    else router.replace({ pathname: "/login", params: { step: "type" } });
  }

  function onCardPress(p: Profile) {
    if (editMode) router.push({ pathname: "/profile-edit", params: { id: p.id } });
    else requestSwitch(p, continueAfterProfile);
  }

  const tintSource = profiles.find((p) => p.id === (hoveredId || activeId));
  const tint = tintSource?.color || colors.brandPrimary;

  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(-16);
  useEffect(() => {
    titleOpacity.value = withTiming(1, { duration: 600, easing: EASE });
    titleY.value = withTiming(0, { duration: 600, easing: EASE });
  }, [titleOpacity, titleY]);
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value, transform: [{ translateY: titleY.value }] }));

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[withAlpha(tint, 0.32), withAlpha(tint, 0.08), "transparent"]}
        locations={[0, 0.45, 0.85]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView edges={["top"]} style={styles.topBar}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} focusable>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
        ) : (
          <View />
        )}
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Animated.View style={[styles.header, titleStyle]}>
          <Image source={require("@/assets/images/icon.png")} style={styles.logo} contentFit="contain" />
          <Text style={styles.title}>{editMode ? "Profilleri Yönet" : t("profiles.title")}</Text>
        </Animated.View>

        <View style={styles.grid}>
          {profiles.map((p, i) => (
            <Animated.View key={p.id} entering={FadeInDown.delay(80 + i * 70).duration(450)}>
              <ProfileCard
                profile={p}
                active={p.id === activeId}
                editMode={editMode}
                onPress={() => onCardPress(p)}
                onHover={(h) => setHoveredId(h ? p.id : null)}
              />
            </Animated.View>
          ))}
          {profiles.length < MAX_PROFILES && (
            <Animated.View entering={FadeInDown.delay(80 + profiles.length * 70).duration(450)}>
              <AddCard onPress={() => router.push("/profile-edit")} />
            </Animated.View>
          )}
        </View>

        <Pressable
          onPress={() => setEditMode((v) => !v)}
          focusable
          style={({ focused, hovered }: any) => [
            styles.manageBtn,
            editMode && { backgroundColor: withAlpha(tint, 0.15), borderColor: withAlpha(tint, 0.5) },
            (focused || hovered) && { borderColor: "#fff" },
          ]}
          testID="profiles-manage"
        >
          <Ionicons name={editMode ? "checkmark" : "pencil"} size={16} color="#fff" />
          <Text style={styles.manageText}>{editMode ? "Bitti" : "Profilleri Yönet"}</Text>
        </Pressable>
      </ScrollView>

      {pinPad}
    </View>
  );
}

function ProfileCard({
  profile,
  active,
  editMode,
  onPress,
  onHover,
}: {
  profile: Profile;
  active: boolean;
  editMode: boolean;
  onPress: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const [lifted, setLifted] = useState(false);
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withTiming(lifted ? 1.07 : 1, { duration: 180, easing: EASE });
  }, [lifted, scale]);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const setLift = (v: boolean) => {
    setLifted(v);
    onHover(v);
  };

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setLift(true)}
      onHoverOut={() => setLift(false)}
      onFocus={() => setLift(true)}
      onBlur={() => setLift(false)}
      focusable
      // @ts-ignore - TV only
      hasTVPreferredFocus={Platform.isTV && active}
      testID={`profile-card-${profile.id}`}
    >
      <Animated.View
        style={[
          styles.card,
          liftStyle,
          lifted && { backgroundColor: "rgba(255,255,255,0.06)", borderColor: withAlpha(profile.color, 0.55) },
        ]}
      >
        <View style={editMode && { opacity: 0.55 }}>
          <ProfileAvatar avatar={profile.avatar} color={profile.color} size={100} locked={profile.hasPin && !editMode} />
        </View>
        {editMode && (
          <View style={styles.editOverlay} pointerEvents="none">
            <View style={styles.editBadge}>
              <Ionicons name="pencil" size={20} color="#000" />
            </View>
          </View>
        )}
        <Text style={[styles.name, (lifted || active) && { color: "#fff" }]} numberOfLines={1}>
          {profile.name}
        </Text>
        {profile.isKids ? <Text style={[styles.kids, { color: profile.color }]}>ÇOCUK</Text> : <Text style={styles.kids}> </Text>}
      </Animated.View>
    </Pressable>
  );
}

function AddCard({ onPress }: { onPress: () => void }) {
  const [lifted, setLifted] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setLifted(true)}
      onHoverOut={() => setLifted(false)}
      onFocus={() => setLifted(true)}
      onBlur={() => setLifted(false)}
      focusable
      testID="profile-card-add"
    >
      <View style={[styles.card, lifted && { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.3)", transform: [{ scale: 1.07 }] }]}>
        <View style={styles.addOuter}>
          <View style={styles.addInner}>
            <Ionicons name="add" size={40} color="rgba(255,255,255,0.7)" />
          </View>
        </View>
        <Text style={[styles.name, lifted && { color: "#fff" }]}>Profil Ekle</Text>
        <Text style={styles.kids}> </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 5, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  scroll: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, paddingVertical: 72, gap: 40 },
  header: { alignItems: "center", gap: 18 },
  logo: { width: 48, height: 48 },
  title: { color: "#fff", fontSize: 30, fontWeight: "800", textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 20, maxWidth: 170 * 6 },
  card: {
    width: 150,
    alignItems: "center",
    padding: 8,
    paddingTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
  },
  editOverlay: { position: "absolute", top: 12, left: 0, right: 0, height: 110, alignItems: "center", justifyContent: "center" },
  editBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  name: { color: "rgba(255,255,255,0.72)", fontSize: font.lg, fontWeight: "600", marginTop: 12, maxWidth: 134 },
  kids: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginTop: 2 },
  addOuter: { width: 110, height: 110, alignItems: "center", justifyContent: "center" },
  addInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    borderStyle: "dashed",
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  manageText: { color: "#fff", fontSize: font.base, fontWeight: "600" },
});

export const __dev_kid_default_blocked = KID_DEFAULT_BLOCKED;
