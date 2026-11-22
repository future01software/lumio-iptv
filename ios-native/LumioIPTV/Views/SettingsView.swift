import LumioCore
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var settings = AppSettings.shared
    @State private var showAddAccount = false
    @State private var showAvatars = false
    @State private var accountInfo: XtreamAccountInfo?
    @State private var pendingDelete: Account?
    @State private var cacheState: CacheState = .idle
    @State private var lock = AppLock.shared
    @State private var pinSheet: PinRequest?

    /// What the PIN sheet is for; `action` runs after a correct PIN (or a new PIN is set).
    struct PinRequest: Identifiable {
        let id = UUID()
        let purpose: PinSheet.Purpose
        let action: () -> Void
    }

    enum CacheState { case idle, busy, done }

    private func clearCache() {
        cacheState = .busy
        Task {
            await model.clearCache()
            cacheState = .done
        }
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        Button { showAvatars = true } label: {
                            Avatars.image(model.avatar)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Theme.brand, lineWidth: 2))
                                .overlay(alignment: .bottomTrailing) {
                                    Image(systemName: "pencil.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(.white, Theme.brand)
                                }
                        }
                        .buttonStyle(.plain)
                        TextField("Profil adı", text: $model.profileName)
                            .font(.title3.weight(.semibold))
                    }
                    .padding(.vertical, 6)
                }

                Section {
                    ForEach(model.accounts) { account in
                        Button {
                            if account.id != model.activeAccount?.id { model.activate(account) }
                        } label: {
                            HStack {
                                Image(systemName: account.kind == .xtream ? "server.rack" : "list.bullet.rectangle")
                                    .foregroundStyle(Theme.brand)
                                    .frame(width: 28)
                                VStack(alignment: .leading) {
                                    Text(account.name).foregroundStyle(.white)
                                    Text(account.kind == .xtream ? "Xtream Codes" : "M3U")
                                        .font(.caption).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                if account.id == model.activeAccount?.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.brand)
                                }
                            }
                        }
                        .swipeActions {
                            Button("Sil", role: .destructive) { pendingDelete = account }
                        }
                    }
                    Button {
                        showAddAccount = true
                    } label: {
                        Label("Hesap ekle", systemImage: "plus.circle.fill")
                    }
                } header: {
                    Text("Hesaplar")
                } footer: {
                    Text("Silmek için sola kaydır. Hesap bilgileri yalnızca bu cihazın Anahtar Zinciri'nde tutulur.")
                }

                if model.activeAccount?.kind == .xtream {
                    Section("Abonelik") {
                        LabeledContent("Durum", value: accountInfo?.status.map(statusText) ?? "—")
                        LabeledContent("Bitiş", value: accountInfo?.expiresAt?.formatted(date: .abbreviated, time: .omitted) ?? "—")
                        if let n = accountInfo?.maxConnections { LabeledContent("Eş zamanlı bağlantı", value: "\(n)") }
                    }
                }

                Section("Görünüm") {
                    AccentSwatches(selection: $settings.accent)
                }

                Section {
                    Toggle("Otomatik oynat", isOn: $settings.autoplay)
                    Toggle("Kaldığı yerden devam et", isOn: $settings.resume)
                    InlinePicker(title: "Oynatma modu", selection: $settings.playbackMode)
                    InlinePicker(title: "Varsayılan görüntü", selection: $settings.aspect)
                } header: {
                    Text("Oynatıcı")
                }

                Section {
                    Toggle("Saat", isOn: $settings.showClock)
                    Toggle("Kanal ve liste adı (5 sn gösterilir)", isOn: $settings.showChannelLabel)
                    Toggle("Yayın bilgisi (çözünürlük, bit hızı…)", isOn: $settings.showStreamInfo)
                } header: {
                    Text("İzlerken ekranda")
                }

                Section {
                    Stepper(value: $settings.epgOffsetHours, in: -12...12) {
                        LabeledContent("Yayın akışı saat farkı",
                                       value: settings.epgOffsetHours == 0 ? "0 sa" : String(format: "%+d sa", settings.epgOffsetHours))
                    }
                    Toggle("Akışı olmayanları gizle", isOn: $settings.guideHideEmpty)
                    InlinePicker(title: "Uygulama açılınca", selection: $settings.startScreen)
                } header: {
                    Text("Canlı TV ve Rehber")
                } footer: {
                    Text("Saat farkı, sağlayıcının yayın akışı saatleri kayıksa düzeltir.")
                }

                Section {
                    Toggle("Yetişkin içeriği gizle", isOn: Binding(
                        get: { settings.hideAdult },
                        set: { hide in
                            // With a PIN set, showing adult content again needs the PIN.
                            if hide || !lock.hasPin {
                                settings.hideAdult = hide
                            } else {
                                pinSheet = PinRequest(purpose: .confirm("Yetişkin içeriğini göstermek için")) {
                                    settings.hideAdult = false
                                }
                            }
                        }))
                    Toggle("Uygulama kilidi (PIN)", isOn: Binding(
                        get: { lock.hasPin },
                        set: { on in
                            if on {
                                pinSheet = PinRequest(purpose: .create) {}
                            } else {
                                pinSheet = PinRequest(purpose: .confirm("Kilidi kapatmak için")) { lock.removePin() }
                            }
                        }))
                    if lock.hasPin {
                        if let name = lock.biometryName {
                            Toggle("\(name) ile aç", isOn: $lock.useBiometrics)
                        }
                        Button("PIN'i değiştir") {
                            pinSheet = PinRequest(purpose: .change) {}
                        }
                    }
                } header: {
                    Text("Ebeveyn ve Güvenlik")
                } footer: {
                    Text(lock.hasPin
                         ? "Lumio açılırken ve arka plandan dönünce PIN sorulur. Yetişkin içeriğini göstermek de PIN ister. Yetişkin kategorileri ve açıkça yetişkin içerikli adlar; İzlemeye devam et ve Son kanallar dahil her yerde gizlenir."
                         : "Yetişkin kategorileri ve açıkça yetişkin içerikli adlar; İzlemeye devam et ve Son kanallar dahil her yerde gizlenir. Uygulama kilidini açarsan bu ayarı kapatmak da PIN ister.")
                }

                Section {
                    InlinePicker(title: "Performans modu", selection: $settings.performance)
                    Button {
                        clearCache()
                    } label: {
                        HStack {
                            Text("Önbelleği temizle")
                            Spacer()
                            switch cacheState {
                            case .idle: EmptyView()
                            case .busy: ProgressView()
                            case .done: Label("Temizlendi", systemImage: "checkmark").foregroundStyle(.green).font(.footnote)
                            }
                        }
                    }
                    .disabled(cacheState == .busy)
                } header: {
                    Text("Gelişmiş")
                } footer: {
                    Text("Önbellek temizlenince kanal, film listesi ve yayın akışı sağlayıcıdan yeniden indirilir.")
                }

                Section("İçerik") {
                    LabeledContent("Kanallar", value: count(model.live.channels.count, model.liveState))
                    LabeledContent("Filmler", value: count(model.vod.movies.count, model.vodState))
                    LabeledContent("Diziler", value: count(model.vod.series.count, model.vodState))
                    Button("Listeyi yenile") { Task { await model.reload() } }
                }

                Section {
                    LabeledContent("Sürüm", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                    NavigationLink("Gizlilik Politikası") { PrivacyPolicyView() }
                } header: {
                    Text("Hakkında")
                } footer: {
                    Text("Lumio yalnızca bir medya oynatıcıdır ve hiçbir içerik sağlamaz. Kullandığın yayınların haklarına sahip olmak senin sorumluluğundadır.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .navigationTitle("Ayarlar")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Bitti") { dismiss() } }
            }
            .sheet(isPresented: $showAddAccount) {
                NavigationStack { AddAccountView() }
            }
            .sheet(item: $pinSheet) { request in
                PinSheet(purpose: request.purpose) { ok in
                    if ok { request.action() }
                }
                .interactiveDismissDisabled()
            }
            .sheet(isPresented: $showAvatars) {
                AvatarPicker(selection: $model.avatar)
                    .presentationDetents([.medium, .large])
            }
            .confirmationDialog("Hesap silinsin mi?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                                titleVisibility: .visible, presenting: pendingDelete) { account in
                Button("\(account.name) hesabını sil", role: .destructive) { model.remove(account) }
            } message: { _ in
                Text("Hesabın favorileri ve izleme geçmişi de silinir.")
            }
            .task(id: model.activeAccount?.id) {
                accountInfo = nil
                accountInfo = try? await model.provider?.accountInfo()
            }
        }
    }

    private func count(_ n: Int, _ state: LoadState) -> String {
        switch state {
        case .loaded: n.formatted()
        case .failed: "Hata"
        default: "…"
        }
    }

    private func statusText(_ s: String) -> String {
        s.lowercased() == "active" ? "Aktif" : s
    }
}

