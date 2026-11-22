import Foundation

public struct XtreamCredentials: Sendable, Hashable {
    public let server: String
    public let username: String
    public let password: String

    public init(server: String, username: String, password: String) {
        self.server = XtreamClient.cleanServer(server)
        self.username = username.trimmingCharacters(in: .whitespacesAndNewlines)
        self.password = password.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public struct XtreamAccountInfo: Sendable {
    public let status: String?
    public let expiresAt: Date?
    public let maxConnections: Int?
}

/// Port of Lumio's local-provider.ts Xtream logic (player_api.php).
public struct XtreamClient: Sendable {
    public let credentials: XtreamCredentials

    public init(credentials: XtreamCredentials) { self.credentials = credentials }

    /// Same cleanup the backend applied to user-entered server URLs.
    public static func cleanServer(_ server: String) -> String {
        var s = String(server.unicodeScalars.filter { $0.value > 32 && $0.value < 127 })
        while s.hasSuffix("/") { s.removeLast() }
        for suffix in ["/player_api.php", "/get.php"] where s.hasSuffix(suffix) { s.removeLast(suffix.count) }
        while s.hasSuffix("/") { s.removeLast() }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "http://" + s }
        return s
    }

    // MARK: URLs

    private func pathComponent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? s
    }

    private func streamURL(_ kind: String, _ id: String, _ ext: String) -> URL? {
        let c = credentials
        return URL(string: "\(c.server)/\(kind)/\(pathComponent(c.username))/\(pathComponent(c.password))/\(id).\(ext)")
    }

    public func liveURL(streamID: String) -> URL? { streamURL("live", streamID, "m3u8") }
    public func movieURL(streamID: String, ext: String?) -> URL? { streamURL("movie", streamID, ext.nonEmpty ?? "mp4") }
    public func episodeURL(episodeID: String, ext: String?) -> URL? { streamURL("series", episodeID, ext.nonEmpty ?? "mp4") }

    public var xmltvURL: URL? {
        var comps = URLComponents(string: "\(credentials.server)/xmltv.php")
        comps?.queryItems = [.init(name: "username", value: credentials.username), .init(name: "password", value: credentials.password)]
        return comps?.url
    }

    // MARK: API

    private func get(_ action: String? = nil, _ extra: [String: String] = [:]) async throws -> Any {
        guard var comps = URLComponents(string: "\(credentials.server)/player_api.php") else { throw ProviderError.invalidURL }
        var items: [URLQueryItem] = [.init(name: "username", value: credentials.username),
                                     .init(name: "password", value: credentials.password)]
        if let action { items.append(.init(name: "action", value: action)) }
        items += extra.map { URLQueryItem(name: $0.key, value: $0.value) }
        comps.queryItems = items
        // `+` is legal in a query but servers decode it as a space - escape it.
        comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = comps.url else { throw ProviderError.invalidURL }
        let data = try await HTTP.data(url, timeout: action == nil ? 20 : 60)
        guard !data.isEmpty else { return [Any]() }
        do {
            return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        } catch {
            throw ProviderError.invalidResponse
        }
    }

    @discardableResult
    public func authenticate() async throws -> XtreamAccountInfo {
        let info = try await get() as? [String: Any]
        guard let user = info?["user_info"] as? [String: Any] else { throw ProviderError.badCredentials }
        if JSONValue.int(user["auth"]) == 0 { throw ProviderError.badCredentials }
        let status = JSONValue.string(user["status"])
        if let status, status.lowercased() != "active" { throw ProviderError.accountExpired }
        let exp = JSONValue.double(user["exp_date"]).map { Date(timeIntervalSince1970: $0) }
        return XtreamAccountInfo(status: status, expiresAt: exp, maxConnections: JSONValue.int(user["max_connections"]))
    }

    private func categories(_ action: String) async throws -> [ContentCategory] {
        let raw = try await get(action) as? [[String: Any]] ?? []
        let cats = raw.compactMap { c -> ContentCategory? in
            guard let id = JSONValue.string(c["category_id"]) else { return nil }
            return ContentCategory(id: id, name: JSONValue.string(c["category_name"]) ?? "Kategorisiz")
        }
        return GroupSorter.sort(cats)
    }

    private func list(_ action: String) async throws -> [[String: Any]] {
        try await get(action) as? [[String: Any]] ?? []
    }

