"""List available agents and usage examples."""

AGENTS = {
    "dictation_ingestion": {
        "description": "Ingest dictation text into the Obsidian vault",
        "usage": [
            'python -m agents.dictation_ingestion --text "Your dictation here" --source voice_memo',
            'python -m agents.dictation_ingestion --file notes.txt --source manual --tags meeting followup',
            'python -m agents.dictation_ingestion --text "Test" --source manual --dry-run',
        ],
    },
    "vault_audit": {
        "description": "Analyze vault health and generate a report",
        "usage": [
            "python -m agents.vault_audit",
            "python -m agents.vault_audit --no-ai",
            "python -m agents.vault_audit --sections tags links --output my_report.md",
        ],
    },
    "daily_note_archiver": {
        "description": "Archive old daily notes into year-based folders",
        "usage": [
            "python -m agents.daily_note_archiver --dry-run",
            "python -m agents.daily_note_archiver --months 3 --execute",
        ],
    },
    "auto_tagger": {
        "description": "Suggest and apply tags to untagged notes using AI",
        "usage": [
            "python -m agents.auto_tagger --dry-run",
            "python -m agents.auto_tagger --batch-size 10 --apply",
            "python -m agents.auto_tagger --folder 'Meeting Notes' --dry-run",
        ],
    },
    "broken_link_fixer": {
        "description": "Find and fix broken wiki links in the vault",
        "usage": [
            "python -m agents.broken_link_fixer --dry-run",
            "python -m agents.broken_link_fixer --auto-fix",
        ],
    },
    "orphan_connector": {
        "description": "Find orphaned notes and suggest connections",
        "usage": [
            "python -m agents.orphan_connector --dry-run",
            "python -m agents.orphan_connector --batch-size 20 --min-score 0.5",
        ],
    },
    "tag_cleanup": {
        "description": "Detect and fix tag inconsistencies (case variants, similar tags, orphans)",
        "usage": [
            "python -m agents.tag_cleanup --dry-run",
            "python -m agents.tag_cleanup --execute --merge",
            "python -m agents.tag_cleanup --execute --remove-orphans",
        ],
    },
    "empty_folder_pruner": {
        "description": "Remove or index empty folders in the vault",
        "usage": [
            "python -m agents.empty_folder_pruner --dry-run",
            "python -m agents.empty_folder_pruner --mode index --execute",
            "python -m agents.empty_folder_pruner --execute",
        ],
    },
    "weekly_digest": {
        "description": "Generate a summary of recent vault activity",
        "usage": [
            "python -m agents.weekly_digest",
            "python -m agents.weekly_digest --days 14",
            "python -m agents.weekly_digest --output my_digest.md",
        ],
    },
    "template_enforcer": {
        "description": "Check and fix frontmatter compliance for notes",
        "usage": [
            "python -m agents.template_enforcer --dry-run",
            "python -m agents.template_enforcer --folder 'Meeting Notes' --template 'Templates/Meeting.md' --fix",
        ],
    },
    "git_sync": {
        "description": "Sync git commits into Obsidian changelog & product docs",
        "usage": [
            "python -m agents.git_sync list",
            "python -m agents.git_sync add --name 'My App' --repo-path /path/to/repo --changelog-path /vault/Changelog.md --product-doc-path /vault/Product.md",
            "python -m agents.git_sync sync --project-id <id>",
            "python -m agents.git_sync sync-all",
            "python -m agents.git_sync remove --project-id <id>",
        ],
    },
}


def main():
    print("Obsidian CLI Toolkit — Available Agents\n")
    for name, info in AGENTS.items():
        print(f"  {name}")
        print(f"    {info['description']}\n")
        print("    Examples:")
        for ex in info["usage"]:
            print(f"      {ex}")
        print()


if __name__ == "__main__":
    main()
