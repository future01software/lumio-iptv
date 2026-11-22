import AVKit
import os
import LumioCore
import SwiftData
import SwiftUI
import UIKit

struct PlayRequest {
    var title: String
    var subtitle: String?
    /// Tried in order until one opens (e.g. original container, then HLS).
    var urls: [URL]
    var isLive: Bool
    var kind: ItemKind
    var itemID: String
    var seriesID: String?
    var image: URL?
    var containerExtension: String?
    var resumeAt: Double?
}

/// Detects the user closing the player (X button or swipe down).
final class LumioPlayerViewController: AVPlayerViewController {
    var onDismiss: (() -> Void)?

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { onDismiss?() }
    }
}

/// Owns the single AVPlayer. AVPlayerViewController gives AirPlay, Picture in Picture,
/// subtitles/audio track menus and the lock-screen controls for free.
@MainActor
final class PlaybackController: NSObject {
    static let shared = PlaybackController()

    var container: ModelContainer?
    var accountID: UUID?
    /// Name of the active list/account, for the channel label overlay.
    var listName: String?
    private let log = Logger(subsystem: "com.future01.lumio.ios", category: "playback")

    private var player: AVPlayer?
    private var playerVC: LumioPlayerViewController?
    private var request: PlayRequest?
    private var urlIndex = 0
    private var didSeekToResume = false
    private var statusObservation: NSKeyValueObservation?
    private var timeObserver: Any?
    private var pipActive = false
    private var restoringFromPiP = false
    private var overlayState: OverlayState?
    // Live stall watchdog (like the desktop app's recoveringHls): a live playlist that
    // stops advancing leaves AVPlayer waiting forever, so rebuild the item.
    private var lastProgressTime: Double = -1
    private var lastProgressAt = Date()
    private var recoveries = 0
    private var nextRecoveryAt = Date.distantPast
    private var statsTimer: Timer?

