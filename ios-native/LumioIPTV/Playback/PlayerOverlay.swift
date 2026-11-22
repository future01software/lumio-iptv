import AVFoundation
import CoreMedia
import Observation
import SwiftUI

/// Stream details read from the playing AVPlayerItem.
struct StreamStats: Equatable {
    var resolution: String?
    var codec: String?
    var fps: Int?
    var bitrateMbps: Double?
    var bufferSeconds: Double?

    static let standardRates: [(Double, Int)] = [(23.976, 24), (24, 24), (25, 25), (29.97, 30), (30, 30), (50, 50), (59.94, 60), (60, 60)]

    /// Snaps a measured rate to a broadcast rate; nil when it doesn't fit one.
    static func snapFPS(_ rate: Double) -> Int? {
        guard rate > 0 else { return nil }
        return standardRates.min { abs($0.0 - rate) < abs($1.0 - rate) }.flatMap { abs($0.0 - rate) <= 1.0 ? $0.1 : nil }
    }

    static func resolutionLabel(_ size: CGSize) -> String? {
        guard size.width > 0, size.height > 0 else { return nil }
        // Use the 16:9-equivalent height so letterboxed 1920×800 still reads as 1080p.
        let h = max(size.height, size.width * 9 / 16)
        switch h {
        case 2000...: return "4K"
        case 1400..<2000: return "1440p"
        case 1000..<1400: return "1080p"
        case 700..<1000: return "720p"
        case 560..<700: return "576p"
        default: return "\(Int(size.height))p"
        }
    }

    static func codecLabel(_ subtype: FourCharCode) -> String? {
        switch subtype {
        case kCMVideoCodecType_H264: "H.264"
        case kCMVideoCodecType_HEVC, FourCharCode(0x6876_6331) /* hvc1 */, FourCharCode(0x6865_7631) /* hev1 */: "HEVC"
        case kCMVideoCodecType_MPEG2Video: "MPEG-2"
        case kCMVideoCodecType_AV1: "AV1"
        default: nil
        }
    }
}

@MainActor
@Observable
final class OverlayState {
    var stats = StreamStats()
    var isLive = false
    var now = Date()
    /// Channel + list name, shown until `labelUntil`.
    var label: (title: String, list: String?)?
    var labelUntil = Date.distantPast
}

/// Drawn between the video and AVPlayerViewController's controls.
struct PlayerOverlay: View {
    let state: OverlayState
    @State private var settings = AppSettings.shared

    var body: some View {
        VStack {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    if let label = state.label, state.now < state.labelUntil {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(label.title).font(.headline)
                            if let list = label.list { Text(list).font(.caption).foregroundStyle(.white.opacity(0.75)) }
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(.white)
                        .transition(.opacity)
                    }
                    if state.isLive && settings.showStreamInfo { badges }
                }
                Spacer()
                if settings.showClock {
                    Text(state.now.formatted(date: .omitted, time: .shortened))
                        .font(.system(size: 15, weight: .semibold).monospacedDigit())
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(.black.opacity(0.45), in: Capsule())
                        .foregroundStyle(.white)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.top, 52)
        .allowsHitTesting(false)
        .animation(.easeOut(duration: 0.3), value: state.now < state.labelUntil)
    }

    private var badges: some View {
        let s = state.stats
        return HStack(spacing: 5) {
            if let r = s.resolution { badge(r) }
            if let c = s.codec { badge(c) }
            if let f = s.fps { badge("\(f) fps") }
            if let b = s.bitrateMbps { badge(String(format: "%.1f Mb/s", b)) }
            if let buf = s.bufferSeconds {
                HStack(spacing: 4) {
                    Circle().fill(buf >= 10 ? Color.green : buf >= 4 ? Color.orange : Color.red).frame(width: 7, height: 7)
                    Text(String(format: "%.0f sn", buf))
                }
                .badgeStyle()
            }
        }
    }

    private func badge(_ text: String) -> some View { Text(text).badgeStyle() }
}

private extension View {
    func badgeStyle() -> some View {
        self.font(.system(size: 11, weight: .bold).monospacedDigit())
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 5))
            .foregroundStyle(.white)
    }
}

enum StreamStatsReader {
    @MainActor
    static func read(_ item: AVPlayerItem, at time: CMTime, previous: StreamStats) async -> StreamStats {
        var s = previous
        s.resolution = StreamStats.resolutionLabel(item.presentationSize) ?? previous.resolution
        if let event = item.accessLog()?.events.last {
            let bps = event.indicatedBitrate > 0 ? event.indicatedBitrate : event.observedBitrate
            s.bitrateMbps = bps > 0 ? bps / 1_000_000 : nil
        }
        let t = time.seconds
        if t.isFinite {
            let ranges = item.loadedTimeRanges.map(\.timeRangeValue)
            if let r = ranges.first(where: { $0.start.seconds <= t + 0.5 && $0.end.seconds >= t }) {
                s.bufferSeconds = max(0, r.end.seconds - t)
            }
        }
        if let video = item.tracks.first(where: { $0.assetTrack?.mediaType == .video }) {
            let rate = Double(video.currentVideoFrameRate)
            if rate > 0 { s.fps = StreamStats.snapFPS(rate) }
            if s.codec == nil, let track = video.assetTrack,
               let desc = try? await track.load(.formatDescriptions).first {
                s.codec = StreamStats.codecLabel(CMFormatDescriptionGetMediaSubType(desc))
            }
        }
        return s
    }
}
