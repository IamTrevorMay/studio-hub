import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shade drive proxy for the Asset Search tool (Assets view).
// Ops (POST { op, ... }):
//   browse  { path? }                          → folders + files directly at
//            path (GET /search/folders + POST /search/files, non-recursive),
//            for the default folder-browsing view
//   search  { query, types?, limit?, offset?, path? } → trimmed asset list
//            from Shade's AI index search. With a path, scopes to that
//            folder recursively (POST /search/files); at root uses the
//            drive-wide POST /search
//   resolve { asset_id, proxy_id? }            → playable/downloadable signed
//            URL (video/audio proxy redirect, else largest preview image)
//   fetch   { asset_id, proxy_id? }            → streams the file bytes
//            through this function (Shade signed URLs live on storage hosts
//            whose CORS we don't control, so downloads/zips route here)
//   drives  {}                                 → candidate drive ids probed
//            against /search, for fixing a bad SHADE_DRIVE_ID
//
// Env: SHADE_API_KEY (Settings > API Keys in Shade — sent raw, no "Bearer"),
//      SHADE_DRIVE_ID (the drive to search; a workspace id also works — see
//      discovery below).
//
// SHADE_DRIVE_ID tolerance: users paste workspace ids or labels here. If the
// configured id 404s ("Drive not found"), we enumerate every uuid the API
// key can see (workspaces, drives, drives nested in workspaces), probe each
// with a 1-result search, and transparently use the first that works. The
// working id is cached per isolate.

const SHADE_API = "https://api.shade.inc";
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

