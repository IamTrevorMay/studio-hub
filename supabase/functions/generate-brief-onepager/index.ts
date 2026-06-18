import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ONE_PAGER_PROMPT = `You are converting a sponsor brief into a standardized one-page ad-read brief for a YouTube creator.

OUTPUT FORMAT: Plain markdown. Five sections in this exact order, each as an H2 heading:

## Talking Points
Key messages or angles the sponsor wants emphasized.

## Call to Action
Exact phrase or instruction they want said. What the viewer should do.

## Codes / Discounts
Promo codes, discount percentages, or links provided. Use "—" if none.

## Dos and Don'ts
Restrictions on what the creator can or cannot say, claim, or show. Two bulleted sub-lists labeled **Dos** and **Don'ts**.

## Assets
If the brief provides files/links/B-roll: list each as a markdown link bullet — \`- [Label](https://exact-url)\`. Preserve every URL verbatim. Never invent, shorten, or paraphrase URLs. Group by kind if helpful (Logos, B-roll, Product shots, Drive folder, etc.).
If no provided assets: write "Custom B-Roll" then list any specific filming requests they made (e.g., "film yourself using the product", "show packaging").

HARD RULES:
- One page maximum (two pages only if absolutely unavoidable).
- Strip every non-essential word. Aggressive abbreviation. Fragments OK.
- Technical/brand terms exact. Never invent codes or claims that aren't in source.
- No introduction, no closing, no commentary. Just the five sections.
- Use markdown bullets (-) for lists. No tables.`;

async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  const base64 = btoa(binary);
  const ct = res.headers.get("content-type") || "";
  let mediaType = "application/pdf";
  if (ct.includes("pdf") || url.toLowerCase().endsWith(".pdf")) mediaType = "application/pdf";
  else if (ct.includes("wordprocessingml") || url.toLowerCase().endsWith(".docx")) mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  else if (ct.includes("msword") || url.toLowerCase().endsWith(".doc")) mediaType = "application/msword";
  return { data: base64, mediaType };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await userClient
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "assistant"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { file_url, text } = body || {};

    if (!file_url && !text) {
      return new Response(JSON.stringify({ error: "Provide file_url or text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let messageContent: any[];
    if (file_url) {
      const { data: b64, mediaType } = await fetchAsBase64(file_url);
      if (mediaType === "application/pdf") {
        messageContent = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: "Convert this sponsor brief into the standardized one-pager described in the system prompt." },
        ];
      } else {
        return new Response(JSON.stringify({
          error: "DOCX not supported by Claude file API. Convert to PDF first, or paste text instead.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      messageContent = [
        { type: "text", text: "Source brief content:\n\n" + text + "\n\nConvert into the standardized one-pager." },
      ];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let claudeResponse;
    try {
      claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: Deno.env.get("CLAUDE_MODEL_ONEPAGER") || "claude-opus-4-7",
          max_tokens: 2048,
          system: ONE_PAGER_PROMPT,
          messages: [{ role: "user", content: messageContent }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      return new Response(JSON.stringify({ error: "Claude API error: " + errBody }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeResponse.json();
    const onepagerMd = (claudeData.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    if (!onepagerMd) {
      return new Response(JSON.stringify({ error: "Empty model response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ onepager_md: onepagerMd }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
