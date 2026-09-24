// Style Guide engine.
//
// Turns review timeline comments into rule cards on the right style guide.
// Actions (admin-tier JWT for all):
//   { action: "update_from_review", review_id }
//     — the "Update Style Guide" button. Processes every comment on the
//       review (all versions) that hasn't been processed before. Idempotent:
//       pressing it again only picks up comments added since.
//   { action: "backfill" }
//     — runs update_from_review across every review that has comments.
//       Safe to re-run; already-processed comments are skipped.
//
// Routing: style_guide_client_for_review() decides the guide — a review born
// from a client assignment or shared to a client feeds that client's guide
// (staff comments included); everything else feeds the single Mayday guide.
//
// What one run does:
//   1. Load unprocessed comments + the guide's existing cards (all statuses).
//   2. Ask Claude, in batches, to classify each comment: reusable rule or
//      one-off note, category, normalized wording, and whether it matches an
//      existing card (or a new card proposed in the same batch).
//   3. New cards land as status='suggested' — the AI never writes an active
//      rule. Matches add an evidence ref and bump ref_count, including on
//      dismissed cards so a rejected suggestion never comes back as new.
//   4. Every comment gets a review_comment_insights row, matched or not.
//
// Deploy: supabase functions deploy style-guide --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
} from "../shared/workflow-engine.ts";

const CATEGORIES = [
  "pacing_cuts",
  "audio_music",
  "graphics_text",
  "sponsor_brand",
  "transitions_effects",
  "story_content",
  "color_look",
  "delivery_export",
] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_HINTS: Record<Category, string> = {
  pacing_cuts: "cut timing, trimming, tightening, shortening or extending sections, dead air",
  audio_music: "music choice, song swaps, sound effects, risers, audio levels, mixing, audio transitions",
  graphics_text: "on-screen text, labels, lower thirds, captions, product icons, logos placement",
  sponsor_brand: "sponsor reads, brand mentions, product callouts, URLs, disclosures, bleeps/censoring",
  transitions_effects: "transitions between clips, zooms, speed ramps, visual effects, motion",
  story_content: "what stays in or comes out, narrative order, emphasis, tone, jokes, structure",
  color_look: "color grade, exposure, framing, look and feel of the image",
  delivery_export: "export settings, file naming, aspect ratio, versions, delivery logistics",
};

const BATCH_SIZE = 60;
const MODEL = Deno.env.get("STYLE_GUIDE_MODEL") || Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";

// ─── Types ─────────────────────────────────────────────────────

interface CommentRow {
  id: string;
  review_id: string;
  version_id: string | null;
  user_id: string | null;
  timestamp_seconds: number | null;
  content: string;
  is_resolved: boolean;
  created_at: string;
}

interface RuleRow {
  id: string;
  category: Category;
  text: string;
  status: "suggested" | "active" | "dismissed";
}

interface ClaudeNewRule {
  key: string;
  category: string;
  text: string;
}

interface ClaudeComment {
  i: number;
  reusable: boolean;
  category: string | null;
  rule: string | null;
  match: string | null; // existing rule id, a new-rule key, or null
}

interface ClaudeOut {
  new_rules: ClaudeNewRule[];
  comments: ClaudeComment[];
}

interface RunSummary {
  guide_id: string;
  guide_title: string;
  review_id: string;
  review_title: string;
  comments_processed: number;
  new_rules: number;
  refs_added: number;
  reusable: number;
}

// ─── Guide resolution ──────────────────────────────────────────

async function ensureGuide(
  admin: SupabaseClient,
  reviewId: string,
): Promise<{ id: string; title: string; scope: string; client_id: string | null }> {
  const { data: clientId, error: routeErr } = await admin.rpc("style_guide_client_for_review", {
    p_review: reviewId,
  });
  if (routeErr) throw new Error(`route failed: ${routeErr.message}`);

  if (clientId) {
    const { data: existing } = await admin
      .from("style_guides")
      .select("id, title, scope, client_id")
      .eq("scope", "client")
      .eq("client_id", clientId)
      .maybeSingle();
    if (existing) return existing;
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, nickname")
      .eq("id", clientId)
      .maybeSingle();
    const name = (prof?.full_name || prof?.nickname || "Client").trim();
    const { data: created, error } = await admin
      .from("style_guides")
      .insert({ scope: "client", client_id: clientId, title: `${name} Style Guide` })
      .select("id, title, scope, client_id")
      .single();
    if (error) {
      // Lost a race with a parallel run — re-select.
      const { data: again } = await admin
        .from("style_guides")
        .select("id, title, scope, client_id")
        .eq("scope", "client")
        .eq("client_id", clientId)
        .single();
      if (again) return again;
      throw new Error(`guide create failed: ${error.message}`);
    }
    return created;
  }

  const { data: mayday } = await admin
    .from("style_guides")
    .select("id, title, scope, client_id")
    .eq("scope", "mayday")
    .maybeSingle();
  if (mayday) return mayday;
  const { data: created, error } = await admin
    .from("style_guides")
    .insert({ scope: "mayday", client_id: null, title: "Mayday Style Guide" })
    .select("id, title, scope, client_id")
    .single();
  if (error) {
    const { data: again } = await admin
      .from("style_guides")
      .select("id, title, scope, client_id")
      .eq("scope", "mayday")
      .single();
    if (again) return again;
    throw new Error(`guide create failed: ${error.message}`);
  }
  return created;
}

