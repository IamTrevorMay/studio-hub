// Shared source handlers for report generation (used by run-report and preview-report)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface SourceResult {
  variables: Record<string, string>;
  sourceCount: number;
}

export interface DataSource {
  type: string;
  config: Record<string, any>;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function resolvePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ─── RSS Source ──────────────────────────────────────────────

export async function fetchRssSource(
  adminClient: ReturnType<typeof createClient>,
  config: { feed_ids?: string[]; time_window_hours?: number },
): Promise<SourceResult> {
  const hours = config.time_window_hours || 48;
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);

  let query = adminClient
    .from("research_articles")
    .select("id, title, description, content, author, pub_date, feed:research_feeds(id, name, source_type)")
    .gte("pub_date", cutoff.toISOString())
    .order("pub_date", { ascending: false })
    .limit(500);

  if (config.feed_ids && config.feed_ids.length > 0) {
    query = query.in("feed_id", config.feed_ids);
  }

  const { data: articles } = await query;
  if (!articles || articles.length === 0) {
    return { variables: { articles: "(No recent articles found)", feed_names: "", source_count: "0" }, sourceCount: 0 };
  }

  const lines: string[] = [];
  const feedNames = new Set<string>();
  for (const a of articles) {
    const feedName = (a as any).feed?.name || "Unknown";
    feedNames.add(feedName);
    const desc = stripHtml(a.description || a.content || "").slice(0, 400);
    lines.push(`- **${a.title || "Untitled"}** [${feedName}] ${desc}`);
  }

  return {
    variables: {
      articles: lines.join("\n"),
      feed_names: [...feedNames].join(", "),
      source_count: String(articles.length),
    },
    sourceCount: articles.length,
  };
}

// ─── Triton API Source ───────────────────────────────────────

export async function fetchTritonSource(
  config: { endpoint?: string; method?: string; params?: string; headers?: string },
): Promise<SourceResult> {
  if (!config.endpoint) {
    return { variables: { triton_data: "(No endpoint configured)" }, sourceCount: 0 };
  }

  const method = config.method || "GET";
  const fetchOpts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (config.headers) {
    try {
      const customHeaders = JSON.parse(config.headers);
      Object.assign(fetchOpts.headers!, customHeaders);
    } catch {}
  }

  if (method === "POST" && config.params) {
    fetchOpts.body = config.params;
  }

  let url = config.endpoint;
  if (method === "GET" && config.params) {
    try {
      const params = JSON.parse(config.params);
      const qs = new URLSearchParams(params).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    } catch {}
  }

  const resp = await fetch(url, fetchOpts);
  const body = await resp.text();

  return {
    variables: { triton_data: body },
    sourceCount: 1,
  };
}

// ─── Supabase Query Source ───────────────────────────────────

export async function fetchSupabaseSource(
  adminClient: ReturnType<typeof createClient>,
  config: { table?: string; select?: string; filters?: string; limit?: number; order_by?: string },
): Promise<SourceResult> {
  if (!config.table) {
    return { variables: { query_results: "(No table configured)" }, sourceCount: 0 };
  }

  let query = adminClient.from(config.table).select(config.select || "*");

  if (config.filters) {
    try {
      const filters = JSON.parse(config.filters);
      for (const f of Array.isArray(filters) ? filters : []) {
        const { column, op, value } = f;
        if (column && op) {
          (query as any) = query.filter(column, op, value);
        }
      }
    } catch {}
  }

  if (config.order_by) {
    const parts = config.order_by.trim().split(/\s+/);
    const col = parts[0];
    const asc = (parts[1] || "asc").toLowerCase() !== "desc";
    query = query.order(col, { ascending: asc });
  }

  query = query.limit(config.limit || 100);

  const { data, error } = await query;
  if (error) {
    return { variables: { query_results: `(Query error: ${error.message})` }, sourceCount: 0 };
  }

  return {
    variables: {
      query_results: JSON.stringify(data, null, 2),
      source_count: String((data || []).length),
    },
    sourceCount: (data || []).length,
  };
}

