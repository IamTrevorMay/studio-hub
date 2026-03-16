import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifyMailgunSignature(timestamp: string, token: string, signature: string): Promise<boolean> {
  const signingKey = Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY");
  if (!signingKey) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(timestamp + token);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hexSig === signature;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let fromAddress = "";
    let fromName = "";
    let subject = "";
    let htmlContent = "";
    let textContent = "";
    let timestamp = "";
    let token = "";
    let signature = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      fromAddress = (formData.get("sender") as string) || (formData.get("from") as string) || "";
      subject = (formData.get("subject") as string) || "";
      htmlContent = (formData.get("body-html") as string) || "";
      textContent = (formData.get("body-plain") as string) || "";
      timestamp = (formData.get("timestamp") as string) || "";
      token = (formData.get("token") as string) || "";
      signature = (formData.get("signature") as string) || "";

      // Parse from name from "Name <email>" format
      const fromRaw = (formData.get("from") as string) || "";
      const nameMatch = fromRaw.match(/^(.+?)\s*</);
      if (nameMatch) {
        fromName = nameMatch[1].replace(/["']/g, "").trim();
        const emailMatch = fromRaw.match(/<([^>]+)>/);
        if (emailMatch) fromAddress = emailMatch[1];
      }
    } else {
      const body = await req.json();
      fromAddress = body.sender || body.from || "";
      fromName = body["from-name"] || "";
      subject = body.subject || "";
      htmlContent = body["body-html"] || "";
      textContent = body["body-plain"] || "";
      timestamp = body.timestamp || "";
      token = body.token || "";
      signature = body.signature || "";
    }

    // Verify Mailgun signature if signing key is configured
    const signingKey = Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY");
    if (signingKey && timestamp && token && signature) {
      const valid = await verifyMailgunSignature(timestamp, token, signature);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Insert newsletter via service role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error } = await adminClient.from("research_newsletters").insert({
      from_address: fromAddress,
      from_name: fromName,
      subject: subject,
      html_content: htmlContent,
      text_content: textContent,
      received_at: new Date().toISOString(),
      read: false,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
