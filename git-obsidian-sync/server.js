const express = require("express");
const fs = require("fs");
const path = require("path");
const { simpleGit } = require("simple-git");
const Anthropic = require("@anthropic-ai/sdk");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Inline env parsing (no dotenv dependency)
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
}

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT) || 3456;
const POLL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS) || 60;
const CONFIG_PATH = path.join(__dirname, "projects.json");

// ---------------------------------------------------------------------------
// Projects persistence (simple JSON file)
// ---------------------------------------------------------------------------

function loadProjects() {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveProjects(projects) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(projects, null, 2));
}

// Project shape:
// { id, name, repoPath, branch, changelogPath, productDocPath, lastCommit, enabled }

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function getNewCommits(project) {
  const git = simpleGit(project.repoPath);

  // Fetch latest from remote (best-effort, works offline too)
  try {
    await git.fetch("origin", project.branch);
  } catch {
    // offline or no remote – that's fine, we'll check local
  }

  const branch = project.branch || "main";
  const log = project.lastCommit
    ? await git.log({ from: project.lastCommit, to: branch })
    : await git.log({ maxCount: 10, from: branch });

  return log.all; // array of commit objects
}

async function getDiffForCommit(repoPath, hash) {
  const git = simpleGit(repoPath);
  return git.diff([`${hash}~1`, hash]).catch(() => "Initial commit");
}

// ---------------------------------------------------------------------------
// Claude API helpers
// ---------------------------------------------------------------------------

function getClient() {
  return new Anthropic();
}

async function generateChangelog(commits, diffs) {
  const client = getClient();
  const now = new Date().toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const commitSummary = commits
    .map((c, i) => `### Commit: ${c.message}\n\`\`\`diff\n${diffs[i]}\n\`\`\``)
    .join("\n\n");

  const msg = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a technical writer. Given the following git commits and diffs, write a concise **release-notes style changelog entry** in Markdown.

Rules:
- Start with a heading: ## ${now}
- Group changes into categories like **Added**, **Changed**, **Fixed**, **Removed** (only include categories that apply)
- Use bullet points
- Be concise but informative — a developer or user should understand what changed
- Do NOT include raw diff content
- Do NOT wrap in code fences

Commits & Diffs:
${commitSummary}`,
      },
    ],
  });

  return msg.content[0].text;
}

async function updateProductDoc(currentDoc, newChangelogEntry) {
  const client = getClient();

  const msg = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a technical writer maintaining a living **Product Document / User Manual** for a software project. This document is stored as an Obsidian markdown note.

Here is the CURRENT product document:
---
${currentDoc || "*(empty — this is a brand new product document)*"}
---

Here is the LATEST changelog entry describing recent changes:
---
${newChangelogEntry}
---

Your job:
1. Update the product document to reflect the changes described in the changelog.
2. Add new sections for new features.
3. Update existing sections when features are modified.
4. Remove sections for features that were removed.
5. Keep the document well-organized with clear headings, descriptions, and usage instructions.
6. If the document was empty, create a sensible structure: title, overview, then feature sections.
7. Write in the style of a user-facing product manual — clear, helpful, not overly technical.
8. Output ONLY the full updated product document in Markdown. No commentary.`,
      },
    ],
  });

  return msg.content[0].text;
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

async function syncProject(project) {
  console.log(`[sync] Checking "${project.name}" …`);

  const commits = await getNewCommits(project);
  if (!commits || commits.length === 0) {
    console.log(`[sync] No new commits for "${project.name}".`);
    return { updated: false };
  }

  console.log(`[sync] Found ${commits.length} new commit(s). Generating changelog …`);

  // Get diffs (limit to 5 most recent to keep token usage reasonable)
  const recent = commits.slice(0, 5);
  const diffs = await Promise.all(
    recent.map((c) => getDiffForCommit(project.repoPath, c.hash))
  );

  // Generate changelog entry
  const changelogEntry = await generateChangelog(recent, diffs);

  // Append to changelog file
  const changelogFile = project.changelogPath;
  const existingChangelog = fs.existsSync(changelogFile)
    ? fs.readFileSync(changelogFile, "utf-8")
    : "";
  const divider = "\n\n---\n\n";
  const updatedChangelog = existingChangelog
    ? changelogEntry + divider + existingChangelog
    : changelogEntry;
  fs.writeFileSync(changelogFile, updatedChangelog, "utf-8");
  console.log(`[sync] Changelog updated: ${changelogFile}`);

  // Update product doc
  console.log(`[sync] Updating product document …`);
  const currentProductDoc = fs.existsSync(project.productDocPath)
    ? fs.readFileSync(project.productDocPath, "utf-8")
    : "";
  const updatedProductDoc = await updateProductDoc(currentProductDoc, changelogEntry);
  fs.writeFileSync(project.productDocPath, updatedProductDoc, "utf-8");
  console.log(`[sync] Product doc updated: ${project.productDocPath}`);

  // Update last known commit
  project.lastCommit = commits[0].hash;
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx !== -1) {
    projects[idx].lastCommit = project.lastCommit;
    saveProjects(projects);
  }

  return { updated: true, commits: commits.length };
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

let polling = false;

async function pollAll() {
  if (polling) return;
  polling = true;

  const projects = loadProjects().filter((p) => p.enabled);
  for (const project of projects) {
    try {
      await syncProject(project);
    } catch (err) {
      console.error(`[sync] Error syncing "${project.name}":`, err.message);
    }
  }

  polling = false;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- API routes ----

// List projects
app.get("/api/projects", (_req, res) => {
  res.json(loadProjects());
});

// Add project
app.post("/api/projects", (req, res) => {
  const { name, repoPath, branch, changelogPath, productDocPath } = req.body;
  if (!name || !repoPath || !changelogPath || !productDocPath) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const projects = loadProjects();
  const project = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    repoPath: path.resolve(repoPath),
    branch: branch || "main",
    changelogPath: path.resolve(changelogPath),
    productDocPath: path.resolve(productDocPath),
    lastCommit: null,
    enabled: true,
  };
  projects.push(project);
  saveProjects(projects);
  res.json(project);
});

// Update project
app.put("/api/projects/:id", (req, res) => {
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const allowed = ["name", "repoPath", "branch", "changelogPath", "productDocPath", "enabled"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      projects[idx][key] =
        key === "repoPath" || key === "changelogPath" || key === "productDocPath"
          ? path.resolve(req.body[key])
          : req.body[key];
    }
  }
  saveProjects(projects);
  res.json(projects[idx]);
});

// Delete project
app.delete("/api/projects/:id", (req, res) => {
  let projects = loadProjects();
  projects = projects.filter((p) => p.id !== req.params.id);
  saveProjects(projects);
  res.json({ ok: true });
});

// Manual sync trigger
app.post("/api/projects/:id/sync", async (req, res) => {
  const projects = loadProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });

  try {
    const result = await syncProject(project);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Status / health
app.get("/api/status", (_req, res) => {
  res.json({
    running: true,
    pollIntervalSeconds: POLL_SECONDS,
    projects: loadProjects().length,
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         Git → Obsidian Sync Running              ║
║                                                  ║
║   Dashboard:  http://localhost:${PORT}              ║
║   Polling:    every ${POLL_SECONDS}s                         ║
╚══════════════════════════════════════════════════╝
  `);

  // Initial poll, then schedule
  pollAll();
  setInterval(pollAll, POLL_SECONDS * 1000);
});
