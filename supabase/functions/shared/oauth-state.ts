// HMAC-signed OAuth state tokens. Prevents an attacker from crafting a
// `state` value that binds a victim's user_id to the attacker's incoming
// authorization code (which would let the attacker overwrite the victim's
// platform credentials via the callback).
//
// Token format: `<base64url(json payload)>.<base64url(hmac-sha256)>`
// Payload always includes `exp` (ms epoch) and `nonce`. `exp` is enforced
// on verify so stolen tokens cannot be replayed indefinitely.
//
// Requires env var `OAUTH_STATE_SECRET` to be set on every fn that signs or
// verifies state (callbacks + url generators). The value can be any
// non-trivial random string.

const enc = new TextEncoder();
const dec = new TextDecoder();
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("OAUTH_STATE_SECRET");
  if (!secret) throw new Error("OAUTH_STATE_SECRET env var is not set");
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signState(
  payload: Record<string, unknown>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<string> {
  const body = {
    ...payload,
    exp: Date.now() + ttlMs,
    nonce: crypto.randomUUID(),
  };
  const bodyB64 = b64url(enc.encode(JSON.stringify(body)));
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(bodyB64));
  return `${bodyB64}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyState(
  token: string,
): Promise<Record<string, unknown>> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    throw new Error("Malformed state token");
  }
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const key = await getHmacKey();
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    fromB64url(sigB64),
    enc.encode(bodyB64),
  );
  if (!ok) throw new Error("Invalid state signature");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(dec.decode(fromB64url(bodyB64)));
  } catch {
    throw new Error("Malformed state payload");
  }

  if (typeof body.exp !== "number" || Date.now() > body.exp) {
    throw new Error("State token expired");
  }
  return body;
}
