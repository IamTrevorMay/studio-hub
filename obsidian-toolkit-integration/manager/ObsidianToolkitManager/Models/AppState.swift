import Foundation
import SwiftUI

@Observable
final class AppState {
    var selectedTab: SidebarTab = .dashboard
    var config: VaultConfig?
    var agents: [AgentDefinition] = []
    var runHistory: [AgentRunRecord] = []
    var lastAuditSummary: AuditSummary?
    var selectedAgentId: String?
    var shellEnvironment: [String: String] = ShellEnvironment.capture()

    var toolkitPath: String {
        get { UserDefaults.standard.string(forKey: "toolkitPath") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "toolkitPath") }
    }

    var pythonPath: String {
        get {
            if let saved = UserDefaults.standard.string(forKey: "pythonPath"), !saved.isEmpty {
                return saved
            }
            // Find the best python3 from the shell environment
            if let path = shellEnvironment["PATH"] {
                for dir in path.components(separatedBy: ":") {
                    let candidate = (dir as NSString).appendingPathComponent("python3")
                    if FileManager.default.isExecutableFile(atPath: candidate), candidate != "/usr/bin/python3" {
                        return candidate
                    }
                }
            }
            return "/usr/bin/python3"
        }
        set { UserDefaults.standard.set(newValue, forKey: "pythonPath") }
    }

    func lastRun(for agentId: String) -> AgentRunRecord? {
        runHistory.last(where: { $0.agentId == agentId })
    }

    func loadShellEnvironment() {
        shellEnvironment = ShellEnvironment.capture()
    }

    func hasAPIKey(envVarName: String) -> Bool {
        guard !envVarName.isEmpty else { return false }
        if let val = shellEnvironment[envVarName], !val.isEmpty { return true }
        return false
    }
}

struct ShellEnvironment {
    static func capture() -> [String: String] {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-l", "-c", "env"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            print("[ShellEnvironment] Failed to launch: \(error)")
            return ProcessInfo.processInfo.environment
        }

        // Read ALL data before waiting — avoids pipe buffer deadlock
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard let output = String(data: data, encoding: .utf8) else {
            print("[ShellEnvironment] Could not decode output")
            return ProcessInfo.processInfo.environment
        }

        var env: [String: String] = [:]
        for line in output.components(separatedBy: .newlines) {
            guard let eqIndex = line.firstIndex(of: "=") else { continue }
            let key = String(line[line.startIndex..<eqIndex])
            let value = String(line[line.index(after: eqIndex)...])
            env[key] = value
        }

        print("[ShellEnvironment] Captured \(env.count) vars, ANTHROPIC_API_KEY present: \(env["ANTHROPIC_API_KEY"] != nil)")
        return env
    }
}

enum SidebarTab: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case agentRunner = "Agent Runner"
    case vaultBrowser = "Vault Browser"
    case reports = "Reports"
    case gitSync = "Git Sync"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .agentRunner: return "terminal"
        case .vaultBrowser: return "folder"
        case .reports: return "doc.text.magnifyingglass"
        case .gitSync: return "arrow.triangle.2.circlepath"
        case .settings: return "gear"
        }
    }
}

struct AuditSummary {
    var fileCount: Int = 0
    var folderCount: Int = 0
    var totalSizeMB: Double = 0
    var uniqueTags: Int = 0
    var brokenLinks: Int = 0
    var orphanedNotes: Int = 0
    var generatedAt: Date?
}
