import SwiftUI
import AppKit

struct AddGitSyncProjectSheet: View {
    let onAdd: (GitSyncProject) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var repoPath = ""
    @State private var branch = "main"
    @State private var changelogPath = ""
    @State private var productDocPath = ""
    @State private var errorMessage: String?

    var isValid: Bool {
        !name.isEmpty && !repoPath.isEmpty && !changelogPath.isEmpty && !productDocPath.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            // Title
            HStack {
                Text("Connect Git Repository")
                    .font(.title2.bold())
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .font(.title2)
                }
                .buttonStyle(.borderless)
            }
            .padding()

            Divider()

            Form {
                Section("Git Repository") {
                    TextField("Project Name", text: $name)
                        .help("A display name for this project")

                    HStack {
                        TextField("Repository Path", text: $repoPath)
                        Button("Browse...") {
                            let panel = NSOpenPanel()
                            panel.canChooseFiles = false
                            panel.canChooseDirectories = true
                            panel.message = "Select a git repository folder"
                            if panel.runModal() == .OK, let url = panel.url {
                                repoPath = url.path
                                // Auto-fill name from folder name if empty
                                if name.isEmpty {
                                    name = url.lastPathComponent
                                }
                            }
                        }
                        .controlSize(.small)
                    }

                    TextField("Branch", text: $branch)
                        .help("Git branch to monitor (default: main)")
                }

                Section("Obsidian Vault Targets") {
                    HStack {
                        TextField("Changelog Path", text: $changelogPath)
                            .help("Where to write the changelog (e.g. /Users/you/Vault/Projects/MyApp Changelog.md)")
                        Button("Browse...") {
                            browseForFile(binding: $changelogPath, title: "Select changelog file location")
                        }
                        .controlSize(.small)
                    }

                    HStack {
                        TextField("Product Doc Path", text: $productDocPath)
                            .help("Where to write the product doc (e.g. /Users/you/Vault/Projects/MyApp Product Doc.md)")
                        Button("Browse...") {
                            browseForFile(binding: $productDocPath, title: "Select product doc file location")
                        }
                        .controlSize(.small)
                    }
                }

                if let error = errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button("Add Project") {
                    addProject()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!isValid)
            }
            .padding()
        }
        .frame(width: 520, height: 440)
    }

    private func browseForFile(binding: Binding<String>, title: String) {
        let panel = NSSavePanel()
        panel.title = title
        panel.allowedContentTypes = [.plainText]
        panel.allowsOtherFileTypes = true
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            binding.wrappedValue = url.path
        }
    }

    private func addProject() {
        // Validate repo path
        let repoURL = URL(fileURLWithPath: repoPath)
        let gitDir = repoURL.appendingPathComponent(".git")
        guard FileManager.default.fileExists(atPath: gitDir.path) else {
            errorMessage = "Not a git repository — no .git folder found at \(repoPath)"
            return
        }

        let timestamp = Int(Date().timeIntervalSince1970)
        let randomSuffix = String(format: "%06x", Int.random(in: 0..<0xFFFFFF))

        let project = GitSyncProject(
            id: "\(timestamp)_\(randomSuffix)",
            name: name,
            repoPath: repoPath,
            branch: branch.isEmpty ? "main" : branch,
            changelogPath: changelogPath,
            productDocPath: productDocPath,
            lastCommit: nil,
            enabled: true
        )

        onAdd(project)
        dismiss()
    }
}
