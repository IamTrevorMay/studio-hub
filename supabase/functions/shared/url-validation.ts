// SSRF guard for user-controlled URLs that get passed to fetch() from an edge
// function. Rejects anything that targets loopback, link-local, or RFC1918
// private space — the typical attack vector is pointing a "feed URL" or
// "custom domain" field at the platform's own metadata service / internal
// admin endpoints, which the edge runtime can reach but external callers can't.

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4) return false;
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;       // link-local / metadata
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isSafeExternalUrl(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "0.0.0.0") return false;
  if (host === "::1" || host === "::") return false;
  if (host.includes(":")) return false;            // IPv6 literal — block
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isPrivateIpv4(host)) return false;
  return true;
}
