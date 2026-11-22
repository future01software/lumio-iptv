import Foundation

/// Streaming XMLTV parser. Keeps only programmes for the given channels within a
/// window around now, so a large provider guide doesn't balloon memory.
public final class XMLTVParser: NSObject, XMLParserDelegate {
    private let channelIDs: Set<String>?
    private let from: Date
    private let to: Date
    private var result: [String: [EPGProgram]] = [:]
    private var count = 0
    private let limit: Int

    private var current: (channel: String, start: Date, stop: Date)?
    private var title = ""
    private var desc = ""
    private var element = ""

    init(channelIDs: Set<String>?, now: Date, limit: Int, pastHours: Double = 6, futureHours: Double = 36) {
        self.channelIDs = channelIDs
        self.from = now.addingTimeInterval(-pastHours * 3600)
        self.to = now.addingTimeInterval(futureHours * 3600)
        self.limit = limit
    }

    public static func fetch(_ url: URL, channelIDs: Set<String>?, limit: Int = 60_000,
                             pastHours: Double = 6, futureHours: Double = 36) async throws -> [String: [EPGProgram]] {
        let data = try await HTTP.data(url, timeout: 120)
        return await Task.detached(priority: .utility) {
            parse(data, channelIDs: channelIDs, limit: limit, pastHours: pastHours, futureHours: futureHours)
        }.value
    }

    public static func parse(_ data: Data, channelIDs: Set<String>?, now: Date = Date(), limit: Int = 60_000,
                             pastHours: Double = 6, futureHours: Double = 36) -> [String: [EPGProgram]] {
        let delegate = XMLTVParser(channelIDs: channelIDs, now: now, limit: limit, pastHours: pastHours, futureHours: futureHours)
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        for k in delegate.result.keys { delegate.result[k]!.sort { $0.start < $1.start } }
        return delegate.result
    }

    /// "20240101120000 +0300" (offset optional, UTC if missing).
    static func date(_ s: String) -> Date? {
        let t = s.trimmingCharacters(in: .whitespaces)
        let digits = t.prefix(14)
        guard digits.count == 14, let _ = Int(digits) else { return nil }
        var comps = DateComponents()
        let d = Array(digits)
        func num(_ a: Int, _ b: Int) -> Int { Int(String(d[a..<b]))! }
        comps.year = num(0, 4); comps.month = num(4, 6); comps.day = num(6, 8)
        comps.hour = num(8, 10); comps.minute = num(10, 12); comps.second = num(12, 14)
        var offset = 0
        let rest = t.dropFirst(14).trimmingCharacters(in: .whitespaces)
        if rest.count == 5, let sign = rest.first, sign == "+" || sign == "-", let hhmm = Int(rest.dropFirst()) {
            offset = (hhmm / 100 * 3600 + hhmm % 100 * 60) * (sign == "-" ? -1 : 1)
        }
        comps.timeZone = TimeZone(secondsFromGMT: offset)
        return Calendar(identifier: .gregorian).date(from: comps)
    }

    public func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                       qualifiedName: String?, attributes: [String: String] = [:]) {
        element = name
        guard name == "programme" else { return }
        current = nil
        guard let ch = attributes["channel"], channelIDs?.contains(ch) ?? true,
              let start = attributes["start"].flatMap(Self.date),
              let stop = attributes["stop"].flatMap(Self.date),
              stop > from, start < to else { return }
        current = (ch, start, stop)
        title = ""
        desc = ""
    }

    public func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard current != nil else { return }
        if element == "title" { title += string } else if element == "desc" { desc += string }
    }

    public func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        self.parser(parser, foundCharacters: String(decoding: CDATABlock, as: UTF8.self))
    }

    public func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        element = ""
        guard name == "programme", let c = current else { return }
        let p = EPGProgram(title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                           summary: desc.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
                           start: c.start, stop: c.stop)
        result[c.channel, default: []].append(p)
        current = nil
        count += 1
        if count >= limit { parser.abortParsing() }
    }
}
