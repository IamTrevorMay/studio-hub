import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COMMAND_VOCABULARY = [
  "archive", "delete", "trash", "remove", "skip", "next", "pass",
  "star", "important", "flag", "read", "read full", "full email",
  "read it", "back", "go back", "previous", "undo",
].join(", ");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
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

    const { audio, mimeType } = await req.json();
    if (!audio) {
      return new Response(JSON.stringify({ error: "Missing audio data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OpenAI API not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 audio to binary
    const binaryString = atob(audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Determine file extension from MIME type
    const ext = mimeType?.includes("webm") ? "webm"
      : mimeType?.includes("mp4") ? "mp4"
      : mimeType?.includes("ogg") ? "ogg"
      : "webm";

    // Build multipart/form-data for Whisper API
    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: mimeType || "audio/webm" }), `audio.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("language", "en");
    formData.append("prompt", `Voice commands for email triage: ${COMMAND_VOCABULARY}`);

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    const whisperData = await whisperRes.json();
    if (!whisperRes.ok) {
      throw new Error(whisperData.error?.message || "Transcription failed");
    }

    return new Response(JSON.stringify({ transcript: whisperData.text || "" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("voice-transcribe error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
