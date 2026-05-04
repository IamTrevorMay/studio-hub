import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const siteUrl = Deno.env.get("SITE_URL") || "https://www.mmcreate.io";

  // Parse return_url from state early so all redirects can use it
  let returnUrl: string | undefined;
  let userId: string | undefined;
  if (stateParam) {
    try {
      const state = JSON.parse(atob(stateParam));
      userId = state.user_id;
      returnUrl = state.return_url;
    } catch {
      // Invalid state — will be handled below
    }
  }

  const redirectBase = returnUrl || `${siteUrl}/andy`;

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectBase}?gmail_error=${encodeURIComponent(error)}` },
    });
  }

  if (!code || !stateParam || !userId) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectBase}?gmail_error=missing_params` },
    });
  }

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-auth-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokens.error_description || tokens.error || "Token exchange failed");
    }

    // Get Google email
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json();

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Store connection using service role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await adminClient
      .from("gmail_connections")
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
        gmail_address: userInfo.email || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (upsertError) throw upsertError;

    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectBase}?gmail_connected=true` },
    });
  } catch (err) {
    console.error("Gmail auth callback error:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectBase}?gmail_error=${encodeURIComponent(err.message)}` },
    });
  }
});
