import LumioCore
import SwiftUI

/// Remote image with a neutral placeholder (initials) while loading or on failure.
struct RemoteImage: View {
    let url: URL?
    var placeholderText: String = ""
    var contentMode: ContentMode = .fill

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.15))) { phase in
            if let image = phase.image {
                image.resizable().aspectRatio(contentMode: contentMode)
            } else {
                ZStack {
                    Theme.surface3
                    Text(initials)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private var initials: String {
        placeholderText.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

struct CategoryChips: View {
    struct Item: Identifiable, Hashable {
        let id: String?
        let name: String
    }

    let items: [Item]
    @Binding var selection: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items, id: \.self) { item in
                        let selected = item.id == selection
                        Button {
                            selection = item.id
                        } label: {
                            Text(item.name)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(selected ? Theme.brand : Theme.surface2, in: Capsule())
                                .foregroundStyle(selected ? .white : Color(white: 0.85))
                        }
                        .buttonStyle(.plain)
                        .id(item.id ?? "__all")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .frame(height: 52)
            .onAppear { proxy.scrollTo(selection ?? "__all", anchor: .center) }
        }
    }
}

struct PosterCard: View {
    let title: String
    let url: URL?
    var badge: String?
    var progress: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color.clear
                .aspectRatio(2 / 3, contentMode: .fit)
                .overlay { RemoteImage(url: url, placeholderText: title) }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if let badge {
                        Text(badge)
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(.black.opacity(0.7), in: Capsule())
                            .padding(6)
                    }
                }
                .overlay(alignment: .bottom) {
                    if let progress, progress > 0 {
                        ProgressBar(value: progress).padding(6)
                    }
                }
            Text(title)
                .font(.caption.weight(.medium))
                .lineLimit(2, reservesSpace: true)
                .foregroundStyle(.white)
        }
    }
}

struct ProgressBar: View {
    let value: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.25))
                Capsule().fill(Theme.brand).frame(width: geo.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 3)
    }
}

struct StateView: View {
    let state: LoadState
    var retry: () -> Void

    var body: some View {
        switch state {
        case .idle, .loading:
            VStack(spacing: 12) {
                ProgressView().controlSize(.large).tint(Theme.brand)
                Text("Yükleniyor…").foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Yüklenemedi", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Tekrar dene", action: retry).buttonStyle(.borderedProminent)
            }
        case .loaded:
            EmptyView()
        }
    }
}

/// Keeps category chip selection meaningful: favorites first, then all, then provider categories.
enum CategoryItems {
    static let favoritesID = "__favorites"

    static func make(_ categories: [ContentCategory], includeAll: Bool = true, includeFavorites: Bool = true) -> [CategoryChips.Item] {
        var items: [CategoryChips.Item] = []
        if includeFavorites { items.append(.init(id: favoritesID, name: "★ Favoriler")) }
        if includeAll { items.append(.init(id: nil, name: "Tümü")) }
        return items + categories.map { .init(id: $0.id, name: $0.name) }
    }
}

/// Category selector for long provider category lists: quick "Favoriler" / "Tümü" chips plus a
/// button showing the current category that opens a searchable list (with item counts).
struct CategoryBar: View {
    let categories: [ContentCategory]
    @Binding var selection: String?
    let count: (String) -> Int

    @State private var showPicker = false

    private var selectedCategory: ContentCategory? {
        guard let id = selection, id != CategoryItems.favoritesID else { return nil }
        return categories.first { $0.id == id }
    }

    var body: some View {
        HStack(spacing: 8) {
            chip("★", selected: selection == CategoryItems.favoritesID) { selection = CategoryItems.favoritesID }
                .accessibilityLabel("Favoriler")
            chip("Tümü", selected: selection == nil) { selection = nil }
            Button {
                showPicker = true
            } label: {
                HStack(spacing: 6) {
                    Text(selectedCategory?.name ?? "Kategoriler")
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.caption.weight(.bold))
                }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(selectedCategory != nil ? Theme.brand : Theme.surface2, in: Capsule())
                .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .sheet(isPresented: $showPicker) {
            CategoryPickerSheet(categories: categories, selection: $selection, count: count)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? Theme.brand : Theme.surface2, in: Capsule())
                .foregroundStyle(selected ? .white : Color(white: 0.85))
        }
        .buttonStyle(.plain)
        .fixedSize()
    }
}

struct CategoryPickerSheet: View {
    let categories: [ContentCategory]
    @Binding var selection: String?
    let count: (String) -> Int

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var filtered: [ContentCategory] {
        let q = search.trimmed
        return q.isEmpty ? categories : categories.filter { $0.name.localizedStandardContains(q) }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { category in
                Button {
                    selection = category.id
                    dismiss()
                } label: {
                    HStack {
                        Text(category.name)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                        Spacer()
                        Text("\(count(category.id))")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(Theme.muted)
                        if category.id == selection {
                            Image(systemName: "checkmark").foregroundStyle(Theme.brand)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .listRowBackground(Theme.surface2)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Kategori ara")
            .navigationTitle("Kategoriler")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Kapat") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }
}
