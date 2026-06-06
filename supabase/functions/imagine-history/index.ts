// supabase/functions/imagine-history/index.ts
// Deploy: supabase functions deploy imagine-history --no-verify-jwt
//
// REST verbs on a single endpoint (Supabase edge fns can't have nested
// path routes):
//
//   GET    /imagine-history             → { rows: [...] } newest-first, cap 100
//   POST   /imagine-history             → { row } create + upload thumbnail
//   DELETE /imagine-history?id=<uuid>   → { ok: true } remove row + thumbnail
//
// Auth: any authenticated Mayday user. RLS on imagine_history scopes rows
// to the caller via auth.uid().

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "imagine-thumbnails";
const HISTORY_LIMIT = 100;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: any valid JWT. Graphics is open to all authed users per Q16.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResp({ error: "Unauthorized" }, 401);

  // Service-role client for storage writes / cross-row reads (the user
  // client honors RLS automatically for the imagine_history table).
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (req.method === "GET") {
    const { data, error } = await userClient
      .from("imagine_history")
      .select("id, widget_id, title, filters, size, thumbnail_url, created_at")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) {
      console.error("imagine-history GET failed:", error.message);
      return jsonResp({ error: "Failed to load history" }, 500);
    }
    return jsonResp({ rows: data || [] });
  }

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ error: "Invalid JSON body" }, 400);
    }

    const widget_id = typeof body.widget_id === "string" ? body.widget_id : null;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const size = body.size && typeof body.size === "object" ? body.size : {};
    const thumbDataUrl = typeof body.thumbnail_data_url === "string" ? body.thumbnail_data_url : null;

    if (!widget_id || !title) {
      return jsonResp({ error: "widget_id and title are required" }, 400);
    }

    // Upload thumbnail if provided. Path: <user_id>/<ts>-<rand>.png so RLS
    // delete can match owner via the existing imagine-thumbs storage policy.
    let thumbnail_url: string | null = null;
    if (thumbDataUrl) {
      const m = thumbDataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!m) return jsonResp({ error: "thumbnail_data_url must be a data: URL" }, 400);
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bytes.length > 2 * 1024 * 1024) {
        return jsonResp({ error: "thumbnail too large (2MB max)" }, 413);
      }
      const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: `image/${m[1]}`,
        upsert: false,
      });
      if (upErr) {
        console.error("thumbnail upload failed:", upErr.message);
        return jsonResp({ error: "thumbnail upload failed" }, 500);
      }
      const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path);
      thumbnail_url = publicUrl;
    }

    const { data, error } = await userClient
      .from("imagine_history")
      .insert({
        user_id: user.id,
        widget_id,
        title,
        filters,
        size,
        thumbnail_url,
      })
      .select("id, widget_id, title, filters, size, thumbnail_url, created_at")
      .single();
    if (error) {
      console.error("imagine-history POST insert failed:", error.message);
      return jsonResp({ error: "Failed to save history row" }, 500);
    }
    return jsonResp({ row: data });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    let id = url.searchParams.get("id");
    if (!id) {
      // supabase-js .invoke() does not pass query strings reliably; accept
      // id from the JSON body as a fallback.
      try {
        const body = await req.json();
        if (body && typeof body.id === "string") id = body.id;
      } catch {
        // no body provided
      }
    }
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return jsonResp({ error: "valid id required" }, 400);
    }

    // Read first so we can delete the storage object best-effort.
    const { data: row } = await userClient
      .from("imagine_history")
      .select("thumbnail_url")
      .eq("id", id)
      .maybeSingle();

    const { error: delErr } = await userClient
      .from("imagine_history")
      .delete()
      .eq("id", id);
    if (delErr) {
      console.error("imagine-history DELETE failed:", delErr.message);
      return jsonResp({ error: "Failed to delete history row" }, 500);
    }

    // Best-effort thumb cleanup; storage path is everything after the
    // bucket name in the public URL.
    if (row?.thumbnail_url) {
      const marker = `/${BUCKET}/`;
      const idx = row.thumbnail_url.indexOf(marker);
      if (idx >= 0) {
        const path = row.thumbnail_url.slice(idx + marker.length);
        await admin.storage.from(BUCKET).remove([path]);
      }
    }
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: "Method not allowed" }, 405);
});
