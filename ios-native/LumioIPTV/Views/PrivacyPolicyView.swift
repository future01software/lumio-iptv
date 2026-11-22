import SwiftUI

/// Gizlilik politikası. Uygulamanın içinde gösterilir, internet gerektirmez.
/// Aynı metnin web sürümü docs/privacy.html dosyasındadır; biri değişirse diğeri de güncellenmeli.
struct PrivacyPolicyView: View {
    private static let updated = "22 Kasım 2026"

    private static let sections: [(String, String)] = [
        ("Kısaca",
         "Lumio senin hakkında hiçbir veri toplamaz, hiçbir sunucumuza veri göndermez, seni takip etmez ve reklam göstermez. Uygulamanın kullandığı her şey yalnızca bu cihazda kalır."),
        ("Eklediğin hesaplar",
         "Eklediğin IPTV hesaplarının adresi, kullanıcı adı ve şifresi yalnızca bu cihazın Anahtar Zinciri'nde saklanır. Bu bilgiler bize ya da başka birine gönderilmez."),
        ("Yayın sunucuları",
         "Lumio, kanal listelerini, program rehberini ve yayınları doğrudan senin eklediğin sunuculardan alır. Bu sunucular bizim değildir; onlarla paylaşılan bilgiler (ör. IP adresin) o hizmeti sağlayanın gizlilik politikasına tabidir."),
        ("Cihazda saklananlar",
         "Favoriler, izleme geçmişi, önbelleğe alınmış listeler ve tercihlerin (tema, dil, profil resmi gibi) yalnızca bu cihazda tutulur."),
        ("Uygulama kilidi",
         "Uygulama kilidini açarsan PIN'in kendisi değil, yalnızca tuzlanmış bir özeti bu cihazın Anahtar Zinciri'nde saklanır. Face ID ile açmayı seçersen doğrulamayı iOS yapar; Lumio yüz verine hiçbir zaman erişemez."),
        ("AirPlay ve arka planda oynatma",
         "AirPlay ile yayın yaptığında görüntü doğrudan seçtiğin cihaza gider. Arka planda ses çalması yalnızca oynatmanın sürmesi içindir."),
        ("Verilerini silmek",
         "Ayarlar'dan bir hesabı sola kaydırarak silebilir, önbelleği temizleyebilirsin. Uygulamayı sildiğinde cihazdaki tüm Lumio verileri de silinir."),
        ("Çocuklar",
         "Lumio çocuklara yönelik değildir ve kimseden bilerek kişisel veri toplamaz."),
        ("Değişiklikler ve iletişim",
         "Bu politika değişirse güncel hali burada ve uygulamanın App Store sayfasındaki gizlilik bağlantısında yayınlanır. Sorularını App Store sayfasındaki geliştirici iletişim bağlantısından iletebilirsin."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Son güncelleme: \(Self.updated)")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                ForEach(Self.sections, id: \.0) { heading, text in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(heading).font(.headline)
                        Text(text).font(.body)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.surface)
        .navigationTitle("Gizlilik Politikası")
        .navigationBarTitleDisplayMode(.inline)
    }
}
