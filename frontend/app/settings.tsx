import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIPTV } from "@/src/store/iptv-store";
import { useAccount } from "@/src/store/account-store";
import { useAppLock } from "@/src/store/app-lock-store";
import { useI18n, LOCALE_INFO, type Locale } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { usePlayerSettings } from "@/src/store/player-settings-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { useProfiles } from "@/src/store/profile-store";
import { useDownloads } from "@/src/store/downloads-store";
import { ProfileAvatar } from "@/src/components/profile/ProfileAvatar";
import { colors, spacing, radius, font } from "@/src/theme/tokens";
import { withAlpha } from "@/src/utils/color";
import { useUpdates } from "@/src/store/update-store";
import { UPDATES_SUPPORTED, currentVersion } from "@/src/services/updater";
import { errorText } from "@/src/utils/error-text";
import { createBackup, decryptBackup, encryptBackup, parseBackup, pickBackupFile, restoreBackup, saveBackupFile, type BackupFile, type EncryptedBackupFile } from "@/src/utils/backup";

type Category = "account" | "library" | "general" | "advanced" | "about";

// Order matches Nuvio's real SettingsCategory enum: Account, General, About, Advanced.
// Desktop (Electron) and plain web: hide native-only settings (see below).
const IS_WEB = Platform.OS === "web";

const CATEGORIES: { id: Category; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "account", label: "Hesap", icon: "person-circle-outline" },
  { id: "library", label: "Kütüphane", icon: "library-outline" },
  { id: "general", label: "Genel", icon: "settings-outline" },
  { id: "about", label: "Hakkında", icon: "information-circle-outline" },
  { id: "advanced", label: "Gelişmiş", icon: "options-outline" },
];

function AccentColorRow({ c, idx, arr, accentColor, setAccentColor }: any) {
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, idx === arr.length - 1 && { borderBottomWidth: 0 }, focused && { backgroundColor: accentColor }]}
      onPress={() => setAccentColor(c.id)}
      focusable={true}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.id, borderWidth: focused ? 2 : 0, borderColor: "#FFF" }} />
        <Text style={[styles.rowLabel, focused && { color: "#FFF", fontWeight: "700" }]}>{c.label}</Text>
      </View>
      {accentColor === c.id && <Text style={[styles.rowValue, { color: focused ? "#FFF" : accentColor, fontWeight: "800" }]}>✓</Text>}
    </Pressable>
  );
}

function LocaleRow({ code, info, locale, setLocale, accentColor, idx, arr }: any) {
  const [focused, setFocused] = React.useState(false);
  const isActive = locale === code;
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, idx === arr.length - 1 && { borderBottomWidth: 0 }, focused && { backgroundColor: accentColor }]}
      onPress={() => setLocale(code)}
      testID={`settings-locale-${code}`}
      focusable={true}
    >
      <Text style={[styles.rowLabel, focused && { color: "#FFF", fontWeight: "700" }]}>{info.nativeLabel}</Text>
      <Text style={[styles.rowValue, isActive && { color: focused ? "#FFF" : accentColor, fontWeight: "800" }]}>
        {info.rtl ? "RTL" : ""}{isActive ? " ✓" : ""}
      </Text>
    </Pressable>
  );
}

function SettingsButton({ label, onPress, danger }: any) {
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        { backgroundColor: danger ? withAlpha(colors.error, 0.1) : colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, alignItems: "center", borderWidth: 2, borderColor: "transparent" },
        focused && { borderColor: danger ? colors.error : "white", backgroundColor: danger ? withAlpha(colors.error, 0.2) : "rgba(255,255,255,0.1)", transform: [{ scale: 1.02 }] }
      ]}
      onPress={onPress}
      focusable={true}
    >
      <Text style={{ color: danger ? colors.error : colors.onSurface, fontSize: font.base, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function BackButton({ router }: any) {
  const { accentColor } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => router.back()}
      hitSlop={10}
      style={[focused && { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.md, borderWidth: 2, borderColor: accentColor }]}
      focusable={true}
    >
      <Ionicons name="chevron-back" size={26} color="#fff" />
    </Pressable>
  );
}

export default function Settings() {
  return <SettingsView />;
}

