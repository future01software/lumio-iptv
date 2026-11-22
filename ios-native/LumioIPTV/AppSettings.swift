import Observation
import SwiftUI

enum AccentChoice: String, CaseIterable, Identifiable {
    case red, orange, blue, green, purple, pink
    var id: String { rawValue }

    var color: Color {
        switch self {
        case .red: Color(red: 0xE5 / 255, green: 0x09 / 255, blue: 0x14 / 255) // Lumio brand #E50914
        case .orange: Color(red: 1, green: 0x9F / 255, blue: 0x0A / 255)
        case .blue: Color(red: 0x0A / 255, green: 0x84 / 255, blue: 1)
        case .green: Color(red: 0x32 / 255, green: 0xD7 / 255, blue: 0x4B / 255)
        case .purple: Color(red: 0xBF / 255, green: 0x5A / 255, blue: 0xF2 / 255)
        case .pink: Color(red: 1, green: 0x37 / 255, blue: 0x5F / 255)
        }
    }

    var title: String {
        switch self {
        case .red: "Kırmızı (Lumio)"
        case .orange: "Turuncu"
        case .blue: "Mavi"
        case .green: "Yeşil"
        case .purple: "Mor"
        case .pink: "Pembe"
        }
    }
}

/// A settings choice shown in an inline picker.
protocol SettingChoice: CaseIterable, Identifiable, Hashable where AllCases: RandomAccessCollection {
    var title: String { get }
    var hint: String? { get }
}

extension SettingChoice where Self: RawRepresentable, RawValue == String {
    var id: String { rawValue }
}

enum PlaybackMode: String, SettingChoice {
    case fast, balanced, smooth
    var title: String {
        switch self { case .fast: "Hızlı açılış"; case .balanced: "Dengeli"; case .smooth: "Kesintisiz" }
    }
    var hint: String? {
        switch self {
        case .fast: "Kanal hemen açılır; zayıf bağlantıda takılabilir."
        case .balanced: "Çoğu bağlantı için önerilen."
        case .smooth: "Canlı yayını ~45 sn geriden oynatır; sağlayıcı arada takılsa da görüntü donmaz."
        }
    }
    /// AVPlayerItem.preferredForwardBufferDuration (0 = automatic).
    var forwardBuffer: Double { switch self { case .fast: 4; case .balanced: 0; case .smooth: 30 } }
    /// Seconds behind the live edge for live channels (desktop app's liveSyncDuration), nil = default.
    /// Some providers publish nothing for 12-14 s at a time; 45 s in hand rides that out.
    var liveOffset: Double? { self == .smooth ? 45 : nil }
    var waitsToMinimizeStalling: Bool { self != .fast }
}

enum AspectChoice: String, SettingChoice {
    case fit, zoom, fill, stretch
    var title: String {
        switch self { case .fit: "Otomatik"; case .zoom: "Yakınlaştır"; case .fill: "Ekranı kapla"; case .stretch: "Ekrana yay" }
    }
    var hint: String? {
        switch self {
        case .fit: "Görüntünün tamamı, kenarlarda boşlukla."
        case .zoom: "Siyah bantları keserek büyütür."
        case .fill: "Ekranı doldurur, kenarlardan kırpar."
        case .stretch: "Ekrana tam yayar; görüntü esneyebilir."
        }
    }
}

enum StartScreen: String, SettingChoice {
    case home, live, lastChannel
    var title: String {
        switch self { case .home: "Ana sayfa"; case .live: "Canlı TV"; case .lastChannel: "Son izlenen kanal" }
    }
    var hint: String? { self == .lastChannel ? "Son izlediğin kanal oynatıcıda açılır." : nil }
}

enum PerformanceMode: String, SettingChoice {
    case auto, light, full
    var title: String {
        switch self { case .auto: "Otomatik"; case .light: "Hafif"; case .full: "Tam" }
    }
    var hint: String? {
        switch self {
        case .auto: "Düşük Güç Modu açıkken Hafif olur."
        case .light: "Animasyonlar ve otomatik kayan vitrin kapanır; pil dostu."
        case .full: "Bütün efektler açık."
        }
    }
}