// ─── Claude ────────────────────────────────────────────────────

function buildPrompt(
  guideTitle: string,
  reviewTitle: string,
  rules: RuleRow[],
  comments: { i: number; text: string; t: string; author: string; resolved: boolean }[],
): string {
  const catList = CATEGORIES.map((c) => `- ${c}: ${CATEGORY_HINTS[c]}`).join("\n");
  const ruleList = rules.length
    ? rules.map((r) => `- id=${r.id} [${r.category}] (${r.status}) ${r.text}`).join("\n")
    : "(none yet)";
  const commentList = comments
    .map((c) => `#${c.i} @${c.t} by ${c.author}${c.resolved ? " (resolved)" : ""}: ${JSON.stringify(c.text)}`)
    .join("\n");

  return `You maintain "${guideTitle}", a video editing style guide built from the notes reviewers leave on video timelines. Below are timeline comments from the review "${reviewTitle}". Your job is to decide, for each comment, whether it expresses a REUSABLE editing preference that should apply to future videos, or a ONE-OFF note about this specific video.

REUSABLE examples: "tighten up the cut here" (→ keep cuts tight, trim dead air), "swap the song for something more upbeat" (→ prefer upbeat music), "product icon on screen here" (→ show product icon when the product is named), "beep the URL" (→ bleep spoken URLs), "weird audio transition, smooth it out" (→ smooth audio transitions between clips).
ONE-OFF examples: "cut out the part about Atlas" (a specific person), "start this clip when he falls" (a specific moment), "riser" with no context, scheduling notes, praise with no instruction.

Categories (use exactly one of these keys):
${catList}

Existing cards on this guide (match against these before proposing a new one; dismissed cards still count as matches so the same idea is not re-proposed):
${ruleList}

Comments to classify:
${commentList}

Rules for your output:
- "rule" is a short imperative sentence a new editor could follow, max 120 characters, no timestamps, no names, no references to "this video".
- Merge aggressively: if several comments express the same preference, propose ONE new rule and match them all to it via its key.
- Prefer matching an existing card over proposing a new one when the meaning is the same, even if the wording differs.
- Non-reusable comments get reusable=false, category=null, rule=null, match=null.
- new_rules keys are short strings like "n1", "n2".

Return ONLY valid JSON, no code fences, in this exact shape:
{"new_rules":[{"key":"n1","category":"pacing_cuts","text":"..."}],"comments":[{"i":0,"reusable":true,"category":"pacing_cuts","rule":"...","match":"n1"},{"i":1,"reusable":false,"category":null,"rule":null,"match":null}]}`;
}

async function callClaude(prompt: string): Promise<ClaudeOut> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw: string = data.content?.[0]?.text || "";
  const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: ClaudeOut;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude returned non-JSON: ${raw.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed.comments)) throw new Error("Claude output missing comments[]");
  if (!Array.isArray(parsed.new_rules)) parsed.new_rules = [];
  return parsed;
}

