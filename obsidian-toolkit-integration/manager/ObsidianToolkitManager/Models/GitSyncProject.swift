import Foundation

struct GitSyncProject: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var repoPath: String
    var branch: String
    var changelogPath: String
    var productDocPath: String
    var lastCommit: String?
    var enabled: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, branch, enabled
        case repoPath = "repo_path"
        case changelogPath = "changelog_path"
        case productDocPath = "product_doc_path"
        case lastCommit = "last_commit"
    }

    var shortLastCommit: String {
        guard let hash = lastCommit, !hash.isEmpty else { return "none" }
        return String(hash.prefix(8))
    }
}
