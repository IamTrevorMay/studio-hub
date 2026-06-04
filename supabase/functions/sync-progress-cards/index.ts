// supabase/functions/sync-progress-cards/index.ts
// Cron-driven poller. Reads Google Drive editing + ready folders,
// reconciles progress_cards table to reflect current pipeline state.
//
// Cards are CREATED when a file first appears in the Editing folder.
// Cards MOVE forward (editing → ready → scheduled) as the same-named
// file appears in the Ready folder or gets an "(S)" prefix.
//
// Matching: exact cleanName match first, then AI fuzzy match via Claude
// Haiku for files the editor renamed between folders.
//
// Auth: CRON_SECRET via ?secret= query param (same pattern as drive-watch-poll).
// Runs every 2 minutes via pg_cron.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EDITING_FOLDER_ID = "1VXcEe8l7jriA017AM9pBBXzG_NTA2B34";
const READY_FOLDER_ID = "1vaG8mZiQX1bb6S8tCs7-9BQzr7i3eeWU";

// ── Helpers ──────────────────────────────────────────────────

async function getDriveAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await res.json();
  if (!res.ok)
    throw new Error(tokens.error_description || "Token refresh failed");
  return tokens.access_token;
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  trashed?: boolean;
  createdTime?: string;
};

async function listDriveFolder(
  token: string,
  folderId: string,
): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken, files(id, name, mimeType, trashed, createdTime)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Drive list failed (${folderId}): ${err}`);
    }
    const json = await res.json();
    all.push(...(json.files || []).filter((f: DriveFile) => !f.trashed));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return all;
}

/** Strip extension + leading "(S)" or "(E)" prefix, trim. */
function cleanName(filename: string): string {
  let name = filename.replace(/\.[^/.]+$/, "");
  name = name.replace(/^\([SE]\)\s*/i, "");
  return name.trim();
}

function hasScheduledPrefix(filename: string): boolean {
  return /^\(S\)\s*/i.test(filename.replace(/\.[^/.]+$/, ""));
}

// ── AI fuzzy matching ────────────────────────────────────────

type FuzzyMatch = { editing: string; ready: string };

async function aiFuzzyMatch(
  editingTitles: string[],
  readyTitles: string[],
): Promise<FuzzyMatch[]> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return [];
  }
  if (editingTitles.length === 0 || readyTitles.length === 0) {
    return [];
  }

  const prompt = `You are matching video filenames between two Google Drive folders. The Editing folder has raw footage titles, and the Ready folder has finished edit titles. The editor sometimes shortens or rephrases the filename.