/**
 * `embedded`: rendered inside the tabs shell as the desktop "Daha" screen
 * (Nuvio's settings root): the app rail stays visible, so no Back row, and it
 * opens on the Library category.
 */
export function SettingsView({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const activeProfile = useProfiles((s) => s.active());
  const favCount = useIPTV((s) => Object.keys(s.favorites).length);
  const histCount = useIPTV((s) => s.history.length);
  const collectionsCount = useIPTV((s) => s.collections.length);
  const downloadsCount = Object.keys(useDownloads((s) => s.items)).length;
  const loadEPG = useIPTV((s) => s.loadEPG);
  const epgLoading = useIPTV((s) => s.epgLoading);
  const config = useIPTV((s) => s.config);
  const playlist = useIPTV((s) => s.playlist);
  const clearPlaylist = useIPTV((s) => s.clearPlaylist);
  const currentEmail = useAccount((s) => s.currentEmail);
  const accountLogout = useAccount((s) => s.logout);
  const tmdbApiKey = useIPTV((s) => s.tmdbApiKey);
  const setTmdbApiKey = useIPTV((s) => s.setTmdbApiKey);
  const autoplay = usePlayerSettings((s) => s.autoplay);
  const setAutoplay = usePlayerSettings((s) => s.setAutoplay);
  const resume = usePlayerSettings((s) => s.resume);
  const setResume = usePlayerSettings((s) => s.setResume);
  const hwAccel = usePlayerSettings((s) => s.hwAccel);
  const setHwAccel = usePlayerSettings((s) => s.setHwAccel);
  const hideAdult = usePlayerSettings((s) => s.hideAdult);
  const setHideAdult = usePlayerSettings((s) => s.setHideAdult);
  const bufferSize = usePlayerSettings((s) => s.bufferSize);
  const setBufferSize = usePlayerSettings((s) => s.setBufferSize);
  const epgShift = usePlayerSettings((s) => s.epgShift);
  const setEpgShift = usePlayerSettings((s) => s.setEpgShift);
  const appLock = useAppLock();
  const { locale, setLocale, t } = useI18n();
  const { accentColor, setAccentColor } = useTheme();
  const { isDesktop } = useResponsive();
  const [pinInput, setPinInput] = React.useState("");
  const [showPinSetup, setShowPinSetup] = React.useState(false);
  const [category, setCategory] = React.useState<Category>(embedded ? "library" : "account");

  const pinSetupCard = showPinSetup && (
    <View style={{ padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md }}>
      <Text style={{ color: colors.onSurface, fontSize: font.lg, fontWeight: "700" }}>{t("settings.pin.title")}</Text>
      <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("settings.pin.help")}</Text>
      <TextInput
        value={pinInput} onChangeText={setPinInput}
        keyboardType="number-pad" secureTextEntry maxLength={8}
        placeholder="••••" placeholderTextColor={colors.textMuted}
        style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontSize: font.xl, textAlign: "center", letterSpacing: 12, borderWidth: 1, borderColor: colors.border }}
        testID="settings-pin-input"
      />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <SettingsButton label={t("settings.pin.cancel")} onPress={() => { setShowPinSetup(false); setPinInput(""); }} />
        <TouchableOpacity
          style={{ flex: 1, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: accentColor, alignItems: "center" }}
          onPress={async () => {
            if (pinInput.length < 4) return;
            await appLock.setPin(pinInput);
            await appLock.setEnabled(true);
            setShowPinSetup(false); setPinInput("");
          }}
          testID="settings-pin-save"
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>{t("settings.pin.save")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const librarySection = (
    <>
      <Group title="Kütüphane">
        <InfoRow icon="search" label={t("more.search")} value="" onPress={() => router.push("/search")} accentColor={accentColor} />
        <InfoRow icon="heart-outline" label={t("more.favorites")} value={String(favCount)} onPress={() => router.push("/favorites")} accentColor={accentColor} />
        <InfoRow icon="bookmark-outline" label="İzleme Listesi" value="" onPress={() => router.push("/favorites?tab=watchlist")} accentColor={accentColor} />
        <InfoRow icon="folder-outline" label="Koleksiyonlar" value={String(collectionsCount)} onPress={() => router.push("/collections")} accentColor={accentColor} />
        <InfoRow icon="time-outline" label={t("more.history")} value={String(histCount)} onPress={() => router.push("/favorites?tab=history")} accentColor={accentColor} />
        <InfoRow icon="cloud-download-outline" label={t("more.downloads")} value={String(downloadsCount)} onPress={() => router.push("/downloads")} accentColor={accentColor} />
        <InfoRow icon="calendar-outline" label={t("more.epg")} value="" onPress={() => router.push("/epg")} accentColor={accentColor} />
        <InfoRow icon="grid-outline" label="Çoklu Ekran" value="" onPress={() => router.push("/multiview")} accentColor={accentColor} />
      </Group>
      <Group title="Profiller">
        <InfoRow icon="people-outline" label="Profilleri Yönet" value={activeProfile?.name || ""} onPress={() => router.push("/profiles")} accentColor={accentColor} />
      </Group>
    </>
  );

  const accountSection = (
    <>
      <Group title={t("settings.group.playlist")}>
        <InfoRow icon="list-outline" label={t("settings.playlist.name")} value={config?.name || "—"} accentColor={accentColor} />
        <InfoRow icon="pricetag-outline" label={t("settings.playlist.type")} value={config?.type?.toUpperCase() || "—"} accentColor={accentColor} />
        <InfoRow icon="tv-outline" label={t("settings.playlist.channels")} value={String(playlist?.channels.length || 0)} accentColor={accentColor} />
        <InfoRow icon="film-outline" label={t("settings.playlist.movies")} value={String(playlist?.movies.length || 0)} accentColor={accentColor} />
        <InfoRow icon="albums-outline" label={t("settings.playlist.series")} value={String(playlist?.series.length || 0)} accentColor={accentColor} />
        <InfoRow
          icon="refresh"
          label={t("more.refresh")}
          value=""
          onPress={() => { if (config) useIPTV.getState().loadPlaylist(config); }}
          accentColor={accentColor}
        />
        <InfoRow icon="cloud-download-outline" label={t("more.refresh_epg")} value={epgLoading ? "…" : ""} onPress={() => loadEPG()} accentColor={accentColor} />
      </Group>
      <Group title="Hesap">
        <InfoRow icon="person-circle-outline" label="Hesap" value={currentEmail || "Hesapsız"} accentColor={accentColor} />
        <View style={{ gap: spacing.sm }}>
          <SettingsButton
            label="Kaynağı Değiştir / Yeni Kaynak Ekle"
            onPress={() => router.push({ pathname: "/login", params: { step: "type" } })}
          />
          <SettingsButton
            label="Çıkış Yap / Listeyi Sil"
            danger
            onPress={async () => {
              await clearPlaylist();
              await accountLogout();
              router.replace("/login");
            }}
          />
        </View>
      </Group>
    </>
  );

  // Nuvio keeps its content-rating toggle ("Show Parental Guide") inside Playback, under
  // General - matched here by keeping hide-adult/app-lock alongside playback, not off in
  // their own "Advanced" bucket.
  const generalSection = (
    <>
      <Group title={t("settings.group.appearance")}>
        <View>
          <Text style={[styles.groupTitle, { marginTop: spacing.md }]}>{t("settings.accent")}</Text>
          <View style={styles.group}>
            {[
              { id: "#E50914", label: "Kırmızı" },
              { id: "#1DB954", label: "Yeşil" },
              { id: "#0A84FF", label: "Mavi" },
              { id: "#FFD60A", label: "Altın" },
              { id: "#B026FF", label: "Mor" },
              { id: "#FF9F0A", label: "Turuncu" },
              { id: "#FF375F", label: "Pembe" },
              { id: "#30D5C8", label: "Turkuaz" },
              { id: "#5E5CE6", label: "Çivit" },
              { id: "#A4133C", label: "Bordo" },
              { id: "#A3E635", label: "Limon" }
            ].map((c, idx, arr) => (
              <AccentColorRow key={c.id} c={c} idx={idx} arr={arr} accentColor={accentColor} setAccentColor={setAccentColor} />
            ))}
          </View>
        </View>
      </Group>

      <Group title={t("settings.group.playback")}>
        <ToggleRow icon="play-circle-outline" label={t("settings.autoplay")} value={autoplay} onValueChange={setAutoplay} testID="set-autoplay" accentColor={accentColor} />
        <ToggleRow icon="play-skip-forward-outline" label={t("settings.resume")} value={resume} onValueChange={setResume} testID="set-resume" accentColor={accentColor} />
        {!IS_WEB && (
          <ToggleRow icon="hardware-chip-outline" label={t("settings.hw")} value={hwAccel} onValueChange={setHwAccel} testID="set-hw" accentColor={accentColor} />
        )}
        <ToggleRow icon="eye-off-outline" label={t("settings.hide_adult")} value={hideAdult} onValueChange={setHideAdult} testID="set-hide-adult" accentColor={accentColor} />
      </Group>

      <Group title={t("settings.group.security")}>
        <ToggleRow
          icon="lock-closed-outline"
          label={t("settings.app_lock")}
          value={appLock.enabled && appLock.hasPin}
          onValueChange={async (v: boolean) => {
            if (v) { setShowPinSetup(true); }
            else { await appLock.setEnabled(false); await appLock.clearPin(); }
          }}
          testID="set-app-lock"
          accentColor={accentColor}
        />
        {!IS_WEB && (
          <ToggleRow
            icon="finger-print-outline"
            label={t("settings.biometric")}
            value={appLock.biometricEnabled}
            onValueChange={(v: boolean) => appLock.setBiometricEnabled(v)}
            testID="set-biometric"
            accentColor={accentColor}
          />
        )}
        <InfoRow icon="shield-checkmark-outline" label={t("settings.secure_storage")} value={t("settings.enabled")} />
      </Group>
      {pinSetupCard}

      <Group title="TMDB (Zengin Meta Veriler)">
        <InputRow label="API Anahtarı (İsteğe Bağlı)" value={tmdbApiKey} onChangeText={setTmdbApiKey} placeholder="TMDB API Key girin..." />
      </Group>

      <Group title={t("settings.group.language")}>
        {(Object.keys(LOCALE_INFO) as Locale[]).map((code, idx, arr) => {
          const info = LOCALE_INFO[code];
          return (
            <LocaleRow key={code} code={code} info={info} locale={locale} setLocale={setLocale} accentColor={accentColor} idx={idx} arr={arr} />
          );
        })}
      </Group>
    </>
  );

  // Technical/tuning knobs, matching Nuvio's Advanced category (startup/diagnostics/cache -
  // low-frequency, power-user settings rather than everyday toggles).
  const advancedSection = (
    <>
    <BackupGroup accentColor={accentColor} />
    <Group title="Performans">
      <InfoRow
        icon="speedometer-outline"
        label={t("settings.buffer_size")}
        value={t(`settings.buffer.${bufferSize}`)}
        accentColor={accentColor}
        onPress={() => {
          const next = bufferSize === "small" ? "normal" : bufferSize === "normal" ? "large" : "small";
          setBufferSize(next);
        }}
      />
      <InfoRow
        icon="time-outline"
        label={t("settings.epg_shift")}
        value={`${epgShift > 0 ? "+" : ""}${epgShift} Saat`}
        accentColor={accentColor}
        onPress={() => {
          let next = epgShift + 1;
          if (next > 12) next = -12;
          setEpgShift(next);
        }}
      />
    </Group>
    </>
  );

  const aboutSection = (
    <Group title={t("settings.group.about")}>
      <InfoRow icon="apps-outline" label={t("settings.about.app")} value="Lumio IPTV" accentColor={accentColor} />
      <InfoRow icon="pricetags-outline" label={t("settings.about.version")} value={currentVersion()} accentColor={accentColor} />
      {UPDATES_SUPPORTED && <UpdateRow accentColor={accentColor} />}
    </Group>
  );

  const sectionsByCategory: Record<Category, React.ReactNode> = {
    account: accountSection,
    library: librarySection,
    general: generalSection,
    advanced: advancedSection,
    about: aboutSection,
  };

  if (isDesktop) {
    return (
      <View style={styles.root}>
        <View style={styles.desktopRoot}>
          <View style={styles.desktopNav}>
            {!embedded && (
              <Pressable onPress={() => router.back()} style={styles.desktopBackRow} testID="settings-back" hitSlop={8}>
                <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
                <Text style={styles.desktopBackText}>Geri</Text>
              </Pressable>
            )}
            <Text style={styles.desktopNavTitle}>{t("settings.title")}</Text>
            {/* Nuvio shows the active profile at the top of settings. */}
            <Pressable
              onPress={() => router.push("/profiles")}
              style={({ hovered }: any) => [styles.desktopProfileRow, hovered && { backgroundColor: "rgba(255,255,255,0.06)" }]}
              testID="settings-profile"
            >
              <ProfileAvatar avatar={activeProfile?.avatar} color={activeProfile?.color} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.desktopProfileName} numberOfLines={1}>{activeProfile?.name || "Profil"}</Text>
                <Text style={styles.desktopProfileMeta} numberOfLines={1}>{currentEmail || "Hesapsız"}</Text>
              </View>
              <Ionicons name="swap-horizontal" size={18} color={colors.textMuted} />
            </Pressable>
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategory(c.id)}
                  style={({ hovered }: any) => [
                    styles.desktopNavItem,
                    active && { backgroundColor: "rgba(255,255,255,0.1)" },
                    hovered && !active && { backgroundColor: "rgba(255,255,255,0.05)" },
                  ]}
                  testID={`settings-category-${c.id}`}
                >
                  <Ionicons name={c.icon} size={20} color={active ? "#fff" : colors.textMuted} />
                  <Text style={[styles.desktopNavLabel, active && { color: "#fff", fontWeight: "700" }]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, maxWidth: 720 }}>
            <Text style={styles.desktopContentTitle}>{CATEGORIES.find((c) => c.id === category)?.label}</Text>
            {sectionsByCategory[category]}
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.header}>
        <BackButton router={router} />
        <Text style={styles.title}>{t("settings.title")}</Text>
        <View style={{ width: 26 }} />
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 }}>
        {accountSection}
        {generalSection}
        {aboutSection}
        {advancedSection}
      </ScrollView>
    </View>
  );
}

