import Foundation

/// Port of Lumio's `sortContentGroups`: Turkish groups first, then the rest
/// alphabetically, then low-priority (backup/HEVC/...) groups and finally adult groups.
public enum GroupSorter {
    static let turkishKeywords = ["turkiye", "turk", "turkey", "türk", "türkiye", "ulusal", "yerli", "kanallari", "kanalları", "national tr"]
    static let adultKeywords = ["adult", "xxx", "+18", "18+", "erotic", "erotik", "porn", "sex", "yetiskin", "for adult", "mature"]
    static let lowPriorityKeywords = ["free", "h65", "h265", "h266", "hevc", "backup", "yedek", "alt yayin", "2nd", "duplicate", "test"]

    static func normalize(_ name: String) -> String {
        var n = name.lowercased()
        for (src, dst) in [("ı", "i"), ("ş", "s"), ("ğ", "g"), ("ü", "u"), ("ö", "o"), ("ç", "c")] {
            n = n.replacingOccurrences(of: src, with: dst)
        }
        return n
    }

    static func stripDecorations(_ name: String) -> String {
        String(name.map { "★☆✦➾▶►●◆◇•|".contains($0) ? " " : $0 }).trimmingCharacters(in: .whitespaces)
    }

    public static func isAdult(_ group: String) -> Bool {
        let n = normalize(stripDecorations(group))
        return adultKeywords.contains { n.contains($0) }
    }

    static func isLowPriority(_ group: String) -> Bool {
        let n = normalize(stripDecorations(group))
        return lowPriorityKeywords.contains { n.contains($0) }
    }

    static func turkishScore(_ name: String) -> Int {
        if isLowPriority(name) { return 0 }
        let n = normalize(stripDecorations(name))
        var score = 0
        for kw in turkishKeywords where n.contains(normalize(kw)) { score += 15 }
        if n.range(of: #"^tr[\s.:|\-/]"#, options: .regularExpression) != nil || n.hasPrefix("tr ") { score += 40 }
        if n.range(of: #"\btr\b"#, options: .regularExpression) != nil { score += 25 }
        if n == "tr" || n.hasSuffix(" tr") { score += 30 }
        return score
    }

    public static func sort(_ names: [String]) -> [String] {
        var seen = Set<String>()
        let items = names.filter { !$0.isEmpty && seen.insert($0).inserted }
        let byName: (String, String) -> Bool = { $0.localizedStandardCompare($1) == .orderedAscending }
        let adult = items.filter(isAdult).sorted(by: byName)
        let low = items.filter { !isAdult($0) && isLowPriority($0) }.sorted(by: byName)
        let regularItems = items.filter { !isAdult($0) && !isLowPriority($0) }
        let scores = Dictionary(uniqueKeysWithValues: regularItems.map { ($0, turkishScore($0)) })
        let regular = regularItems.sorted { a, b in
            let sa = scores[a]!, sb = scores[b]!
            return sa != sb ? sa > sb : byName(a, b)
        }
        return regular + low + adult
    }

    public static func sort(_ categories: [ContentCategory]) -> [ContentCategory] {
        // Duplicate names keep their own ids: append them after the first occurrence.
        let order = sort(categories.map(\.name))
        var result: [ContentCategory] = []
        var used = Set<String>()
        for name in order {
            for c in categories where c.name == name && used.insert(c.id).inserted { result.append(c) }
        }
        return result
    }
}
