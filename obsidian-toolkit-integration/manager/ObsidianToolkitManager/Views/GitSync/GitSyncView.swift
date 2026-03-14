import SwiftUI
import AppKit

struct GitSyncView: View {
    @Environment(AppState.self) private var appState
    @State private var projects: [GitSyncProject] = []
    @State private var showAddSheet = false
    @State private var syncingIds: Set<String> = []
    @State private var outputLines: [OutputLine] = []
    @State private var showOutput = false

    struct OutputLine: Identifiable {
        let id = UUID()
        let text: String
        let isStderr: Bool
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Git Sync")
                        .font(.title.bold())
                    Text("Connect git repositories to Obsidian docs — changelogs and product docs update automatically from commits.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    syncAll()
                } label: {
                    Label("Sync All", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.bordered)
                .disabled(!syncingIds.isEmpty)

                Button {
                    showAddSheet = true
                } label: {
                    Label("Add Project", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()

            Divider()

            if projects.isEmpty {
                ContentUnavailableView(
                    "No Projects Connected",
                    systemImage: "arrow.triangle.2.circlepath",
                    description: Text("Add a git repository to start syncing commits into Obsidian changelog and product docs.")
                )
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 340, maximum: 500), spacing: 16)], spacing: 16) {
                        ForEach(projects) { project in
                            GitSyncProjectCard(
                                project: project,
                                isSyncing: syncingIds.contains(project.id),
                                onSync: { syncProject(project) },
                                onToggle: { toggleProject(project) },
                                onDelete: { deleteProject(project) }
                            )
                        }
                    }
                    .padding()
                }
            }

            // Output console (collapsible)
            if showOutput && !outputLines.isEmpty {
                Divider()
                VStack(spacing: 0) {
                    HStack {
                        Text("Output")
                            .font(.caption.bold())
                        Spacer()
                        Button("Clear") {
                            outputLines.removeAll()
                            showOutput = false
                        }
                        .buttonStyle(.borderless)
                        .font(.caption)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.bar)

                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 1) {
                            ForEach(outputLines) { line in
                                Text(line.text)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(line.isStderr ? .secondary : .primary)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(6)
                    }
                    .background(Color(nsColor: .textBackgroundColor))
                    .frame(maxHeight: 150)
                }
            }
        }
        .navigationTitle("Git Sync")
        .onAppear { loadProjects() }
        .sheet(isPresented: $showAddSheet) {
            AddGitSyncProjectSheet(onAdd: { project in
                addProject(project)
            })
        }
    }

    // MARK: - Actions

    private func loadProjects() {
        projects = GitSyncService.loadProjects(toolkitPath: appState.toolkitPath)
    }

    private func addProject(_ project: GitSyncProject) {
        var current = GitSyncService.loadProjects(toolkitPath: appState.toolkitPath)
        current.append(project)
        try? GitSyncService.saveProjects(current, toolkitPath: appState.toolkitPath)
        loadProjects()
    }

    private func deleteProject(_ project: GitSyncProject) {
        var current = GitSyncService.loadProjects(toolkitPath: appState.toolkitPath)
        current.removeAll { $0.id == project.id }
        try? GitSyncService.saveProjects(current, toolkitPath: appState.toolkitPath)
        loadProjects()
    }

    private func toggleProject(_ project: GitSyncProject) {
        var current = GitSyncService.loadProjects(toolkitPath: appState.toolkitPath)
        if let idx = current.firstIndex(where: { $0.id == project.id }) {
            current[idx].enabled.toggle()
            try? GitSyncService.saveProjects(current, toolkitPath: appState.toolkitPath)
        }
        loadProjects()
    }

    private func syncProject(_ project: GitSyncProject) {
        syncingIds.insert(project.id)
        showOutput = true

        Task {
            let (_, stream) = GitSyncService.runCommand(
                command: "sync",
                args: ["--project-id", project.id],
                pythonPath: appState.pythonPath,
                toolkitPath: appState.toolkitPath,
                environment: appState.shellEnvironment
            )

            for await output in stream {
                await MainActor.run {
                    switch output {
                    case .stdout(let line):
                        outputLines.append(OutputLine(text: line, isStderr: false))
                    case .stderr(let line):
                        outputLines.append(OutputLine(text: line, isStderr: true))
                    case .exit:
                        syncingIds.remove(project.id)
                        loadProjects()
                    }
                }
            }
        }
    }

    private func syncAll() {
        let enabled = projects.filter(\.enabled)
        for p in enabled { syncingIds.insert(p.id) }
        showOutput = true

        Task {
            let (_, stream) = GitSyncService.runCommand(
                command: "sync-all",
                pythonPath: appState.pythonPath,
                toolkitPath: appState.toolkitPath,
                environment: appState.shellEnvironment
            )

            for await output in stream {
                await MainActor.run {
                    switch output {
                    case .stdout(let line):
                        outputLines.append(OutputLine(text: line, isStderr: false))
                    case .stderr(let line):
                        outputLines.append(OutputLine(text: line, isStderr: true))
                    case .exit:
                        syncingIds.removeAll()
                        loadProjects()
                    }
                }
            }
        }
    }
}
