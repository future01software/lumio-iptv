import Foundation
import LumioCore
import Observation
import SwiftData

enum AppTab: Hashable {
    case home, live, movies, series, library
}

enum LoadState: Equatable {
    case idle, loading, loaded
    case failed(String)
}

@MainActor
@Observable
final class AppModel {
    let container: ModelContainer
    private let store = AccountStore()
    private let cache = CatalogCache()

    private(set) var accounts: [Account] = []
    private(set) var activeAccount: Account?
    private(set) var provider: ContentProvider?

    private(set) var liveState: LoadState = .idle
    private(set) var vodState: LoadState = .idle
    private(set) var live = LiveCatalog()
    private(set) var vod = VODCatalog()
    private(set) var channelsByCategory: [String: [Channel]] = [:]
    private(set) var moviesByCategory: [String: [Movie]] = [:]
    private(set) var seriesByCategory: [String: [Series]] = [:]
    private var channelIndex: [String: Channel] = [:]
    private var movieIndex: [String: Movie] = [:]
    private var seriesIndex: [String: Series] = [:]
    /// XMLTV guide keyed by epg channel id (M3U `url-tvg` or a user-provided EPG URL).
    private var guide: [String: [EPGProgram]] = [:]
    /// Unfiltered catalogs as loaded; `live`/`vod` are these minus adult content when hidden.
    private var rawLive = LiveCatalog()
    private var rawVOD = VODCatalog()

    var selectedTab: AppTab = .home
    /// Last played channels of the active account (ids only; not sensitive).
    private(set) var recentChannelIDs: [String] = []
    /// Home screen content, picked once per catalog load.
    private(set) var heroMovies: [Movie] = []
    private(set) var homeMovies: [Movie] = []
    private(set) var homeSeries: [Series] = []

    var profileName: String {
        didSet { UserDefaults.standard.set(profileName, forKey: "lumio.profileName") }
    }
    var avatar: String {
        didSet { UserDefaults.standard.set(avatar, forKey: "lumio.avatar") }
    }

    init(container: ModelContainer) {
        self.container = container
        profileName = UserDefaults.standard.string(forKey: "lumio.profileName") ?? "Profil"
        avatar = UserDefaults.standard.string(forKey: "lumio.avatar") ?? "boy_01"
        accounts = store.load()
        let activeID = store.activeAccountID
        if let account = accounts.first(where: { $0.id == activeID }) ?? accounts.first {
            activate(account)
        }
        PlaybackController.shared.container = container
    }

    // MARK: Accounts

    func addAccount(_ account: Account) async throws {
        try await ContentProvider.validate(account)
        accounts.append(account)
        store.save(accounts)
        activate(account)
    }

    func activate(_ account: Account) {
        activeAccount = account
        store.activeAccountID = account.id
        PlaybackController.shared.stop()
        PlaybackController.shared.accountID = account.id
        PlaybackController.shared.listName = account.name
        live = LiveCatalog(); vod = VODCatalog(); guide = [:]
        rawLive = LiveCatalog(); rawVOD = VODCatalog()
        channelsByCategory = [:]; moviesByCategory = [:]; seriesByCategory = [:]
        channelIndex = [:]; movieIndex = [:]; seriesIndex = [:]
        liveState = .idle; vodState = .idle
        heroMovies = []; homeMovies = []; homeSeries = []
        recentChannelIDs = UserDefaults.standard.stringArray(forKey: recentKey(account.id)) ?? []
        selectedTab = AppSettings.shared.startScreen == .home ? .home : .live
        provider = ContentProvider(account: account)
        Task {
            await loadCached(for: account.id)
            await reload()
        }
    }

    /// Shows the last saved catalogs immediately (decoded off the main thread).
    private func loadCached(for accountID: UUID) async {
        let cache = self.cache
        let (live, vod) = await Task.detached(priority: .userInitiated) {
            (cache.load(LiveCatalog.self, accountID: accountID, name: "live"),
             cache.load(VODCatalog.self, accountID: accountID, name: "vod"))
        }.value
        guard activeAccount?.id == accountID else { return }
        if let live, liveState != .loaded { applyLive(live) }
        if let vod, vodState != .loaded { applyVOD(vod) }
    }

    private func applyLive(_ catalog: LiveCatalog) {
        rawLive = catalog
        rebuildLive()
        liveState = .loaded
    }

