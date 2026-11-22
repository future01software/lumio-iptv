import LumioCore
import SwiftData
import SwiftUI

struct LiveTVView: View {
    @Environment(AppModel.self) private var model
    @Query(sort: \FavoriteItem.addedAt, order: .reverse) private var favorites: [FavoriteItem]
    @State private var category: String?
    @State private var didPickDefault = false
    @State private var search = ""

    var body: some View {
        NavigationStack {
            Group {
                if model.liveState == .loaded {
                    content
                } else {
                    StateView(state: model.liveState) { Task { await model.loadLive() } }
                }
            }
            .background(Theme.surface)
            .navigationTitle("Canlı TV")
            .toolbar {
                if model.liveState == .loaded {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink {
                            GuideView(channels: channels, title: guideTitle)
                        } label: {
                            Label("Yayın akışı", systemImage: "calendar")
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Kanal ara")
            .refreshable { await model.loadLive() }
        }
    }

    private var guideTitle: String {
        switch category {
        case nil: "Yayın akışı"
        case CategoryItems.favoritesID: "Favoriler · Akış"
        case let id?: model.live.categories.first { $0.id == id }?.name ?? "Yayın akışı"
        }
    }

    private var favoriteIDs: Set<String> {
        guard let id = model.activeAccount?.id else { return [] }
        return Set(favorites.filter { $0.accountID == id && $0.kind == .live }.map(\.itemID))
    }

    private var channels: [Channel] {
        let q = search.trimmed
        if !q.isEmpty {
            return model.live.channels.filter { $0.name.localizedStandardContains(q) }
        }
        switch category {
        case nil: return model.live.channels
        case CategoryItems.favoritesID:
            let favs = favoriteIDs
            return model.live.channels.filter { favs.contains($0.id) }
        case let id?: return model.channelsByCategory[id] ?? []
        }
    }

    private var content: some View {
        let favs = favoriteIDs
        let list = channels
        return VStack(spacing: 0) {
            if search.trimmed.isEmpty {
                CategoryBar(categories: model.live.categories, selection: $category) { model.channelsByCategory[$0]?.count ?? 0 }
            }
            if list.isEmpty {
                ContentUnavailableView(
                    category == CategoryItems.favoritesID ? "Favori kanal yok" : "Kanal bulunamadı",
                    systemImage: category == CategoryItems.favoritesID ? "star" : "tv",
                    description: Text(category == CategoryItems.favoritesID ? "Kanal satırındaki yıldıza dokunarak ekleyebilirsin." : ""))
            } else {
                List(list) { channel in
                    ChannelRow(channel: channel, isFavorite: favs.contains(channel.id))
                        .listRowBackground(Theme.surface)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .id(category ?? "__all")
            }
        }
        .onAppear {
            // Open on the first provider category (usually the local/national one), not on
            // "all", which can be tens of thousands of channels.
            guard !didPickDefault else { return }
            didPickDefault = true
            category = favs.isEmpty ? model.live.categories.first?.id : CategoryItems.favoritesID
        }
    }
}

struct ChannelRow: View {
    let channel: Channel
    let isFavorite: Bool

    @Environment(AppModel.self) private var model
    @State private var nowNext: NowNext?

    var body: some View {
        HStack(spacing: 12) {
            Button {
                model.play(channel)
            } label: {
                HStack(spacing: 12) {
                    RemoteImage(url: channel.logo, placeholderText: channel.name, contentMode: .fit)
                        .padding(4)
                        .frame(width: 64, height: 44)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(channel.name)
                            .font(.body.weight(.semibold))
                            .lineLimit(1)
                        if let now = nowNext?.now {
                            Text("\(now.start.hourMinute)  \(now.title)")
                                .font(.caption)
                                .foregroundStyle(Color(white: 0.8))
                                .lineLimit(1)
                            ProgressBar(value: now.progress())
                                .frame(maxWidth: 160)
                        }
                        if let next = nowNext?.next {
                            Text("Sonra \(next.start.hourMinute)  \(next.title)")
                                .font(.caption2)
                                .foregroundStyle(Theme.muted)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button {
                model.toggleFavorite(.live, id: channel.id, name: channel.name, image: channel.logo)
            } label: {
                Image(systemName: isFavorite ? "star.fill" : "star")
                    .foregroundStyle(isFavorite ? Theme.brand : Theme.muted)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(isFavorite ? "Favorilerden çıkar" : "Favorilere ekle")
        }
        .task(id: channel.id) {
            // Small delay so fast scrolling doesn't fire a guide request per row.
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            nowNext = await model.nowNext(for: channel)
        }
    }
}
