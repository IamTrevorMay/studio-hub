// HMAC signing for email click-tracking links, so mailer-track-click cannot be
// abused as an open redirect. The render rewrites every href to route through
// mailer-track-click with the original URL in `u`; we attach `sig = HMAC(u)` and
// the redirect endpoint refuses any `u` whose signature doesn't verify.
//
// createHmac (node:crypto) is synchronous, which matters because the render's
// rewriteHref callback runs synchronously inside renderCampaign.
//
// Key: MAILER_LINK_SECRET if set, else the service-role key (server-only, high
// entropy, always present in the edge env). Rotating it invalidates links in
// already-sent emails, which is acceptable for time-sensitive newsletters.

import { createHmac } from "node:crypto";

function linkSecret(): string {
  return Deno.env.get("MAILER_LINK_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

export function signDest(dest: string): string {
  return createHmac("sha256", linkSecret()).update(dest).digest("hex").slice(0, 32);
}

export function verifyDest(dest: string, sig: string | null): boolean {
  if (!sig) return false;
  const expected = signDest(dest);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}
