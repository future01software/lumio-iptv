import Combine
import LumioCore
import SwiftData
import SwiftUI

/// "Ana Sayfa": featured carousel plus rows, modeled on the reference app's home tab.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \WatchProgress.updatedAt, order: .reverse) private var allProgress: [WatchProgress]
    @Query(sort: \FavoriteItem.addedAt, order: .reverse) private var allFavorites: [FavoriteItem]

    @State private var showSettings = false

    private var accountID: UUID? { model.activeAccount?.id }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if model.heroMovies.isEmpty {
                        HeroPlaceholder(loading: model.vodState == .loading || model.vodState == .idle)
                    } else {
                        HeroCarousel(movies: model.heroMovies)
                    }

                    let continueItems = ContinueWatchingRow.items(from: allProgress, accountID: accountID).filter(model.isAllowed)
                    if !continueItems.isEmpty {
                        HomeSection(title: "İzlemeye Devam Et") { ContinueWatchingRow(items: continueItems) }
                    }

                    if !model.recentChannels.isEmpty {
                        HomeSection(title: "Son Kanallar", more: .live) { ChannelStrip(channels: model.recentChannels) }
                    }

                    if !model.homeMovies.isEmpty {
                        HomeSection(title: "Popüler Filmler", more: .movies) {
                            PosterStrip(items: model.homeMovies.map { .movie($0) })
                        }
                    }

                    if !model.homeSeries.isEmpty {
                        HomeSection(title: "Popüler Diziler", more: .series) {
                            PosterStrip(items: model.homeSeries.map { .series($0) })
                        }
                    }

                    let favorites = favoriteItems
                    if !favorites.isEmpty {
                        HomeSection(title: "Favoriler", more: .library) { PosterStrip(items: favorites) }
                    }
                }
                .padding(.bottom, 32)
            }
            .background(Theme.surface)
            .ignoresSafeArea(edges: .top)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Movie.self) { MovieDetailView(movie: $0) }
            .navigationDestination(for: Series.self) { SeriesDetailView(series: $0) }
            .refreshable { await model.reload() }
            .overlay(alignment: .topTrailing) {
                Button { showSettings = true } label: {
                    Avatars.image(model.avatar)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 36, height: 36)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Theme.brand, lineWidth: 1.5))
                }
                .accessibilityLabel("Profil ve ayarlar")
                .padding(.trailing, 20)
                .padding(.top, 8)
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }

    private var favoriteItems: [PosterStrip.Item] {
        allFavorites.filter { $0.accountID == accountID }.prefix(10).compactMap { fav in
            switch fav.kind {
            case .movie: model.movie(id: fav.itemID).map { .movie($0) }
            case .series: model.series(id: fav.itemID).map { .series($0) }
            default: nil
            }
        }
    }
}

// MARK: - Hero

private struct HeroCarousel: View {
    let movies: [Movie]
    @Environment(AppModel.self) private var model
    @State private var index = 0
    private let timer = Timer.publish(every: 7, on: .main, in: .common).autoconnect()

