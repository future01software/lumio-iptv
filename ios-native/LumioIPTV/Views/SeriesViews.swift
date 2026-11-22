import LumioCore
import SwiftData
import SwiftUI

struct SeriesListView: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \FavoriteItem.addedAt, order: .reverse) private var favorites: [FavoriteItem]
    @State private var category: String?
    @State private var didPickDefault = false
    @State private var search = ""

    var body: some View {
        NavigationStack {
            Group {
                if model.vodState == .loaded {
                    content
                } else {
                    StateView(state: model.vodState) { Task { await model.loadVOD() } }
                }
            }
            .background(Theme.surface)
            .navigationTitle("Diziler")
            .searchable(text: $search, prompt: "Dizi ara")
            .navigationDestination(for: Series.self) { SeriesDetailView(series: $0) }
        }
    }

    private var items: [Series] {
        let q = search.trimmed
        if !q.isEmpty { return model.vod.series.filter { $0.name.localizedStandardContains(q) } }
        switch category {
        case nil: return model.vod.series
        case CategoryItems.favoritesID:
            let id = model.activeAccount?.id
            return favorites.filter { $0.accountID == id && $0.kind == .series }.compactMap { model.series(id: $0.itemID) }
        case let id?: return model.seriesByCategory[id] ?? []
        }
    }

    private var content: some View {
        let list = items
        return VStack(spacing: 0) {
            if search.trimmed.isEmpty {
                CategoryBar(categories: model.vod.seriesCategories, selection: $category) { model.seriesByCategory[$0]?.count ?? 0 }
            }
            if list.isEmpty {
                ContentUnavailableView("Dizi bulunamadı", systemImage: "play.rectangle.on.rectangle")
            } else {
                ScrollView {
                    LazyVGrid(columns: posterColumns, spacing: 16) {
                        ForEach(list) { series in
                            NavigationLink(value: series) {
                                PosterCard(title: series.name, url: series.poster, badge: series.rating.flatMap(MoviesView.ratingBadge))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
                .id(category ?? "__all") // new category starts at the top
            }
        }
        .onAppear {
            guard !didPickDefault else { return }
            didPickDefault = true
            category = model.vod.seriesCategories.first?.id
        }
    }
}

struct SeriesDetailView: View {
    let series: Series

    @Environment(AppModel.self) private var model
    @Query private var favorite: [FavoriteItem]
    @Query private var progress: [WatchProgress]
    @State private var info: SeriesInfo?
    @State private var loadError: String?
    @State private var season: Int?

    init(series: Series) {
        self.series = series
        let id = series.id
        let seriesKind = ItemKind.series.rawValue
        _favorite = Query(filter: #Predicate<FavoriteItem> { $0.itemID == id && $0.kindRaw == seriesKind })
        _progress = Query(filter: #Predicate<WatchProgress> { $0.seriesID == id }, sort: \WatchProgress.updatedAt, order: .reverse)
    }

    private var accountID: UUID? { model.activeAccount?.id }
    private var isFavorite: Bool { favorite.contains { $0.accountID == accountID } }

    private var progressByEpisode: [String: WatchProgress] {
        Dictionary(progress.filter { $0.accountID == accountID }.map { ($0.itemID, $0) }, uniquingKeysWith: { a, _ in a })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DetailHeader(title: series.name, poster: series.poster, backdrop: info?.backdrop ?? series.poster, meta: meta)
                actions
                if let plot = info?.plot ?? series.plot {
                    Text(plot).font(.callout).foregroundStyle(Color(white: 0.85)).lineLimit(6)
                }
                if let genre = info?.genre { InfoLine(label: "Tür", value: genre) }
                episodesSection
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(Theme.surface)
        .ignoresSafeArea(edges: .top)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                let loaded = try await model.provider?.seriesInfo(series)
                info = loaded
                if season == nil {
                    // Open on the season of the last watched episode, else the first one.
                    let last = progress.first { $0.accountID == accountID }
                    season = loaded?.episodes.first { $0.id == last?.itemID }?.season ?? loaded?.seasons.first
                }
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    private var meta: [String] {
        var m: [String] = []
        if let y = series.year { m.append(y) }
        if let seasons = info?.seasons, !seasons.isEmpty { m.append("\(seasons.count) sezon") }
        if let r = (info?.rating ?? series.rating).flatMap(MoviesView.ratingBadge) { m.append(r) }
        return m
    }

    /// The episode to start/continue: last watched (or the one after it if finished), else the first.
    private var nextUp: (Episode, WatchProgress?)? {
        guard let episodes = info?.episodes, !episodes.isEmpty else { return nil }
        guard let last = progress.first(where: { $0.accountID == accountID }),
              let idx = episodes.firstIndex(where: { $0.id == last.itemID }) else { return (episodes[0], nil) }
        if last.isResumable { return (episodes[idx], last) }
        return idx + 1 < episodes.count ? (episodes[idx + 1], nil) : (episodes[idx], last)
    }

    private var actions: some View {
        HStack(spacing: 10) {
            Button {
                if let (ep, _) = nextUp { model.play(ep, of: series) }
            } label: {
                Group {
                    if let (ep, p) = nextUp {
                        Label(p?.isResumable == true ? "Devam et · S\(ep.season) B\(ep.number)" : "Oynat · S\(ep.season) B\(ep.number)",
                              systemImage: "play.fill")
                    } else {
                        Label("Oynat", systemImage: "play.fill")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(nextUp == nil)

            Button {
                model.toggleFavorite(.series, id: series.id, name: series.name, image: series.poster)
            } label: {
                Image(systemName: isFavorite ? "heart.fill" : "heart")
                    .foregroundStyle(isFavorite ? Theme.brand : .white)
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityLabel(isFavorite ? "Listemden çıkar" : "Listeme ekle")
        }
    }

    @ViewBuilder
    private var episodesSection: some View {
        if let info {
            if info.episodes.isEmpty {
                Text("Bu dizi için bölüm bulunamadı.").foregroundStyle(Theme.muted)
            } else {
                if info.seasons.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(info.seasons, id: \.self) { s in
                                Button("Sezon \(s)") { season = s }
                                    .font(.subheadline.weight(.semibold))
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(s == season ? Theme.brand : Theme.surface2, in: Capsule())
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                }
                let progressMap = progressByEpisode
                LazyVStack(spacing: 12) {
                    ForEach(info.episodes.filter { $0.season == (season ?? info.seasons.first) }) { ep in
                        EpisodeRow(episode: ep, fallbackImage: series.poster, progress: progressMap[ep.id]) {
                            model.play(ep, of: series)
                        }
                    }
                }
            }
        } else if let loadError {
            Label(loadError, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.muted)
        } else {
            ProgressView().tint(Theme.brand).frame(maxWidth: .infinity).padding()
        }
    }
}

struct EpisodeRow: View {
    let episode: Episode
    let fallbackImage: URL?
    let progress: WatchProgress?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                RemoteImage(url: episode.still ?? fallbackImage, placeholderText: "\(episode.number)")
                    .frame(width: 128, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(alignment: .bottom) {
                        if let progress, progress.fraction > 0 { ProgressBar(value: progress.fraction).padding(4) }
                    }
                    .overlay { Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.white.opacity(0.85)) }
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(episode.number). \(episode.title)")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    if let d = episode.durationSeconds, d > 0 {
                        Text(d.durationText).font(.caption).foregroundStyle(Theme.muted)
                    }
                    if let plot = episode.plot {
                        Text(plot).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