/// User preferences (non-sensitive, UserDefaults). Views read these through
/// Observation, so changing one updates every screen.
@MainActor
@Observable
final class AppSettings {
    static let shared = AppSettings()
    private let defaults = UserDefaults.standard

    var accent: AccentChoice {
        didSet { defaults.set(accent.rawValue, forKey: "lumio.accent") }
    }
    /// Hides adult categories/titles everywhere, including continue watching and recent channels.
    var hideAdult: Bool {
        didSet { defaults.set(hideAdult, forKey: "lumio.hideAdult") }
    }
    /// Wall clock in a corner while watching.
    var showClock: Bool {
        didSet { defaults.set(showClock, forKey: "lumio.showClock") }
    }
    /// Resolution / codec / fps / bitrate / buffer badges on live channels.
    var showStreamInfo: Bool {
        didSet { defaults.set(showStreamInfo, forKey: "lumio.showStreamInfo") }
    }
    /// Guide: hide channels whose schedule is empty.
    var guideHideEmpty: Bool {
        didSet { defaults.set(guideHideEmpty, forKey: "lumio.guideHideEmpty") }
    }

    var autoplay: Bool { didSet { defaults.set(autoplay, forKey: "lumio.autoplay") } }
    /// Continue movies/episodes from the saved position.
    var resume: Bool { didSet { defaults.set(resume, forKey: "lumio.resume") } }
    var playbackMode: PlaybackMode { didSet { defaults.set(playbackMode.rawValue, forKey: "lumio.playbackMode") } }
    var aspect: AspectChoice { didSet { defaults.set(aspect.rawValue, forKey: "lumio.aspect") } }
    /// Channel + playlist name for 5 s when playback starts.
    var showChannelLabel: Bool { didSet { defaults.set(showChannelLabel, forKey: "lumio.showChannelLabel") } }
    /// Shifts every guide time by this many hours (−12…12) for providers with a wrong time zone.
    var epgOffsetHours: Int { didSet { defaults.set(epgOffsetHours, forKey: "lumio.epgOffsetHours") } }
    var startScreen: StartScreen { didSet { defaults.set(startScreen.rawValue, forKey: "lumio.startScreen") } }
    var performance: PerformanceMode { didSet { defaults.set(performance.rawValue, forKey: "lumio.performance") } }

    /// Effective light mode (Otomatik follows Low Power Mode).
    var isLightMode: Bool {
        performance == .light || (performance == .auto && ProcessInfo.processInfo.isLowPowerModeEnabled)
    }

    private init() {
        autoplay = defaults.object(forKey: "lumio.autoplay") as? Bool ?? true
        resume = defaults.object(forKey: "lumio.resume") as? Bool ?? true
        playbackMode = PlaybackMode(rawValue: defaults.string(forKey: "lumio.playbackMode") ?? "") ?? .balanced
        aspect = AspectChoice(rawValue: defaults.string(forKey: "lumio.aspect") ?? "") ?? .fit
        showChannelLabel = defaults.bool(forKey: "lumio.showChannelLabel")
        epgOffsetHours = defaults.integer(forKey: "lumio.epgOffsetHours")
        startScreen = StartScreen(rawValue: defaults.string(forKey: "lumio.startScreen") ?? "") ?? .home
        performance = PerformanceMode(rawValue: defaults.string(forKey: "lumio.performance") ?? "") ?? .auto
        accent = AccentChoice(rawValue: defaults.string(forKey: "lumio.accent") ?? "") ?? .red
        hideAdult = defaults.object(forKey: "lumio.hideAdult") as? Bool ?? true
        showClock = defaults.bool(forKey: "lumio.showClock")
        showStreamInfo = defaults.object(forKey: "lumio.showStreamInfo") as? Bool ?? true
        guideHideEmpty = defaults.bool(forKey: "lumio.guideHideEmpty")
    }
}