// ─── Triton Brief Source ─────────────────────────────────────
// Fetches the latest brief from the Triton Supabase `briefs` table.
// Requires env vars: TRITON_SUPABASE_URL, TRITON_SUPABASE_SERVICE_ROLE_KEY.

export async function fetchTritonBriefSource(
  _adminClient: ReturnType<typeof createClient>,
  config: { date?: string },
): Promise<SourceResult> {
  const tritonUrl = Deno.env.get("TRITON_SUPABASE_URL");
  const tritonKey = Deno.env.get("TRITON_SUPABASE_SERVICE_ROLE_KEY");
  if (!tritonUrl || !tritonKey) {
    return {
      variables: {
        brief_title: "(Triton not configured)",
        brief_summary: "",
        brief_content: "",
        brief_badges: "",
        brief_date: "",
      },
      sourceCount: 0,
    };
  }

  const tritonClient = createClient(tritonUrl, tritonKey);
  let query = tritonClient
    .from("briefs")
    .select("id, date, title, summary, content, metadata")
    .order("date", { ascending: false })
    .limit(1);

  if (config.date) {
    query = tritonClient
      .from("briefs")
      .select("id, date, title, summary, content, metadata")
      .eq("date", config.date)
      .limit(1);
  }

  const { data } = await query;
  const brief = data?.[0];
  if (!brief) {
    return {
      variables: {
        brief_title: "(No brief available)",
        brief_summary: "",
        brief_content: "",
        brief_badges: "",
        brief_date: "",
      },
      sourceCount: 0,
    };
  }

  const badges: string[] = [];
  const meta = (brief as any).metadata || {};
  if (meta.finished_count !== undefined) {
    badges.push(
      `<span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:4px;">${meta.finished_count || 0} games</span>`,
    );
  }
  if (meta.is_off_day) {
    badges.push(
      `<span style="font-size:11px;font-weight:600;color:#f59e0b;background:rgba(245,158,11,0.1);padding:3px 8px;border-radius:4px;">Off Day</span>`,
    );
  }
  const badgesHtml = badges.length
    ? `<div style="display:flex;gap:8px;margin-top:10px;">${badges.join("")}</div>`
    : "";

  return {
    variables: {
      brief_title: brief.title || "Daily Brief",
      brief_summary: brief.summary || "",
      brief_content: brief.content || "",
      brief_badges: badgesHtml,
      brief_date: brief.date || "",
    },
    sourceCount: 1,
  };
}

// ─── Section dispatcher ──────────────────────────────────────

export async function fetchSectionSource(
  adminClient: ReturnType<typeof createClient>,
  source: DataSource,
): Promise<SourceResult> {
  switch (source.type) {
    case "rss":
      return fetchRssSource(adminClient, source.config || {});
    case "triton_api":
      return fetchTritonSource(source.config || {});
    case "triton_brief":
      return fetchTritonBriefSource(adminClient, source.config || {});
    case "supabase_query":
      return fetchSupabaseSource(adminClient, source.config || {});
    default:
      return { variables: {}, sourceCount: 0 };
  }
}

// ─── Multi-Source Fetcher ────────────────────────────────────

export async function fetchAllSources(
  adminClient: ReturnType<typeof createClient>,
  dataSources: DataSource[],
): Promise<SourceResult> {
  const mergedVars: Record<string, string> = {};
  let totalSourceCount = 0;

  for (const source of dataSources) {
    const result = await fetchSectionSource(adminClient, source);
    Object.assign(mergedVars, result.variables);
    totalSourceCount += result.sourceCount;
  }

  // Ensure source_count reflects total across all sources
  mergedVars.source_count = String(totalSourceCount);

  return { variables: mergedVars, sourceCount: totalSourceCount };
}
