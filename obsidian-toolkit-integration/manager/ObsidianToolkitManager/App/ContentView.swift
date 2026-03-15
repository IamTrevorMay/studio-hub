import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        NavigationSplitView {
            List(SidebarTab.allCases, selection: $state.selectedTab) { tab in
                Label(tab.rawValue, systemImage: tab.icon)
                    .tag(tab)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
            .listStyle(.sidebar)
        } detail: {
            if appState.toolkitPath.isEmpty {
                ContentUnavailableView(
                    "No Toolkit Configured",
                    systemImage: "folder.badge.questionmark",
                    description: Text("Open Settings (Cmd+,) to set your obsidian-toolkit path.")
                )
            } else {
                switch appState.selectedTab {
                case .dashboard:
                    DashboardView()
                case .agentRunner:
                    AgentRunnerView()
                case .vaultBrowser:
                    VaultBrowserView()
                case .reports:
                    ReportListView()
                case .gitSync:
                    GitSyncView()
                case .settings:
                    SettingsView()
                }
            }
        }
        .frame(minWidth: 800, minHeight: 500)
    }
}
