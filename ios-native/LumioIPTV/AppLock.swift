import CryptoKit
import LocalAuthentication
import LumioCore
import SwiftUI
import UIKit

/// App lock with a 4-digit PIN (like the desktop app's "Uygulama kilidi"), optionally Face ID / Touch ID.
/// While a PIN is set, switching off "Yetişkin içeriği gizle" also asks for it.
/// The PIN is never stored: only a salted SHA-256 of it, in the Keychain.
@MainActor
@Observable
final class AppLock {
    static let shared = AppLock()
    static let pinLength = 4
    static let maxAttempts = 5
    static let lockoutSeconds: TimeInterval = 30

    private let keychain: KeychainStore
    private let defaults: UserDefaults
    private let pinKey = "pin"

    private(set) var hasPin: Bool
    private(set) var isLocked: Bool
    /// Wrong PINs in a row; at `maxAttempts` entry is refused until `lockedUntil`.
    private(set) var failedAttempts = 0
    private(set) var lockedUntil: Date?
    var useBiometrics: Bool {
        didSet { defaults.set(useBiometrics, forKey: "lumio.appLock.biometrics") }
    }

    init(keychain: KeychainStore = KeychainStore(service: "com.future01.lumio.applock"),
         defaults: UserDefaults = .standard) {
        self.keychain = keychain
        self.defaults = defaults
        let stored = keychain.data(for: pinKey) != nil
        hasPin = stored
        isLocked = stored
        useBiometrics = defaults.bool(forKey: "lumio.appLock.biometrics")
    }

    // MARK: PIN

    static func isValid(_ pin: String) -> Bool {
        pin.count == pinLength && pin.allSatisfy(\.isASCII) && pin.allSatisfy(\.isNumber)
    }

    func setPin(_ pin: String) {
        guard Self.isValid(pin) else { return }
        let salt = Data((0..<16).map { _ in UInt8.random(in: .min ... .max) })
        guard keychain.set(salt + Self.digest(pin, salt: salt), for: pinKey) else { return }
        hasPin = true
        failedAttempts = 0
        lockedUntil = nil
    }

    func removePin() {
        keychain.remove(pinKey)
        hasPin = false
        isLocked = false
        useBiometrics = false
        failedAttempts = 0
        lockedUntil = nil
    }

    enum Check: Equatable { case ok, wrong(remaining: Int), lockedOut(seconds: Int) }

    /// Checks a PIN without changing the lock state (used to confirm settings changes).
    func check(_ pin: String, now: Date = Date()) -> Check {
        if let until = lockedUntil, until > now {
            return .lockedOut(seconds: Int(until.timeIntervalSince(now).rounded(.up)))
        }
        guard let stored = keychain.data(for: pinKey), stored.count > 16 else { return .ok }
        let salt = stored.prefix(16)
        if Self.digest(pin, salt: salt) == stored.dropFirst(16) {
            failedAttempts = 0
            lockedUntil = nil
            return .ok
        }
        failedAttempts += 1
        if failedAttempts >= Self.maxAttempts {
            failedAttempts = 0
            lockedUntil = now.addingTimeInterval(Self.lockoutSeconds)
            return .lockedOut(seconds: Int(Self.lockoutSeconds))
        }
        return .wrong(remaining: Self.maxAttempts - failedAttempts)
    }

    private static func digest(_ pin: String, salt: Data) -> Data {
        Data(SHA256.hash(data: salt + Data("lumio-app-lock:\(pin)".utf8)))
    }

    // MARK: Lock state

    func lock() {
        if hasPin { isLocked = true }
    }

    func unlock(with pin: String) -> Check {
        let result = check(pin)
        if result == .ok { isLocked = false }
        return result
    }

    /// "Face ID", "Touch ID", "Optic ID", or nil when the device has none enrolled.
    var biometryName: String? {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return nil }
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return nil
        }
    }

    func unlockWithBiometrics() async {
        guard hasPin, useBiometrics, isLocked, biometryName != nil else { return }
        let context = LAContext()
        context.localizedFallbackTitle = "PIN gir"
        let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                                                     localizedReason: "Lumio'nun kilidini aç")) ?? false
        if ok { isLocked = false; failedAttempts = 0; lockedUntil = nil }
    }
}

// MARK: - Lock window

/// Shows the lock screen in its own window above everything, including the full-screen player
/// (AVPlayerViewController is presented from UIKit, so a SwiftUI overlay would sit underneath it).
@MainActor
final class LockWindowController {
    static let shared = LockWindowController()
    private var window: UIWindow?

    func update(locked: Bool) {
        if locked { show() } else { hide() }
    }

    private func show() {
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState != .unattached }) else { return }
        let w = UIWindow(windowScene: scene)
        w.windowLevel = .alert + 1
        let host = UIHostingController(rootView: LockScreen().preferredColorScheme(.dark))
        host.view.backgroundColor = .black
        w.rootViewController = host
        w.makeKeyAndVisible()
        window = w
    }

    private func hide() {
        window?.isHidden = true
        window = nil
    }
}

// MARK: - Views

