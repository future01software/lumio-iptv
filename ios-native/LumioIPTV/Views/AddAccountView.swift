import LumioCore
import SwiftUI

struct AddAccountView: View {
    var isOnboarding = false

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var kind: AccountKind = .xtream
    @State private var name = ""
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var m3uURL = ""
    @State private var epgURL = ""
    @State private var connecting = false
    @State private var error: String?

    var body: some View {
        Form {
            if isOnboarding {
                Section {
                    VStack(spacing: 14) {
                        Image("Wordmark")
                            .resizable()
                            .scaledToFit()
                            .frame(height: 44)
                        Text("Kendi IPTV hesabını ekle")
                            .font(.title3.weight(.semibold))
                        Text("Lumio yalnızca bir oynatıcıdır; içerik sağlamaz. Sağlayıcından aldığın Xtream Codes bilgilerini ya da M3U adresini gir.")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .listRowBackground(Color.clear)
            }

            Section {
                Picker("Hesap türü", selection: $kind) {
                    Text("Xtream Codes").tag(AccountKind.xtream)
                    Text("M3U").tag(AccountKind.m3u)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section("Hesap adı") {
                TextField("Örn. Ev", text: $name)
            }

            if kind == .xtream {
                Section {
                    TextField("Sunucu (http://adres:port)", text: $server)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                    TextField("Kullanıcı adı", text: $username)
                        .textContentType(.username)
                    SecureField("Şifre", text: $password)
                        .textContentType(.password)
                } header: {
                    Text("Xtream Codes")
                } footer: {
                    Text("Bilgiler yalnızca bu cihazın Anahtar Zinciri'nde saklanır.")
                }
            } else {
                Section {
                    TextField("M3U adresi (http…)", text: $m3uURL, axis: .vertical)
                        .keyboardType(.URL)
                    TextField("EPG (XMLTV) adresi — isteğe bağlı", text: $epgURL, axis: .vertical)
                        .keyboardType(.URL)
                } header: {
                    Text("M3U çalma listesi")
                } footer: {
                    Text("Adresler yalnızca bu cihazın Anahtar Zinciri'nde saklanır.")
                }
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.callout)
                }
            }

            Section {
                Button(action: connect) {
                    HStack {
                        Spacer()
                        if connecting { ProgressView().tint(.white) } else { Text("Bağlan").fontWeight(.semibold) }
                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
                .disabled(!canSubmit || connecting)
                .listRowBackground(canSubmit ? Theme.brand : Theme.surface3)
                .foregroundStyle(.white)
            } footer: {
                // Ayarlar'a hesap eklenmeden ulaşılamadığı için politika burada da açılabilmeli.
                if isOnboarding {
                    NavigationLink("Gizlilik Politikası") { PrivacyPolicyView() }
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
            }
        }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .scrollContentBackground(.hidden)
        .background(Theme.surface)
        .navigationTitle(isOnboarding ? "" : "Hesap ekle")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !isOnboarding {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
            }
        }
        .onChange(of: kind) { error = nil }
        #if DEBUG
        .onAppear {
            // Simulator testing against Tools/mock-xtream (fake local panel, not a real provider).
            if ProcessInfo.processInfo.arguments.contains("-mockXtream") {
                kind = .xtream; name = "Test"; server = "http://127.0.0.1:8899"; username = "demo"; password = "demo"
            }
        }
        #endif
    }

    private var canSubmit: Bool {
        switch kind {
        case .xtream: !server.trimmed.isEmpty && !username.trimmed.isEmpty && !password.trimmed.isEmpty
        case .m3u: !m3uURL.trimmed.isEmpty
        }
    }

    private func connect() {
        let account = Account(
            name: name.trimmed.isEmpty ? (kind == .xtream ? "Xtream" : "M3U") : name.trimmed,
            kind: kind, server: server.trimmed, username: username.trimmed, password: password.trimmed,
            m3uURL: m3uURL.trimmed, epgURL: epgURL.trimmed)
        connecting = true
        error = nil
        Task {
            do {
                try await model.addAccount(account)
                if !isOnboarding { dismiss() }
            } catch {
                self.error = error.localizedDescription
            }
            connecting = false
        }
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
