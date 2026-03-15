#!/bin/bash
# Usage: ./apply.sh /path/to/ObsidianToolkit
# Copies all Git Sync integration files into your local ObsidianToolkit repo.

set -e

TARGET="${1:?Usage: ./apply.sh /path/to/ObsidianToolkit}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$TARGET/.git" ]; then
  echo "Error: $TARGET is not a git repository"
  exit 1
fi

echo "Copying new files..."
# New Python agent
cp "$SCRIPT_DIR/toolkit/agents/git_sync.py" "$TARGET/toolkit/agents/git_sync.py"

# New Swift files
mkdir -p "$TARGET/manager/ObsidianToolkitManager/Views/GitSync"
cp "$SCRIPT_DIR/manager/ObsidianToolkitManager/Models/GitSyncProject.swift" \
   "$TARGET/manager/ObsidianToolkitManager/Models/"
cp "$SCRIPT_DIR/manager/ObsidianToolkitManager/Services/GitSyncService.swift" \
   "$TARGET/manager/ObsidianToolkitManager/Services/"
cp "$SCRIPT_DIR/manager/ObsidianToolkitManager/Views/GitSync/"*.swift \
   "$TARGET/manager/ObsidianToolkitManager/Views/GitSync/"

echo "Copying modified files..."
# Modified existing files (with Git Sync additions)
cp "$SCRIPT_DIR/toolkit/agents/__init__.py" "$TARGET/toolkit/agents/__init__.py"
cp "$SCRIPT_DIR/toolkit/agents/__main__.py" "$TARGET/toolkit/agents/__main__.py"
cp "$SCRIPT_DIR/toolkit/manifest.json" "$TARGET/toolkit/manifest.json"
cp "$SCRIPT_DIR/manager/ObsidianToolkitManager/Models/AppState.swift" \
   "$TARGET/manager/ObsidianToolkitManager/Models/AppState.swift"
cp "$SCRIPT_DIR/manager/ObsidianToolkitManager/App/ContentView.swift" \
   "$TARGET/manager/ObsidianToolkitManager/App/ContentView.swift"

echo ""
echo "Done! Files applied to $TARGET"
echo "You can now cd into $TARGET and commit."
