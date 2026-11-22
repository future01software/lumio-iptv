import Foundation
import SwiftData

public enum ItemKind: String, Codable, Sendable {
    case live, movie, series, episode
}

/// A favorited channel, movie or series. Stream URLs are NOT stored (they embed
/// credentials); items are resolved against the loaded catalog by id.
@Model
public final class FavoriteItem {
    @Attribute(.unique) public var key: String
    public var accountID: UUID
    public var kindRaw: String
    public var itemID: String
    public var name: String
    public var imageURL: String?
    public var addedAt: Date

    public init(accountID: UUID, kind: ItemKind, itemID: String, name: String, imageURL: URL?) {
        self.key = Self.key(accountID, kind, itemID)
        self.accountID = accountID
        self.kindRaw = kind.rawValue
        self.itemID = itemID
        self.name = name
        self.imageURL = imageURL?.absoluteString
        self.addedAt = Date()
    }

    public var kind: ItemKind { ItemKind(rawValue: kindRaw) ?? .live }

    public static func key(_ accountID: UUID, _ kind: ItemKind, _ itemID: String) -> String {
        "\(accountID.uuidString)|\(kind.rawValue)|\(itemID)"
    }
}

/// Playback position of a movie or episode ("continue watching").
@Model
public final class WatchProgress {
    @Attribute(.unique) public var key: String
    public var accountID: UUID
    public var kindRaw: String
    public var itemID: String
    /// For episodes: the series they belong to.
    public var seriesID: String?
    public var name: String
    public var subtitle: String?
    public var imageURL: String?
    public var containerExtension: String?
    public var position: Double
    public var duration: Double
    public var updatedAt: Date

    public init(accountID: UUID, kind: ItemKind, itemID: String, seriesID: String?, name: String,
                subtitle: String?, imageURL: URL?, containerExtension: String?) {
        self.key = FavoriteItem.key(accountID, kind, itemID)
        self.accountID = accountID
        self.kindRaw = kind.rawValue
        self.itemID = itemID
        self.seriesID = seriesID
        self.name = name
        self.subtitle = subtitle
        self.imageURL = imageURL?.absoluteString
        self.containerExtension = containerExtension
        self.position = 0
        self.duration = 0
        self.updatedAt = Date()
    }

    public var kind: ItemKind { ItemKind(rawValue: kindRaw) ?? .movie }

    public var fraction: Double { duration > 0 ? min(1, position / duration) : 0 }

    /// Started but not (nearly) finished.
    public var isResumable: Bool { position > 30 && (duration <= 0 || position < duration - 90) && fraction < 0.95 }
}

public enum LumioSchema {
    public static let models: [any PersistentModel.Type] = [FavoriteItem.self, WatchProgress.self]
}