struct LockScreen: View {
    @State private var lock = AppLock.shared

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image("Wordmark")
                .resizable()
                .scaledToFit()
                .frame(height: 48)
                .accessibilityLabel("Lumio")
            PinPad(title: "PIN'ini gir") { pin in
                lock.unlock(with: pin)
            }
            if lock.useBiometrics, let name = lock.biometryName {
                Button {
                    Task { await lock.unlockWithBiometrics() }
                } label: {
                    Label("\(name) ile aç", systemImage: name == "Touch ID" ? "touchid" : "faceid")
                }
                .foregroundStyle(Theme.brand)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.surface.ignoresSafeArea())
        .task { await lock.unlockWithBiometrics() }
    }
}

/// Four dots and a number pad. `onComplete` gets the 4 digits and says whether they were right.
struct PinPad: View {
    let title: String
    var subtitle: String?
    let onComplete: (String) -> AppLock.Check

    @State private var digits = ""
    @State private var message: String?
    @State private var shake = 0

    var body: some View {
        VStack(spacing: 22) {
            VStack(spacing: 6) {
                Text(title).font(.title3.weight(.semibold))
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(Theme.muted) }
            }
            HStack(spacing: 18) {
                ForEach(0..<AppLock.pinLength, id: \.self) { i in
                    Circle()
                        .fill(i < digits.count ? Color.white : Color.white.opacity(0.18))
                        .frame(width: 14, height: 14)
                }
            }
            .modifier(Shake(amount: CGFloat(shake)))
            .accessibilityElement()
            .accessibilityLabel("\(digits.count) / \(AppLock.pinLength) rakam girildi")
            Text(message ?? " ")
                .font(.footnote)
                .foregroundStyle(.red)
                .frame(height: 18)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(78), spacing: 18), count: 3), spacing: 14) {
                ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9"], id: \.self) { key($0) }
                Color.clear.frame(width: 72, height: 72)
                key("0")
                Button {
                    if !digits.isEmpty { digits.removeLast() }
                } label: {
                    Image(systemName: "delete.left").font(.title2).frame(width: 72, height: 72)
                }
                .foregroundStyle(.white)
                .accessibilityLabel("Sil")
            }
        }
    }

    private func key(_ d: String) -> some View {
        Button {
            guard digits.count < AppLock.pinLength else { return }
            digits.append(d)
            if digits.count == AppLock.pinLength { submit() }
        } label: {
            Text(d)
                .font(.system(size: 30, weight: .regular, design: .rounded))
                .frame(width: 72, height: 72)
                .background(Circle().fill(Color.white.opacity(0.1)))
        }
        .foregroundStyle(.white)
    }

    private func submit() {
        let pin = digits
        switch onComplete(pin) {
        case .ok:
            message = nil
            digits = ""
        case .wrong(let remaining):
            message = "PIN yanlış · \(remaining) deneme hakkın kaldı"
            fail()
        case .lockedOut(let seconds):
            message = "Çok fazla yanlış deneme. \(seconds) sn sonra tekrar dene."
            fail()
        }
    }

    private func fail() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        withAnimation(.default) { shake += 1 }
        digits = ""
    }
}

private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 8 * sin(amount * .pi * 4), y: 0))
    }
}

/// Settings sheet: set a new PIN (twice), confirm the current one, or both (change).
struct PinSheet: View {
    enum Purpose { case create, confirm(String), change }
    let purpose: Purpose
    let onDone: (Bool) -> Void

    @State private var lock = AppLock.shared
    @State private var step: Step
    @State private var first = ""
    @State private var mismatch = false
    @Environment(\.dismiss) private var dismiss

    private enum Step { case current, new, repeatNew }

    init(purpose: Purpose, onDone: @escaping (Bool) -> Void) {
        self.purpose = purpose
        self.onDone = onDone
        switch purpose {
        case .create: _step = State(initialValue: .new)
        case .confirm, .change: _step = State(initialValue: .current)
        }
    }

    var body: some View {
        NavigationStack {
            VStack {
                Spacer()
                switch step {
                case .current:
                    PinPad(title: "Mevcut PIN", subtitle: confirmReason) { pin in
                        let result = lock.check(pin)
                        if result == .ok {
                            if case .change = purpose { step = .new } else { finish(true) }
                        }
                        return result
                    }
                case .new:
                    PinPad(title: "Yeni PIN",
                           subtitle: mismatch ? "PIN'ler aynı değildi, yeniden seç" : "\(AppLock.pinLength) haneli bir PIN seç") { pin in
                        first = pin
                        mismatch = false
                        step = .repeatNew
                        return .ok
                    }
                    .id("new")
                case .repeatNew:
                    PinPad(title: "PIN'i tekrar gir") { pin in
                        guard pin == first else {
                            mismatch = true
                            step = .new
                            return .ok
                        }
                        lock.setPin(pin)
                        finish(true)
                        return .ok
                    }
                    .id("repeat")
                }
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .background(Theme.surface.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { finish(false) } }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var confirmReason: String? {
        if case .confirm(let reason) = purpose { return reason }
        return nil
    }

    private func finish(_ ok: Bool) {
        onDone(ok)
        dismiss()
    }
}
