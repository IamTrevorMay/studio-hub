import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { stripHtml, resolvePrompt } from "./report-sources.ts";

// ─── stripHtml ────────────────────────────────────────────────

Deno.test("stripHtml — removes tags and collapses whitespace", () => {
  const input = "<p>Hello   <b>world</b>  </p>";
  assertEquals(stripHtml(input), "Hello world");
});

Deno.test("stripHtml — no tags passthrough", () => {
  assertEquals(stripHtml("plain text"), "plain text");
});

Deno.test("stripHtml — empty string returns empty string", () => {
  assertEquals(stripHtml(""), "");
});

// ─── resolvePrompt ────────────────────────────────────────────

Deno.test("resolvePrompt — replaces placeholders", () => {
  const template = "Hello {{name}}, today is {{day}}.";
  const result = resolvePrompt(template, { name: "World", day: "Monday" });
  assertEquals(result, "Hello World, today is Monday.");
});

Deno.test("resolvePrompt — missing key replaced with empty string", () => {
  const result = resolvePrompt("Value: {{missing}}", {});
  assertEquals(result, "Value: ");
});

Deno.test("resolvePrompt — no placeholders passthrough", () => {
  const input = "No placeholders here";
  assertEquals(resolvePrompt(input, { foo: "bar" }), input);
});