    public func liveCatalog() async throws -> LiveCatalog {
        async let cats = categories("get_live_categories")
        async let streams = list("get_live_streams")
        let (categories, raw) = try await (cats, streams)
        let known = Set(categories.map(\.id))
        let channels = raw.compactMap { s -> Channel? in
            guard let id = JSONValue.string(s["stream_id"]), let url = liveURL(streamID: id) else { return nil }
            return Channel(id: id, name: JSONValue.string(s["name"]) ?? "Adsız", logo: JSONValue.url(s["stream_icon"]),
                           categoryID: Self.category(s, known), url: url,
                           epgID: JSONValue.string(s["epg_channel_id"]), number: JSONValue.int(s["num"]),
                           catchupDays: JSONValue.int(s["tv_archive"]) == 1 ? max(1, JSONValue.int(s["tv_archive_duration"]) ?? 1) : nil)
        }
        return LiveCatalog(categories: categories.withUncategorized(using: channels.map(\.categoryID)), channels: channels)
    }

    public func vodCatalog() async throws -> VODCatalog {
        async let vodCats = categories("get_vod_categories")
        async let serCats = categories("get_series_categories")
        async let vodRaw = list("get_vod_streams")
        async let serRaw = list("get_series")
        let (mc, sc, vr, sr) = try await (vodCats, serCats, vodRaw, serRaw)
        let movieKnown = Set(mc.map(\.id)), seriesKnown = Set(sc.map(\.id))
        let movies = vr.compactMap { s -> Movie? in
            guard let id = JSONValue.string(s["stream_id"]) else { return nil }
            let ext = JSONValue.string(s["container_extension"])
            guard let url = movieURL(streamID: id, ext: ext) else { return nil }
            return Movie(id: id, name: JSONValue.string(s["name"]) ?? "Adsız", poster: JSONValue.url(s["stream_icon"]),
                         categoryID: Self.category(s, movieKnown), url: url, containerExtension: ext,
                         year: JSONValue.string(s["year"]), rating: JSONValue.string(s["rating"]))
        }
        let series = sr.compactMap { s -> Series? in
            guard let id = JSONValue.string(s["series_id"]) else { return nil }
            return Series(id: id, name: JSONValue.string(s["name"]) ?? "Adsız", poster: JSONValue.url(s["cover"]),
                          categoryID: Self.category(s, seriesKnown), plot: JSONValue.string(s["plot"]),
                          year: JSONValue.string(s["year"]) ?? JSONValue.string(s["releaseDate"]).map { String($0.prefix(4)) },
                          rating: JSONValue.string(s["rating"]), episodes: [])
        }
        return VODCatalog(movieCategories: mc.withUncategorized(using: movies.map(\.categoryID)), movies: movies,
                          seriesCategories: sc.withUncategorized(using: series.map(\.categoryID)), series: series)
    }

    public func movieInfo(id: String) async throws -> MovieInfo {
        let root = try await get("get_vod_info", ["vod_id": id]) as? [String: Any]
        let info = root?["info"] as? [String: Any] ?? [:]
        var out = MovieInfo()
        out.plot = JSONValue.string(info["plot"]) ?? JSONValue.string(info["description"])
        out.genre = JSONValue.string(info["genre"])
        out.cast = JSONValue.string(info["cast"]) ?? JSONValue.string(info["actors"])
        out.director = JSONValue.string(info["director"])
        out.releaseDate = JSONValue.string(info["releasedate"]) ?? JSONValue.string(info["release_date"])
        out.durationSeconds = JSONValue.double(info["duration_secs"])
        out.rating = JSONValue.string(info["rating"])
        out.backdrop = Self.firstURL(info["backdrop_path"]) ?? JSONValue.url(info["movie_image"])
        return out
    }

