import LumioCore
import SwiftData
import SwiftUI

/// "Listem": continue watching + favorites, stored locally with SwiftData.
struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \WatchProgress.updatedAt, order: .reverse) private var allProgress: [WatchProgress]
    @Query(sort: \FavoriteItem.addedAt, order: .reverse) private var allFavorites: [FavoriteItem]

    @State private var showSettings = false

    private var accountID: UUID? { model.activeAccount?.id }
    private var continueWatching: [WatchProgress] {
        ContinueWatchingRow.items(from: allProgress, accountID: accountID).filter(model.isAllowed)
    }
    private func favorites(_ kind: ItemKind) -> [FavoriteItem] {
        allFavorites.filter { $0.accountID == accountID && $0.kind == kind }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if continueWatching.isEmpty && allFavorites.allSatisfy({ $0.accountID != accountID }) {
                        ContentUnavailableView("Listen boş", systemImage: "heart",
                                               description: Text("İzlemeye başladıkların ve favorilerin burada görünür."))
                            .padding(.top, 80)
                    }
                    if !continueWatching.isEmpty { continueSection }
                    channelsSection
                    posterSection("Favori filmler", favorites(.movie)) { fav in
                        model.movie(id: fav.itemID).map { AnyHashable($0) }
                    }
                    posterSection("Favori diziler", favorites(.series)) { fav in
                        model.series(id: fav.itemID).map { AnyHashable($0) }
                    }
                }
                .padding(.vertical, 12)
            }
            .background(Theme.surface)
            .navigationTitle("Listem")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Ayarlar")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .navigationDestination(for: Movie.self) { MovieDetailView(movie: $0) }
            .navigationDestination(for: Series.self) { SeriesDetailView(series: $0) }
        }
    }

    private var continueSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("İzlemeye devam et")
            ContinueWatchingRow(items: continueWatching)
        }
    }

    @ViewBuilder
    private var channelsSection: some View {
        let favs = favorites(.live)
        if !favs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionTitle("Favori kanallar")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 12) {
                        ForEach(favs) { fav in
                            Button {
                                if let ch = model.channel(id: fav.itemID) { model.play(ch) }
                            } label: {
                                VStack(spacing: 6) {
                                    RemoteImage(url: fav.imageURL.flatMap(URL.init(string:)), placeholderText: fav.name, contentMode: .fit)
                                        .padding(10)
                                        .frame(width: 112, height: 68)
                                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                                    Text(fav.name).font(.caption).lineLimit(1).frame(width: 112)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }

    @ViewBuilder
    private func posterSection(_ title: String, _ favs: [FavoriteItem], value: @escaping (FavoriteItem) -> AnyHashable?) -> some View {
        if !favs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionTitle(title)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(favs) { fav in
                            let card = PosterCard(title: fav.name, url: fav.imageURL.flatMap(URL.init(string:))).frame(width: 112)
                            if let v = value(fav) {
                                NavigationLink(value: v) { card }.buttonStyle(.plain)
                            } else {
                                card.opacity(0.5) // catalog still loading
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }
}

struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.title3.bold()).padding(.horizontal, 16)
    }
}
