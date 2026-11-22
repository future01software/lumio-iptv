import AVFoundation
import LumioCore
import SwiftData
import SwiftUI

@main
struct LumioApp: App {
    private let container: ModelContainer
    @State private var model: AppModel

    init() {
        // Channel logos and posters: let AsyncImage reuse what it already downloaded.
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)

        let container: ModelContainer
        do {
            container = try ModelContainer(for: FavoriteItem.self, WatchProgress.self)
        } catch {
            fatalError("SwiftData store could not be opened: \(error)")
        }
        self.container = container
        _model = State(initialValue: AppModel(container: container))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        .modelContainer(container)
    }
}
