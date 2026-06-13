// Thin wrapper around the Resend REST API. Pulls the key from the
// RESEND_API_KEY secret. All callers should treat 4xx as permanent
// (bad request / suppression) and 5xx as transient (retryable).

const RESEND_BASE = "https://api.resend.com";

export interface SendEmailInput {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

export interface SendEmailResult {
  id: string;
}

function resendKey(): string {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set");
  return key;
}

export async function resendSend(input: SendEmailInput): Promise<SendEmailResult> {
  const resp = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await resp.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!resp.ok) {
    const msg = (data && typeof data === "object" && "message" in data && (data as { message: string }).message)
      || `Resend ${resp.status}`;
    const err = new Error(String(msg));
    (err as { status?: number }).status = resp.status;
    throw err;
  }
  return data as SendEmailResult;
}

export async function resendBatch(items: SendEmailInput[]): Promise<SendEmailResult[]> {
  // Resend supports up to 100 items per batch request.
  const out: SendEmailResult[] = [];
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const resp = await fetch(`${RESEND_BASE}/emails/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });
    const text = await resp.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!resp.ok) {
      const msg = (data && typeof data === "object" && "message" in data && (data as { message: string }).message)
        || `Resend batch ${resp.status}`;
      throw new Error(String(msg));
    }
    if (data && typeof data === "object" && "data" in data) {
      const arr = (data as { data: SendEmailResult[] }).data;
      out.push(...arr);
    }
  }
  return out;
}