function UpdateRow({ accentColor }: { accentColor: string }) {
  const status = useUpdates((s) => s.status);
  const manifest = useUpdates((s) => s.manifest);
  const progress = useUpdates((s) => s.progress);
  const error = useUpdates((s) => s.error);
  const check = useUpdates((s) => s.check);
  const download = useUpdates((s) => s.download);
  const value =
    status === "checking" ? "Denetleniyor…" :
    status === "uptodate" ? "Güncel ✓" :
    status === "available" ? `${manifest?.version} mevcut — kur` :
    status === "downloading" ? `İndiriliyor %${Math.round(progress * 100)}` :
    status === "ready" ? "Kuruluyor…" :
    status === "error" ? "Hata — tekrar dene" : "";
  return (
    <>
      <InfoRow
        icon="cloud-download-outline"
        label="Güncellemeleri denetle"
        value={value}
        accentColor={accentColor}
        onPress={() => (status === "available" || (status === "error" && manifest && progress > 0) ? download() : check(true))}
      />
      {status === "error" && !!error && <Text style={styles.note}>{error}</Text>}
    </>
  );
}

// Export/import of profiles, favourites, history, collections, settings and the
// playlist source, as one JSON file the user keeps or moves to another device.
function BackupGroup({ accentColor }: { accentColor: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = React.useState<BackupFile | null>(null);
  // A picked backup that is password protected and still needs its password.
  const [locked, setLocked] = React.useState<EncryptedBackupFile | null>(null);
  const [exportPassword, setExportPassword] = React.useState("");
  const [importPassword, setImportPassword] = React.useState("");

  const doExport = async () => {
    if (busy) return;
    if (exportPassword && exportPassword.length < 6) {
      setMessage({ text: "Yedek parolası en az 6 karakter olmalı.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const backup = await createBackup();
      const where = await saveBackupFile(exportPassword ? await encryptBackup(backup, exportPassword) : backup);
      if (where) {
        setMessage({ text: `Yedek kaydedildi${exportPassword ? " (parolalı)" : ""}: ${where}` });
        setExportPassword("");
      }
    } catch (e: any) {
      setMessage({ text: `Yedek alınamadı: ${errorText(e)}`, error: true });
    } finally {
      setBusy(false);
    }
  };

  const doPick = async () => {
    if (busy) return;
    setMessage(null);
    setLocked(null);
    try {
      const text = await pickBackupFile();
      if (text == null) return;
      const parsed = parseBackup(text);
      if (parsed.kind === "encrypted") setLocked(parsed.file);
      else setPending(parsed.backup);
    } catch (e: any) {
      setMessage({ text: errorText(e), error: true });
    }
  };

  const doUnlock = async () => {
    if (!locked || busy) return;
    setBusy(true);
    setMessage(null);
    // Let the "…" render before the (synchronous, CPU-heavy) key derivation starts.
    await new Promise((r) => setTimeout(r, 30));
    try {
      setPending(decryptBackup(locked, importPassword));
      setLocked(null);
      setImportPassword("");
    } catch (e: any) {
      setMessage({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await restoreBackup(pending);
      setPending(null);
      router.replace("/");
    } catch (e: any) {
      setMessage({ text: `Geri yüklenemedi: ${errorText(e)}`, error: true });
    } finally {
      setBusy(false);
    }
  };

  let profileCount = 0;
  try { profileCount = JSON.parse(pending?.data["iptv.profiles.v1"] || "[]").length; } catch {}

  return (
    <View style={{ gap: spacing.sm }}>
      <Group title="Yedekleme">
        <PasswordRow
          label="Yedek parolası (isteğe bağlı)"
          value={exportPassword}
          onChangeText={setExportPassword}
          placeholder="Boş bırakılırsa yedek şifrelenmez"
        />
        <InfoRow icon="save-outline" label="Ayarları yedekle" value={busy && !pending && !locked ? "…" : ""} onPress={doExport} accentColor={accentColor} />
        <InfoRow icon="refresh-circle-outline" label="Yedekten geri yükle" value="" onPress={doPick} accentColor={accentColor} />
      </Group>
      <Text style={styles.note}>
        Profiller, favoriler, izleme geçmişi, koleksiyonlar, ayarlar ve playlist bilgisi tek bir dosyaya kaydedilir. Dosya IPTV hesap bilgilerini (kullanıcı adı/şifre) içerir: bir parola belirlersen dosya şifrelenir. Parolayı unutursan yedek açılamaz.
      </Text>
      {message && <Text style={[styles.note, { color: message.error ? colors.error : colors.success }]}>{message.text}</Text>}
      {locked && (
        <View style={styles.confirmCard}>
          <Text style={{ color: colors.onSurface, fontSize: font.lg, fontWeight: "700" }}>Bu yedek parolalı</Text>
          <Text style={{ color: colors.textMuted, fontSize: font.sm }}>
            {new Date(locked.createdAt).toLocaleString("tr-TR")} tarihli yedek. Açmak için parolasını gir.
          </Text>
          <PasswordRow label="Parola" value={importPassword} onChangeText={setImportPassword} placeholder="Yedek parolası" />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><SettingsButton label="İptal" onPress={() => { setLocked(null); setImportPassword(""); }} /></View>
            <View style={{ flex: 1 }}><SettingsButton label={busy ? "Açılıyor…" : "Aç"} onPress={doUnlock} /></View>
          </View>
        </View>
      )}
      {pending && (
        <View style={styles.confirmCard}>
          <Text style={{ color: colors.onSurface, fontSize: font.lg, fontWeight: "700" }}>Yedek geri yüklensin mi?</Text>
          <Text style={{ color: colors.textMuted, fontSize: font.sm }}>
            {new Date(pending.createdAt).toLocaleString("tr-TR")} tarihli yedek · {profileCount} profil · sürüm {pending.appVersion}.{"\n"}
            Bu cihazdaki ayarlar yedektekilerle değiştirilecek.
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><SettingsButton label="İptal" onPress={() => setPending(null)} /></View>
            <View style={{ flex: 1 }}><SettingsButton label={busy ? "Geri yükleniyor…" : "Geri yükle"} onPress={doRestore} /></View>
          </View>
        </View>
      )}
    </View>
  );
}

function PasswordRow({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View style={[styles.row, { flexDirection: "column", alignItems: "stretch", paddingVertical: spacing.md }]}>
      <Text style={[styles.rowLabel, { marginBottom: spacing.sm }]}>{label}</Text>
      <TextInput
        style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", padding: spacing.md, borderRadius: radius.sm }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Group({ title, children }: any) {
  return (
    <View>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}
// Icon in a small accent-tinted chip to the left of the label, matching Nuvio's
// SettingsNavigationRow/SettingsSwitchRow.
function RowIcon({ icon, accentColor, focused }: { icon?: keyof typeof Ionicons.glyphMap; accentColor?: string; focused?: boolean }) {
  if (!icon) return null;
  return (
    <View style={[styles.rowIconChip, { backgroundColor: focused ? "rgba(255,255,255,0.2)" : `${accentColor || colors.brandPrimary}22` }]}>
      <Ionicons name={icon} size={18} color={focused ? "#fff" : accentColor || colors.brandPrimary} />
    </View>
  );
}

function InfoRow({ label, value, icon, accentColor, onPress }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap; accentColor?: string, onPress?: () => void }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, focused && { backgroundColor: accentColor }]}
      focusable={true}
    >
      <RowIcon icon={icon} accentColor={accentColor} focused={focused} />
      <Text style={[styles.rowLabel, focused && { color: "#FFF", fontWeight: "700" }]}>{label}</Text>
      <Text style={[styles.rowValue, focused && { color: "rgba(255,255,255,0.8)" }]} numberOfLines={1}>{value}</Text>
    </Pressable>
  );
}
function ToggleRow({ label, value, onValueChange, icon, testID, accentColor = colors.brandPrimary }: any) {
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, focused && { backgroundColor: accentColor }]}
      onPress={() => onValueChange(!value)}
      focusable={true}
    >
      <RowIcon icon={icon} accentColor={accentColor} focused={focused} />
      <Text style={[styles.rowLabel, focused && { color: "#FFF", fontWeight: "700" }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: accentColor, false: "rgba(255,255,255,0.3)" }}
        thumbColor={"#ffffff"}
        // @ts-ignore activeThumbColor is a react-native-web specific prop that fixes the teal default
        activeThumbColor={"#ffffff"}
        testID={testID}
      />
    </Pressable>
  );
}

