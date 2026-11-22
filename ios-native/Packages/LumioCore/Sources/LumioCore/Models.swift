import Foundation

// MARK: - Account

public enum AccountKind: String, Codable, Sendable, CaseIterable {
    case xtream, m3u
}

/// A provider login. The whole value (including the password and the M3U URL, which
/// often embeds credentials too) is persisted only in the Keychain - see `AccountStore`.
public struct Account: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var kind: AccountKind
    public var server: String
    public var username: String
    public var password: String
    public var m3uURL: String
    public var epgURL: String

    public init(id: UUID = UUID(), name: String, kind: AccountKind,
                server: String = "", username: String = "", password: String = "",
                m3uURL: String = "", epgURL: String = "") {
        self.id = id
        self.name = name
        self.kind = kind
        self.server = server
        self.username = username
        self.password = password
        self.m3uURL = m3uURL
        self.epgURL = epgURL
    }

    public var xtreamCredentials: XtreamCredentials? {
        guard kind == .xtream, !server.isEmpty, !username.isEmpty, !password.isEmpty else { return nil }
        return XtreamCredentials(server: server, username: username, password: password)
    }
}

extension Account: CustomStringConvertible, CustomDebugStringConvertible {
    // Never let credentials reach logs through string interpolation.
    public var description: String { "Account(\(name), \(kind.rawValue))" }
    public var debugDescription: String { description }
}

// MARK: - Content

public struct ContentCategory: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}

public struct Channel: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let logo: URL?
    public let categoryID: String
    public let url: URL
    /// XMLTV channel id (`tvg-id` / `epg_channel_id`).
    public let epgID: String?
    public let number: Int?
    /// Days of catch-up (timeshift) the provider keeps for this channel; nil/0 = none.
    public let catchupDays: Int?

    public init(id: String, name: String, logo: URL?, categoryID: String, url: URL, epgID: String?, number: Int?,
                catchupDays: Int? = nil) {
        self.id = id; self.name = name; self.logo = logo; self.categoryID = categoryID
        self.url = url; self.epgID = epgID; self.number = number; self.catchupDays = catchupDays
    }

    public var hasCatchup: Bool { (catchupDays ?? 0) > 0 }
}

public struct Movie: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let poster: URL?
    public let categoryID: String
    public let url: URL
    public let containerExtension: String?
    public let year: String?
    public let rating: String?

    public init(id: String, name: String, poster: URL?, categoryID: String, url: URL,
                containerExtension: String?, year: String?, rating: String?) {
        self.id = id; self.name = name; self.poster = poster; self.categoryID = categoryID; self.url = url
        self.containerExtension = containerExtension; self.year = year; self.rating = rating
    }
}

public struct Episode: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let season: Int
    public let number: Int
    public let url: URL
    public let containerExtension: String?
    public let still: URL?
    public let plot: String?
    public let durationSeconds: Double?

    public init(id: String, title: String, season: Int, number: Int, url: URL, containerExtension: String?,
                still: URL?, plot: String?, durationSeconds: Double?) {
        self.id = id; self.title = title; self.season = season; self.number = number; self.url = url
        self.containerExtension = containerExtension; self.still = still; self.plot = plot
        self.durationSeconds = durationSeconds
    }
}

public struct Series: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let poster: URL?
    public let categoryID: String
    public let plot: String?
    public let year: String?
    public let rating: String?
    /// Filled for M3U playlists; Xtream series load episodes on demand (`seriesInfo`).
    public let episodes: [Episode]

    public init(id: String, name: String, poster: URL?, categoryID: String, plot: String?,
                year: String?, rating: String?, episodes: [Episode]) {
        self.id = id; self.name = name; self.poster = poster; self.categoryID = categoryID
        self.plot = plot; self.year = year; self.rating = rating; self.episodes = episodes
    }
}

public struct MovieInfo: Sendable {
    public var plot: String?
    public var genre: String?
    public var cast: String?
    public var director: String?
    public var releaseDate: String?
    public var durationSeconds: Double?
    public var rating: String?
    public var backdrop: URL?
    public init() {}
}

public struct SeriesInfo: Sendable {
    public var plot: String?
    public var genre: String?
    public var cast: String?
    public var rating: String?
    public var backdrop: URL?
    public var episodes: [Episode] = []
    public init() {}

    public var seasons: [Int] { Array(Set(episodes.map(\.season))).sorted() }
}

public struct EPGProgram: Hashable, Sendable {
    public let title: String
    public let summary: String?
    public let start: Date
    public let stop: Date

    public init(title: String, summary: String?, start: Date, stop: Date) {
        self.title = title; self.summary = summary; self.start = start; self.stop = stop
    }

    public func progress(at now: Date = Date()) -> Double {
        let total = stop.timeIntervalSince(start)
        guard total > 0 else { return 0 }
        return min(1, max(0, now.timeIntervalSince(start) / total))
    }
}

public struct NowNext: Sendable, Hashable {
    public let now: EPGProgram?
    public let next: EPGProgram?
    public init(now: EPGProgram?, next: EPGProgram?) { self.now = now; self.next = next }

    public static func from(_ programs: [EPGProgram], at date: Date = Date()) -> NowNext {
        let sorted = programs.sorted { $0.start < $1.start }
        guard let idx = sorted.firstIndex(where: { $0.start <= date && $0.stop > date }) else {
            return NowNext(now: nil, next: sorted.first { $0.start > date })
        }
        return NowNext(now: sorted[idx], next: idx + 1 < sorted.count ? sorted[idx + 1] : nil)
    }
}

public struct LiveCatalog: Codable, Sendable {
    public var categories: [ContentCategory]
    public var channels: [Channel]
    public init(categories: [ContentCategory] = [], channels: [Channel] = []) {
        self.categories = categories; self.channels = channels
    }
}

public struct VODCatalog: Codable, Sendable {
    public var movieCategories: [ContentCategory]
    public var movies: [Movie]
    public var seriesCategories: [ContentCategory]
    public var series: [Series]
    public init(movieCategories: [ContentCategory] = [], movies: [Movie] = [],
                seriesCategories: [ContentCategory] = [], series: [Series] = []) {
        self.movieCategories = movieCategories; self.movies = movies
        self.seriesCategories = seriesCategories; self.series = series
    }
}

// MARK: - Errors

public enum ProviderError: LocalizedError, Equatable {
    case missingCredentials
    case badCredentials
    case accountExpired
    case http(Int)
    case timeout
    case unreachable
    case invalidResponse
    case emptyPlaylist
    case invalidURL

    public var errorDescription: String? {
        switch self {
        case .missingCredentials: "Sunucu, kullanıcı adı ve şifre gerekli."
        case .badCredentials: "Kullanıcı adı veya şifre hatalı."
        case .accountExpired: "Hesabın süresi dolmuş ya da hesap aktif değil."
        case .http(let code): "Sağlayıcı yanıt vermedi (HTTP \(code))."
        case .timeout: "Sağlayıcı zaman aşımına uğradı."
        case .unreachable: "Sağlayıcıya bağlanılamadı."
        case .invalidResponse: "Sağlayıcıdan geçersiz yanıt geldi."
        case .emptyPlaylist: "Listede oynatılabilir içerik bulunamadı."
        case .invalidURL: "Adres geçersiz."
        }
    }
}
