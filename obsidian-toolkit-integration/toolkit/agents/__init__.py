"""Obsidian toolkit agents."""


def __getattr__(name):
    if name == "Agent":
        from .framework import Agent
        return Agent
    if name == "DictationIngestionAgent":
        from .dictation_ingestion import DictationIngestionAgent
        return DictationIngestionAgent
    if name == "VaultAuditAgent":
        from .vault_audit import VaultAuditAgent
        return VaultAuditAgent
    if name == "DailyNoteArchiverAgent":
        from .daily_note_archiver import DailyNoteArchiverAgent
        return DailyNoteArchiverAgent
    if name == "AutoTaggerAgent":
        from .auto_tagger import AutoTaggerAgent
        return AutoTaggerAgent
    if name == "BrokenLinkFixerAgent":
        from .broken_link_fixer import BrokenLinkFixerAgent
        return BrokenLinkFixerAgent
    if name == "OrphanConnectorAgent":
        from .orphan_connector import OrphanConnectorAgent
        return OrphanConnectorAgent
    if name == "TagCleanupAgent":
        from .tag_cleanup import TagCleanupAgent
        return TagCleanupAgent
    if name == "EmptyFolderPrunerAgent":
        from .empty_folder_pruner import EmptyFolderPrunerAgent
        return EmptyFolderPrunerAgent
    if name == "WeeklyDigestAgent":
        from .weekly_digest import WeeklyDigestAgent
        return WeeklyDigestAgent
    if name == "TemplateEnforcerAgent":
        from .template_enforcer import TemplateEnforcerAgent
        return TemplateEnforcerAgent
    if name == "GitSyncAgent":
        from .git_sync import GitSyncAgent
        return GitSyncAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "Agent",
    "DictationIngestionAgent",
    "VaultAuditAgent",
    "DailyNoteArchiverAgent",
    "AutoTaggerAgent",
    "BrokenLinkFixerAgent",
    "OrphanConnectorAgent",
    "TagCleanupAgent",
    "EmptyFolderPrunerAgent",
    "WeeklyDigestAgent",
    "TemplateEnforcerAgent",
    "GitSyncAgent",
]
