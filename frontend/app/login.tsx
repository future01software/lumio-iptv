import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  Keyboard,
  BackHandler,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

import { useIPTV } from "@/src/store/iptv-store";
import { useAccount } from "@/src/store/account-store";
import { useI18n } from "@/src/store/i18n-store";
import { useTheme } from "@/src/store/theme-store";
import { useResponsive } from "@/src/hooks/use-responsive";
import { colors, spacing, radius, font, DEMO_PLAYLIST } from "@/src/theme/tokens";

type Mode = "xtream" | "m3u";
type Step = "welcome" | "signup" | "type" | "name" | "url" | "creds";
const VALID_STEPS: Step[] = ["welcome", "signup", "type", "name", "url", "creds"];

export default function Login() {
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string }>();
  const loadPlaylist = useIPTV((s) => s.loadPlaylist);
  const loading = useIPTV((s) => s.loading);
  const error = useIPTV((s) => s.error);
  const savedAccounts = useIPTV((s) => s.savedAccounts);
  const addSavedAccount = useIPTV((s) => s.addSavedAccount);
  const removeSavedAccount = useIPTV((s) => s.removeSavedAccount);
  const { t } = useI18n();
  const { accentColor } = useTheme();
  const { isDesktop, isTV } = useResponsive();
  // TVs get the desktop split layout: natively the window is a 1280x720dp canvas on
  // every TV (see android/.../TvScale.kt), which the desktop layout was designed for.
  const split = isDesktop || isTV;

  // Settings' "Kaynağı Değiştir" and the post-profile-pick redirect from /profiles both
  // deep-link straight into the add-a-source wizard via ?step=type, skipping the
  // welcome/signup screens that don't apply once a profile is already active.
  const initialStep = VALID_STEPS.includes(params.step as Step) ? (params.step as Step) : "welcome";
  const [step, setStep] = useState<Step>(initialStep);
  // Arrived via ?step=type (Settings' "Kaynağı Değiştir" or Home's empty-state "Kaynak Ekle")
  // rather than through the welcome screen - "back" from the type step should return to
  // wherever that link came from, not loop into onboarding.
  const isDeepLink = initialStep !== "welcome";
  const [mode, setMode] = useState<Mode>("m3u");
  const [name, setName] = useState("Listem");
  const [m3uUrl, setM3uUrl] = useState("");
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPassword2, setSignupPassword2] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const accountLogin = useAccount((s) => s.login);
  const accountSignup = useAccount((s) => s.signup);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signupError, setSignupError] = useState<string | null>(null);

  useEffect(() => {
    const backAction = () => {
      if (step === "signup") { setStep("welcome"); return true; }
      if (step === "type") {
        if (isDeepLink) return false; // let the OS/router handle it (goes back to Settings/Home)
        setStep("welcome");
        return true;
      }
      if (step === "name") { setStep("type"); return true; }
      if (step === "url") { setStep("name"); return true; }
      if (step === "creds") { setStep("url"); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
    return () => backHandler.remove();
  }, [step]);

  // Accounts are local to this device (no cloud backend), but the password is really
  // verified against a salted hash - see src/store/account-store.ts. On success we go
  // on to pick/create a profile, then into the add-a-source wizard if needed.
  async function submitLogin() {
    if (authBusy) return;
    setAuthBusy(true);
    const res = await accountLogin(loginEmail, loginPassword);
    setAuthBusy(false);
    if (!res.ok) {
      setLoginError(res.error);
      if (res.field === "password") setLoginPassword("");
      return;
    }
    setLoginError(null);
    setLoginPassword("");
    router.push("/profiles");
  }

  async function submitSignup() {
    if (authBusy) return;
    if (signupPassword !== signupPassword2) {
      setSignupError("Şifreler eşleşmiyor");
      return;
    }
    setAuthBusy(true);
    const res = await accountSignup(signupEmail, signupPassword);
    setAuthBusy(false);
    if (!res.ok) {
      setSignupError(res.error);
      return;
    }
    setSignupError(null);
    setSignupPassword("");
    setSignupPassword2("");
    router.push("/profiles");
  }

  async function tryDemo() {
    const ok = await loadPlaylist({
      name: DEMO_PLAYLIST.name,
      type: "m3u",
      m3u_url: DEMO_PLAYLIST.m3u_url,
      epg_url: DEMO_PLAYLIST.epg_url,
    });
    if (ok) router.replace("/(tabs)");
  }

  async function submit() {
    const cfg =
      mode === "m3u"
        ? { name: name || "M3U Playlist", type: "m3u" as const, m3u_url: m3uUrl }
        : {
            name: name || "Xtream Playlist",
            type: "xtream" as const,
            server,
            username,
            password,
          };
    const ok = await loadPlaylist(cfg);
    if (ok) {
      // Başarılı girişte hesabı otomatik kaydet
      await addSavedAccount(cfg);
      router.replace("/(tabs)");
    }
  }

  async function quickLogin(cfg: any) {
    const ok = await loadPlaylist(cfg);
    if (ok) router.replace("/(tabs)");
  }

  async function pickM3uFile() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["audio/mpegurl", "audio/x-mpegurl", "application/x-mpegurl", "*/*"],
      });
      if (!res.canceled && res.assets.length > 0) {
        const file = res.assets[0];
        let content = "";
        if (Platform.OS === "web") {
          content = await file.file!.text();
        } else {
          content = await FileSystem.readAsStringAsync(file.uri, { encoding: "utf8" });
        }
        
        const cfg = { 
          name: name || file.name.replace(/\.m3u8?$/i, ""), 
          type: "m3u" as const, 
          m3u_content: content,
          m3u_url: "local_file" 
        };
        const ok = await loadPlaylist(cfg);
        if (ok) {
          // Yerel dosyayı devasa boyutu nedeniyle kayıtlı hesaplara eklemiyoruz
          router.replace("/(tabs)");
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  function nextStep() {
    if (step === "type") setStep("name");
    else if (step === "name") setStep("url");
    else if (step === "url") {
      if (mode === "m3u") submit();
      else setStep("creds");
    } else if (step === "creds") {
      submit();
    }
  }

  function renderStepType() {
    // Desktop already scrolls via the outer split-screen ScrollView - nesting another
    // one here fights its `justifyContent: "center"` and pins content to the top.
    const Wrapper = split ? View : ScrollView;
    const wrapperProps = split ? {} : { showsVerticalScrollIndicator: false };
    return (
      <Wrapper style={{ width: "100%" }} {...wrapperProps}>
        {/* KAYITLI HESAPLAR */}
        {savedAccounts.length > 0 && (
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={styles.stepTitle}>Kayıtlı Hesaplar</Text>
            <Text style={[styles.stepSubtitle, { marginBottom: spacing.sm }]}>Hızlı giriş için bir hesap seçin.</Text>
            {savedAccounts.map((acc, i) => (
              <View key={i} style={savedStyles.row}>
                <TVPressable
                  style={[savedStyles.btn, { flex: 1 }]}
                  onPress={() => quickLogin(acc)}
                >
                  <Ionicons
                    name={acc.type === "xtream" ? "server" : "list"}
                    size={20}
                    color={accentColor}
                    style={{ marginRight: 10 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={savedStyles.name} numberOfLines={1}>{acc.name}</Text>
                    <Text style={savedStyles.sub} numberOfLines={1}>
                      {acc.type === "xtream" ? `${acc.server} • ${acc.username}` : acc.m3u_url}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TVPressable>
                <TVPressable
                  style={savedStyles.deleteBtn}
                  onPress={() => removeSavedAccount(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                </TVPressable>
              </View>
            ))}
            <View style={savedStyles.divider} />
          </View>
        )}

        <Text style={styles.stepTitle}>Yeni Kaynak Ekle</Text>
        <Text style={styles.stepSubtitle}>Eklemek istediğiniz IPTV bağlantı türünü seçin.</Text>
        <TVPressable
          style={styles.typeBtn}
          focusStyle={styles.typeBtnFocused}
          onPress={() => { setMode("m3u"); setStep("name"); }}
          hasTVPreferredFocus={Platform.isTV && (savedAccounts.length === 0)}
        >
          <Ionicons name="list" size={24} color="#FFF" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.typeBtnTitle}>M3U Çalma Listesi</Text>
            <Text style={styles.typeBtnDesc}>Standart M3U veya M3U8 URL'si ile ekle</Text>
          </View>
        </TVPressable>
        <TVPressable
          style={styles.typeBtn}
          focusStyle={styles.typeBtnFocused}
          onPress={() => { setMode("xtream"); setStep("name"); }}
        >
          <Ionicons name="server" size={24} color="#FFF" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.typeBtnTitle}>Xtream Codes API</Text>
            <Text style={styles.typeBtnDesc}>Sunucu URL, Kullanıcı Adı ve Şifre ile ekle</Text>
          </View>
        </TVPressable>
        <TVPressable
          style={[styles.btnGhost, { marginTop: spacing.md }]}
          onPress={() => (isDeepLink ? router.back() : setStep("welcome"))}
        >
          <Text style={styles.btnGhostText}>Geri</Text>
        </TVPressable>
      </Wrapper>
    );
  }

  function renderStepWelcome() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Tekrar hoş geldin</Text>
        <Text style={styles.stepSubtitle}>Kitaplığına ve ilerlemene ulaşmak için giriş yap.</Text>
        <Input icon="mail-outline" label="E-posta" value={loginEmail} onChangeText={(v: string) => { setLoginEmail(v); setLoginError(null); }} placeholder="ornek@eposta.com" autoCapitalize="none" keyboardType="email-address" />
        <Input icon="lock-closed-outline" label="Şifre" value={loginPassword} onChangeText={(v: string) => { setLoginPassword(v); setLoginError(null); }} secureTextEntry onSubmitEditing={submitLogin} />
        {loginError && <Text style={styles.error}>{loginError}</Text>}
        <TVPressable
          style={[styles.btnPrimaryWhite, authBusy && { opacity: 0.6 }]}
          onPress={submitLogin}
          disabled={authBusy}
          hasTVPreferredFocus={Platform.isTV}
        >
          <Text style={styles.btnPrimaryWhiteText}>{authBusy ? "Kontrol ediliyor…" : "Giriş Yap"}</Text>
        </TVPressable>
        <TVPressable
          style={styles.signupRow}
          focusStyle={{ backgroundColor: "rgba(255,255,255,0.1)" }}
          onPress={() => setStep("signup")}
          testID="login-signup-link"
        >
          <Text style={styles.signupText}>
            Hesabın yok mu? <Text style={{ color: accentColor, fontWeight: "700" }}>Kayıt ol</Text>
          </Text>
        </TVPressable>

        <View style={styles.orDivider}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>veya</Text>
          <View style={styles.orLine} />
        </View>

        <TVPressable style={styles.btnGhost} onPress={() => router.push("/profiles")} testID="login-guest">
          <Text style={styles.btnGhostText}>Hesapsız Giriş</Text>
        </TVPressable>
        <TVPressable style={[styles.btnGhost, { marginTop: spacing.md }]} onPress={tryDemo} disabled={loading}>
          <Ionicons name="play-circle" size={20} color={colors.onSurface} />
          <Text style={styles.btnGhostText}>{t("login.try_demo")}</Text>
        </TVPressable>
      </View>
    );
  }

  // Creates a local account (see account-store). "Hesapsız Giriş" skips accounts entirely.
  function renderStepSignup() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Hesap Oluştur</Text>
        <Text style={styles.stepSubtitle}>Hesabın bu cihazda saklanır; şifren şifrelenmiş olarak tutulur.</Text>
        <Input icon="mail-outline" label="E-posta" value={signupEmail} onChangeText={(v: string) => { setSignupEmail(v); setSignupError(null); }} placeholder="ornek@eposta.com" autoCapitalize="none" keyboardType="email-address" />
        <Input icon="lock-closed-outline" label="Şifre (en az 6 karakter)" value={signupPassword} onChangeText={(v: string) => { setSignupPassword(v); setSignupError(null); }} secureTextEntry />
        <Input icon="lock-closed-outline" label="Şifre (tekrar)" value={signupPassword2} onChangeText={(v: string) => { setSignupPassword2(v); setSignupError(null); }} secureTextEntry onSubmitEditing={submitSignup} />
        {signupError && <Text style={styles.error}>{signupError}</Text>}
        <View style={styles.row}>
          <TVPressable style={styles.btnGhost} onPress={() => setStep("welcome")}>
            <Text style={styles.btnGhostText}>Geri</Text>
          </TVPressable>
          <TVPressable style={[styles.btnPrimaryWhite, { flex: 1 }, authBusy && { opacity: 0.6 }]} onPress={submitSignup} disabled={authBusy}>
            <Text style={styles.btnPrimaryWhiteText}>{authBusy ? "Oluşturuluyor…" : "Hesabı Oluştur"}</Text>
          </TVPressable>
        </View>
      </View>
    );
  }

  function renderStepName() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Listenizi İsimlendirin</Text>
        <Text style={styles.stepSubtitle}>Bu çalma listesi için hatırlatıcı bir isim girin.</Text>
        <Input 
          label={t("login.field.name")} 
          value={name} 
          onChangeText={setName} 
          autoFocus={true}
          onSubmitEditing={nextStep}
        />
        <View style={styles.row}>
          <TVPressable style={styles.btnGhost} onPress={() => setStep("type")}>
            <Text style={styles.btnGhostText}>Geri</Text>
          </TVPressable>
          <TVPressable style={[styles.btnPrimary, { backgroundColor: accentColor, flex: 1 }]} onPress={nextStep}>
            <Text style={styles.btnPrimaryText}>İleri</Text>
          </TVPressable>
        </View>
      </View>
    );
  }

  function renderStepUrl() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>{mode === "m3u" ? "M3U URL" : "Sunucu Adresi"}</Text>
        <Text style={styles.stepSubtitle}>{mode === "m3u" ? "M3U bağlantı adresini girin." : "Xtream sunucu adresini girin."}</Text>
        {mode === "m3u" ? (
          <Input
            label={t("login.field.m3u")}
            value={m3uUrl}
            onChangeText={setM3uUrl}
            placeholder="https://example.com/playlist.m3u"
            autoCapitalize="none"
            autoFocus={true}
            onSubmitEditing={nextStep}
          />
        ) : (
          <Input
            label={t("login.field.server")}
            value={server}
            onChangeText={setServer}
            placeholder="http://server.com:8080"
            autoCapitalize="none"
            autoFocus={true}
            onSubmitEditing={nextStep}
          />
        )}
        <View style={styles.row}>
          <TVPressable style={styles.btnGhost} onPress={() => setStep("name")}>
            <Text style={styles.btnGhostText}>Geri</Text>
          </TVPressable>
          <TVPressable style={[styles.btnPrimary, { backgroundColor: accentColor, flex: 1 }]} onPress={nextStep}>
            <Text style={styles.btnPrimaryText}>{mode === "m3u" ? t("login.connect") : "İleri"}</Text>
          </TVPressable>
        </View>
        {mode === "m3u" && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.textMuted, textAlign: "center", marginBottom: spacing.sm }}>VEYA</Text>
            <TVPressable style={[styles.btnGhost, { borderColor: accentColor, borderWidth: 1 }]} onPress={pickM3uFile}>
              <Ionicons name="document-text-outline" size={20} color={accentColor} />
              <Text style={[styles.btnGhostText, { color: accentColor }]}>Cihazdan .m3u Dosyası Seç</Text>
            </TVPressable>
          </View>
        )}
      </View>
    );
  }

  function renderStepCreds() {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Hesap Bilgileri</Text>
        <Text style={styles.stepSubtitle}>Xtream kullanıcı adı ve şifrenizi girin.</Text>
        <Input
          label={t("login.field.username")}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoFocus={true}
        />
        <Input
          label={t("login.field.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          onSubmitEditing={nextStep}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <TVPressable style={styles.btnGhost} onPress={() => setStep("url")}>
            <Text style={styles.btnGhostText}>Geri</Text>
          </TVPressable>
          <TVPressable style={[styles.btnPrimary, { backgroundColor: accentColor, flex: 1 }]} onPress={nextStep}>
            <Text style={styles.btnPrimaryText}>{t("login.connect")}</Text>
          </TVPressable>
        </View>
      </View>
    );
  }

  function renderStep() {
    return (
      <>
        {step === "welcome" && renderStepWelcome()}
        {step === "signup" && renderStepSignup()}
        {step === "type" && renderStepType()}
        {step === "name" && renderStepName()}
        {step === "url" && renderStepUrl()}
        {step === "creds" && renderStepCreds()}
      </>
    );
  }

  if (split) {
    return (
      <View style={styles.root}>
        {/* Diagonal accent-to-black wash across the whole window, matching Nuvio's auth
            screen background (their exact stops are a fixed violet; this derives the same
            shape from the user's chosen accent color so it stays re-skinnable). */}
        <LinearGradient
          colors={[accentColor + "59", accentColor + "26", "rgba(0,0,0,0.4)", "#000000"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.desktopRoot}>
          <View style={styles.desktopLeft}>
            <View style={styles.desktopBrandRow}>
              <Image source={require("@/assets/images/icon.png")} style={styles.desktopLogo} contentFit="contain" />
              <Text style={styles.title}>
                <Text style={{ color: accentColor }}>lumi</Text>
                <Text style={{ color: "#FFF" }}>o</Text>
              </Text>
            </View>
            <Text style={styles.desktopHeadline}>Playlistini bağla,{"\n"}izlemeye başla</Text>
            <Text style={styles.desktopSub}>Kanallarına, filmlerine ve dizilerine tek bir yerden ulaş.</Text>
          </View>

          <View style={styles.desktopRight}>
            <View style={styles.desktopFormPane}>
              <ScrollView contentContainerStyle={styles.desktopRightContent} showsVerticalScrollIndicator={false}>
                {renderStep()}
                {error && step !== "creds" && <Text style={styles.error}>{error}</Text>}
                {(step === "welcome" || step === "signup") && (
                  <Text style={styles.localOnlyNote}>Verilerin sadece bu cihazda saklanacak</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size={64} color={accentColor} />
            <Text style={styles.loadingText}>Bağlanıyor, kanallar yükleniyor...</Text>
            <Text style={styles.loadingSubtext}>Bu işlem listenizin boyutuna göre biraz zaman alabilir.</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={["rgba(20,20,20,1)", "rgba(10,10,10,1)", "#000"]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: "center", padding: spacing.xl }} behavior={Platform.OS === "ios" ? "padding" : undefined}>

          <View style={styles.header}>
            <Text style={styles.title}>
              <Text style={{ color: accentColor }}>lumi</Text>
              <Text style={{ color: "#FFF" }}>o</Text>
            </Text>
          </View>

          <BlurView intensity={40} tint="dark" style={styles.card}>
            {renderStep()}
          </BlurView>

        </KeyboardAvoidingView>
      </SafeAreaView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size={64} color={accentColor} />
          <Text style={styles.loadingText}>Bağlanıyor, kanallar yükleniyor...</Text>
          <Text style={styles.loadingSubtext}>Bu işlem listenizin boyutuna göre biraz zaman alabilir.</Text>
        </View>
      )}
    </View>
  );
}

function Input({ icon, label, ...props }: any) {
  const [focused, setFocused] = useState(false);
  const { accentColor } = useTheme();
  return (
    <View style={inputStyles.wrap}>
      <Text style={inputStyles.label}>{label}</Text>
      <View style={[inputStyles.fieldRow, focused && { borderColor: accentColor, backgroundColor: "rgba(255,255,255,0.1)" }]}>
        {icon && <Ionicons name={icon} size={19} color={colors.textMuted} style={inputStyles.fieldIcon} />}
        <TextInput
          {...props}
          onSubmitEditing={(e) => {
            Keyboard.dismiss();
            if (props.onSubmitEditing) props.onSubmitEditing(e);
          }}
          onFocus={(e) => {
            setFocused(true);
            if (props.onFocus) props.onFocus(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            if (props.onBlur) props.onBlur(e);
          }}
          style={inputStyles.input}
          placeholderTextColor={colors.textMuted}
        />
      </View>
    </View>
  );
}

// Focus ring follows the theme's accent color, except on accent-filled buttons where an
// accent ring would be invisible - those get a white one. `focusStyle` adds per-button
// extras (e.g. a background).
function TVPressable({ style, focusStyle, children, ...props }: any) {
  const [focused, setFocused] = useState(false);
  const { accentColor } = useTheme();
  const ring = StyleSheet.flatten(style)?.backgroundColor === accentColor ? "#fff" : accentColor;
  return (
    <Pressable
      {...props}
      focusable={true}
      onFocus={(e) => { setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur && props.onBlur(e); }}
      style={[
        style, 
        focused && { borderColor: ring, borderWidth: 2 },
        focused && focusStyle,
      ]}
    >
      {children}
    </Pressable>
  );
}

const inputStyles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { color: colors.textMuted, fontSize: font.sm, marginBottom: 6 },
  // Matches Nuvio's auth field metrics: 56dp height, 14dp radius, White@4%/8% bg/border.
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
  },
  fieldIcon: { marginRight: spacing.sm },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontSize: font.lg,
    height: "100%",
  },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { alignItems: "center", marginBottom: spacing.xxl },
  title: { color: colors.onSurface, fontSize: 48, fontWeight: "800", letterSpacing: -1 },
  desktopRoot: { flex: 1, flexDirection: "row" },
  desktopLeft: {
    flex: 4, justifyContent: "center", paddingHorizontal: 80,
  },
  desktopBrandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xxl },
  desktopLogo: { width: 40, height: 40 },
  desktopHeadline: { color: "#fff", fontSize: 40, fontWeight: "800", lineHeight: 46, letterSpacing: -0.5, marginBottom: spacing.md },
  desktopSub: { color: "rgba(255,255,255,0.55)", fontSize: font.lg, maxWidth: 420 },
  desktopRight: { flex: 5, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  // Nuvio's form pane: a subtle glass panel floating over the same diagonal gradient as the
  // rest of the window, not a flat differently-colored column.
  desktopFormPane: {
    width: "100%", maxWidth: 520, borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.022)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 48, paddingVertical: 56,
  },
  desktopRightContent: { justifyContent: "center", width: "100%" },
  localOnlyNote: { color: colors.textMuted, fontSize: font.sm, textAlign: "center", marginTop: spacing.lg },
  // Padded pill with a transparent border so the TV focus ring (set in the Pressable)
  // has room to show without shifting the layout.
  signupRow: {
    marginTop: spacing.lg, alignSelf: "center", alignItems: "center",
    paddingVertical: 6, paddingHorizontal: 16, borderRadius: radius.pill,
    borderWidth: 2, borderColor: "transparent",
  },
  signupText: { color: colors.textMuted, fontSize: font.base },
  orDivider: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.lg },
  orLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  orText: { color: colors.textMuted, fontSize: font.sm },
  card: {
    borderRadius: radius.lg, padding: spacing.xl, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(20,20,20,0.6)",
  },
  stepContainer: { width: "100%" },
  stepTitle: { color: "#FFF", fontSize: font.xl, fontWeight: "700", marginBottom: 4 },
  stepSubtitle: { color: colors.textMuted, fontSize: font.base, marginBottom: spacing.xl },
  typeBtn: {
    flexDirection: "row", alignItems: "center", padding: spacing.lg,
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: radius.md,
    borderWidth: 2, borderColor: "transparent", marginBottom: spacing.md
  },
  // Picking a type moves straight to the next step, so only the focused card is highlighted.
  typeBtnFocused: { backgroundColor: "rgba(255,255,255,0.1)" },
  typeBtnTitle: { color: "#FFF", fontSize: font.lg, fontWeight: "600" },
  typeBtnDesc: { color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  btnPrimary: {
    paddingVertical: 14, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  btnPrimaryText: { color: colors.onBrandPrimary, fontSize: font.lg, fontWeight: "700" },
  // Nuvio's auth CTA is a neutral white pill (not accent-colored) - used only for
  // Giriş Yap / Hesabı Oluştur to match that screen exactly.
  btnPrimaryWhite: {
    backgroundColor: "#F5F5F5", paddingVertical: 15, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent",
  },
  btnPrimaryWhiteText: { color: "#111111", fontSize: font.lg, fontWeight: "700" },
  btnGhost: {
    flexDirection: "row", gap: 8, paddingVertical: 14, paddingHorizontal: 24, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  btnGhostText: { color: colors.onSurface, fontSize: font.lg, fontWeight: "600" },
  error: { color: colors.error, marginVertical: spacing.sm, fontSize: font.sm },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center", alignItems: "center", zIndex: 999,
  },
  loadingText: { color: "#fff", fontSize: font.xl, fontWeight: "700", marginTop: spacing.xl },
  loadingSubtext: { color: "rgba(255,255,255,0.7)", fontSize: font.base, marginTop: spacing.sm },
});

const savedStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
    gap: 8,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  name: {
    color: "#fff",
    fontSize: font.base,
    fontWeight: "600",
  },
  sub: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 10,
    backgroundColor: "rgba(255,60,60,0.1)",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,60,60,0.2)",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: spacing.lg,
  },
});
