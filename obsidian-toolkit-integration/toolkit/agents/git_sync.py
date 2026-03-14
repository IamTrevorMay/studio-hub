"""Git Sync agent — monitors git repos and updates Obsidian changelog & product docs."""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from agents.framework import Agent


class GitSyncAgent(Agent):
    """Sync git commit history into Obsidian markdown notes."""

    PROJECTS_FILE = "git_sync_projects.json"

    def get_name(self) -> str:
        return "git-sync"

    def validate_config(self):
        pass  # No vault-specific validation needed beyond base

    # ------------------------------------------------------------------
    # Project persistence
    # ------------------------------------------------------------------

    def _projects_path(self) -> Path:
        return Path(__file__).parent.parent / self.PROJECTS_FILE

    def _load_projects(self) -> list[dict]:
        path = self._projects_path()
        if not path.exists():
            return []
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def _save_projects(self, projects: list[dict]) -> None:
        path = self._projects_path()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(projects, f, indent=2)

    def _find_project(self, projects: list[dict], project_id: str) -> dict | None:
        return next((p for p in projects if p["id"] == project_id), None)

    # ------------------------------------------------------------------
    # Git helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _git(repo_path: str, *args: str) -> str:
        """Run a git command and return stdout."""
        result = subprocess.run(
            ["git", *args],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def _fetch_remote(self, repo_path: str, branch: str) -> None:
        try:
            self._git(repo_path, "fetch", "origin", branch)
        except (RuntimeError, subprocess.TimeoutExpired):
            self.logger.debug("Fetch failed (offline?) — using local commits")

    def _get_new_commits(self, project: dict) -> list[dict]:
        repo = project["repo_path"]
        branch = project.get("branch", "main")

        self._fetch_remote(repo, branch)

        if project.get("last_commit"):
            fmt = "--pretty=format:%H||%s||%an||%ai"
            raw = self._git(repo, "log", fmt, f"{project['last_commit']}..{branch}")
        else:
            fmt = "--pretty=format:%H||%s||%an||%ai"
            raw = self._git(repo, "log", fmt, "-10", branch)

        if not raw:
            return []

        commits = []
        for line in raw.splitlines():
            parts = line.split("||", 3)
            if len(parts) == 4:
                commits.append({
                    "hash": parts[0],
                    "message": parts[1],
                    "author": parts[2],
                    "date": parts[3],
                })
        return commits

    def _get_diff(self, repo_path: str, commit_hash: str) -> str:
        try:
            return self._git(repo_path, "diff", f"{commit_hash}~1", commit_hash)
        except RuntimeError:
            return "Initial commit"

    # ------------------------------------------------------------------
    # Claude API helpers
    # ------------------------------------------------------------------

    def _generate_changelog(self, commits: list[dict], diffs: list[str]) -> str:
        client = self.get_claude_client()
        if not client:
            raise RuntimeError("No API key — cannot generate changelog")

        now = datetime.now().strftime("%A, %B %d, %Y at %I:%M %p")
        commit_summary = "\n\n".join(
            f"### Commit: {c['message']}\n```diff\n{d}\n```"
            for c, d in zip(commits, diffs)
        )

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": (
                    "You are a technical writer. Given the following git commits and diffs, "
                    "write a concise **release-notes style changelog entry** in Markdown.\n\n"
                    "Rules:\n"
                    f"- Start with a heading: ## {now}\n"
                    "- Group changes into categories like **Added**, **Changed**, **Fixed**, "
                    "**Removed** (only include categories that apply)\n"
                    "- Use bullet points\n"
                    "- Be concise but informative\n"
                    "- Do NOT include raw diff content\n"
                    "- Do NOT wrap in code fences\n\n"
                    f"Commits & Diffs:\n{commit_summary}"
                ),
            }],
        )
        return response.content[0].text

    def _update_product_doc(self, current_doc: str, changelog_entry: str) -> str:
        client = self.get_claude_client()
        if not client:
            raise RuntimeError("No API key — cannot update product doc")

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": (
                    "You are a technical writer maintaining a living **Product Document / "
                    "User Manual** for a software project stored as an Obsidian markdown note.\n\n"
                    "Here is the CURRENT product document:\n---\n"
                    f"{current_doc or '*(empty — brand new product document)*'}\n---\n\n"
                    "Here is the LATEST changelog entry:\n---\n"
                    f"{changelog_entry}\n---\n\n"
                    "Your job:\n"
                    "1. Update the product document to reflect the changelog changes.\n"
                    "2. Add new sections for new features.\n"
                    "3. Update existing sections for modified features.\n"
                    "4. Remove sections for removed features.\n"
                    "5. Keep it well-organized with clear headings and descriptions.\n"
                    "6. If empty, create a sensible structure: title, overview, feature sections.\n"
                    "7. Write in user-facing product manual style.\n"
                    "8. Output ONLY the full updated document in Markdown. No commentary."
                ),
            }],
        )
        return response.content[0].text

    # ------------------------------------------------------------------
    # Core sync
    # ------------------------------------------------------------------

    def _sync_project(self, project: dict) -> dict:
        self.logger.info('Checking "%s" ...', project["name"])

        commits = self._get_new_commits(project)
        if not commits:
            self.logger.info('No new commits for "%s".', project["name"])
            return {"updated": False}

        self.logger.info("Found %d new commit(s). Generating changelog ...", len(commits))

        recent = commits[:5]
        diffs = [self._get_diff(project["repo_path"], c["hash"]) for c in recent]

        changelog_entry = self._generate_changelog(recent, diffs)

        # Append to changelog
        changelog_path = Path(project["changelog_path"])
        changelog_path.parent.mkdir(parents=True, exist_ok=True)
        existing = changelog_path.read_text(encoding="utf-8") if changelog_path.exists() else ""
        divider = "\n\n---\n\n"
        updated = changelog_entry + divider + existing if existing else changelog_entry
        changelog_path.write_text(updated, encoding="utf-8")
        self.logger.info("Changelog updated: %s", changelog_path)

        # Update product doc
        self.logger.info("Updating product document ...")
        doc_path = Path(project["product_doc_path"])
        doc_path.parent.mkdir(parents=True, exist_ok=True)
        current_doc = doc_path.read_text(encoding="utf-8") if doc_path.exists() else ""
        updated_doc = self._update_product_doc(current_doc, changelog_entry)
        doc_path.write_text(updated_doc, encoding="utf-8")
        self.logger.info("Product doc updated: %s", doc_path)

        # Update last commit
        project["last_commit"] = commits[0]["hash"]
        projects = self._load_projects()
        for p in projects:
            if p["id"] == project["id"]:
                p["last_commit"] = project["last_commit"]
                break
        self._save_projects(projects)

        return {"updated": True, "commits": len(commits)}

    # ------------------------------------------------------------------
    # Public commands
    # ------------------------------------------------------------------

    def run(self, command: str = "list", **kwargs) -> str:
        """Dispatch to the appropriate subcommand."""
        dispatch = {
            "list": self._cmd_list,
            "add": self._cmd_add,
            "remove": self._cmd_remove,
            "sync": self._cmd_sync,
            "sync-all": self._cmd_sync_all,
        }
        handler = dispatch.get(command)
        if not handler:
            raise ValueError(f"Unknown command: {command}. Use: {', '.join(dispatch)}")
        return handler(**kwargs)

    def _cmd_list(self, **_kwargs) -> str:
        projects = self._load_projects()
        if not projects:
            print("No projects configured. Use 'add' to connect a git repo.")
            return "empty"

        print(f"\n{'Name':<25} {'Branch':<10} {'Enabled':<9} {'Last Commit':<12} Repo Path")
        print("-" * 90)
        for p in projects:
            last = (p.get("last_commit") or "none")[:8]
            enabled = "yes" if p.get("enabled", True) else "no"
            print(f"{p['name']:<25} {p.get('branch', 'main'):<10} {enabled:<9} {last:<12} {p['repo_path']}")
        print()
        return "ok"

    def _cmd_add(self, name: str = "", repo_path: str = "", branch: str = "main",
                 changelog_path: str = "", product_doc_path: str = "", **_kwargs) -> str:
        if not all([name, repo_path, changelog_path, product_doc_path]):
            raise ValueError("Required: --name, --repo-path, --changelog-path, --product-doc-path")

        repo_path = str(Path(repo_path).resolve())
        changelog_path = str(Path(changelog_path).resolve())
        product_doc_path = str(Path(product_doc_path).resolve())

        if not Path(repo_path).is_dir():
            raise ValueError(f"Repo path does not exist: {repo_path}")
        if not (Path(repo_path) / ".git").exists():
            raise ValueError(f"Not a git repository: {repo_path}")

        projects = self._load_projects()
        project = {
            "id": f"{int(datetime.now().timestamp())}_{os.urandom(3).hex()}",
            "name": name,
            "repo_path": repo_path,
            "branch": branch,
            "changelog_path": changelog_path,
            "product_doc_path": product_doc_path,
            "last_commit": None,
            "enabled": True,
        }
        projects.append(project)
        self._save_projects(projects)
        print(f'Added project "{name}" (id: {project["id"]})')
        return project["id"]

    def _cmd_remove(self, project_id: str = "", **_kwargs) -> str:
        if not project_id:
            raise ValueError("Required: --project-id")

        projects = self._load_projects()
        before = len(projects)
        projects = [p for p in projects if p["id"] != project_id]
        if len(projects) == before:
            raise ValueError(f"Project not found: {project_id}")

        self._save_projects(projects)
        print(f"Removed project {project_id}")
        return "removed"

    def _cmd_sync(self, project_id: str = "", **_kwargs) -> str:
        if not project_id:
            raise ValueError("Required: --project-id")

        projects = self._load_projects()
        project = self._find_project(projects, project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        result = self._sync_project(project)
        if result["updated"]:
            print(f'Synced {result["commits"]} commit(s) for "{project["name"]}"')
        else:
            print(f'No new commits for "{project["name"]}"')
        return "synced" if result["updated"] else "no_changes"

    def _cmd_sync_all(self, **_kwargs) -> str:
        projects = self._load_projects()
        enabled = [p for p in projects if p.get("enabled", True)]
        if not enabled:
            print("No enabled projects to sync.")
            return "empty"

        synced = 0
        for project in enabled:
            try:
                result = self._sync_project(project)
                if result["updated"]:
                    synced += 1
            except Exception as e:
                self.logger.error('Error syncing "%s": %s', project["name"], e)

        print(f"Sync complete. {synced}/{len(enabled)} projects had updates.")
        return f"synced_{synced}"


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sync git commits into Obsidian changelog & product docs"
    )
    parser.add_argument("--config", help="Path to config.json")

    sub = parser.add_subparsers(dest="command", help="Command to run")

    # list
    sub.add_parser("list", help="List configured projects")

    # add
    add_p = sub.add_parser("add", help="Add a project to monitor")
    add_p.add_argument("--name", required=True, help="Project name")
    add_p.add_argument("--repo-path", required=True, help="Path to git repository")
    add_p.add_argument("--branch", default="main", help="Branch to monitor (default: main)")
    add_p.add_argument("--changelog-path", required=True, help="Path to changelog markdown file")
    add_p.add_argument("--product-doc-path", required=True, help="Path to product doc markdown file")

    # remove
    rm_p = sub.add_parser("remove", help="Remove a project")
    rm_p.add_argument("--project-id", required=True, help="Project ID to remove")

    # sync
    sync_p = sub.add_parser("sync", help="Sync a specific project now")
    sync_p.add_argument("--project-id", required=True, help="Project ID to sync")

    # sync-all
    sub.add_parser("sync-all", help="Sync all enabled projects")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    agent = GitSyncAgent(config_path=args.config)

    kwargs = {}
    if args.command == "add":
        kwargs = {
            "name": args.name,
            "repo_path": args.repo_path,
            "branch": args.branch,
            "changelog_path": args.changelog_path,
            "product_doc_path": args.product_doc_path,
        }
    elif args.command in ("remove", "sync"):
        kwargs = {"project_id": args.project_id}

    agent.run(command=args.command, **kwargs)


if __name__ == "__main__":
    main()
