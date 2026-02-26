import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { articles, newsletters, save } = await req.json();

    if ((!articles || articles.length === 0) && (!newsletters || newsletters.length === 0)) {
      return new Response(
        JSON.stringify({ error: "No articles or newsletters provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the content summary for Claude
    let contentSummary = "";

    if (articles?.length > 0) {
      contentSummary += "## Articles\n\n";
      for (const a of articles) {
        contentSummary += `### ${a.title}\n`;
        contentSummary += `Source: ${a.source || "Unknown"} | Date: ${a.pub_date || "Unknown"}\n`;
        const text = (a.content || a.description || "")
          .replace(/<[^>]*>/g, "")
          .substring(0, 2000);
        contentSummary += `${text}\n\n`;
      }
    }

    if (newsletters?.length > 0) {
      contentSummary += "## Newsletters\n\n";
      for (const n of newsletters) {
        contentSummary += `### ${n.subject}\n`;
        contentSummary += `From: ${n.from_name || n.from_address || "Unknown"}\n`;
        const text = (n.text_content || "").substring(0, 3000);
        contentSummary += `${text}\n\n`;
      }
    }

    // Call Claude API
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `You are a baseball research analyst for a player development organization. Analyze the following articles and newsletters, then produce a concise research briefing in markdown format.

Your briefing should:
- Start with a clear, descriptive title on the first line (just the title text, no # prefix)
- Include a "## Key Takeaways" section with 3-5 bullet points
- Include a "## Detailed Analysis" section organized by theme
- If there are player development or scouting implications, include a "## Development Implications" section
- Keep it focused and actionable for coaching staff
- Use markdown formatting (##, ###, **, -, etc.)

Here is the content to analyze:

${contentSummary}`,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      return new Response(
        JSON.stringify({ error: "Claude API error: " + errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResponse.json();
    const fullContent = claudeData.content?.[0]?.text || "";

    // Extract title from first line
    const lines = fullContent.split("\n");
    const title = lines[0].replace(/^#+\s*/, "").trim() || "Research Briefing";
    const content = lines.slice(1).join("\n").trim();

    // Optionally save to database
    if (save) {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      await adminClient.from("research_reports").insert({
        title,
        content,
        source_article_ids: (articles || []).map((a: { id: string }) => a.id).filter(Boolean),
        source_newsletter_ids: (newsletters || []).map((n: { id: string }) => n.id).filter(Boolean),
        created_by: user.id,
      });
    }

    return new Response(
      JSON.stringify({ title, content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
