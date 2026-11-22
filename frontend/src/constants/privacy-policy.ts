// Privacy policy text, shown in-app (app/privacy.tsx) so it works offline.
// The web copy for the App Store / Play listing is docs/privacy.html; keep both in sync.
import type { Locale } from "@/src/store/i18n-store";

export const PRIVACY_UPDATED: Record<Locale, string> = {
  tr: "Son güncelleme: 22 Kasım 2026",
  en: "Last updated: 22 November 2026",
};

export const PRIVACY_SECTIONS: Record<Locale, [string, string][]> = {
  tr: [
    ["Kısaca",
      "Lumio reklam göstermez, seni takip etmez ve analitik verisi toplamaz. Bizim işlettiğimiz bir sunucu yoktur; hesabın, listelerin ve ayarların yalnızca kendi cihazında kalır."],
    ["Lumio hesabı",
      "Hesap oluşturursan e-posta adresin ve şifrenin tuzlanmış özeti (şifrenin kendisi değil) yalnızca bu cihazda saklanır, hiçbir yere gönderilmez. Hesabını Ayarlar > Hesap > Hesabı Sil ile istediğin an kalıcı olarak silebilirsin."],
    ["IPTV kaynakların",
      "Eklediğin playlist adresi, kullanıcı adı ve şifre bu cihazda saklanır. Kanallar, rehber ve yayınlar doğrudan senin sağlayıcından alınır. Sağlayıcıyla paylaşılan bilgiler (ör. IP adresin) o hizmetin gizlilik politikasına tabidir. Masaüstü sürümü, listeleri işlemek için yalnızca kendi bilgisayarında çalışan yerel bir yardımcı sunucu kullanır."],
    ["Cihazda saklananlar",
      "Profiller, favoriler, izleme geçmişi, koleksiyonlar, indirilen videolar, ebeveyn kilidi PIN'i ve tercihlerin yalnızca bu cihazda tutulur."],
    ["Film ve dizi bilgileri",
      "Afiş, özet ve fragman bulmak için içerik adı TMDB'ye (themoviedb.org) ve Apple iTunes Arama'ya gönderilir. Fragmanlar YouTube'dan oynatılır. Bu isteklerde senin hakkında kişisel bilgi gönderilmez; bu servisler kendi gizlilik politikalarına tabidir."],
    ["Chromecast",
      "Yayın yapabileceğin cihazları bulmak için yerel ağın taranır. Yayın başlattığında oynatılan adres seçtiğin Chromecast cihazına gönderilir."],
    ["Güncellemeler",
      "Masaüstü ve Android sürümleri yeni sürüm olup olmadığını GitHub'daki Lumio sürüm sayfasından kontrol eder. Bu kontrolde kişisel bilgi gönderilmez."],
    ["Yedekler",
      "Yedekleme, ayarlarını ve IPTV hesap bilgilerini senin seçtiğin bir dosyaya kaydeder. Bir parola belirlersen dosya şifrelenir. Dosyanın nerede saklanacağı ve kiminle paylaşılacağı senin kontrolündedir."],
    ["Verilerini silmek",
      "Ayarlar'dan hesabını silebilir, playlist'ini kaldırabilir ve önbelleği temizleyebilirsin. Uygulamayı kaldırdığında cihazdaki tüm Lumio verileri de silinir."],
    ["Çocuklar",
      "Lumio çocuklara yönelik değildir ve kimseden bilerek kişisel veri toplamaz."],
    ["Değişiklikler ve iletişim",
      "Bu politika değişirse güncel hali uygulamada ve Lumio'nun GitHub sayfasında yayınlanır. Sorularını github.com/future01software/lumio-iptv adresinden iletebilirsin."],
  ],
  en: [
    ["In short",
      "Lumio shows no ads, does not track you and collects no analytics. We run no server of our own; your account, lists and settings stay on your own device."],
    ["Lumio account",
      "If you create an account, your email address and a salted hash of your password (never the password itself) are stored only on this device and are never sent anywhere. You can permanently delete your account at any time in Settings > Account > Delete Account."],
    ["Your IPTV sources",
      "The playlist address, username and password you add are stored on this device. Channels, the guide and streams come directly from your provider. What the provider receives (such as your IP address) is governed by its own privacy policy. The desktop version uses a local helper server that runs only on your own computer to process lists."],
    ["Stored on the device",
      "Profiles, favorites, watch history, collections, downloaded videos, your parental PIN and your preferences are kept only on this device."],
    ["Movie and series details",
      "To find posters, summaries and trailers, the title is sent to TMDB (themoviedb.org) and Apple's iTunes Search. Trailers play from YouTube. No personal information about you is sent in these requests; these services are governed by their own privacy policies."],
    ["Chromecast",
      "Your local network is scanned to find devices you can cast to. When you start casting, the stream address is sent to the Chromecast you choose."],
    ["Updates",
      "The desktop and Android versions check Lumio's release page on GitHub for a new version. No personal information is sent in this check."],
    ["Backups",
      "A backup saves your settings and IPTV account details to a file you choose. If you set a password, the file is encrypted. Where the file is kept and who it is shared with is up to you."],
    ["Deleting your data",
      "In Settings you can delete your account, remove your playlist and clear the cache. Uninstalling the app removes all Lumio data from the device."],
    ["Children",
      "Lumio is not directed at children and does not knowingly collect personal data from anyone."],
    ["Changes and contact",
      "If this policy changes, the current version is published in the app and on Lumio's GitHub page. Send questions via github.com/future01software/lumio-iptv."],
  ],
};
