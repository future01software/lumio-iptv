import Foundation

enum HTTP {
    /// Same UA the Lumio Android/desktop builds send; some panels reject unknown clients.
    static let userAgent = "IPTVSmarters/1.0"

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 180
        cfg.httpAdditionalHeaders = ["User-Agent": userAgent]
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: cfg)
    }()

    static func data(_ url: URL, timeout: TimeInterval = 30) async throws -> Data {
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        do {
            let (data, response) = try await session.data(for: req)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw ProviderError.http(http.statusCode)
            }
            return data
        } catch let error as ProviderError {
            throw error
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw error.code == .timedOut ? ProviderError.timeout : ProviderError.unreachable
        }
    }

    static func text(_ url: URL, timeout: TimeInterval = 30) async throws -> String {
        let data = try await data(url, timeout: timeout)
        return String(decoding: data, as: UTF8.self)
    }
}

/// Lenient accessors for provider JSON, where numbers arrive as strings and vice versa.
enum JSONValue {
    static func string(_ any: Any?) -> String? {
        switch any {
        case let s as String: return s.isEmpty ? nil : s
        case let n as NSNumber: return n.stringValue
        default: return nil
        }
    }

    static func int(_ any: Any?) -> Int? {
        switch any {
        case let n as NSNumber: return n.intValue
        case let s as String: return Int(s.trimmingCharacters(in: .whitespaces)) ?? Double(s).map { Int($0) }
        default: return nil
        }
    }

    static func double(_ any: Any?) -> Double? {
        switch any {
        case let n as NSNumber: return n.doubleValue
        case let s as String: return Double(s.trimmingCharacters(in: .whitespaces))
        default: return nil
        }
    }

    static func url(_ any: Any?) -> URL? {
        guard let s = string(any)?.trimmingCharacters(in: .whitespaces), s.hasPrefix("http") else { return nil }
        return URL(string: s) ?? s.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed).flatMap(URL.init(string:))
    }
}
