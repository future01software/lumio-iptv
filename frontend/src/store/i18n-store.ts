import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager } from "react-native";

export type Locale = "en" | "tr";

const dict: Record<Locale, Record<string, string>> = {
  en: {
    "app.name": "Lumio IPTV",
    "login.title": "Lumio IPTV",
    "login.subtitle": "Premium IPTV. Built for cinema.",
    "login.tab.m3u": "M3U URL",
    "login.tab.xtream": "Xtream Codes",
    "login.field.name": "Playlist Name",
    "login.field.m3u": "M3U URL",
    "login.field.epg": "EPG URL (optional)",
    "login.field.server": "Server URL",
    "login.field.username": "Username",
    "login.field.password": "Password",
    "login.connect": "Connect Playlist",
    "login.try_demo": "Try Demo Playlist",
    "login.footer": "Your credentials are stored securely on-device.",
    "tab.home": "Home", "tab.live": "Live TV", "tab.movies": "Movies", "tab.series": "Series", "tab.more": "More", "tab.settings": "Settings",
    "home.featured": "FEATURED", "home.play": "Play", "home.browse": "Browse",
    "home.continue": "Continue Watching", "home.recent_channels": "Recent Channels",
    "home.trending_movies": "Trending Movies", "home.popular_series": "Popular Series",
    "home.favorites": "Favorites", "home.see_all": "See all", "home.no_playlist": "No playlist loaded.",
    "live.title": "Live TV", "live.search": "Search channels", "live.all": "All", "live.favorites": "★ Favorites", "live.no_results": "No channels found.",
    "movies.title": "Movies", "movies.search": "Search movies", "movies.no_results": "No movies found.",
    "series.title": "Series", "series.search": "Search series", "series.no_results": "No series found.",
    "search.title": "Search", "search.placeholder": "Search channels, movies, series", "search.no_results": "No results found", "search.empty": "Type to search",
    "search.tab.all": "All", "search.tab.live": "Channels", "search.tab.movies": "Movies", "search.tab.series": "Series",
    "search.voice": "Voice search", "search.listening": "Listening…", "search.voice_unavailable": "Voice search not available on this device.",
    "settings.title": "Settings",
    "settings.group.playlist": "Playlist", "settings.group.appearance": "Appearance",
    "settings.group.playback": "Playback", "settings.group.security": "Security",
    "settings.group.language": "Language & Region", "settings.group.about": "About",
    "settings.playlist.name": "Name", "settings.playlist.type": "Type",
    "settings.playlist.channels": "Channels", "settings.playlist.movies": "Movies", "settings.playlist.series": "Series",
    "settings.about.app": "App", "settings.about.version": "Version",
    "settings.color.netflix": "Netflix Red",
    "settings.amoled": "AMOLED Black Theme", "settings.accent": "Accent Color",
    "settings.autoplay": "Auto Play", "settings.resume": "Resume Playback", "settings.hw": "Hardware Acceleration",
    "settings.app_lock": "App Lock", "settings.biometric": "Biometric Unlock (Face/Fingerprint)",
    "settings.secure_storage": "Secure Storage", "settings.enabled": "Enabled",
    "settings.language": "Language",
    "settings.hide_adult": "Hide Adult Content (+18)",
    "settings.epg_shift": "EPG Time Shift (Hours)",
    "settings.buffer_size": "Network Buffer Size",
    "settings.buffer.small": "Small (Fast)", "settings.buffer.normal": "Normal", "settings.buffer.large": "Performance (Large buffer)",
    "settings.pin.title": "Set App Lock PIN", "settings.pin.help": "4–8 digits. Device passcode used as fallback if biometrics fail.",
    "settings.pin.cancel": "Cancel", "settings.pin.save": "Save",
    "more.title": "More", "more.library": "LIBRARY", "more.playlist": "PLAYLIST", "more.settings": "SETTINGS",
    "more.search": "Search", "more.favorites": "Favorites", "more.history": "Watch History",
    "more.downloads": "Downloads", "more.profiles": "Switch Profile", "more.epg": "TV Guide (EPG)",
    "more.refresh": "Refresh Playlist", "more.refresh_epg": "Refresh EPG", "more.switch": "Switch Playlist",
    "more.app_settings": "App Settings", "more.about": "About", "more.disconnect": "Disconnect Playlist",
    "more.guest": "Guest",
    "downloads.title": "Downloads", "downloads.storage_used": "Storage Used",
    "downloads.free": "{free} free on device", "downloads.empty": "No downloads yet",
    "downloads.empty_hint": "Open a movie or series episode and tap Download to save it for offline playback.",
    "profiles.title": "Who's watching?", "profiles.add": "Add profile", "profiles.new": "New profile",
    "profiles.name_ph": "Profile name", "profiles.avatar": "Avatar", "profiles.kids": "Kids profile",
    "profiles.kids_help": "Filters adult/news content. Requires PIN to exit.",
    "profiles.pin_ph": "4–6 digit PIN", "profiles.create": "Create",
    "profiles.enter_pin": "Enter profile PIN", "profiles.unlock": "Unlock", "profiles.bad_pin": "Incorrect PIN",
    "lock.title": "App Locked", "lock.subtitle": "Enter your PIN to continue", "lock.unlock": "Unlock", "lock.biometric": "Use Biometrics",
    "player.live": "● LIVE", "player.retry": "Retry",
    "player.unlock": "Unlock", "player.lock": "Lock", "player.sleep": "Sleep", "player.info": "Info",
    "player.sleep_cancelled": "Sleep timer disabled.",
    "player.sleep_active": "Sleep timer active: turning off in {time}.",
    "player.error_playback": "Playback error. Stream may be offline or unsupported.",
    "player.pip_hint": "To use PiP, move the app to background (requires Android 12+ and Expo APK).",
    "player.info_toast": "Playing: {title} ({type})",
    "common.cancel": "Cancel", "common.save": "Save", "common.delete": "Delete",
    "common.next": "Next",
  },
  tr: {
    "app.name": "Lumio IPTV",
    "login.title": "Lumio IPTV",
    "login.subtitle": "Hızlı, Güvenli ve Kesintisiz. IPTV Listeleriniz Tek Ekranda.",
    "login.tab.m3u": "M3U URL",
    "login.tab.xtream": "Xtream Codes",
    "login.field.name": "Liste Adı",
    "login.field.m3u": "M3U URL",
    "login.field.epg": "EPG URL (isteğe bağlı)",
    "login.field.server": "Sunucu URL",
    "login.field.username": "Kullanıcı Adı",
    "login.field.password": "Şifre",
    "login.connect": "Listeyi Bağla",
    "login.try_demo": "Demo Listesi Dene",
    "login.footer": "Bilgileriniz cihazınızda güvenle saklanır.",
    "tab.home": "Ana Sayfa", "tab.live": "Canlı TV", "tab.movies": "Filmler", "tab.series": "Diziler", "tab.more": "Daha", "tab.settings": "Ayarlar",
    "home.featured": "ÖNE ÇIKAN", "home.play": "Oynat", "home.browse": "Gözat",
    "home.continue": "İzlemeye Devam Et", "home.recent_channels": "Son Kanallar",
    "home.trending_movies": "Popüler Filmler", "home.popular_series": "Popüler Diziler",
    "home.favorites": "Favoriler", "home.see_all": "Tümünü gör", "home.no_playlist": "Yüklü liste yok.",
    "live.title": "Canlı TV", "live.search": "Kanal ara", "live.all": "Tümü", "live.favorites": "★ Favoriler", "live.no_results": "Kanal bulunamadı.",
    "movies.title": "Filmler", "movies.search": "Film ara", "movies.no_results": "Film bulunamadı.",
    "series.title": "Diziler", "series.search": "Dizi ara", "series.no_results": "Dizi bulunamadı.",
    "search.title": "Ara", "search.placeholder": "Kanal, film, dizi ara", "search.no_results": "Sonuç bulunamadı", "search.empty": "Aramak için yazın",
    "search.tab.all": "Tümü", "search.tab.live": "Kanallar", "search.tab.movies": "Filmler", "search.tab.series": "Diziler",
    "search.voice": "Sesli arama", "search.listening": "Dinleniyor…", "search.voice_unavailable": "Sesli arama bu cihazda kullanılamıyor.",
    "settings.title": "Ayarlar",
    "settings.group.playlist": "Liste", "settings.group.appearance": "Görünüm",
    "settings.group.playback": "Oynatma", "settings.group.security": "Güvenlik",
    "settings.group.language": "Dil ve Bölge", "settings.group.about": "Hakkında",
    "settings.playlist.name": "Adı", "settings.playlist.type": "Türü",
    "settings.playlist.channels": "Kanallar", "settings.playlist.movies": "Filmler", "settings.playlist.series": "Diziler",
    "settings.about.app": "Uygulama", "settings.about.version": "Sürüm",
    "settings.color.netflix": "Netflix Kırmızısı",
    "settings.amoled": "AMOLED Siyah Tema", "settings.accent": "Vurgu Rengi",
    "settings.autoplay": "Otomatik Oynat", "settings.resume": "Kaldığı Yerden Devam Et", "settings.hw": "Donanım Hızlandırma",
    "settings.app_lock": "Uygulama Kilidi", "settings.biometric": "Biyometrik Açma (Yüz/Parmak İzi)",
    "settings.secure_storage": "Güvenli Depolama", "settings.enabled": "Etkin",
    "settings.language": "Dil",
    "settings.hide_adult": "Yetişkin (+18) İçerikleri Gizle",
    "settings.epg_shift": "EPG Zaman Dilimi (Saat)",
    "settings.buffer_size": "Ağ Ön Belleği (Buffer)",
    "settings.buffer.small": "Küçük (Hızlı)", "settings.buffer.normal": "Normal", "settings.buffer.large": "Performans (Büyük tampon)",
    "settings.pin.title": "Uygulama Kilidi PIN'i", "settings.pin.help": "4–8 hane. Biyometri başarısız olursa cihaz şifresi yedek olarak kullanılır.",
    "settings.pin.cancel": "İptal", "settings.pin.save": "Kaydet",
    "more.title": "Daha", "more.library": "KÜTÜPHANE", "more.playlist": "LİSTE", "more.settings": "AYARLAR",
    "more.search": "Ara", "more.favorites": "Favoriler", "more.history": "İzleme Geçmişi",
    "more.downloads": "İndirilenler", "more.profiles": "Profil Değiştir", "more.epg": "TV Rehberi (EPG)",
    "more.refresh": "Listeyi Yenile", "more.refresh_epg": "EPG Yenile", "more.switch": "Liste Değiştir",
    "more.app_settings": "Uygulama Ayarları", "more.about": "Hakkında", "more.disconnect": "Listeyi Çıkar",
    "more.guest": "Misafir",
    "downloads.title": "İndirilenler", "downloads.storage_used": "Kullanılan Alan",
    "downloads.free": "Cihazda {free} boş", "downloads.empty": "Henüz indirme yok",
    "downloads.empty_hint": "Bir film veya dizi bölümü açın ve çevrimdışı oynatmak için İndir'e dokunun.",
    "profiles.title": "Kim izliyor?", "profiles.add": "Profil ekle", "profiles.new": "Yeni profil",
    "profiles.name_ph": "Profil adı", "profiles.avatar": "Avatar", "profiles.kids": "Çocuk profili",
    "profiles.kids_help": "Yetişkin/haber içeriklerini filtreler. Çıkmak için PIN gerekir.",
    "profiles.pin_ph": "4–6 haneli PIN", "profiles.create": "Oluştur",
    "profiles.enter_pin": "Profil PIN'i", "profiles.unlock": "Aç", "profiles.bad_pin": "Hatalı PIN",
    "lock.title": "Uygulama Kilitli", "lock.subtitle": "Devam etmek için PIN girin", "lock.unlock": "Aç", "lock.biometric": "Biyometriyi Kullan",
    "player.live": "● CANLI", "player.retry": "Tekrar Dene",
    "player.unlock": "Aç", "player.lock": "Kilitle", "player.sleep": "Uyku", "player.info": "Bilgi",
    "player.sleep_cancelled": "Uyku modu iptal edildi.",
    "player.sleep_active": "Uyku modu aktif: {time} sonra kapanacak.",
    "player.error_playback": "Oynatma hatası. Yayın çevrimdışı veya desteklenmiyor olabilir.",
    "player.pip_hint": "PiP için uygulamayı arka plana almalısınız (Android 12+ ve Expo APK gerektirir).",
    "player.info_toast": "Yayın: {title} ({type})",
    "common.cancel": "İptal", "common.save": "Kaydet", "common.delete": "Sil",
    "common.next": "Sonraki",
  },
};