    public func seriesInfo(id: String) async throws -> SeriesInfo {
        let root = try await get("get_series_info", ["series_id": id]) as? [String: Any] ?? [:]
        let info = root["info"] as? [String: Any] ?? [:]
        var out = SeriesInfo()
        out.plot = JSONValue.string(info["plot"])
        out.genre = JSONValue.string(info["genre"])
        out.cast = JSONValue.string(info["cast"])
        out.rating = JSONValue.string(info["rating"])
        out.backdrop = Self.firstURL(info["backdrop_path"]) ?? JSONValue.url(info["cover"])

        // `episodes` is {"1": [...], "2": [...]} on most panels, a flat array on a few.
        var raw: [(String, [String: Any])] = []
        if let bySeason = root["episodes"] as? [String: Any] {
            for (season, list) in bySeason { for e in list as? [[String: Any]] ?? [] { raw.append((season, e)) } }
        } else if let flat = root["episodes"] as? [[String: Any]] {
            raw = flat.map { (JSONValue.string($0["season"]) ?? "1", $0) }
        }
        out.episodes = raw.compactMap { season, e in
            guard let eid = JSONValue.string(e["id"]) else { return nil }
            let ext = JSONValue.string(e["container_extension"])
            guard let url = episodeURL(episodeID: eid, ext: ext) else { return nil }
            let einfo = e["info"] as? [String: Any] ?? [:]
            return Episode(id: eid, title: JSONValue.string(e["title"]) ?? "Bölüm",
                           season: JSONValue.int(e["season"]) ?? Int(season) ?? 1,
                           number: JSONValue.int(e["episode_num"]) ?? 1, url: url, containerExtension: ext,
                           still: JSONValue.url(einfo["movie_image"]), plot: JSONValue.string(einfo["plot"]),
                           durationSeconds: JSONValue.double(einfo["duration_secs"]))
        }.sorted { ($0.season, $0.number) < ($1.season, $1.number) }
        return out
    }

    /// Now/next for one channel. Titles and descriptions are base64 on Xtream panels.
    public func shortEPG(streamID: String, limit: Int = 4) async throws -> [EPGProgram] {
        let root = try await get("get_short_epg", ["stream_id": streamID, "limit": String(limit)]) as? [String: Any]
        return Self.listings(root)
    }

    /// Full schedule the panel keeps for a channel (past days too on catch-up channels).
    public func fullEPG(streamID: String) async throws -> [EPGProgram] {
        let root = try await get("get_simple_data_table", ["stream_id": streamID]) as? [String: Any]
        var seen = Set<Date>()
        return Self.listings(root).sorted { $0.start < $1.start }.filter { seen.insert($0.start).inserted }
    }

    /// Timeshift (catch-up) URL. Like the Lumio desktop/Android apps, the start is given in UTC.
    public func timeshiftURL(streamID: String, start: Date, durationMinutes: Int) -> URL? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd:HH-mm"
        let c = credentials
        return URL(string: "\(c.server)/timeshift/\(pathComponent(c.username))/\(pathComponent(c.password))/\(durationMinutes)/\(f.string(from: start))/\(streamID).m3u8")
    }

    static func listings(_ root: [String: Any]?) -> [EPGProgram] {
        let listings = root?["epg_listings"] as? [[String: Any]] ?? []
        return listings.compactMap { l in
            guard let start = JSONValue.double(l["start_timestamp"]),
                  let stop = JSONValue.double(l["stop_timestamp"]) else { return nil }
            return EPGProgram(title: Self.base64(l["title"]) ?? "", summary: Self.base64(l["description"]),
                              start: Date(timeIntervalSince1970: start), stop: Date(timeIntervalSince1970: stop))
        }
    }

    /// Items pointing at a category the provider didn't list go to "Kategorisiz" (id "").
    static func category(_ item: [String: Any], _ known: Set<String>) -> String {
        let id = JSONValue.string(item["category_id"]) ?? ""
        return known.contains(id) ? id : ""
    }

    static func base64(_ any: Any?) -> String? {
        guard let s = JSONValue.string(any) else { return nil }
        if let d = Data(base64Encoded: s, options: .ignoreUnknownCharacters), let decoded = String(data: d, encoding: .utf8) {
            return decoded.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        }
        return s
    }

    static func firstURL(_ any: Any?) -> URL? {
        if let arr = any as? [Any] { return arr.lazy.compactMap(JSONValue.url).first }
        return JSONValue.url(any)
    }
}

extension Optional where Wrapped == String {
    var nonEmpty: String? { self.flatMap { $0.isEmpty ? nil : $0 } }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

extension Array where Element == ContentCategory {
    /// Adds a catch-all category for items whose category id the provider didn't list.
    func withUncategorized(using ids: [String]) -> [ContentCategory] {
        let known = Set(map(\.id))
        return ids.contains(where: { !known.contains($0) }) ? self + [ContentCategory(id: "", name: "Kategorisiz")] : self
    }
}