EDITING folder titles (one per line):
${editingTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

READY folder titles (one per line):
${readyTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Match each READY title to the EDITING title that refers to the same video. Only include confident matches — if a ready title has no clear editing counterpart, skip it.

Respond with ONLY a JSON array of objects, each with "editing" (exact editing title from the list) and "ready" (exact ready title from the list). Example: [{"editing":"Full Title Here","ready":"Short Title"}]
If no matches, respond with []`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("AI match API error:", res.status, await res.text());
      return [];
    }

    const json = await res.json();
    const text = json.content?.[0]?.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const matches: FuzzyMatch[] = JSON.parse(jsonMatch[0]);

    // Validate: each title must actually exist in the provided lists
    const editingSet = new Set(editingTitles.map((t) => t.toLowerCase()));
    const readySet = new Set(readyTitles.map((t) => t.toLowerCase()));

    return matches.filter(
      (m) =>
        editingSet.has(m.editing.toLowerCase()) &&
        readySet.has(m.ready.toLowerCase()),
    );
  } catch (err) {
    console.error("AI fuzzy match failed:", err);
    return [];
  }
}

// ── Main ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const auth = req.headers.get("Authorization");
  const querySecret = url.searchParams.get("secret");
  let ok =
    cronSecret &&
    (auth === `Bearer ${cronSecret}` || querySecret === cronSecret);

  // Also allow admin users via JWT
  if (!ok && auth?.startsWith("Bearer ")) {
    const userToken = auth.replace("Bearer ", "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user } } = await userClient.auth.getUser(userToken);
    if (user) {
      const { data: profile } = await userClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (profile?.role === "admin") ok = true;
    }
  }

  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Audit mode: ?audit=editing returns file dates without syncing
  const auditMode = url.searchParams.get("audit");

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = await getDriveAccessToken();

    if (auditMode) {
      const folderId = auditMode === "ready" ? READY_FOLDER_ID : EDITING_FOLDER_ID;
      const files = await listDriveFolder(token, folderId);
      const result = files
        .map((f) => ({ name: cleanName(f.name), raw: f.name, created: f.createdTime }))
        .sort((a, b) => (a.created || "").localeCompare(b.created || ""));
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [editingFiles, readyFiles] = await Promise.all([
      listDriveFolder(token, EDITING_FOLDER_ID),
      listDriveFolder(token, READY_FOLDER_ID),
    ]);

    const { data: cards, error: cardsErr } = await admin
      .from("progress_cards")
      .select("*")
      .is("archived_at", null);
    if (cardsErr) throw cardsErr;

    const existingCards = cards || [];
    const now = new Date().toISOString();

    // Lookup: lowercase title → card
    const cardsByTitle = new Map<string, (typeof existingCards)[0]>();
    for (const c of existingCards) {
      cardsByTitle.set(c.title.toLowerCase(), c);
    }

    const updates: { id: string; data: Record<string, unknown> }[] = [];
    const matchedEditingKeys = new Set<string>();

    // ── Phase 1: Exact-match ready files to existing cards ───

    const unmatchedReadyFiles: DriveFile[] = [];

    for (const file of readyFiles) {
      const clean = cleanName(file.name);
      const key = clean.toLowerCase();
      const card = cardsByTitle.get(key);
      const scheduled = hasScheduledPrefix(file.name);

      if (card) {
        if (card.status === "editing") {
          updates.push({
            id: card.id,
            data: {
              status: scheduled ? "scheduled" : "ready",
              ready_drive_file_id: file.id,
              ...(scheduled ? { moved_to_scheduled_at: now } : {}),
              updated_at: now,
            },
          });
          matchedEditingKeys.add(key);
        } else if (card.status === "ready" && scheduled) {
          updates.push({
            id: card.id,
            data: {
              status: "scheduled",
              moved_to_scheduled_at: now,
              updated_at: now,
            },
          });
        }
        // already matched — skip
      } else {
        unmatchedReadyFiles.push(file);
      }
    }

    // ── Phase 2: Collect new editing-folder inserts ──────────
    // Build them in a map so Phase 3 can mutate entries before insert.

    type PendingInsert = {
      title: string;
      status: string;
      content_type: string;
      drive_file_id: string | null;
      ready_drive_file_id: string | null;
      moved_to_scheduled_at: string | null;
      drive_uploaded_at: string | null;
      created_at: string;
      updated_at: string;
    };

    // key = lowercase clean title
    const pendingInserts = new Map<string, PendingInsert>();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const file of editingFiles) {
      // Skip files uploaded more than 7 days ago (stale backlog)
      if (file.createdTime && file.createdTime < sevenDaysAgo) continue;

      const clean = cleanName(file.name);
      const key = clean.toLowerCase();
      if (!cardsByTitle.has(key) && !pendingInserts.has(key)) {
        pendingInserts.set(key, {
          title: clean,
          status: "editing",
          content_type: "short",
          drive_file_id: file.id,
          ready_drive_file_id: null,
          moved_to_scheduled_at: null,
          drive_uploaded_at: file.createdTime || null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    // ── Phase 3: AI fuzzy-match unmatched ready → editing ────
    // Check against BOTH existing DB cards and pending inserts.

    let aiMatched = 0;

    if (unmatchedReadyFiles.length > 0) {
      // Candidates: existing editing cards not yet advanced + pending editing inserts
      const dbCandidates = existingCards
        .filter(
          (c) =>
            c.status === "editing" &&
            !matchedEditingKeys.has(c.title.toLowerCase()),
        )
        .map((c) => c.title);

      const pendingCandidates = [...pendingInserts.values()]
        .filter((p) => p.status === "editing")
        .map((p) => p.title);

      const allCandidates = [...dbCandidates, ...pendingCandidates];

      if (allCandidates.length > 0) {
        const readyTitles = unmatchedReadyFiles.map((f) => cleanName(f.name));
        const fuzzyMatches = await aiFuzzyMatch(allCandidates, readyTitles);

        const matchedReadyTitles = new Set<string>();

        for (const match of fuzzyMatches) {
          if (matchedReadyTitles.has(match.ready.toLowerCase())) continue;

          const readyFile = unmatchedReadyFiles.find(
            (f) =>
              cleanName(f.name).toLowerCase() === match.ready.toLowerCase(),
          );
          if (!readyFile) continue;

          const scheduled = hasScheduledPrefix(readyFile.name);
          const readyClean = cleanName(readyFile.name);

          // Is this match against an existing DB card or a pending insert?
          const dbCard = existingCards.find(
            (c) =>
              c.title.toLowerCase() === match.editing.toLowerCase() &&
              c.status === "editing",
          );

          if (dbCard) {
            // Update existing card: rename + advance
            updates.push({
              id: dbCard.id,
              data: {
                title: readyClean,
                status: scheduled ? "scheduled" : "ready",
                ready_drive_file_id: readyFile.id,
                ...(scheduled ? { moved_to_scheduled_at: now } : {}),
                updated_at: now,
              },
            });
            matchedEditingKeys.add(dbCard.title.toLowerCase());
          } else {
            // Mutate the pending insert: change title + advance status
            const pendingKey = match.editing.toLowerCase();
            const pending = pendingInserts.get(pendingKey);
            if (pending) {
              // Remove old key, update entry, re-insert under new key
              pendingInserts.delete(pendingKey);
              pending.title = readyClean;
              pending.status = scheduled ? "scheduled" : "ready";
              pending.ready_drive_file_id = readyFile.id;
              pending.moved_to_scheduled_at = scheduled ? now : null;
              pendingInserts.set(readyClean.toLowerCase(), pending);
            }
          }

          matchedReadyTitles.add(match.ready.toLowerCase());
          aiMatched++;
        }

        // Remove matched files from unmatched list
        for (const title of matchedReadyTitles) {
          const idx = unmatchedReadyFiles.findIndex(
            (f) => cleanName(f.name).toLowerCase() === title,
          );
          if (idx !== -1) unmatchedReadyFiles.splice(idx, 1);
        }
      }
    }

    // ── Phase 4: Create cards for still-unmatched ready files ─

    for (const file of unmatchedReadyFiles) {
      // Skip files uploaded more than 7 days ago (stale backlog)
      if (file.createdTime && file.createdTime < sevenDaysAgo) continue;

      const clean = cleanName(file.name);
      const key = clean.toLowerCase();
      if (cardsByTitle.has(key) || pendingInserts.has(key)) continue;

      const scheduled = hasScheduledPrefix(file.name);
      pendingInserts.set(key, {
        title: clean,
        status: scheduled ? "scheduled" : "ready",
        content_type: "short",
        drive_file_id: null,
        ready_drive_file_id: file.id,
        moved_to_scheduled_at: scheduled ? now : null,
        drive_uploaded_at: file.createdTime || null,
        created_at: now,
        updated_at: now,
      });
    }

    // ── Phase 5: Auto-archive scheduled cards > 3 days ───────

    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    for (const card of existingCards) {
      if (
        card.status === "scheduled" &&
        card.moved_to_scheduled_at &&
        card.moved_to_scheduled_at < threeDaysAgo
      ) {
        updates.push({
          id: card.id,
          data: { archived_at: now, updated_at: now },
        });
      }
    }

    // ── Execute DB writes ────────────────────────────────────

    let insertedCount = 0;
    let updatedCount = 0;

    const inserts = [...pendingInserts.values()];
    if (inserts.length > 0) {
      const { error: insErr } = await admin
        .from("progress_cards")
        .insert(inserts);
      if (insErr) throw insErr;
      insertedCount = inserts.length;
    }

    for (const { id, data } of updates) {
      const { error: upErr } = await admin
        .from("progress_cards")
        .update(data)
        .eq("id", id);
      if (upErr) throw upErr;
      updatedCount++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        editing_files: editingFiles.length,
        ready_files: readyFiles.length,
        existing_cards: existingCards.length,
        inserted: insertedCount,
        updated: updatedCount,
        ai_matched: aiMatched,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("sync-progress-cards error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
