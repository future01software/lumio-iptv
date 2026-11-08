import React from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { useProfiles } from "@/src/store/profile-store";
import { ProfileAvatar, withAlpha } from "@/src/components/profile/ProfileAvatar";
import { useProfileSwitch } from "@/src/components/profile/useProfileSwitch";
import { colors, font, spacing } from "@/src/theme/tokens";
import { FocusPressable } from "@/src/components/FocusPressable";

// Nuvio's ProfilePopupContent: a small menu next to the rail avatar for switching
// profiles in place, without going back through "Who's watching?".
export function ProfileSwitcher({ visible, anchorLeft, onClose }: { visible: boolean; anchorLeft: number; onClose: () => void }) {
  const router = useRouter();
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeProfileId);
  const { requestSwitch, pinPad } = useProfileSwitch();

  return (
    <>
      <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View entering={FadeIn.duration(140)} style={[styles.popup, { left: anchorLeft }]}>
          {profiles.map((p) => {
            const active = p.id === activeId;
            return (
              <FocusPressable
                key={p.id}
                                onPress={() => {
                  onClose();
                  if (!active) requestSwitch(p);
                }}
                style={({ focused, hovered }: any) => [
                  styles.item,
                  active && { backgroundColor: withAlpha(p.color, 0.18) },
                  (focused || hovered) && !active && styles.itemHover,
                ]}
                testID={`switcher-${p.id}`}
              >
                <ProfileAvatar avatar={p.avatar} color={p.color} size={34} />
                <Text style={[styles.name, active && { color: "#fff" }]} numberOfLines={1}>
                  {p.name}
                </Text>
                {active ? (
                  <Ionicons name="checkmark" size={18} color={p.color} />
                ) : p.hasPin ? (
                  <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                ) : null}
              </FocusPressable>
            );
          })}
          <View style={styles.divider} />
          <FocusPressable
            onPress={() => {
              onClose();
              router.push("/profiles");
            }}
            style={({ focused, hovered }: any) => [styles.item, (focused || hovered) && styles.itemHover]}
          >
            <View style={styles.manageIcon}>
              <Ionicons name="people-outline" size={18} color="#fff" />
            </View>
            <Text style={[styles.name, { color: "#fff" }]}>Profilleri Yönet</Text>
          </FocusPressable>
        </Animated.View>
      </Modal>
      {pinPad}
    </>
  );
}

const styles = StyleSheet.create({
  popup: {
    position: "absolute",
    top: 12,
    width: 248,
    padding: 6,
    borderRadius: 18,
    backgroundColor: "rgba(22,22,24,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  itemHover: { backgroundColor: "rgba(255,255,255,0.07)" },
  name: { flex: 1, color: "rgba(255,255,255,0.8)", fontSize: font.base, fontWeight: "600" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: spacing.xs, marginHorizontal: 6 },
  manageIcon: { width: 37, height: 37, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
});