struct AvatarPicker: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 14)], spacing: 14) {
                    ForEach(Avatars.all, id: \.self) { name in
                        Button {
                            selection = name
                            dismiss()
                        } label: {
                            Avatars.image(name)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(name == selection ? Theme.brand : .clear, lineWidth: 3))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(Theme.surface2)
            .navigationTitle("Avatar seç")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Picker that expands in place, listing every option with its hint and a checkmark.
struct InlinePicker<Choice: SettingChoice>: View {
    let title: String
    @Binding var selection: Choice
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            ForEach(Array(Choice.allCases)) { choice in
                Button {
                    selection = choice
                    withAnimation { expanded = false }
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(choice.title).foregroundStyle(.white)
                            if let hint = choice.hint {
                                Text(hint).font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                        Spacer()
                        if choice == selection {
                            Image(systemName: "checkmark").foregroundStyle(Theme.brand).fontWeight(.semibold)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } label: {
            LabeledContent(title, value: selection.title)
                .foregroundStyle(.white)
        }
    }
}

/// Accent colors as one row of round swatches.
struct AccentSwatches: View {
    @Binding var selection: AccentChoice

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LabeledContent("Vurgu rengi", value: selection.title)
            HStack(spacing: 0) {
                ForEach(AccentChoice.allCases) { choice in
                    Button {
                        selection = choice
                    } label: {
                        Circle()
                            .fill(choice.color)
                            .frame(width: 34, height: 34)
                            .overlay {
                                if choice == selection {
                                    Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(.white)
                                }
                            }
                            .overlay(Circle().stroke(.white.opacity(choice == selection ? 0.9 : 0), lineWidth: 2).padding(-4))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(choice.title)
                }
            }
            .padding(.vertical, 4)
        }
    }
}
