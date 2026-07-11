import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shade drive proxy for the Asset Search tool (Assets view).
// Ops (POST { op, ... }):
//   search  { query, types?, limit?, offset? } → trimmed asset list from
//            Shade's AI index search (POST /search)
//   resolve { asset_id, proxy_id? }            → playable/downloadable signed
//            URL (video/audio proxy redirect, else largest preview image)
//   fetch   { asset_id, proxy_id?, }           → streams the file bytes
//            through this function (Shade signed URLs live on storage hosts
//            whose CORS we don't control, so downloads/zips route here)
//
// Env: SHADE_API_KEY (Settings > API Keys in Shade — sent raw, no "Bearer"),
//      SHADE_DRIVE_ID (the drive to search).

const SHADE_API = "https://api.shade.inc";

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

// AssetDTO carries more than the UI needs (job states, full metadata blobs);
// trim to what the results table, review modal, and playlist snapshot use.
function trimAsset(a: any) {
  const previews = Array.isArray(a.preview_images) ? a.preview_images : [];
  const proxies = Array.isArray(a.proxies) ? a.proxies : a.proxy ? [a.proxy] : [];
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
    const driveId = Deno.env.get("SHADE_DRIVE_ID");
    if (!apiKey || !driveId) {
      return json({ error: "Shade integration not configured (SHADE_API_KEY / SHADE_DRIVE_ID)" }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const op = body.op;

    if (op === "search") {
      const payload: Record<string, unknown> = {
        drive_id: driveId,
        limit: Math.min(parseInt(body.limit, 10) || 60, 200),
        offset: parseInt(body.offset, 10) || 0,
      };
      if (body.query && String(body.query).trim()) payload.query = String(body.query).trim();

      const resp = await fetch(`${SHADE_API}/search`, {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return json({ error: `Shade search failed: ${resp.status} ${errText.slice(0, 300)}` }, 502);
      }
      const data = await resp.json();
      let assets = (Array.isArray(data) ? data : data.assets || data.results || data.items || []).map(trimAsset);
      // Type filtering is done here rather than via Shade's filter DSL —
      // the trimmed list is small and this keeps the request shape simple.
      if (Array.isArray(body.types) && body.types.length > 0) {
        const wanted = new Set(body.types.map((t: string) => String(t).toUpperCase()));
        assets = assets.filter((a: any) => wanted.has(String(a.type || "").toUpperCase()));
      }
      return json({ assets });
    }

    if (op === "resolve") {
      if (!body.asset_id) return json({ error: "asset_id required" }, 400);
      const url = await resolveUrl(apiKey, driveId, body.asset_id, body.proxy_id);
      return json({ url });
    }

    if (op === "fetch") {
      if (!body.asset_id) return json({ error: "asset_id required" }, 400);
      const url = await resolveUrl(apiKey, driveId, body.asset_id, body.proxy_id);
      if (!url) return json({ error: "No downloadable rendition for this asset" }, 404);
      const fileResp = await fetch(url);
      if (!fileResp.ok) return json({ error: `File fetch failed: ${fileResp.status}` }, 502);
      return new Response(fileResp.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": fileResp.headers.get("content-type") || "application/octet-stream",
        },
      });
    }

    return json({ error: `Unknown op: ${op}` }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});