function InputRow({ label, value, onChangeText, placeholder }: any) {
  return (
    <View style={[styles.row, { flexDirection: "column", alignItems: "stretch", paddingVertical: spacing.md }]}>
      <Text style={[styles.rowLabel, { marginBottom: spacing.sm }]}>{label}</Text>
      <TextInput
        style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", padding: spacing.md, borderRadius: radius.sm }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  groupTitle: { color: colors.textMuted, fontSize: font.sm, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: spacing.sm, marginLeft: spacing.xs },
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  rowLabel: { color: colors.onSurface, fontSize: font.base, fontWeight: "500", flex: 1 },
  rowValue: { color: colors.textMuted, fontSize: font.base, fontWeight: "500", maxWidth: 180 },
  note: { color: colors.textMuted, fontSize: font.sm, lineHeight: 18, marginHorizontal: spacing.xs },
  confirmCard: { padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, gap: spacing.md },
  rowIconChip: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  // Nuvio's settings screen: a left category rail (title + icon rows) and a scrollable
  // content pane on the right showing only the selected category's groups.
  desktopRoot: { flex: 1, flexDirection: "row" },
  desktopNav: { width: 260, backgroundColor: "#050505", borderRightWidth: 1, borderRightColor: "#1A1A1A", padding: spacing.lg, gap: 4 },
  desktopBackRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: spacing.lg, alignSelf: "flex-start" },
  desktopBackText: { color: colors.textMuted, fontSize: font.sm, fontWeight: "600" },
  desktopNavTitle: { color: "#fff", fontSize: font.xxl, fontWeight: "800", marginBottom: spacing.lg },
  desktopProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    marginBottom: spacing.lg,
  },
  desktopProfileName: { color: "#fff", fontSize: font.base, fontWeight: "700" },
  desktopProfileMeta: { color: colors.textMuted, fontSize: font.sm, marginTop: 1 },
  desktopNavItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.md },
  desktopNavLabel: { color: colors.textMuted, fontSize: font.base, fontWeight: "600" },
  desktopContentTitle: { color: "#fff", fontSize: font.xxl, fontWeight: "800", marginBottom: spacing.sm },
});
