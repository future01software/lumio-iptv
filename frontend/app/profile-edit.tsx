import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Switch, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useProfiles, PROFILE_COLORS, KID_DEFAULT_BLOCKED, MAX_PROFILES } from "@/src/store/profile-store";
import { ProfileAvatar, isImageAvatar, withAlpha } from "@/src/components/profile/ProfileAvatar";
import {
  AVATAR_SEEDS,
  AVATAR_STYLES,
  isGeneratedAvatar,
  makeAvatarId,
  parseAvatarId,
  randomSeed,
  type AvatarStyleId,
} from "@/src/utils/avatars";
import { BUNDLED_AVATARS, isBundledAvatar, makeBundledAvatarId } from "@/src/utils/bundledAvatars";
import { PinPad, type PinSubmitResult } from "@/src/components/profile/PinPad";
import { colors, spacing, radius, font } from "@/src/theme/tokens";

const EMOJIS = ["😀", "😎", "🤓", "🥳", "😺", "🐶", "🦊", "🐼", "🦁", "🐯", "🐸", "🐵", "🦄", "🐙", "🐧", "🦖", "👻", "🤖", "👽", "🎮", "🎬", "⚽", "🚀", "🌟"];
const PIN_LENGTH = 4;

type AvatarMode = "character" | "letter" | "emoji" | "image";
// "3d" is the bundled picture set; the rest are DiceBear styles
type CharStyle = AvatarStyleId | "3d";
const CHAR_STYLES: { id: CharStyle; label: string }[] = [{ id: "3d", label: "3D Karakter" }, ...AVATAR_STYLES];
type PinFlow =
  | { step: "unlock" } // gate: editing a PIN-protected profile
  | { step: "verify"; purpose: "change" | "remove" }
  | { step: "new" }
  | { step: "confirm"; first: string };

function initialOf(name: string) {
  return (name.trim()[0] || "?").toUpperCase();
}

