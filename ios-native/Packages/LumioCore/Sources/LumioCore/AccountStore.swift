import Foundation
import Security

/// Minimal generic-password Keychain wrapper.
public struct KeychainStore: Sendable {
    public let service: String

    public init(service: String) { self.service = service }

    private func baseQuery(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    public func data(for key: String) -> Data? {
        var q = baseQuery(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    public func set(_ data: Data, for key: String) -> Bool {
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(baseQuery(key) as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var q = baseQuery(key)
            q.merge(attrs) { $1 }
            return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }

    public func remove(_ key: String) {
        SecItemDelete(baseQuery(key) as CFDictionary)
    }
}

/// Accounts live in the Keychain (credentials included); only the id of the active
/// account, which is not sensitive, is kept in UserDefaults.
public struct AccountStore: Sendable {
    private let keychain: KeychainStore
    private let accountsKey = "accounts.v1"
    private let activeKey = "lumio.activeAccountID"

    public init(service: String = "com.future01.lumio.accounts") {
        keychain = KeychainStore(service: service)
    }

    public func load() -> [Account] {
        guard let data = keychain.data(for: accountsKey) else { return [] }
        return (try? JSONDecoder().decode([Account].self, from: data)) ?? []
    }

    public func save(_ accounts: [Account]) {
        if accounts.isEmpty { keychain.remove(accountsKey); return }
        if let data = try? JSONEncoder().encode(accounts) { keychain.set(data, for: accountsKey) }
    }

    public var activeAccountID: UUID? {
        get { UserDefaults.standard.string(forKey: activeKey).flatMap(UUID.init(uuidString:)) }
        nonmutating set { UserDefaults.standard.set(newValue?.uuidString, forKey: activeKey) }
    }
}
