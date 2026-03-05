import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const siteUrl = Deno.env.get("SITE_URL") || "https://www.mmcreate.io";

  if (error) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${siteUrl}?twitch_error=${encodeURIComponent(error)}`,
      },
    });
  }

  if (!code || !stateParam) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${siteUrl}?twitch_error=missing_params`,
      },
    });
  }

  try {
    const state = JSON.parse(atob(stateParam));
    const userId = state.user_id;
    if (!userId) throw new Error("No user_id in state");

    const clientId = Deno.env.get("TWITCH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/twitch-auth-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(
        tokens.message || tokens.error_description || tokens.error || "Token exchange failed",
      );
    }

    // Fetch Twitch user info (broadcaster ID + display name)
    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Client-Id": clientId,
      },
    });
    const userData = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) throw new Error("Could not fetch Twitch user info");

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    // Store credentials in platform_accounts using service role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: updateError } = await adminClient
      .from("platform_accounts")
      .update({
        external_id: twitchUser.id,
        account_name: twitchUser.display_name,
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          twitch_login: twitchUser.login,
          broadcaster_type: twitchUser.broadcaster_type,
        },
      })
      .eq("platform", "twitch")
      .eq("is_active", true);

    if (updateError) throw updateError;

    console.log(
      `Twitch connected: ${twitchUser.display_name} (${twitchUser.id})`,
    );

    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}?twitch_connected=true` },
    });
  } catch (err) {
    console.error("Twitch auth callback error:", err);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${siteUrl}?twitch_error=${encodeURIComponent((err as Error).message)}`,
      },
    });
  }
});