const STORAGE_KEY = "iptv.locale.v1";

const LOCALE_INFO: Record<Locale, { label: string; nativeLabel: string; rtl: boolean }> = {
  en: { label: "English", nativeLabel: "English", rtl: false },
  tr: { label: "Turkish", nativeLabel: "Türkçe", rtl: false },
};

type State = {
  locale: Locale;
  initialized: boolean;
  init: () => Promise<void>;
  setLocale: (l: Locale) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export const useI18n = create<State>((set, get) => ({
  locale: "tr",
  initialized: false,
  init: async () => {
    if (get().initialized) return;
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    // Unknown/removed locales (Arabic was dropped) fall back to Turkish.
    const loc: Locale = raw && raw in LOCALE_INFO ? (raw as Locale) : "tr";
    const info = LOCALE_INFO[loc];
    try {
      if (info?.rtl !== I18nManager.isRTL) {
        I18nManager.allowRTL(info?.rtl ?? false);
        I18nManager.forceRTL(info?.rtl ?? false);
      }
    } catch {}
    set({ locale: loc, initialized: true });
  },
  setLocale: async (l) => {
    await AsyncStorage.setItem(STORAGE_KEY, l);
    const info = LOCALE_INFO[l];
    try {
      I18nManager.allowRTL(info.rtl);
      I18nManager.forceRTL(info.rtl);
    } catch {}
    set({ locale: l });
  },
  t: (key, vars) => {
    const loc = get().locale;
    let s = dict[loc]?.[key] ?? dict.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  },
}));

export { LOCALE_INFO };
