import CryptoKit
import Foundation

/// Encrypted on-disk copy of the last loaded catalogs, so the app can show content
/// instantly on launch and refresh in the background. Catalogs contain stream URLs
/// (which embed the provider password), so files are AES-GCM encrypted with a key
/// that lives only in the Keychain, and the cache is excluded from backups.
public struct CatalogCache: Sendable {
    private let keychain = KeychainStore(service: "com.future01.lumio.cache")
    private let keyName = "catalog-key.v1"

    public init() {}

    private var directory: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("LumioCatalog", isDirectory: true)
    }

    private func file(_ accountID: UUID, _ name: String) -> URL {
        directory.appendingPathComponent("\(accountID.uuidString)-\(name).bin")
    }

    private func key() -> SymmetricKey {
        if let data = keychain.data(for: keyName), data.count == 32 { return SymmetricKey(data: data) }
        let key = SymmetricKey(size: .bits256)
        keychain.set(key.withUnsafeBytes { Data($0) }, for: keyName)
        return key
    }

    public func save<T: Encodable>(_ value: T, accountID: UUID, name: String) {
        do {
            let json = try JSONEncoder().encode(value)
            guard let sealed = try AES.GCM.seal(json, using: key()).combined else { return }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var url = file(accountID, name)
            try sealed.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        } catch {
            // Cache is best-effort.
        }
    }

    public func load<T: Decodable>(_ type: T.Type, accountID: UUID, name: String) -> T? {
        guard let data = try? Data(contentsOf: file(accountID, name)),
              let box = try? AES.GCM.SealedBox(combined: data),
              let json = try? AES.GCM.open(box, using: key()) else { return nil }
        return try? JSONDecoder().decode(type, from: json)
    }

    public func remove(accountID: UUID) {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for f in files where f.lastPathComponent.hasPrefix(accountID.uuidString) {
            try? FileManager.default.removeItem(at: f)
        }
    }
}