    func play(_ request: PlayRequest) {
        stop()
        guard !request.urls.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setActive(true)

        let player = AVPlayer()
        player.allowsExternalPlayback = true
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        self.player = player
        self.request = request
        urlIndex = 0
        didSeekToResume = false
        lastProgressTime = -1
        lastProgressAt = Date()
        recoveries = 0
        nextRecoveryAt = .distantPast

        let vc = LumioPlayerViewController()
        vc.player = player
        vc.delegate = self
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.updatesNowPlayingInfoCenter = true
        vc.modalPresentationStyle = .fullScreen
        vc.view.backgroundColor = .black
        vc.videoGravity = switch AppSettings.shared.aspect {
        case .fit: .resizeAspect
        case .zoom, .fill: .resizeAspectFill
        case .stretch: .resize
        }
        vc.onDismiss = { [weak self] in self?.playerDismissed() }
        playerVC = vc
        attachOverlay(to: vc, isLive: request.isLive)
        if AppSettings.shared.showChannelLabel, let state = overlayState {
            state.label = (request.title, listName)
            state.labelUntil = Date().addingTimeInterval(5)
        }

        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 10, preferredTimescale: 1), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.saveProgress() }
        }

        loadCurrentURL()
        Self.topViewController()?.present(vc, animated: true)
    }

    /// Adds the current programme to the player's info panel (live channels).
    func updateLiveInfo(for itemID: String, subtitle: String, summary: String?) {
        guard let request, request.itemID == itemID, let item = player?.currentItem else { return }
        self.request?.subtitle = subtitle
        item.externalMetadata = Self.metadata(title: request.title, subtitle: subtitle, summary: summary)
    }

    func stop() {
        saveProgress()
        statsTimer?.invalidate()
        statsTimer = nil
        overlayState = nil
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        statusObservation = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        if let vc = playerVC, vc.presentingViewController != nil { vc.dismiss(animated: true) }
        playerVC?.onDismiss = nil
        playerVC = nil
        player = nil
        request = nil
        pipActive = false
    }

    // MARK: - Private

    /// Stream info badges + optional wall clock, between the video and the system controls.
    private func attachOverlay(to vc: AVPlayerViewController, isLive: Bool) {
        let state = OverlayState()
        state.isLive = isLive
        overlayState = state
        let host = UIHostingController(rootView: PlayerOverlay(state: state))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        guard let overlay = vc.contentOverlayView else { return }
        overlay.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.bottomAnchor),
        ])
        statsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshStats() }
        }
    }

    private func refreshStats() {
        guard let state = overlayState, let player, let item = player.currentItem else { return }
        state.now = Date()
        if state.isLive { watchdog(player) }
        guard state.isLive, AppSettings.shared.showStreamInfo else { return }
        let time = player.currentTime()
        let previous = state.stats
        Task { @MainActor in
            let stats = await StreamStatsReader.read(item, at: time, previous: previous)
            if stats != state.stats { state.stats = stats }
        }
    }

    private func watchdog(_ player: AVPlayer) {
        let t = player.currentTime().seconds
        let now = Date()
        if t.isFinite, abs(t - lastProgressTime) > 0.2 {
            if lastProgressTime >= 0, now.timeIntervalSince(lastProgressAt) < 3 { recoveries = 0 }
            lastProgressTime = t
            lastProgressAt = now
            return
        }
        // Paused by the user: not a stall.
        guard player.timeControlStatus != .paused || player.rate != 0 else { lastProgressAt = now; return }
        guard now.timeIntervalSince(lastProgressAt) >= 5, now >= nextRecoveryAt, recoveries < 6 else { return }
        recoveries += 1
        nextRecoveryAt = now.addingTimeInterval(Double(min(30, 4 * recoveries)))
        #if DEBUG
        // Diagnostics without URLs: where the playhead stuck vs. what was loaded / seekable.
        if let item = player.currentItem {
            let loaded = item.loadedTimeRanges.map { String(format: "%.1f–%.1f", $0.timeRangeValue.start.seconds, $0.timeRangeValue.end.seconds) }
            let seekable = item.seekableTimeRanges.map { String(format: "%.1f–%.1f", $0.timeRangeValue.start.seconds, $0.timeRangeValue.end.seconds) }
            log.debug("live stall at t=\(t, privacy: .public) loaded=\(loaded, privacy: .public) seekable=\(seekable, privacy: .public); rebuilding (attempt \(self.recoveries, privacy: .public))")
        }
        #endif
        lastProgressAt = now
        loadCurrentURL()
    }

    private func loadCurrentURL() {
        guard let request, let player, urlIndex < request.urls.count else { return }
        let item = AVPlayerItem(url: request.urls[urlIndex])
        item.externalMetadata = Self.metadata(title: request.title, subtitle: request.subtitle, summary: nil)
        let mode = AppSettings.shared.playbackMode
        item.preferredForwardBufferDuration = mode.forwardBuffer
        player.automaticallyWaitsToMinimizeStalling = mode.waitsToMinimizeStalling
        if request.isLive, let offset = mode.liveOffset {
            // Start behind the live edge and stay there, so gaps where the provider
            // publishes nothing are covered by video already in hand. AVPlayer clamps
            // this to the playlist's length when the provider keeps a shorter window.
            item.configuredTimeOffsetFromLive = CMTime(seconds: offset, preferredTimescale: 1)
            item.automaticallyPreservesTimeOffsetFromLive = true
        }
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            DispatchQueue.main.async { self?.itemStatusChanged(status) }
        }
        player.replaceCurrentItem(with: item)
        if AppSettings.shared.autoplay { player.play() }
    }

    private func itemStatusChanged(_ status: AVPlayerItem.Status) {
        guard let request, let player else { return }
        switch status {
        case .readyToPlay:
            if !didSeekToResume, let resume = request.resumeAt, resume > 0 {
                didSeekToResume = true
                player.seek(to: CMTime(seconds: resume, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .positiveInfinity)
            }
        case .failed:
            urlIndex += 1
            if urlIndex < request.urls.count {
                loadCurrentURL()
            } else {
                showError()
            }
        default:
            break
        }
    }

    private func showError() {
        guard let vc = playerVC, vc.presentingViewController != nil else { return }
        let alert = UIAlertController(
            title: "Oynatılamadı",
            message: "Bu yayın açılamadı. Yayın kapalı olabilir ya da biçimi iPhone'da desteklenmiyor olabilir.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Kapat", style: .default) { [weak self] _ in self?.stop() })
        vc.present(alert, animated: true)
    }

    private func playerDismissed() {
        // PiP start dismisses the player too; keep playing in that case.
        guard !pipActive, !restoringFromPiP else { return }
        stop()
    }

    private func saveProgress() {
        guard let request, !request.isLive, request.kind != .live, let player, let item = player.currentItem,
              let container, let accountID else { return }
        let position = player.currentTime().seconds
        let duration = item.duration.seconds
        guard position.isFinite, position > 5 else { return }

        let ctx = container.mainContext
        let key = FavoriteItem.key(accountID, request.kind, request.itemID)
        let existing = try? ctx.fetch(FetchDescriptor<WatchProgress>(predicate: #Predicate { $0.key == key })).first
        let p = existing ?? WatchProgress(accountID: accountID, kind: request.kind, itemID: request.itemID,
                                          seriesID: request.seriesID, name: request.title, subtitle: request.subtitle,
                                          imageURL: request.image, containerExtension: request.containerExtension)
        if existing == nil { ctx.insert(p) }
        p.position = position
        if duration.isFinite, duration > 0 { p.duration = duration }
        p.updatedAt = Date()
        try? ctx.save()
    }

    private static func metadata(title: String, subtitle: String?, summary: String?) -> [AVMetadataItem] {
        func item(_ id: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
            let m = AVMutableMetadataItem()
            m.identifier = id
            m.value = value as NSString
            m.extendedLanguageTag = "und"
            return m
        }
        var items = [item(.commonIdentifierTitle, title)]
        if let subtitle, !subtitle.isEmpty { items.append(item(.iTunesMetadataTrackSubTitle, subtitle)) }
        if let summary, !summary.isEmpty { items.append(item(.commonIdentifierDescription, summary)) }
        return items
    }

    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }
}

extension PlaybackController: AVPlayerViewControllerDelegate {
    nonisolated func playerViewControllerWillStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
        MainActor.assumeIsolated { pipActive = true }
    }

    nonisolated func playerViewControllerDidStopPictureInPicture(_ playerViewController: AVPlayerViewController) {
        MainActor.assumeIsolated {
            pipActive = false
            // Closed from the PiP window (not restored back to full screen): stop playback.
            if !restoringFromPiP, playerVC?.presentingViewController == nil { stop() }
            restoringFromPiP = false
        }
    }

    nonisolated func playerViewController(_ playerViewController: AVPlayerViewController,
                                          restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        MainActor.assumeIsolated {
            guard let vc = playerVC else { completionHandler(false); return }
            restoringFromPiP = true
            if vc.presentingViewController != nil { completionHandler(true); return }
            if let top = Self.topViewController() {
                top.present(vc, animated: true) { completionHandler(true) }
            } else {
                completionHandler(false)
            }
        }
    }
}
