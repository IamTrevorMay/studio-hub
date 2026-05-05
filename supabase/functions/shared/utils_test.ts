import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { jsonResponse, errorResponse, fetchWithRetry, getSupabaseAdmin } from "./utils.ts";

// ─── jsonResponse ─────────────────────────────────────────────

Deno.test("jsonResponse — correct status, Content-Type, and JSON body", async () => {
  const res = jsonResponse({ ok: true }, 201);
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const body = await res.json();
  assertEquals(body, { ok: true });
});

// ─── errorResponse ────────────────────────────────────────────

Deno.test("errorResponse — returns error object with status, defaults to 500", async () => {
  const res = errorResponse("something broke");
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const body = await res.json();
  assertEquals(body, { error: "something broke" });
});

Deno.test("errorResponse — custom status code", async () => {
  const res = errorResponse("not found", 404);
  assertEquals(res.status, 404);
});

// ─── fetchWithRetry ───────────────────────────────────────────

Deno.test("fetchWithRetry — succeeds on first try (1 fetch call)", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    return new Response("ok", { status: 200 });
  };
  try {
    const res = await fetchWithRetry("http://example.com", {}, 3, 1);
    assertEquals(res.status, 200);
    assertEquals(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithRetry — retries on 429, succeeds on 3rd attempt", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount < 3) {
      return new Response("rate limited", { status: 429 });
    }
    return new Response("ok", { status: 200 });
  };
  try {
    const res = await fetchWithRetry("http://example.com", {}, 3, 1);
    assertEquals(res.status, 200);
    assertEquals(callCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithRetry — retries on 500+", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) return new Response("err", { status: 502 });
    return new Response("ok", { status: 200 });
  };
  try {
    const res = await fetchWithRetry("http://example.com", {}, 3, 1);
    assertEquals(res.status, 200);
    assertEquals(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithRetry — respects Retry-After header", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return new Response("wait", {
        status: 429,
        headers: { "Retry-After": "0" }, // 0 seconds for fast test
      });
    }
    return new Response("ok", { status: 200 });
  };
  try {
    const res = await fetchWithRetry("http://example.com", {}, 3, 1);
    assertEquals(res.status, 200);
    assertEquals(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithRetry — network error triggers retry", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) throw new Error("ECONNRESET");
    return new Response("ok", { status: 200 });
  };
  try {
    const res = await fetchWithRetry("http://example.com", {}, 3, 1);
    assertEquals(res.status, 200);
    assertEquals(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithRetry — exhausts retries and throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("always fails");
  };
  try {
    await assertRejects(
      () => fetchWithRetry("http://example.com", {}, 2, 1),
      Error,
      "always fails"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── getSupabaseAdmin ─────────────────────────────────────────

Deno.test("getSupabaseAdmin — throws when env vars missing", () => {
  const origUrl = Deno.env.get("SUPABASE_URL");
  const origKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    let threw = false;
    try {
      getSupabaseAdmin();
    } catch (e) {
      threw = true;
      assertEquals((e as Error).message, "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    assertEquals(threw, true);
  } finally {
    if (origUrl) Deno.env.set("SUPABASE_URL", origUrl);
    if (origKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", origKey);
  }
});
