# Git Sync → ObsidianToolkit Integration Guide

This directory contains all the files needed to add the Git Sync agent to the
[ObsidianToolkit](https://github.com/IamTrevorMay/ObsidianToolkit) repository.

## File Map

Copy each file to its target location in ObsidianToolkit:

### Python Agent (toolkit/)

| Source | Target in ObsidianToolkit |
|--------|---------------------------|
| `toolkit/agents/git_sync.py` | `toolkit/agents/git_sync.py` |
| `toolkit/manifest_git_sync_entry.json` | *(merge into `toolkit/manifest.json` → `agents` array)* |

### Swift Manager (manager/)

| Source | Target in ObsidianToolkit |
|--------|---------------------------|
| `manager/.../Models/GitSyncProject.swift` | `manager/ObsidianToolkitManager/Models/GitSyncProject.swift` |
| `manager/.../Services/GitSyncService.swift` | `manager/ObsidianToolkitManager/Services/GitSyncService.swift` |
| `manager/.../Views/GitSync/GitSyncView.swift` | `manager/ObsidianToolkitManager/Views/GitSync/GitSyncView.swift` |
| `manager/.../Views/GitSync/GitSyncProjectCard.swift` | `manager/ObsidianToolkitManager/Views/GitSync/GitSyncProjectCard.swift` |
| `manager/.../Views/GitSync/AddGitSyncProjectSheet.swift` | `manager/ObsidianToolkitManager/Views/GitSync/AddGitSyncProjectSheet.swift` |

### Existing Files to Modify

See the `.patch` files for exact changes:

1. **`toolkit/agents/__init__.py`** — Add `GitSyncAgent` lazy import + `__all__` entry
2. **`toolkit/agents/__main__.py`** — Add `git_sync` to the `AGENTS` dict
3. **`toolkit/manifest.json`** — Append the git_sync agent definition from `manifest_git_sync_entry.json`
4. **`manager/.../Models/AppState.swift`** — Add `.gitSync` to `SidebarTab` enum + icon
5. **`manager/.../Views/ContentView`** — Route `.gitSync` tab to `GitSyncView()`

## How It Works

### Python Agent (`git_sync.py`)

A CLI agent that extends the ObsidianToolkit `Agent` base class:

```bash
# List connected projects
python -m agents.git_sync list

# Connect a git repo to Obsidian docs
python -m agents.git_sync add \
  --name "My App" \
  --repo-path /path/to/repo \
  --branch main \
  --changelog-path "/path/to/vault/My App Changelog.md" \
  --product-doc-path "/path/to/vault/My App Product Doc.md"

# Sync a specific project
python -m agents.git_sync sync --project-id <id>

# Sync all enabled projects
python -m agents.git_sync sync-all

# Remove a project
python -m agents.git_sync remove --project-id <id>
```

On sync, it:
1. Fetches new commits since last sync
2. Gets diffs for the 5 most recent commits
3. Sends to Claude to generate a changelog entry (Added/Changed/Fixed/Removed)
4. Appends the entry to the changelog markdown file
5. Sends the changelog + existing product doc to Claude to update the living product doc
6. Saves the latest commit hash for next run

### Swift Manager (GitSync tab)

Adds a dedicated **Git Sync** tab to the macOS manager app with:
- Grid of project cards showing repo path, branch, Obsidian file paths, last commit
- **Add Project** sheet with file browser for repo and Obsidian paths
- **Sync Now** button per project (runs Python agent via subprocess)
- **Sync All** button for batch sync
- Enable/disable toggle per project
- Delete with confirmation
- Live output console showing sync progress

## Requirements

- Python 3.12+
- `anthropic` pip package (already in toolkit requirements.txt)
- `ANTHROPIC_API_KEY` environment variable
- Git installed and accessible
