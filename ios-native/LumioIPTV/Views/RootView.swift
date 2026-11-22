import LumioCore
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var lock = AppLock.shared

    var body: some View {
        Group {
            if model.activeAccount == nil {
                NavigationStack { AddAccountView(isOnboarding: true) }
            } else {
                MainTabView()
                    .id(model.activeAccount?.id)
            }
        }
        .preferredColorScheme(.dark)
        // Performance "Hafif": no animations anywhere.
        .transaction { if AppSettings.shared.isLightMode { $0.disablesAnimations = true } }
        .onChange(of: AppSettings.shared.hideAdult) { model.contentFilterChanged() }
        // App lock: locked at launch when a PIN is set, and again whenever the app goes to the background.
        .onAppear { LockWindowController.shared.update(locked: lock.isLocked) }
        .onChange(of: lock.isLocked) { _, locked in LockWindowController.shared.update(locked: locked) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { lock.lock() }
        }
        .tint(Theme.brand)
        .background(Theme.surface.ignoresSafeArea())
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            HomeView()
                .tabItem { Label("Ana Sayfa", systemImage: "house") }
                .tag(AppTab.home)
            LiveTVView()
                .tabItem { Label("Canlı TV", systemImage: "tv") }
                .tag(AppTab.live)
            MoviesView()
                .tabItem { Label("Filmler", systemImage: "film") }
                .tag(AppTab.movies)
            SeriesListView()
                .tabItem { Label("Diziler", systemImage: "play.rectangle.on.rectangle") }
                .tag(AppTab.series)
            LibraryView()
                .tabItem { Label("Listem", systemImage: "heart") }
                .tag(AppTab.library)
        }
        .task { await model.runLaunchAction() }
    }
}
