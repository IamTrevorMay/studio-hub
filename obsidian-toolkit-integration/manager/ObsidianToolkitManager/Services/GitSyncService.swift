import Foundation

struct GitSyncService {

    // MARK: - Projects file I/O

    static func projectsFileURL(toolkitPath: String) -> URL {
        URL(fileURLWithPath: toolkitPath)
            .appendingPathComponent("git_sync_projects.json")
    }

    static func loadProjects(toolkitPath: String) -> [GitSyncProject] {
        let url = projectsFileURL(toolkitPath: toolkitPath)
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([GitSyncProject].self, from: data)) ?? []
    }

    static func saveProjects(_ projects: [GitSyncProject], toolkitPath: String) throws {
        let url = projectsFileURL(toolkitPath: toolkitPath)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(projects)
        try data.write(to: url, options: .atomic)
    }

    // MARK: - Run agent subcommands via Python

    static func runCommand(
        command: String,
        args: [String] = [],
        pythonPath: String,
        toolkitPath: String,
        environment: [String: String] = [:]
    ) -> (UUID, AsyncStream<ProcessOutput>) {
        var arguments = ["-m", "agents.git_sync"]
        arguments.append(command)
        arguments.append(contentsOf: args)

        let configPath = (toolkitPath as NSString).appendingPathComponent("config.json")
        arguments.append(contentsOf: ["--config", configPath])

        let stream = AsyncStream<ProcessOutput> { continuation in
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()

            process.executableURL = URL(fileURLWithPath: pythonPath)
            process.arguments = arguments
            process.currentDirectoryURL = URL(fileURLWithPath: toolkitPath)
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe
            if !environment.isEmpty {
                process.environment = environment
            }

            let stdoutHandle = stdoutPipe.fileHandleForReading
            let stderrHandle = stderrPipe.fileHandleForReading

            stdoutHandle.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                if let str = String(data: data, encoding: .utf8) {
                    for line in str.components(separatedBy: .newlines) where !line.isEmpty {
                        continuation.yield(.stdout(line))
                    }
                }
            }

            stderrHandle.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                if let str = String(data: data, encoding: .utf8) {
                    for line in str.components(separatedBy: .newlines) where !line.isEmpty {
                        continuation.yield(.stderr(line))
                    }
                }
            }

            process.terminationHandler = { proc in
                stdoutHandle.readabilityHandler = nil
                stderrHandle.readabilityHandler = nil

                let remainingStdout = stdoutHandle.readDataToEndOfFile()
                if !remainingStdout.isEmpty, let str = String(data: remainingStdout, encoding: .utf8) {
                    for line in str.components(separatedBy: .newlines) where !line.isEmpty {
                        continuation.yield(.stdout(line))
                    }
                }
                let remainingStderr = stderrHandle.readDataToEndOfFile()
                if !remainingStderr.isEmpty, let str = String(data: remainingStderr, encoding: .utf8) {
                    for line in str.components(separatedBy: .newlines) where !line.isEmpty {
                        continuation.yield(.stderr(line))
                    }
                }

                continuation.yield(.exit(proc.terminationStatus))
                continuation.finish()
            }

            continuation.onTermination = { @Sendable _ in
                if process.isRunning {
                    process.terminate()
                }
            }

            do {
                try process.run()
            } catch {
                continuation.yield(.stderr("Failed to launch: \(error.localizedDescription)"))
                continuation.yield(.exit(-1))
                continuation.finish()
            }
        }

        return (UUID(), stream)
    }
}
