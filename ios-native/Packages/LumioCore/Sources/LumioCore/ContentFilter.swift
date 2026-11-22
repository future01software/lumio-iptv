import Foundation

/// Adult-content rules shared with the Lumio desktop/Android apps (content-filter.ts).
/// Names only match unambiguous terms, so titles like "Adult Swim" or "Sex Education" stay.
public enum ContentFilter {
    static let adultCategory = try! NSRegularExpression(pattern: #"adult|xxx|18\+|yetişkin|yetiskin"#, options: .caseInsensitive)
    static let adultName = try! NSRegularExpression(
        pattern: #"xxx|porn|\b18\+|\+18\b|erotik|erotic|playboy|brazzers|hustler|\badults? \d"#, options: .caseInsensitive)

    private static func matches(_ re: NSRegularExpression, _ s: String?) -> Bool {
        guard let s, !s.isEmpty else { return false }
        return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    public static func isAdultCategory(_ name: String?) -> Bool { matches(adultCategory, name) }
    public static func isAdultName(_ name: String?) -> Bool { matches(adultName, name) }

    public static func isAdult(name: String?, category: String?) -> Bool {
        isAdultCategory(category) || isAdultName(name)
    }

    public static func filter(_ catalog: LiveCatalog) -> LiveCatalog {
        let cats = catalog.categories.filter { !isAdultCategory($0.name) }
        let ok = Set(cats.map(\.id))
        return LiveCatalog(categories: cats, channels: catalog.channels.filter { ok.contains($0.categoryID) && !isAdultName($0.name) })
    }

    public static func filter(_ catalog: VODCatalog) -> VODCatalog {
        let mc = catalog.movieCategories.filter { !isAdultCategory($0.name) }
        let sc = catalog.seriesCategories.filter { !isAdultCategory($0.name) }
        let mok = Set(mc.map(\.id)), sok = Set(sc.map(\.id))
        return VODCatalog(movieCategories: mc, movies: catalog.movies.filter { mok.contains($0.categoryID) && !isAdultName($0.name) },
                          seriesCategories: sc, series: catalog.series.filter { sok.contains($0.categoryID) && !isAdultName($0.name) })
    }
}
