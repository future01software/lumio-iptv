import SwiftUI

/// Colors from the Lumio design tokens (frontend/src/theme/tokens.ts).
enum Theme {
    /// User-selectable accent; Lumio red (#E50914) by default.
    @MainActor static var brand: Color { AppSettings.shared.accent.color }
    static let surface = Color.black
    static let surface2 = Color(white: 0x1A / 255)
    static let surface3 = Color(white: 0x26 / 255)
    static let muted = Color(red: 0x9C / 255, green: 0xA3 / 255, blue: 0xAF / 255)
    static let border = Color(white: 0x33 / 255)
}

enum Avatars {
    static let all: [String] = (1...20).map { String(format: "boy_%02d", $0) } + (1...20).map { String(format: "girl_%02d", $0) }

    static func image(_ name: String) -> Image {
        if let path = Bundle.main.path(forResource: name, ofType: "png"), let ui = UIImage(contentsOfFile: path) {
            return Image(uiImage: ui)
        }
        return Image(systemName: "person.crop.circle.fill")
    }
}

extension Double {
    /// 1:23:45 / 23:45
    var clockString: String {
        guard isFinite, self >= 0 else { return "" }
        let s = Int(self)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// "1 sa 42 dk"
    var durationText: String {
        let m = Int(self) / 60
        return m >= 60 ? "\(m / 60) sa \(m % 60) dk" : "\(m) dk"
    }
}

extension Date {
    var hourMinute: String { formatted(date: .omitted, time: .shortened) }
}
