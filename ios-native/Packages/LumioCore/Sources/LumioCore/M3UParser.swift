import Foundation

public struct M3UPlaylist: Sendable {
    public var live: LiveCatalog
    public var vod: VODCatalog
    /// `url-tvg` / `x-tvg-url` from the `#EXTM3U` header, if present.
    public var epgURL: URL?
}

/// Port of Lumio's `parseM3U` (local-provider.ts): splits a playlist into live
/// channels, movies and series (grouped by `SxxEyy` in the title).
public enum M3UParser {
    public static func fetch(_ url: URL) async throws -> M3UPlaylist {
        let text = try await HTTP.text(url, timeout: 90)
        let playlist = parse(text)
        if playlist.live.channels.isEmpty && playlist.vod.movies.isEmpty && playlist.vod.series.isEmpty {
            throw text.contains("#EXTM3U") || text.contains("#EXTINF") ? ProviderError.emptyPlaylist : ProviderError.invalidResponse
        }
        return playlist
    }

    /// Stable id from a string (FNV-1a), so items keep their id across refreshes.
    static func stableID(_ input: String) -> String {
        var h: UInt32 = 0x811c9dc5
        for b in input.utf8 { h ^= UInt32(b); h = h &* 0x01000193 }
        return "m" + String(h, radix: 36) + String(input.utf8.count, radix: 36)
    }

    /// Parses `key="value"` pairs. Values may contain commas and spaces.
    static func attributes(_ s: Substring) -> [String: String] {
        var out: [String: String] = [:]
        var i = s.startIndex
        while i < s.endIndex {
            guard let eq = s[i...].range(of: "=\"") else { break }
            var keyStart = eq.lowerBound
            while keyStart > i, !s[s.index(before: keyStart)].isWhitespace { keyStart = s.index(before: keyStart) }
            let key = s[keyStart..<eq.lowerBound].lowercased()
            guard let close = s[eq.upperBound...].firstIndex(of: "\"") else { break }
            out[key] = String(s[eq.upperBound..<close])
            i = s.index(after: close)
        }
        return out
    }

    /// Splits `#EXTINF:-1 a="x, y",Title` at the first comma outside quotes.
    static func splitExtinf(_ line: Substring) -> (attrs: Substring, title: Substring)? {
        var inQuote = false
        var i = line.index(line.startIndex, offsetBy: 8, limitedBy: line.endIndex) ?? line.endIndex
        while i < line.endIndex {
            let ch = line[i]
            if ch == "\"" { inQuote.toggle() } else if ch == ",", !inQuote {
                return (line[line.index(line.startIndex, offsetBy: 8)..<i], line[line.index(after: i)...])
            }
            i = line.index(after: i)
        }
        return nil
    }

    static let episodeRegex = try! NSRegularExpression(pattern: #"S(\d+)\s*E(\d+)"#, options: .caseInsensitive)

    public static func parse(_ content: String) -> M3UPlaylist {
        var channels: [Channel] = []
        var movies: [Movie] = []
        var seriesOrder: [String] = []
        var seriesMap: [String: (name: String, logo: URL?, group: String, eps: [Episode])] = [:]
        var epgURL: URL?
        var attrs: [String: String] = [:]
        var title = ""

        for raw in content.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXTM3U") {
                let a = attributes(Substring(line))
                epgURL = (a["url-tvg"] ?? a["x-tvg-url"])?.split(separator: ",").first.flatMap { URL(string: String($0)) }
                continue
            }
            if line.hasPrefix("#EXTINF") {
                if let m = splitExtinf(Substring(line)) {
                    title = m.title.trimmingCharacters(in: .whitespaces)
                    attrs = attributes(m.attrs)
                }
                continue
            }
            if line.isEmpty || line.hasPrefix("#") { continue }
            guard let url = URL(string: line) ?? line.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed).flatMap(URL.init(string:)) else {
                attrs = [:]; title = ""; continue
            }

            let group = attrs["group-title"].nonEmpty ?? "Kategorisiz"
            let logo = attrs["tvg-logo"].flatMap { $0.hasPrefix("http") ? URL(string: $0) : nil }
            let name = title.nonEmpty ?? "Adsız"
            let lowerGroup = group.lowercased()
            let lowerURL = line.lowercased()
            let ns = name as NSString
            let ep = episodeRegex.firstMatch(in: name, range: NSRange(location: 0, length: ns.length))
            let isSeries = ep != nil || lowerGroup.contains("series") || lowerGroup.contains("dizi")
            let ext = url.pathExtension.lowercased()
            let isMovie = !isSeries && (lowerGroup.contains("movie") || lowerGroup.contains("vod") || lowerGroup.contains("film")
                                         || ["mp4", "mkv", "avi", "mov", "m4v"].contains(ext) || lowerURL.contains("/movie/"))

            if isSeries {
                let season = ep.flatMap { Int(ns.substring(with: $0.range(at: 1))) } ?? 1
                let number = ep.flatMap { Int(ns.substring(with: $0.range(at: 2))) } ?? 1
                var base = name
                if let ep { base = ns.substring(to: ep.range.location).trimmingCharacters(in: CharacterSet(charactersIn: " -|:")) }
                if base.isEmpty { base = name }
                let sid = base.lowercased()
                let episode = Episode(id: stableID("e:" + line), title: name, season: season, number: number, url: url,
                                      containerExtension: ext.nonEmpty, still: logo, plot: nil, durationSeconds: nil)
                if seriesMap[sid] == nil { seriesOrder.append(sid); seriesMap[sid] = (base, logo, group, []) }
                seriesMap[sid]!.eps.append(episode)
            } else if isMovie {
                movies.append(Movie(id: stableID("v:" + line), name: name, poster: logo, categoryID: group, url: url,
                                    containerExtension: ext.nonEmpty, year: nil, rating: nil))
            } else {
                channels.append(Channel(id: stableID("c:" + line), name: name, logo: logo, categoryID: group, url: url,
                                        epgID: attrs["tvg-id"].nonEmpty, number: attrs["tvg-chno"].flatMap { Int($0) }))
            }
            attrs = [:]
            title = ""
        }

        let series = seriesOrder.map { sid -> Series in
            let s = seriesMap[sid]!
            let eps = s.eps.sorted { ($0.season, $0.number) < ($1.season, $1.number) }
            return Series(id: stableID("s:" + sid), name: s.name, poster: s.logo, categoryID: s.group,
                          plot: nil, year: nil, rating: nil, episodes: eps)
        }
        func cats(_ groups: [String]) -> [ContentCategory] {
            GroupSorter.sort(groups).map { ContentCategory(id: $0, name: $0) }
        }
        return M3UPlaylist(
            live: LiveCatalog(categories: cats(channels.map(\.categoryID)), channels: channels),
            vod: VODCatalog(movieCategories: cats(movies.map(\.categoryID)), movies: movies,
                            seriesCategories: cats(series.map(\.categoryID)), series: series),
            epgURL: epgURL)
    }
}