    private func rebuildLive() {
        let catalog = AppSettings.shared.hideAdult ? ContentFilter.filter(rawLive) : rawLive
        live = catalog
        channelsByCategory = Dictionary(grouping: catalog.channels, by: \.categoryID)
        channelIndex = Dictionary(catalog.channels.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private func applyVOD(_ catalog: VODCatalog) {
        rawVOD = catalog
        rebuildVOD()
        vodState = .loaded
    }

    private func rebuildVOD() {
        let catalog = AppSettings.shared.hideAdult ? ContentFilter.filter(rawVOD) : rawVOD
        vod = catalog
        moviesByCategory = Dictionary(grouping: catalog.movies, by: \.categoryID)
        seriesByCategory = Dictionary(grouping: catalog.series, by: \.categoryID)
        movieIndex = Dictionary(catalog.movies.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        seriesIndex = Dictionary(catalog.series.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        pickHomeContent()
    }

    /// Drops the saved catalogs, cached images and guide data, then reloads from the provider.
    func clearCache() async {
        guard let account = activeAccount else { return }
        cache.remove(accountID: account.id)
        URLCache.shared.removeAllCachedResponses()
        guide = [:]
        provider = ContentProvider(account: account) // fresh EPG caches
        liveState = .idle; vodState = .idle
        await reload()
    }

    private var didRunLaunchAction = false

    /// "Uygulama açılınca: Son izlenen kanal" - plays the most recent channel once per launch.
    func runLaunchAction() async {
        guard !didRunLaunchAction else { return }
        didRunLaunchAction = true
        guard AppSettings.shared.startScreen == .lastChannel, let id = recentChannelIDs.first else { return }
        for _ in 0..<150 where liveState != .loaded { try? await Task.sleep(for: .milliseconds(200)) }
        guard let channel = channelIndex[id] else { return }
        try? await Task.sleep(for: .milliseconds(400)) // let the first screen settle before presenting
        play(channel)
    }

    /// Re-applies the adult filter after the setting changes.
    func contentFilterChanged() {
        if liveState == .loaded { rebuildLive() }
        if vodState == .loaded { heroMovies = []; rebuildVOD() }
    }

    /// Continue-watching / recent entries pass the filter when their item is still visible
    /// (adult categories removed) and the saved name isn't adult.
    func isAllowed(_ p: WatchProgress) -> Bool {
        guard AppSettings.shared.hideAdult else { return true }
        if ContentFilter.isAdultName(p.name) { return false }
        switch p.kind {
        case .movie: return vodState != .loaded || movieIndex[p.itemID] != nil
        case .episode: return vodState != .loaded || p.seriesID.map { seriesIndex[$0] != nil } ?? true
        default: return true
        }
    }

    func remove(_ account: Account) {
        accounts.removeAll { $0.id == account.id }
        store.save(accounts)
        let ctx = container.mainContext
        let id = account.id
        try? ctx.delete(model: FavoriteItem.self, where: #Predicate { $0.accountID == id })
        try? ctx.delete(model: WatchProgress.self, where: #Predicate { $0.accountID == id })
        try? ctx.save()
        cache.remove(accountID: id)
        if activeAccount?.id == account.id {
            if let next = accounts.first {
                activate(next)
            } else {
                PlaybackController.shared.stop()
                activeAccount = nil
                provider = nil
                store.activeAccountID = nil
            }
        }
    }

    // MARK: Loading

    func reload() async {
        // Channels and VOD in parallel: the home screen needs VOD, the live tab needs channels.
        async let live: Void = loadLive()
        async let vod: Void = loadVOD()
        _ = await (live, vod)
        await loadGuide()
    }

    func loadLive() async {
        guard let provider, let accountID = activeAccount?.id else { return }
        // With cached data on screen, refresh silently; errors keep the cached list.
        let hadData = liveState == .loaded
        if !hadData { liveState = .loading }
        do {
            let catalog = try await provider.liveCatalog()
            guard provider === self.provider else { return }
            applyLive(catalog)
            let cache = self.cache
            Task.detached(priority: .background) { cache.save(catalog, accountID: accountID, name: "live") }
        } catch {
            guard provider === self.provider, !hadData else { return }
            liveState = .failed(error.localizedDescription)
        }
    }

    func loadVOD() async {
        guard let provider, let accountID = activeAccount?.id else { return }
        let hadData = vodState == .loaded
        if !hadData { vodState = .loading }
        do {
            let catalog = try await provider.vodCatalog()
            guard provider === self.provider else { return }
            applyVOD(catalog)
            let cache = self.cache
            Task.detached(priority: .background) { cache.save(catalog, accountID: accountID, name: "vod") }
        } catch {
            guard provider === self.provider, !hadData else { return }
            vodState = .failed(error.localizedDescription)
        }
    }

    /// Full XMLTV guide, only when the account or playlist names one. Xtream accounts
    /// without one use per-channel `get_short_epg` instead (much lighter on a phone).
    private func loadGuide() async {
        guard let provider, let url = await provider.guideURL() else { return }
        let ids = Set(live.channels.compactMap(\.epgID))
        let pastHours: Double = live.channels.contains(where: \.hasCatchup) ? 72 : 24
        guard !ids.isEmpty,
              let programs = try? await XMLTVParser.fetch(url, channelIDs: ids, limit: 150_000, pastHours: pastHours, futureHours: 48)
        else { return }
        guard provider === self.provider else { return }
        guide = programs
    }

    /// Like the reference app: posters from the top (local-first, non-adult) categories,
    /// and a few random ones of those for the hero carousel.
    private func pickHomeContent() {
        func pick<T>(_ cats: [ContentCategory], _ byCat: [String: [T]], limit: Int, hasPoster: (T) -> Bool) -> [T] {
            var out: [T] = []
            for c in cats where !GroupSorter.isAdult(c.name) {
                for item in byCat[c.id] ?? [] where hasPoster(item) {
                    out.append(item)
                    if out.count >= limit { return out }
                }
            }
            return out
        }
        let movies = pick(vod.movieCategories, moviesByCategory, limit: 50) { $0.poster != nil }
        let ids = Set(movies.map(\.id))
        if heroMovies.isEmpty || !heroMovies.allSatisfy({ ids.contains($0.id) }) {
            heroMovies = Array(movies.shuffled().prefix(5))
        }
        homeMovies = Array(movies.prefix(20))
        homeSeries = pick(vod.seriesCategories, seriesByCategory, limit: 20) { $0.poster != nil }
    }

    /// Uses the filtered index, so hidden (adult) channels drop out too.
    var recentChannels: [Channel] { recentChannelIDs.compactMap { channelIndex[$0] } }

    func removeRecent(_ channel: Channel) {
        guard let accountID = activeAccount?.id else { return }
        recentChannelIDs.removeAll { $0 == channel.id }
        UserDefaults.standard.set(recentChannelIDs, forKey: recentKey(accountID))
    }

    /// Multi-day schedule for the guide: the XMLTV guide when there is one, else Xtream's
    /// per-channel table. nil = couldn't load (e.g. cancelled), [] = no schedule.
    func schedule(for channel: Channel) async -> [EPGProgram]? {
        if let id = channel.epgID, let programs = guide[id] { return shifted(programs) }
        guard let provider else { return nil }
        if activeAccount?.kind == .xtream { return await provider.fullSchedule(for: channel).map(shifted) }
        return []
    }

    var anyCatchup: Bool { live.channels.contains(where: \.hasCatchup) }

    func playCatchup(_ channel: Channel, _ program: EPGProgram) {
        // The guide shows shifted times; the panel expects its own.
        let d = TimeInterval(AppSettings.shared.epgOffsetHours * 3600)
        let original = EPGProgram(title: program.title, summary: program.summary, start: program.start - d, stop: program.stop - d)
        guard let url = provider?.catchupURL(channel: channel, program: original) else { return }
        PlaybackController.shared.play(PlayRequest(
            title: channel.name, subtitle: "\(program.start.hourMinute) · \(program.title)", urls: [url], isLive: false,
            kind: .live, itemID: channel.id, seriesID: nil, image: channel.logo, containerExtension: nil, resumeAt: nil))
    }

    private func recentKey(_ id: UUID) -> String { "lumio.recentChannels.\(id.uuidString)" }

    private func rememberChannel(_ channel: Channel) {
        guard let accountID = activeAccount?.id else { return }
        recentChannelIDs = Array(([channel.id] + recentChannelIDs.filter { $0 != channel.id }).prefix(12))
        UserDefaults.standard.set(recentChannelIDs, forKey: recentKey(accountID))
    }

    func nowNext(for channel: Channel) async -> NowNext? {
        if let id = channel.epgID, let programs = guide[id] { return NowNext.from(shifted(programs)) }
        guard let provider, activeAccount?.kind == .xtream else { return nil }
        let programs = await provider.shortEPG(for: channel)
        return programs.isEmpty ? nil : NowNext.from(shifted(programs))
    }

    /// Applies the user's guide hour offset.
    private func shifted(_ programs: [EPGProgram]) -> [EPGProgram] {
        let hours = AppSettings.shared.epgOffsetHours
        guard hours != 0 else { return programs }
        let d = TimeInterval(hours * 3600)
        return programs.map { EPGProgram(title: $0.title, summary: $0.summary, start: $0.start + d, stop: $0.stop + d) }
    }

    // MARK: Lookup

    func channel(id: String) -> Channel? { channelIndex[id] }
    func movie(id: String) -> Movie? { movieIndex[id] }
    func series(id: String) -> Series? { seriesIndex[id] }

    // MARK: Library

    func toggleFavorite(_ kind: ItemKind, id: String, name: String, image: URL?) {
        guard let accountID = activeAccount?.id else { return }
        let ctx = container.mainContext
        let key = FavoriteItem.key(accountID, kind, id)
        let d = FetchDescriptor<FavoriteItem>(predicate: #Predicate { $0.key == key })
        if let existing = try? ctx.fetch(d).first {
            ctx.delete(existing)
        } else {
            ctx.insert(FavoriteItem(accountID: accountID, kind: kind, itemID: id, name: name, imageURL: image))
        }
        try? ctx.save()
    }

    func progress(_ kind: ItemKind, _ id: String) -> WatchProgress? {
        guard let accountID = activeAccount?.id else { return nil }
        let key = FavoriteItem.key(accountID, kind, id)
        return try? container.mainContext.fetch(FetchDescriptor<WatchProgress>(predicate: #Predicate { $0.key == key })).first
    }

    // MARK: Playback

    func play(_ channel: Channel) {
        rememberChannel(channel)
        PlaybackController.shared.play(PlayRequest(
            title: channel.name, subtitle: nil, urls: [channel.url], isLive: true, kind: .live,
            itemID: channel.id, seriesID: nil, image: channel.logo, containerExtension: nil, resumeAt: nil))
        Task {
            if let nn = await nowNext(for: channel), let now = nn.now {
                PlaybackController.shared.updateLiveInfo(for: channel.id, subtitle: now.title, summary: now.summary)
            }
        }
    }

    func play(_ movie: Movie, fromStart: Bool = false) {
        let urls = provider?.playbackURLs(for: movie.url) ?? [movie.url]
        let resume = fromStart || !AppSettings.shared.resume ? nil : progress(.movie, movie.id).flatMap { $0.isResumable ? $0.position : nil }
        PlaybackController.shared.play(PlayRequest(
            title: movie.name, subtitle: movie.year, urls: urls, isLive: false, kind: .movie,
            itemID: movie.id, seriesID: nil, image: movie.poster, containerExtension: movie.containerExtension, resumeAt: resume))
    }

    func play(_ episode: Episode, of series: Series, fromStart: Bool = false) {
        let urls = provider?.playbackURLs(for: episode.url) ?? [episode.url]
        let resume = fromStart || !AppSettings.shared.resume ? nil : progress(.episode, episode.id).flatMap { $0.isResumable ? $0.position : nil }
        PlaybackController.shared.play(PlayRequest(
            title: series.name, subtitle: "S\(episode.season) B\(episode.number) · \(episode.title)", urls: urls,
            isLive: false, kind: .episode, itemID: episode.id, seriesID: series.id, image: series.poster,
            containerExtension: episode.containerExtension, resumeAt: resume))
    }

    /// Continue watching: rebuild the stream URL (never persisted) and play.
    func resume(_ p: WatchProgress) async {
        switch p.kind {
        case .movie:
            if let movie = movie(id: p.itemID) { play(movie) }
        case .episode:
            guard let seriesID = p.seriesID else { return }
            let series = series(id: seriesID)
            if let ep = series?.episodes.first(where: { $0.id == p.itemID }), let series {
                play(ep, of: series)
                return
            }
            guard let url = await provider?.episodeURL(episodeID: p.itemID, ext: p.containerExtension) else { return }
            let urls = provider?.playbackURLs(for: url) ?? [url]
            PlaybackController.shared.play(PlayRequest(
                title: p.name, subtitle: p.subtitle, urls: urls, isLive: false, kind: .episode, itemID: p.itemID,
                seriesID: seriesID, image: p.imageURL.flatMap(URL.init(string:)),
                containerExtension: p.containerExtension, resumeAt: p.isResumable ? p.position : nil))
        default:
            break
        }
    }
}