function normCategory(c: string | null | undefined): Category | null {
  if (!c) return null;
  return (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : null;
}

// ─── Core: process one review ──────────────────────────────────

async function processReview(
  admin: SupabaseClient,
  reviewId: string,
  runBy: string | null,
): Promise<RunSummary | null> {
  const { data: review, error: revErr } = await admin
    .from("reviews")
    .select("id, title, kind")
    .eq("id", reviewId)
    .maybeSingle();
  if (revErr) throw new Error(revErr.message);
  if (!review) throw new Error("Review not found");
  // Resources walkthrough guides reuse the review tables but their notes are
  // about the guide, not about how a cut should be made.
  if (review.kind === "guide") return null;

  const { data: allComments, error: cErr } = await admin
    .from("review_comments")
    .select("id, review_id, version_id, user_id, timestamp_seconds, content, is_resolved, created_at")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });
  if (cErr) throw new Error(cErr.message);
  const comments = (allComments || []) as CommentRow[];
  if (comments.length === 0) return null;

  const { data: done } = await admin
    .from("review_comment_insights")
    .select("comment_id")
    .in("comment_id", comments.map((c) => c.id));
  const doneSet = new Set((done || []).map((d: { comment_id: string }) => d.comment_id));
  const pending = comments.filter((c) => !doneSet.has(c.id) && c.content && c.content.trim());
  if (pending.length === 0) return null;

  const guide = await ensureGuide(admin, reviewId);

  // Author labels + version labels for prompt context / ref snapshots.
  const authorIds = [...new Set(pending.map((c) => c.user_id).filter(Boolean))] as string[];
  const { data: authors } = authorIds.length
    ? await admin.from("profiles").select("id, full_name, role").in("id", authorIds)
    : { data: [] };
  const authorById = new Map<string, { name: string; role: string }>(
    (authors || []).map((a: { id: string; full_name: string | null; role: string | null }) => [
      a.id,
      { name: a.full_name || "Reviewer", role: a.role || "staff" },
    ]),
  );
  const { data: versions } = await admin
    .from("review_versions")
    .select("id, label, version_number")
    .eq("review_id", reviewId);
  const versionLabel = new Map<string, string>(
    (versions || []).map((v: { id: string; label: string | null; version_number: number }) => [
      v.id,
      v.label || `Cut ${v.version_number}`,
    ]),
  );

  let { data: ruleRows } = await admin
    .from("style_guide_rules")
    .select("id, category, text, status")
    .eq("guide_id", guide.id);
  let rules = (ruleRows || []) as RuleRow[];

  let newRulesTotal = 0;
  let refsTotal = 0;
  let reusableTotal = 0;

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    const promptComments = batch.map((c, i) => {
      const a = c.user_id ? authorById.get(c.user_id) : null;
      const secs = Math.max(0, Math.floor(Number(c.timestamp_seconds || 0)));
      const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      return {
        i,
        text: c.content.trim(),
        t,
        author: a ? `${a.name} (${a.role})` : "Reviewer",
        resolved: !!c.is_resolved,
      };
    });

    const out = await callClaude(buildPrompt(guide.title, review.title, rules, promptComments));

    // 1. Create the batch's new cards (suggested).
    const keyToRuleId = new Map<string, string>();
    for (const nr of out.new_rules) {
      const cat = normCategory(nr.category);
      const text = (nr.text || "").trim().slice(0, 200);
      if (!cat || !text || !nr.key) continue;
      const { data: ins, error } = await admin
        .from("style_guide_rules")
        .insert({
          guide_id: guide.id,
          category: cat,
          text,
          status: "suggested",
          source: "ai",
          first_review_id: reviewId,
        })
        .select("id, category, text, status")
        .single();
      if (error) {
        console.error("rule insert failed:", error.message);
        continue;
      }
      keyToRuleId.set(nr.key, ins.id);
      rules.push(ins as RuleRow);
      newRulesTotal++;
    }

    // 2. Insights + refs per comment.
    const ruleIds = new Set(rules.map((r) => r.id));
    const refCountBump = new Map<string, number>();
    for (const cc of out.comments) {
      const c = batch[cc.i];
      if (!c) continue;
      const reusable = !!cc.reusable;
      let ruleId: string | null = null;
      if (reusable && cc.match) {
        if (keyToRuleId.has(cc.match)) ruleId = keyToRuleId.get(cc.match)!;
        else if (ruleIds.has(cc.match)) ruleId = cc.match;
      }
      if (reusable) reusableTotal++;

      const { error: insErr } = await admin.from("review_comment_insights").upsert(
        {
          comment_id: c.id,
          review_id: reviewId,
          guide_id: guide.id,
          reusable,
          category: normCategory(cc.category),
          normalized_text: cc.rule ? String(cc.rule).slice(0, 200) : null,
          rule_id: ruleId,
        },
        { onConflict: "comment_id" },
      );
      if (insErr) console.error("insight upsert failed:", insErr.message);

      if (ruleId) {
        const { data: refIns, error: refErr } = await admin
          .from("style_guide_rule_refs")
          .upsert(
            {
              rule_id: ruleId,
              comment_id: c.id,
              review_id: reviewId,
              version_id: c.version_id,
              review_title: review.title,
              version_label: c.version_id ? versionLabel.get(c.version_id) || null : null,
              timestamp_seconds: c.timestamp_seconds,
              excerpt: c.content.trim().slice(0, 500),
              author_id: c.user_id,
            },
            { onConflict: "rule_id,comment_id", ignoreDuplicates: true },
          )
          .select("id");
        if (refErr) console.error("ref upsert failed:", refErr.message);
        else if (refIns && refIns.length > 0) {
          refCountBump.set(ruleId, (refCountBump.get(ruleId) || 0) + 1);
          refsTotal++;
        }
      }
    }

    // Comments Claude skipped in its output still get a ledger row so they
    // aren't re-sent forever.
    const answered = new Set(out.comments.map((cc) => cc.i));
    for (let i = 0; i < batch.length; i++) {
      if (answered.has(i)) continue;
      await admin.from("review_comment_insights").upsert(
        { comment_id: batch[i].id, review_id: reviewId, guide_id: guide.id, reusable: false },
        { onConflict: "comment_id" },
      );
    }

    // 3. Bump ref counts (service role; the guard trigger leaves it alone).
    for (const [ruleId, n] of refCountBump) {
      const { data: cur } = await admin
        .from("style_guide_rules")
        .select("ref_count")
        .eq("id", ruleId)
        .single();
      await admin
        .from("style_guide_rules")
        .update({ ref_count: (cur?.ref_count || 0) + n })
        .eq("id", ruleId);
    }
  }

  await admin.from("style_guide_runs").insert({
    guide_id: guide.id,
    review_id: reviewId,
    run_by: runBy,
    comments_processed: pending.length,
    new_rules: newRulesTotal,
    refs_added: refsTotal,
  });
  await admin.from("style_guides").update({ last_run_at: new Date().toISOString() }).eq("id", guide.id);

  return {
    guide_id: guide.id,
    guide_title: guide.title,
    review_id: reviewId,
    review_title: review.title,
    comments_processed: pending.length,
    new_rules: newRulesTotal,
    refs_added: refsTotal,
    reusable: reusableTotal,
  };
}

