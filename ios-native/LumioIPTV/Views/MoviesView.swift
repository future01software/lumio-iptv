import LumioCore
import SwiftData
import SwiftUI

let posterColumns = [GridItem(.adaptive(minimum: 108, maximum: 170), spacing: 12, alignment: .top)]

struct MoviesView: View {
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
            .navigationTitle("Filmler")
            .searchable(text: $search, prompt: "Film ara")
            .navigationDestination(for: Movie.self) { MovieDetailView(movie: $0) }
        }
    }

    private var movies: [Movie] {
        let q = search.trimmed
        if !q.isEmpty { return model.vod.movies.filter { $0.name.localizedStandardContains(q) } }
        switch category {
        case nil: return model.vod.movies
        case CategoryItems.favoritesID:
            let id = model.activeAccount?.id
            return favorites.filter { $0.accountID == id && $0.kind == .movie }.compactMap { model.movie(id: $0.itemID) }
        case let id?: return model.moviesByCategory[id] ?? []
        }
    }

    private var content: some View {
        let list = movies
        return VStack(spacing: 0) {
            if search.trimmed.isEmpty {
                CategoryBar(categories: model.vod.movieCategories, selection: $category) { model.moviesByCategory[$0]?.count ?? 0 }
            }
            if list.isEmpty {
                ContentUnavailableView("Film bulunamadı", systemImage: "film")
            } else {
                ScrollView {
                    LazyVGrid(columns: posterColumns, spacing: 16) {
                        ForEach(list) { movie in
                            NavigationLink(value: movie) {
                                PosterCard(title: movie.name, url: movie.poster, badge: movie.rating.flatMap(Self.ratingBadge))
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
            category = model.vod.movieCategories.first?.id
        }
    }

    static func ratingBadge(_ rating: String) -> String? {
        guard let r = Double(rating), r > 0 else { return nil }
        return String(format: "★ %.1f", r)
    }
}

struct MovieDetailView: View {
    let movie: Movie

    @Environment(AppModel.self) private var model
    @Query private var progress: [WatchProgress]
    @Query private var favorite: [FavoriteItem]
    @State private var info: MovieInfo?

    init(movie: Movie) {
        self.movie = movie
        let id = movie.id
        let movieKind = ItemKind.movie.rawValue
        _progress = Query(filter: #Predicate<WatchProgress> { $0.itemID == id && $0.kindRaw == movieKind })
        _favorite = Query(filter: #Predicate<FavoriteItem> { $0.itemID == id && $0.kindRaw == movieKind })
    }

    private var accountProgress: WatchProgress? { progress.first { $0.accountID == model.activeAccount?.id } }
    private var isFavorite: Bool { favorite.contains { $0.accountID == model.activeAccount?.id } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DetailHeader(title: movie.name, poster: movie.poster, backdrop: info?.backdrop ?? movie.poster,
                             meta: meta)
                actions
                if let plot = info?.plot {
                    Text(plot).font(.callout).foregroundStyle(Color(white: 0.85))
                }
                if let genre = info?.genre { InfoLine(label: "Tür", value: genre) }
                if let director = info?.director { InfoLine(label: "Yönetmen", value: director) }
                if let cast = info?.cast { InfoLine(label: "Oyuncular", value: cast) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(Theme.surface)
        .ignoresSafeArea(edges: .top)
        .navigationBarTitleDisplayMode(.inline)
        .task { info = try? await model.provider?.movieInfo(movie) }
    }

    private var meta: [String] {
        var m: [String] = []
        if let y = info?.releaseDate.map({ String($0.prefix(4)) }) ?? movie.year { m.append(y) }
        if let d = info?.durationSeconds, d > 0 { m.append(d.durationText) }
        if let r = (info?.rating ?? movie.rating).flatMap(MoviesView.ratingBadge) { m.append(r) }
        return m
    }

    private var actions: some View {
        let p = accountProgress
        let resumable = p?.isResumable == true
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    model.play(movie)
                } label: {
                    Label(resumable ? "Devam et · \(p!.position.clockString)" : "Oynat", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())

                Button {
                    model.toggleFavorite(.movie, id: movie.id, name: movie.name, image: movie.poster)
                } label: {
                    Image(systemName: isFavorite ? "heart.fill" : "heart")
                        .foregroundStyle(isFavorite ? Theme.brand : .white)
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityLabel(isFavorite ? "Listemden çıkar" : "Listeme ekle")
            }
            if resumable {
                Button("Baştan oynat") { model.play(movie, fromStart: true) }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                ProgressBar(value: p!.fraction)
            }
        }
    }
}

struct DetailHeader: View {
    let title: String
    let poster: URL?
    let backdrop: URL?
    let meta: [String]

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: backdrop, placeholderText: "")
                .frame(height: 300)
                .frame(maxWidth: .infinity)
                .clipped()
                .blur(radius: backdrop == poster ? 18 : 0)
                .overlay(LinearGradient(colors: [.black.opacity(0.2), .black.opacity(0.5), .black],
                                        startPoint: .top, endPoint: .bottom))
                .padding(.horizontal, -16)
            HStack(alignment: .bottom, spacing: 14) {
                RemoteImage(url: poster, placeholderText: title)
                    .frame(width: 100, height: 150)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .shadow(radius: 10)
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.title2.bold()).lineLimit(3)
                    if !meta.isEmpty {
                        Text(meta.joined(separator: "  ·  ")).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .frame(height: 300)
    }
}

struct InfoLine: View {
    let label: String
    let value: String
    var body: some View {
        (Text(label + ": ").foregroundStyle(Theme.muted) + Text(value))
            .font(.footnote)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .padding(.vertical, 13)
            .padding(.horizontal, 18)
            .background(Theme.brand.opacity(configuration.isPressed ? 0.75 : 1), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(width: 50, height: 48)
            .background(Theme.surface3.opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 12))
    }
}