    var body: some View {
        TabView(selection: $index) {
            ForEach(Array(movies.enumerated()), id: \.offset) { i, movie in
                HeroSlide(movie: movie).tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(height: 560)
        .overlay(alignment: .topLeading) {
            Image("Wordmark")
                .resizable()
                .scaledToFit()
                .frame(height: 30)
                .padding(.leading, 20)
                .padding(.top, 62)
                .allowsHitTesting(false)
        }
        .overlay(alignment: .bottom) {
            HStack(spacing: 6) {
                ForEach(movies.indices, id: \.self) { i in
                    Capsule()
                        .fill(i == index ? Theme.brand : Color.white.opacity(0.35))
                        .frame(width: i == index ? 18 : 6, height: 6)
                }
            }
            .padding(.bottom, 8)
            .animation(.easeInOut(duration: 0.2), value: index)
        }
        .onReceive(timer) { _ in
            guard movies.count > 1, !AppSettings.shared.isLightMode else { return }
            withAnimation(.easeInOut(duration: 0.5)) { index = (index + 1) % movies.count }
        }
    }
}

private struct HeroSlide: View {
    let movie: Movie
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: movie.poster, placeholderText: movie.name)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .overlay(
                    LinearGradient(stops: [
                        .init(color: .black.opacity(0.55), location: 0),
                        .init(color: .clear, location: 0.25),
                        .init(color: .clear, location: 0.5),
                        .init(color: .black.opacity(0.85), location: 0.82),
                        .init(color: .black, location: 1),
                    ], startPoint: .top, endPoint: .bottom))

            VStack(alignment: .leading, spacing: 10) {
                Text("ÖNE ÇIKAN")
                    .font(.caption.weight(.heavy))
                    .tracking(1.5)
                    .foregroundStyle(Theme.brand)
                Text(movie.name)
                    .font(.largeTitle.bold())
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let meta = meta { Text(meta).font(.subheadline).foregroundStyle(Color(white: 0.8)) }
                HStack(spacing: 10) {
                    Button { model.play(movie) } label: {
                        Label("Oynat", systemImage: "play.fill").frame(minWidth: 110)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    NavigationLink(value: movie) {
                        Label("Gözat", systemImage: "info.circle")
                            .font(.headline)
                            .padding(.vertical, 13)
                            .padding(.horizontal, 18)
                            .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 44)
        }
    }

    private var meta: String? {
        let parts = [movie.year, movie.rating.flatMap(MoviesView.ratingBadge)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }
}

private struct HeroPlaceholder: View {
    let loading: Bool
    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.surface2, Theme.surface], startPoint: .top, endPoint: .bottom)
            VStack(spacing: 14) {
                Image("Wordmark").resizable().scaledToFit().frame(height: 40)
                if loading { ProgressView().tint(Theme.brand) }
            }
        }
        .frame(height: 320)
    }
}

// MARK: - Rows

private struct HomeSection<Content: View>: View {
    let title: String
    var more: AppTab?
    @ViewBuilder let content: Content
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title3.bold())
                Spacer()
                if let more {
                    Button("Tümünü gör") { model.selectedTab = more }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 16)
            content
        }
    }
}

struct PosterStrip: View {
    enum Item: Hashable {
        case movie(Movie)
        case series(Series)
    }

    let items: [Item]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(items, id: \.self) { item in
                    switch item {
                    case .movie(let m):
                        NavigationLink(value: m) { PosterCard(title: m.name, url: m.poster).frame(width: 112) }
                            .buttonStyle(.plain)
                    case .series(let s):
                        NavigationLink(value: s) { PosterCard(title: s.name, url: s.poster).frame(width: 112) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

struct ChannelStrip: View {
    let channels: [Channel]
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 12) {
                ForEach(channels) { channel in
                    Button { model.play(channel) } label: {
                        VStack(spacing: 6) {
                            RemoteImage(url: channel.logo, placeholderText: channel.name, contentMode: .fit)
                                .padding(10)
                                .frame(width: 112, height: 68)
                                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                            Text(channel.name).font(.caption).lineLimit(1).frame(width: 112)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Son kanallardan kaldır", systemImage: "xmark", role: .destructive) {
                            model.removeRecent(channel)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

struct ContinueWatchingRow: View {
    let items: [WatchProgress]
    @Environment(AppModel.self) private var model
    @Environment(\.modelContext) private var context

    /// One entry per series (its latest episode), plus movies; only started, unfinished ones.
    static func items(from all: [WatchProgress], accountID: UUID?) -> [WatchProgress] {
        var seenSeries = Set<String>()
        return all.filter { p in
            guard p.accountID == accountID, p.isResumable else { return false }
            if let s = p.seriesID { return seenSeries.insert(s).inserted }
            return true
        }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(items) { p in
                    Button {
                        Task { await model.resume(p) }
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            RemoteImage(url: p.imageURL.flatMap(URL.init(string:)), placeholderText: p.name)
                                .frame(width: 112, height: 168)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay { Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.9)) }
                                .overlay(alignment: .bottom) { ProgressBar(value: p.fraction).padding(6) }
                            Text(p.name).font(.caption.weight(.semibold)).lineLimit(1)
                            Text(p.subtitle ?? "\(Int(max(0, p.duration - p.position)) / 60) dk kaldı")
                                .font(.caption2).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        .frame(width: 112)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Listeden kaldır", systemImage: "xmark", role: .destructive) {
                            context.delete(p)
                            try? context.save()
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