// ─── HTTP ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // Admin-tier JWT, or the cron secret (ops-only: lets the backfill be run
  // from SQL via pg_net without a browser session).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && providedSecret === cronSecret;
  const auth = isCron ? null : await getUserFromJwt(req);
  if (!isCron && (!auth || !auth.isAdmin)) return jsonResp({ error: "Admin access required" }, 403);
  const runBy = auth?.userId ?? null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action || "");
  const admin = getAdminClient();

  try {
    if (action === "update_from_review") {
      const reviewId = String(body.review_id || "");
      if (!reviewId) return jsonResp({ error: "review_id required" }, 400);
      const summary = await processReview(admin, reviewId, runBy);
      if (!summary) {
        // Nothing new — still tell the caller which guide this review feeds.
        const guide = await ensureGuide(admin, reviewId);
        return jsonResp({
          ok: true,
          up_to_date: true,
          guide_id: guide.id,
          guide_title: guide.title,
          comments_processed: 0,
          new_rules: 0,
          refs_added: 0,
        });
      }
      return jsonResp({ ok: true, up_to_date: false, ...summary });
    }

    if (action === "backfill") {
      const { data: reviewIds, error } = await admin
        .from("review_comments")
        .select("review_id")
        .order("created_at", { ascending: true });
      if (error) return jsonResp({ error: error.message }, 500);
      const ids = [...new Set((reviewIds || []).map((r: { review_id: string }) => r.review_id))];
      const results: RunSummary[] = [];
      const errors: { review_id: string; error: string }[] = [];
      for (const id of ids) {
        try {
          const s = await processReview(admin, id, runBy);
          if (s) results.push(s);
        } catch (e) {
          errors.push({ review_id: id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return jsonResp({
        ok: true,
        reviews_scanned: ids.length,
        reviews_processed: results.length,
        comments_processed: results.reduce((n, r) => n + r.comments_processed, 0),
        new_rules: results.reduce((n, r) => n + r.new_rules, 0),
        refs_added: results.reduce((n, r) => n + r.refs_added, 0),
        results,
        errors,
      });
    }

    return jsonResp({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("style-guide error:", e);
    return jsonResp({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
