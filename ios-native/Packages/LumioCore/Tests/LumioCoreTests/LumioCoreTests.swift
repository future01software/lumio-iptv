import XCTest
@testable import LumioCore

final class LumioCoreTests: XCTestCase {
    func testCleanServer() {
        XCTAssertEqual(XtreamClient.cleanServer(" example.com:8080/player_api.php "), "http://example.com:8080")
        XCTAssertEqual(XtreamClient.cleanServer("https://example.com/"), "https://example.com")
        XCTAssertEqual(XtreamClient.cleanServer("http://example.com/get.php"), "http://example.com")
    }

    func testXtreamURLsEscapeCredentials() {
        let c = XtreamClient(credentials: .init(server: "example.com", username: "user", password: "p/ss#1"))
        XCTAssertEqual(c.liveURL(streamID: "42")?.absoluteString, "http://example.com/live/user/p%2Fss%231/42.m3u8")
        XCTAssertEqual(c.movieURL(streamID: "7", ext: nil)?.absoluteString, "http://example.com/movie/user/p%2Fss%231/7.mp4")
    }

    func testM3UParse() {
        let m3u = """
        #EXTM3U url-tvg="https://epg.example.com/guide.xml"
        #EXTINF:-1 tvg-id="trt1.tr" tvg-logo="https://logo.example.com/trt1.png" group-title="TR | Ulusal",TRT 1
        https://stream.example.com/trt1.m3u8
        #EXTINF:-1 http-user-agent="Mozilla/5.0 (KHTML, like Gecko)" group-title="News",World News
        https://stream.example.com/news.m3u8
        #EXTINF:-1 group-title="Movies",Some Film (2020)
        https://stream.example.com/film.mp4
        #EXTINF:-1 group-title="Shows",Some Show S01 E02
        https://stream.example.com/show-s1e2.mp4
        #EXTINF:-1 group-title="Shows",Some Show S01 E01
        https://stream.example.com/show-s1e1.mp4
        """
        let p = M3UParser.parse(m3u)
        XCTAssertEqual(p.epgURL?.absoluteString, "https://epg.example.com/guide.xml")
        XCTAssertEqual(p.live.channels.map(\.name), ["TRT 1", "World News"])
        XCTAssertEqual(p.live.channels.first?.epgID, "trt1.tr")
        XCTAssertEqual(p.live.categories.first?.name, "TR | Ulusal")
        XCTAssertEqual(p.vod.movies.map(\.name), ["Some Film (2020)"])
        XCTAssertEqual(p.vod.series.count, 1)
        XCTAssertEqual(p.vod.series.first?.name, "Some Show")
        XCTAssertEqual(p.vod.series.first?.episodes.map(\.number), [1, 2])
    }

    func testGroupSortTurkishFirstAdultLast() {
        let sorted = GroupSorter.sort(["Sports", "XXX Adult", "TR Ulusal", "Backup HEVC", "Movies"])
        XCTAssertEqual(sorted, ["TR Ulusal", "Movies", "Sports", "Backup HEVC", "XXX Adult"])
    }

    func testXMLTV() {
        let xml = """
        <?xml version="1.0"?><tv>
        <programme start="20260101100000 +0000" stop="20260101110000 +0000" channel="a"><title>Now &amp; Then</title><desc>D</desc></programme>
        <programme start="20260101110000 +0000" stop="20260101120000 +0000" channel="a"><title>Next</title></programme>
        <programme start="20260101100000 +0000" stop="20260101110000 +0000" channel="b"><title>Other</title></programme>
        </tv>
        """
        let now = XMLTVParser.date("20260101103000 +0000")!
        let r = XMLTVParser.parse(Data(xml.utf8), channelIDs: ["a"], now: now)
        XCTAssertNil(r["b"])
        let nn = NowNext.from(r["a"] ?? [], at: now)
        XCTAssertEqual(nn.now?.title, "Now & Then")
        XCTAssertEqual(nn.next?.title, "Next")
        XCTAssertEqual(nn.now?.progress(at: now) ?? 0, 0.5, accuracy: 0.001)
        XCTAssertEqual(XMLTVParser.date("20260101100000 +0300"), XMLTVParser.date("20260101070000 +0000"))
    }

    func testBase64Titles() {
        XCTAssertEqual(XtreamClient.base64("SGFiZXJsZXI="), "Haberler")
    }

    func testAccountDescriptionRedactsSecrets() {
        let a = Account(name: "Ev", kind: .xtream, server: "s", username: "u", password: "secret")
        XCTAssertFalse("\(a)".contains("secret"))
    }
}

final class ContentFilterTests: XCTestCase {
    func testAdultRules() {
        XCTAssertTrue(ContentFilter.isAdultCategory("XXX | Channels"))
        XCTAssertTrue(ContentFilter.isAdultCategory("Yetişkin 18+"))
        XCTAssertFalse(ContentFilter.isAdultCategory("Belgesel"))
        XCTAssertTrue(ContentFilter.isAdultName("Some Playboy TV"))
        XCTAssertTrue(ContentFilter.isAdultName("Film +18"))
        XCTAssertTrue(ContentFilter.isAdultName("Adults 2"))
        XCTAssertFalse(ContentFilter.isAdultName("Adult Swim"))
        XCTAssertFalse(ContentFilter.isAdultName("Sex Education"))
    }

    func testSimpleDataTableListings() {
        let root: [String: Any] = ["epg_listings": [
            ["title": "SGFiZXJsZXI=", "description": "", "start_timestamp": "1700000000", "stop_timestamp": "1700001800"]]]
        let p = XtreamClient.listings(root)
        XCTAssertEqual(p.first?.title, "Haberler")
        XCTAssertEqual(p.first?.stop.timeIntervalSince(p.first!.start), 1800)
    }
}
