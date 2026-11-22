import Foundation

/// One entry point over Xtream and M3U accounts, used by the iPhone app (and a future tvOS app).
public actor ContentProvider {
    public let account: Account
    private var m3u: M3UPlaylist?
    private var shortEPGCache: [String: (programs: [EPGProgram], fetchedAt: Date)] = [:]
    private var fullEPGCache: [String: (programs: [EPGProgram], fetchedAt: Date)] = [:]

    public init(account: Account) { self.account = account }

    private var xtream: XtreamClient? { account.xtreamCredentials.map(XtreamClient.init) }

    /// Validates a new account before it is saved.
    public static func validate(_ account: Account) async throws {
        switch account.kind {
        case .xtream:
            guard let creds = account.xtreamCredentials else { throw ProviderError.missingCredentials }
            try await XtreamClient(credentials: creds).authenticate()
        case .m3u:
            guard let url = URL(string: account.m3uURL.trimmingCharacters(in: .whitespaces)), url.scheme?.hasPrefix("http") == true
            else { throw ProviderError.invalidURL }
            _ = try await M3UParser.fetch(url)
        }
    }

    public func accountInfo() async throws -> XtreamAccountInfo? {
        try await xtream?.authenticate()
    }

    private func loadM3U() async throws -> M3UPlaylist {
        if let m3u { return m3u }
        guard let url = URL(string: account.m3uURL.trimmingCharacters(in: .whitespaces)) else { throw ProviderError.invalidURL }
        let parsed = try await M3UParser.fetch(url)
        m3u = parsed
        return parsed
    }

    public func liveCatalog() async throws -> LiveCatalog {
        if let xtream { return try await xtream.liveCatalog() }
        return try await loadM3U().live
    }

    public func vodCatalog() async throws -> VODCatalog {
        if let xtream { return try await xtream.vodCatalog() }
        return try await loadM3U().vod
    }

    public func movieInfo(_ movie: Movie) async throws -> MovieInfo {
        guard let xtream else { return MovieInfo() }
        return try await xtream.movieInfo(id: movie.id)
    }

    public func seriesInfo(_ series: Series) async throws -> SeriesInfo {
        guard let xtream else {
            var info = SeriesInfo()
            info.episodes = series.episodes
            return info
        }
        return try await xtream.seriesInfo(id: series.id)
    }

    /// Rebuilds a stream URL for "continue watching" entries (URLs are never persisted).
    public func episodeURL(episodeID: String, ext: String?) -> URL? {
        xtream?.episodeURL(episodeID: episodeID, ext: ext)
    }

    /// Alternative URLs to try when AVPlayer can't open the original container
    /// (e.g. MKV): many Xtream panels also serve VOD as HLS.
    public nonisolated func playbackURLs(for url: URL) -> [URL] {
        guard account.kind == .xtream else { return [url] }
        let ext = url.pathExtension.lowercased()
        guard ext != "m3u8" else { return [url] }
        let hls = url.deletingPathExtension().appendingPathExtension("m3u8")
        return ["mp4", "m4v", "mov"].contains(ext) ? [url, hls] : [hls, url]
    }

    /// XMLTV guide URL: the account's own, the playlist header's, or Xtream's xmltv.php.
    public func guideURL() async -> URL? {
        if let u = URL(string: account.epgURL.trimmingCharacters(in: .whitespaces)), u.scheme != nil { return u }
        if account.kind == .m3u { return m3u?.epgURL }
        return nil
    }

    /// Xtream now/next for one channel, cached until the current programme ends.
    public func shortEPG(for channel: Channel) async -> [EPGProgram] {
        guard let xtream else { return [] }
        let now = Date()
        if let cached = shortEPGCache[channel.id] {
            let stillValid = cached.programs.first(where: { $0.stop > now }).map { $0.start <= now } ?? false
            if stillValid || now.timeIntervalSince(cached.fetchedAt) < 300 { return cached.programs }
        }
        let programs: [EPGProgram]
        do {
            programs = try await xtream.shortEPG(streamID: channel.id)
        } catch is CancellationError {
            return [] // row scrolled away; don't cache
        } catch {
            programs = [] // provider has no guide for it; don't ask again for a while
        }
        shortEPGCache[channel.id] = (programs, now)
        return programs
    }

    /// Full multi-day schedule for the guide (Xtream), cached for 30 minutes.
    public func fullSchedule(for channel: Channel) async -> [EPGProgram]? {
        guard let xtream else { return nil }
        if let cached = fullEPGCache[channel.id], Date().timeIntervalSince(cached.fetchedAt) < 1800 { return cached.programs }
        do {
            let programs = try await xtream.fullEPG(streamID: channel.id)
            fullEPGCache[channel.id] = (programs, Date())
            return programs
        } catch is CancellationError {
            return nil
        } catch {
            fullEPGCache[channel.id] = ([], Date())
            return []
        }
    }

    /// Catch-up URL for a past programme, when the channel and account support it.
    public nonisolated func catchupURL(channel: Channel, program: EPGProgram) -> URL? {
        guard channel.hasCatchup, let xtream = account.xtreamCredentials.map(XtreamClient.init) else { return nil }
        let minutes = max(1, Int(program.stop.timeIntervalSince(program.start) / 60))
        return xtream.timeshiftURL(streamID: channel.id, start: program.start, durationMinutes: minutes)
    }
}