// Nuvio's ProfileEditScreen: avatar + color + name + security, with delete behind
// an in-app confirmation (Alert.alert is a no-op in the Electron/web build).
export default function ProfileEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const profiles = useProfiles((s) => s.profiles);
  const addProfile = useProfiles((s) => s.addProfile);
  const updateProfile = useProfiles((s) => s.updateProfile);
  const removeProfile = useProfiles((s) => s.removeProfile);
  const tryPin = useProfiles((s) => s.tryPin);
  const setPinStore = useProfiles((s) => s.setPin);
  const clearPin = useProfiles((s) => s.clearPin);

  const existing = useMemo(() => profiles.find((p) => p.id === id) || null, [profiles, id]);
  const isNew = !existing;

  const usedColors = new Set(profiles.map((p) => p.color));
  const [name, setName] = useState(existing?.name || "");
  const [color, setColor] = useState(existing?.color || PROFILE_COLORS.find((c) => !usedColors.has(c)) || PROFILE_COLORS[0]);
  const initialMode: AvatarMode = !existing
    ? "character"
    : isGeneratedAvatar(existing.avatar) || isBundledAvatar(existing.avatar)
      ? "character"
      : isImageAvatar(existing.avatar)
      ? "image"
      : existing.avatar.length === 1 && existing.avatar.toUpperCase() !== existing.avatar.toLowerCase()
        ? "letter"
        : EMOJIS.includes(existing.avatar)
          ? "emoji"
          : "letter";
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(initialMode);
  const [emoji, setEmoji] = useState(initialMode === "emoji" ? existing!.avatar : EMOJIS[0]);
  const [imageUrl, setImageUrl] = useState(initialMode === "image" ? existing!.avatar : "");
  // Cartoon avatars (DiceBear): a style plus a seed. New profiles start on a
  // random pick; the grid shows fixed seeds until "Karıştır" rolls new ones.
  const parsedChar = parseAvatarId(existing?.avatar);
  const existingBundledId = isBundledAvatar(existing?.avatar) ? existing!.avatar.slice("asset3d:".length) : null;
  const [charStyle, setCharStyle] = useState<CharStyle>(parsedChar?.styleId ?? "3d");
  const [bundledId, setBundledId] = useState<string>(
    () => existingBundledId ?? BUNDLED_AVATARS[Math.floor(Math.random() * BUNDLED_AVATARS.length)].id,
  );
  const [charSeed, setCharSeed] = useState(
    () => parsedChar?.seed ?? AVATAR_SEEDS[Math.floor(Math.random() * AVATAR_SEEDS.length)],
  );
  const [charSeeds, setCharSeeds] = useState<string[]>(() =>
    parsedChar && !AVATAR_SEEDS.includes(parsedChar.seed) ? [parsedChar.seed, ...AVATAR_SEEDS.slice(0, -1)] : [...AVATAR_SEEDS],
  );
  const [isKids, setIsKids] = useState(existing?.isKids || false);
  const [keywords, setKeywords] = useState<string[]>(existing?.blockedKeywords || []);
  const [keywordInput, setKeywordInput] = useState("");
  const [pendingPin, setPendingPin] = useState<string | null>(null); // new profiles only
  // The active profile was already unlocked on the way in; any other PIN-protected
  // profile has to be unlocked before its settings can be changed.
  const activeId = useProfiles((s) => s.activeProfileId);
  const [pinFlow, setPinFlow] = useState<PinFlow | null>(
    existing?.hasPin && existing.id !== activeId ? { step: "unlock" } : null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const imageValid = /^https?:\/\/\S+$/i.test(imageUrl.trim());
  const avatar =
    avatarMode === "character"
      ? charStyle === "3d"
        ? makeBundledAvatarId(bundledId)
        : makeAvatarId(charStyle, charSeed)
      : avatarMode === "emoji"
        ? emoji
        : avatarMode === "image" && imageValid
          ? imageUrl.trim()
          : initialOf(name);
  const hasPin = isNew ? !!pendingPin : !!existing?.hasPin;

  // Reached via a stale link (e.g. an "add" page with the limit already hit).
  // Decided once on mount, so creating the 6th profile here doesn't trip it.
  const [atLimit] = useState(() => !existing && profiles.length >= MAX_PROFILES);
  useEffect(() => {
    if (atLimit) router.back();
  }, [atLimit, router]);
  if (atLimit) return null;

  function toggleKids(v: boolean) {
    setIsKids(v);
    // Seed the default filter list the first time kids mode is switched on.
    if (v && keywords.length === 0) setKeywords([...KID_DEFAULT_BLOCKED]);
  }

  function addKeyword() {
    const k = keywordInput.trim().toLowerCase();
    if (k && !keywords.includes(k)) setKeywords([...keywords, k]);
    setKeywordInput("");
  }

  async function save() {
    if (!name.trim()) {
      setError("Profil adı boş olamaz");
      return;
    }
    if (avatarMode === "image" && !imageValid) {
      setError("Geçerli bir resim bağlantısı gir (http/https)");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await addProfile({ name: name.trim(), avatar, color, isKids, pin: pendingPin || undefined });
        // addProfile seeds kid keywords itself; apply any edits made here.
        const all = useProfiles.getState().profiles;
        const created = all[all.length - 1];
        if (created && isKids) await updateProfile(created.id, { blockedKeywords: keywords });
      } else {
        await updateProfile(existing!.id, { name: name.trim(), avatar, color, isKids, blockedKeywords: isKids ? keywords : [] });
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    await removeProfile(existing!.id);
    router.back();
  }

  async function submitPin(pin: string): Promise<PinSubmitResult> {
    if (!pinFlow) return null;
    if (pinFlow.step === "unlock" || pinFlow.step === "verify") {
      const res = await tryPin(existing!.id, pin);
      if (!res.ok) {
        if (res.retryAfterSec > 0) return { error: "", lockSec: res.retryAfterSec };
        return { error: `Hatalı PIN · ${res.attemptsLeft} deneme hakkın kaldı` };
      }
      if (pinFlow.step === "unlock") setPinFlow(null);
      else if (pinFlow.purpose === "remove") {
        await clearPin(existing!.id);
        setPinFlow(null);
      } else setPinFlow({ step: "new" });
      return null;
    }
    if (pinFlow.step === "new") {
      setPinFlow({ step: "confirm", first: pin });
      return null;
    }
    if (pin !== pinFlow.first) {
      setPinFlow({ step: "new" });
      return { error: "PIN'ler eşleşmedi, baştan gir" };
    }
    if (isNew) setPendingPin(pin);
    else await setPinStore(existing!.id, pin);
    setPinFlow(null);
    return null;
  }

  function cancelPin() {
    // Backing out of the unlock gate means leaving the screen entirely.
    if (pinFlow?.step === "unlock") router.back();
    setPinFlow(null);
  }

  const pinTitle =
    pinFlow?.step === "unlock"
      ? existing?.name || ""
      : pinFlow?.step === "verify"
        ? "Mevcut PIN'i gir"
        : pinFlow?.step === "new"
          ? "Yeni PIN belirle"
          : "Yeni PIN'i tekrar gir";
  const pinSubtitle =
    pinFlow?.step === "unlock" ? "Bu profili düzenlemek için PIN gerekli" : pinFlow?.step === "new" ? `${PIN_LENGTH} haneli bir PIN seç` : undefined;

  const preview = (
    <View style={[styles.preview, wide && styles.previewWide]}>
      <ProfileAvatar avatar={avatar} color={color} size={wide ? 150 : 110} locked={hasPin} />
      <Text style={styles.previewName} numberOfLines={1}>
        {name.trim() || "Yeni Profil"}
      </Text>
      {isKids && <Text style={[styles.previewKids, { color }]}>ÇOCUK PROFİLİ</Text>}
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[withAlpha(color, 0.28), withAlpha(color, 0.06), "transparent"]}
        locations={[0, 0.4, 0.8]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView edges={["top"]} style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} focusable>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{isNew ? "Profil Ekle" : "Profili Düzenle"}</Text>
        <Pressable
          onPress={save}
          disabled={saving}
          focusable
          style={({ focused, hovered }: any) => [styles.saveBtn, { backgroundColor: color }, (focused || hovered) && styles.saveBtnHover]}
          testID="profile-save"
        >
          <Text style={styles.saveText}>{saving ? "Kaydediliyor…" : isNew ? "Oluştur" : "Kaydet"}</Text>
        </Pressable>
      </SafeAreaView>

      <ScrollView contentContainerStyle={[styles.body, wide && styles.bodyWide]}>
        {preview}

        <View style={[styles.form, wide && styles.formWide]}>
          {!!error && <Text style={styles.error}>{error}</Text>}

          <Section title="İsim">
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder="Profil adı"
              placeholderTextColor={colors.textMuted}
              maxLength={20}
              style={styles.input}
              testID="profile-name"
            />
          </Section>

          <Section title="Avatar">
            <View style={styles.segment}>
              {(
                [
                  ["character", "Karakter"],
                  ["letter", "Harf"],
                  ["emoji", "Emoji"],
                  ["image", "Resim"],
                ] as const
              ).map(([mode, label]) => (
                <Pressable
                  key={mode}
                  onPress={() => setAvatarMode(mode)}
                  focusable
                  style={({ focused, hovered }: any) => [
                    styles.segmentItem,
                    avatarMode === mode && { backgroundColor: withAlpha(color, 0.3) },
                    (focused || hovered) && { borderColor: "#fff" },
                  ]}
                >
                  <Text style={[styles.segmentText, avatarMode === mode && { color: "#fff" }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {avatarMode === "character" && (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.styleChips}>
                  {CHAR_STYLES.map((st) => (
                    <Pressable
                      key={st.id}
                      onPress={() => setCharStyle(st.id)}
                      focusable
                      style={({ focused, hovered }: any) => [
                        styles.styleChip,
                        charStyle === st.id && { backgroundColor: withAlpha(color, 0.3), borderColor: color },
                        (focused || hovered) && charStyle !== st.id && { borderColor: "rgba(255,255,255,0.5)" },
                      ]}
                      testID={`avatar-style-${st.id}`}
                    >
                      <Text style={[styles.segmentText, charStyle === st.id && { color: "#fff" }]}>{st.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.charGrid}>
                  {charStyle === "3d"
                    ? BUNDLED_AVATARS.map(({ id }) => {
                        const selected = id === bundledId;
                        return (
                          <Pressable
                            key={id}
                            onPress={() => setBundledId(id)}
                            focusable
                            style={({ focused, hovered }: any) => [
                              styles.charCell,
                              selected && { borderColor: color, backgroundColor: withAlpha(color, 0.18) },
                              (focused || hovered) && !selected && { borderColor: "rgba(255,255,255,0.5)" },
                            ]}
                          >
                            <ProfileAvatar avatar={makeBundledAvatarId(id)} color={color} size={54} />
                          </Pressable>
                        );
                      })
                    : charSeeds.map((seed) => {
                        const selected = seed === charSeed;
                        return (
                          <Pressable
                            key={seed}
                            onPress={() => setCharSeed(seed)}
                            focusable
                            style={({ focused, hovered }: any) => [
                              styles.charCell,
                              selected && { borderColor: color, backgroundColor: withAlpha(color, 0.18) },
                              (focused || hovered) && !selected && { borderColor: "rgba(255,255,255,0.5)" },
                            ]}
                          >
                            <ProfileAvatar avatar={makeAvatarId(charStyle as AvatarStyleId, seed)} color={color} size={54} />
                          </Pressable>
                        );
                      })}
                </View>
                {charStyle !== "3d" && (
                  <View style={styles.buttonRow}>
                    <ActionButton
                      icon="shuffle"
                      label="Karıştır"
                      onPress={() => setCharSeeds(Array.from({ length: AVATAR_SEEDS.length }, randomSeed))}
                    />
                  </View>
                )}
              </>
            )}
            {avatarMode === "letter" && <Text style={styles.help}>İsmin baş harfi kullanılır.</Text>}
            {avatarMode === "emoji" && (
              <View style={styles.emojiGrid}>
                {EMOJIS.map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => setEmoji(e)}
                    focusable
                    style={({ focused, hovered }: any) => [
                      styles.emojiCell,
                      emoji === e && { backgroundColor: withAlpha(color, 0.3), borderColor: color },
                      (focused || hovered) && emoji !== e && { borderColor: "rgba(255,255,255,0.5)" },
                    ]}
                  >
                    <Text style={styles.emojiText}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {avatarMode === "image" && (
              <>
                <TextInput
                  value={imageUrl}
                  onChangeText={(v) => {
                    setImageUrl(v);
                    setError(null);
                  }}
                  placeholder="https://…/avatar.png"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Text style={[styles.help, imageUrl && !imageValid && { color: colors.error }]}>
                  {imageUrl && !imageValid ? "Bağlantı http:// veya https:// ile başlamalı" : "Kare bir resmin bağlantısını yapıştır."}
                </Text>
              </>
            )}
          </Section>

          <Section title="Renk">
            <View style={styles.swatches}>
              {PROFILE_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  focusable
                  accessibilityLabel={c}
                  style={({ focused, hovered }: any) => [
                    styles.swatch,
                    { backgroundColor: c },
                    color === c && styles.swatchActive,
                    (focused || hovered) && color !== c && { borderColor: "rgba(255,255,255,0.6)" },
                  ]}
                >
                  {color === c && <Ionicons name="checkmark" size={18} color="#fff" />}
                </Pressable>
              ))}
            </View>
          </Section>

          <Section title="Çocuk Profili">
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Çocuklar için güvenli mod</Text>
                <Text style={styles.help}>Aşağıdaki kelimeleri içeren kanal, film ve diziler gizlenir.</Text>
              </View>
              <Switch value={isKids} onValueChange={toggleKids} trackColor={{ true: color, false: "#444" }} thumbColor="#fff" />
            </View>
            {isKids && (
              <>
                <View style={styles.chips}>
                  {keywords.map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => setKeywords(keywords.filter((x) => x !== k))}
                      focusable
                      style={({ focused, hovered }: any) => [styles.chip, (focused || hovered) && { borderColor: colors.error }]}
                    >
                      <Text style={styles.chipText}>{k}</Text>
                      <Ionicons name="close" size={14} color={colors.textMuted} />
                    </Pressable>
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput
                    value={keywordInput}
                    onChangeText={setKeywordInput}
                    onSubmitEditing={addKeyword}
                    placeholder="Engellenecek kelime ekle"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    style={[styles.input, { flex: 1 }]}
                  />
                  <Pressable onPress={addKeyword} focusable style={[styles.smallBtn, { backgroundColor: withAlpha(color, 0.3) }]}>
                    <Ionicons name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
              </>
            )}
          </Section>

          <Section title="Güvenlik">
            <View style={styles.row}>
              <Ionicons name={hasPin ? "lock-closed" : "lock-open-outline"} size={20} color={hasPin ? color : colors.textMuted} />
              <Text style={[styles.rowTitle, { flex: 1 }]}>{hasPin ? "PIN kilidi açık" : "PIN kilidi kapalı"}</Text>
            </View>
            <Text style={styles.help}>PIN'li profile girmek ve profili düzenlemek için PIN istenir.</Text>
            <View style={styles.buttonRow}>
              {!hasPin && <ActionButton icon="keypad-outline" label="PIN Belirle" onPress={() => setPinFlow({ step: "new" })} />}
              {hasPin && isNew && <ActionButton icon="close-circle-outline" label="PIN'i Kaldır" onPress={() => setPendingPin(null)} />}
              {hasPin && !isNew && (
                <>
                  <ActionButton icon="keypad-outline" label="PIN'i Değiştir" onPress={() => setPinFlow({ step: "verify", purpose: "change" })} />
                  <ActionButton icon="close-circle-outline" label="PIN'i Kaldır" onPress={() => setPinFlow({ step: "verify", purpose: "remove" })} />
                </>
              )}
            </View>
          </Section>

          {!isNew && profiles.length > 1 && (
            <View style={styles.dangerZone}>
              {confirmDelete ? (
                <>
                  <Text style={styles.rowTitle}>"{existing!.name}" silinsin mi?</Text>
                  <Text style={styles.help}>Bu işlem geri alınamaz.</Text>
                  <View style={styles.buttonRow}>
                    <ActionButton icon="arrow-undo-outline" label="Vazgeç" onPress={() => setConfirmDelete(false)} />
                    <ActionButton icon="trash-outline" label="Evet, sil" danger onPress={doDelete} />
                  </View>
                </>
              ) : (
                <ActionButton icon="trash-outline" label="Profili Sil" danger onPress={() => setConfirmDelete(true)} />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {pinFlow && (
        <PinPad
          key={pinFlow.step}
          title={pinTitle}
          subtitle={pinSubtitle}
          avatar={pinFlow.step === "unlock" ? existing?.avatar : avatar}
          color={pinFlow.step === "unlock" ? existing?.color : color}
          length={pinFlow.step === "new" || pinFlow.step === "confirm" ? PIN_LENGTH : existing?.pinLength}
          onSubmit={submitPin}
          onCancel={cancelPin}
        />
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      focusable
      style={({ focused, hovered }: any) => [
        styles.actionBtn,
        danger && { borderColor: withAlpha(colors.error, 0.5) },
        (focused || hovered) && { backgroundColor: danger ? withAlpha(colors.error, 0.15) : "rgba(255,255,255,0.1)", borderColor: danger ? colors.error : "#fff" },
      ]}
    >
      <Ionicons name={icon} size={18} color={danger ? colors.error : "#fff"} />
      <Text style={[styles.actionText, danger && { color: colors.error }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  headerTitle: { flex: 1, color: "#fff", fontSize: font.xl, fontWeight: "800" },
  saveBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 2, borderColor: "transparent" },
  saveBtnHover: { borderColor: "#fff" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: font.base },
  body: { padding: spacing.lg, paddingBottom: 80, gap: spacing.lg },
  bodyWide: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 48, paddingTop: spacing.xl },
  preview: { alignItems: "center", gap: 10, paddingVertical: spacing.md },
  previewWide: { width: 240, paddingTop: 40 },
  previewName: { color: "#fff", fontSize: font.xl, fontWeight: "700", maxWidth: 240 },
  previewKids: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  form: { gap: spacing.md, width: "100%" },
  formWide: { maxWidth: 620, flex: 1 },
  section: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  sectionTitle: { color: colors.textMuted, fontSize: font.sm, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    height: 50,
    color: "#fff",
    fontSize: font.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  help: { color: colors.textMuted, fontSize: font.sm, lineHeight: 18 },
  error: { color: colors.error, fontSize: font.base, fontWeight: "600" },
  segment: { flexDirection: "row", gap: 6, padding: 4, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.05)", alignSelf: "flex-start" },
  segmentItem: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: "transparent" },
  segmentText: { color: colors.textMuted, fontWeight: "600", fontSize: font.base },
  styleChips: { gap: 8, paddingVertical: 2 },
  styleChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  charGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  charCell: { padding: 4, borderRadius: 40, borderWidth: 2, borderColor: "transparent" },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emojiCell: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  emojiText: { fontSize: 26 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "transparent" },
  swatchActive: { borderColor: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowTitle: { color: "#fff", fontSize: font.lg, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  chipText: { color: "#fff", fontSize: font.sm },
  smallBtn: { width: 50, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  actionText: { color: "#fff", fontWeight: "600", fontSize: font.base },
  dangerZone: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: withAlpha(colors.error, 0.25),
    backgroundColor: withAlpha(colors.error, 0.04),
  },
});
