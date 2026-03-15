import SwiftUI

struct GitSyncProjectCard: View {
    let project: GitSyncProject
    let isSyncing: Bool
    let onSync: () -> Void
    let onToggle: () -> Void
    let onDelete: () -> Void

    @State private var showDeleteConfirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header row
            HStack {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.title2)
                    .foregroundStyle(project.enabled ? .blue : .gray)
                    .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name)
                        .font(.headline)
                    Text(project.branch)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Toggle("", isOn: Binding(
                    get: { project.enabled },
                    set: { _ in onToggle() }
                ))
                .toggleStyle(.switch)
                .labelsHidden()
            }

            // Repo path
            Label {
                Text(project.repoPath)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } icon: {
                Image(systemName: "folder.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Obsidian paths
            VStack(alignment: .leading, spacing: 4) {
                Label {
                    Text(abbreviatePath(project.changelogPath))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                } icon: {
                    Image(systemName: "doc.text")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }

                Label {
                    Text(abbreviatePath(project.productDocPath))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                } icon: {
                    Image(systemName: "book.closed")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                }
            }

            Divider()

            // Footer
            HStack {
                // Last commit
                HStack(spacing: 4) {
                    Image(systemName: "number")
                        .font(.caption2)
                    Text(project.shortLastCommit)
                        .font(.system(.caption2, design: .monospaced))
                }
                .foregroundStyle(.tertiary)

                Spacer()

                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)

                if isSyncing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button("Sync Now", action: onSync)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(!project.enabled)
                }
            }
        }
        .padding()
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.08), radius: 4, y: 2)
        .opacity(project.enabled ? 1.0 : 0.6)
        .confirmationDialog("Delete \"\(project.name)\"?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the project from Git Sync. Your Obsidian files won't be deleted.")
        }
    }

    private func abbreviatePath(_ path: String) -> String {
        let components = path.components(separatedBy: "/")
        if components.count > 3 {
            return ".../" + components.suffix(3).joined(separator: "/")
        }
        return path
    }
}
