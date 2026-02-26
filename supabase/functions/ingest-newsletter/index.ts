import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  try {
    // Validate webhook secret (query param or header)
    const url = new URL(req.url);
    const secret = url.searchParams.get("secret") ||
      req.headers.get("x-webhook-secret");

    const expectedSecret = Deno.env.get("MAILGUN_WEBHOOK_SECRET");
    if (!expectedSecret || secret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let fromAddress = "";
    let fromName = "";
    let subject = "";
    let textContent = "";
    let htmlContent = "";
    let receivedAt = new Date().toISOString();

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // Mailgun sends multipart form data
      const formData = await req.formData();
      fromAddress = (formData.get("sender") as string) || (formData.get("from") as string) || "";
      subject = (formData.get("subject") as string) || "";
      textContent = (formData.get("body-plain") as string) || "";
      htmlContent = (formData.get("body-html") as string) || "";
      const dateHeader = (formData.get("Date") as string) || "";
      if (dateHeader) {
        try { receivedAt = new Date(dateHeader).toISOString(); } catch { /* use default */ }
      }
    } else {
      // JSON body fallback
      const body = await req.json();
      fromAddress = body.sender || body.from || "";
      subject = body.subject || "";
      textContent = body["body-plain"] || body.text_content || "";
      htmlContent = body["body-html"] || body.html_content || "";
      if (body.Date || body.date) {
        try { receivedAt = new Date(body.Date || body.date).toISOString(); } catch { /* use default */ }
      }
    }

    // Parse "Name <email>" format
    const fromMatch = fromAddress.match(/^(.+?)\s*<(.+?)>$/);
    if (fromMatch) {
      fromName = fromMatch[1].trim().replace(/^["']|["']$/g, "");
      fromAddress = fromMatch[2].trim();
    }

    const { error } = await adminClient.from("research_newsletters").insert({
      from_address: fromAddress,
      from_name: fromName || null,
      subject: subject || "(No Subject)",
      text_content: textContent || null,
      html_content: htmlContent || null,
      received_at: receivedAt,
      read: false,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