let cachedDriveId: string | null = null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function shadeGet(apiKey: string, path: string): Promise<any | null> {
  try {
    const resp = await fetch(`${SHADE_API}${path}`, { headers: { Authorization: apiKey } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// Walk an arbitrary response and collect anything with a uuid id; keep the
// closest name/title so the drives op can label candidates.
function collectCandidates(node: any, out: Map<string, string>, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collectCandidates(n, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    if (typeof node.id === "string" && UUID_RE.test(node.id) && !out.has(node.id)) {
      out.set(node.id, node.name || node.title || "");
    }
    for (const v of Object.values(node)) collectCandidates(v, out, depth + 1);
  }
}

async function rawSearch(apiKey: string, driveId: string, payload: Record<string, unknown>) {
  return await fetch(`${SHADE_API}/search`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, drive_id: driveId }),
  });
}

// Enumerate candidate ids (top-level listings + drives nested under each
// workspace-looking id) and probe each with a 1-result search.
async function discoverCandidates(apiKey: string): Promise<Map<string, string>> {
  const candidates = new Map<string, string>();
  for (const path of ["/workspaces/drives", "/workspaces", "/drives"]) {
    collectCandidates(await shadeGet(apiKey, path), candidates);
  }
  for (const id of [...candidates.keys()]) {
    collectCandidates(await shadeGet(apiKey, `/workspaces/${id}/drives`), candidates);
  }
  return candidates;
}

// Resolve the configured id to a searchable drive id, adopting a discovered
// one when the configured value is a workspace id. Cached per isolate.
async function ensureDriveId(apiKey: string, configuredId: string): Promise<string> {
  if (cachedDriveId) return cachedDriveId;
  const probe = await rawSearch(apiKey, configuredId, { limit: 1, offset: 0 });
  if (probe.ok) {
    cachedDriveId = configuredId;
    return configuredId;
  }
  if (probe.status === 404) {
    const candidates = await discoverCandidates(apiKey);
    candidates.delete(configuredId);
    for (const [id] of candidates) {
      const p = await rawSearch(apiKey, id, { limit: 1, offset: 0 });
      if (p.ok) {
        cachedDriveId = id;
        return id;
      }
    }
  }
  return configuredId;
}

async function probeDrives(apiKey: string, candidates: Map<string, string>) {
  const results: Array<{ id: string; name: string; searchable: boolean }> = [];
  for (const [id, name] of [...candidates.entries()].slice(0, 12)) {
    const resp = await rawSearch(apiKey, id, { limit: 1, offset: 0 });
    results.push({ id, name, searchable: resp.ok });
  }
  return results;
}

// The /proxies endpoint "retrieves a proxy by redirecting to a signed URL";
// handle a redirect, a JSON body with a url field, or a plain-text URL.
async function resolveUrl(apiKey: string, driveId: string, assetId: string, proxyId?: string | null): Promise<string | null> {
  if (proxyId) {
    const resp = await fetch(`${SHADE_API}/proxies/${proxyId}?drive_id=${encodeURIComponent(driveId)}`, {
      headers: { Authorization: apiKey },
      redirect: "manual",
    });
    const loc = resp.headers.get("location");
    if (loc) return loc;
    if (resp.ok) {
      const text = await resp.text();
      try {
        const body = JSON.parse(text);
        const url = body?.url || body?.signed_url || (typeof body === "string" ? body : null);
        if (url) return url;
      } catch {
        if (text.startsWith("http")) return text.replace(/^"|"$/g, "");
      }
    }
  }
  // No proxy (images, documents) — fall back to the largest preview frame.
  const resp = await fetch(`${SHADE_API}/assets/${assetId}/previews?drive_id=${encodeURIComponent(driveId)}`, {
    headers: { Authorization: apiKey },
  });
  if (!resp.ok) return null;
  const previews = await resp.json();
  if (!Array.isArray(previews) || previews.length === 0) return null;
  const withUrl = previews.filter((p: any) => p?.signed_url);
  if (withUrl.length === 0) return null;
  return withUrl[withUrl.length - 1].signed_url;
}

// /search/folders responses vary (array of path strings or of objects);
// normalize to { path, name } sorted by name.
function normalizeFolders(data: any): Array<{ path: string; name: string }> {
  const raw = Array.isArray(data) ? data : data?.folders || data?.results || data?.items || [];
  const out: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();
  for (const f of raw) {
    let p: string | null = null;
    if (typeof f === "string") p = f;
    else if (f && typeof f === "object") p = f.path || f.full_path || f.key || null;
    if (!p) continue;
    p = p.replace(/\/+$/, "");
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const name = (f && typeof f === "object" && f.name) || p.split("/").filter(Boolean).pop() || p;
    out.push({ path: p, name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function extractAssetList(data: any): any[] {
  return Array.isArray(data) ? data : data.assets || data.results || data.items || [];
}

// AssetDTO carries more than the UI needs (job states, full metadata blobs);
// trim to what the results table, review modal, and playlist snapshot use.
function trimAsset(a: any) {
  const previews = Array.isArray(a.preview_images) ? a.preview_images : [];
  // Video assets carry their playback rendition in `proxy`; audio-only
  // assets carry it in `audio_proxy` (with `proxy` null).
  const proxies = Array.isArray(a.proxies) ? a.proxies : a.proxy ? [a.proxy] : a.audio_proxy ? [a.audio_proxy] : [];
  return {
    id: a.id,
    name: a.name,
    path: a.path,
    extension: a.extension,
    type: a.type, // VIDEO | IMAGE | AUDIO | DOCUMENT | ...
    size_bytes: a.size_bytes,
    created: a.created,
    updated: a.updated,
    thumbnail: previews[0]?.signed_url || null,
    proxy_id: proxies[0]?.id || null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    // Staff-only: the external portal roles never see the Tools pages.
    const { data: profile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role === "agency" || profile.role === "partner") {
      return json({ error: "Not authorized" }, 403);
    }

    const apiKey = Deno.env.get("SHADE_API_KEY");
    // Tolerate a pasted label around the id ("Mayday Media — <uuid>").
    const configuredId = (Deno.env.get("SHADE_DRIVE_ID") || "").match(UUID_RE)?.[0];
    if (!apiKey || !configuredId) {
      return json({ error: "Shade integration not configured (SHADE_API_KEY / SHADE_DRIVE_ID)" }, 503);
    }
    const driveId = await ensureDriveId(apiKey, configuredId);

    const body = await req.json().catch(() => ({}));
    const op = body.op;

    if (op === "drives") {
      const candidates = await discoverCandidates(apiKey);
      const drives = await probeDrives(apiKey, candidates);
      return json({ drives });
    }

    if (op === "browse") {
      const path = typeof body.path === "string" && body.path.trim() ? body.path.trim() : "/";
      const qs = `drive_id=${encodeURIComponent(driveId)}&path=${encodeURIComponent(path)}&limit=200`;
      const [foldersResp, filesResp] = await Promise.all([
        fetch(`${SHADE_API}/search/folders?${qs}`, { headers: { Authorization: apiKey } }),
        fetch(`${SHADE_API}/search/files`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ drive_id: driveId, path, recursive: false, limit: 200, offset: 0 }),
        }),
      ]);
      if (!foldersResp.ok && !filesResp.ok) {
        const errText = await filesResp.text();
        return json({ error: `Shade browse failed: ${filesResp.status} ${errText.slice(0, 300)}` }, 502);
      }
      const folders = foldersResp.ok ? normalizeFolders(await foldersResp.json()) : [];
      const assets = filesResp.ok ? extractAssetList(await filesResp.json()).map(trimAsset) : [];
      return json({ folders, assets, path, drive_id: driveId });
    }

    if (op === "search") {
      const limit = Math.min(parseInt(body.limit, 10) || 60, 200);
      const offset = parseInt(body.offset, 10) || 0;
      const query = body.query && String(body.query).trim() ? String(body.query).trim() : null;
      const path = typeof body.path === "string" && body.path.trim() && body.path.trim() !== "/"
        ? body.path.trim()
        : null;

      let resp: Response;
      if (path) {
        // Folder-scoped search: /search/files supports path + recursive.
        resp = await fetch(`${SHADE_API}/search/files`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            drive_id: driveId,
            path,
            recursive: true,
            limit,
            offset,
            ...(query ? { query } : {}),
          }),
        });
      } else {
        const payload: Record<string, unknown> = { limit, offset };
        if (query) payload.query = query;
        resp = await rawSearch(apiKey, driveId, payload);
      }
      if (!resp.ok) {
        const errText = await resp.text();
        return json({ error: `Shade search failed: ${resp.status} ${errText.slice(0, 300)}` }, 502);
      }
      let assets = extractAssetList(await resp.json()).map(trimAsset);
      // Type filtering is done here rather than via Shade's filter DSL —
      // the trimmed list is small and this keeps the request shape simple.
      if (Array.isArray(body.types) && body.types.length > 0) {
        const wanted = new Set(body.types.map((t: string) => String(t).toUpperCase()));
        assets = assets.filter((a: any) => wanted.has(String(a.type || "").toUpperCase()));
      }
      return json({ assets, drive_id: driveId });
    }

    if (op === "resolve") {
      if (!body.asset_id) return json({ error: "asset_id required" }, 400);
      const url = await resolveUrl(apiKey, driveId, body.asset_id, body.proxy_id);
      return json({ url });
    }

    if (op === "fetch") {
      if (!body.asset_id) return json({ error: "asset_id required" }, 400);
      // Log the precise failure point (Upload-to-Drive returned an opaque 500
      // because this op never recorded WHY the byte-pull failed). RLS: user_id
      // must equal auth.uid(), which userClient satisfies.
      const logFetchErr = async (status: number, msg: string) => {
        try {
          await userClient.from("upload_errors").insert({
            user_id: user.id, source: "server", phase: "fetch", status_code: status,
            error: msg, context: { fn: "shade-search", asset_id: body.asset_id, proxy_id: body.proxy_id ?? null },
          });
        } catch (_e) { /* never let logging mask the real error */ }
      };
      let url: string | null = null;
      try {
        url = await resolveUrl(apiKey, driveId, body.asset_id, body.proxy_id);
      } catch (e) {
        await logFetchErr(500, `resolve threw: ${(e as Error).message}`);
        return json({ error: `resolve failed: ${(e as Error).message}` }, 500);
      }
      if (!url) {
        await logFetchErr(404, "No downloadable rendition for this asset");
        return json({ error: "No downloadable rendition for this asset" }, 404);
      }
      let fileResp: Response;
      try {
        fileResp = await fetch(url);
      } catch (e) {
        await logFetchErr(502, `file fetch threw: ${(e as Error).message}`);
        return json({ error: `file fetch threw: ${(e as Error).message}` }, 502);
      }
      if (!fileResp.ok) {
        await logFetchErr(fileResp.status, `File fetch failed: ${fileResp.status}`);
        return json({ error: `File fetch failed: ${fileResp.status}` }, 502);
      }
      const len = fileResp.headers.get("content-length");
      return new Response(fileResp.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": fileResp.headers.get("content-type") || "application/octet-stream",
          ...(len ? { "Content-Length": len } : {}),
        },
      });
    }

    return json({ error: `Unknown op: ${op}` }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});
