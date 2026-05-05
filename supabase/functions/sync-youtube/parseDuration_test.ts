import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { parseDuration } from "./parseDuration.ts";

Deno.test("parseDuration — PT1H2M3S equals 3723 seconds", () => {
  assertEquals(parseDuration("PT1H2M3S"), 3723);
});

Deno.test("parseDuration — PT5M equals 300 seconds", () => {
  assertEquals(parseDuration("PT5M"), 300);
});

Deno.test("parseDuration — PT30S equals 30 seconds", () => {
  assertEquals(parseDuration("PT30S"), 30);
});

Deno.test("parseDuration — PT1H equals 3600 seconds", () => {
  assertEquals(parseDuration("PT1H"), 3600);
});

Deno.test("parseDuration — empty string returns 0", () => {
  assertEquals(parseDuration(""), 0);
});

Deno.test("parseDuration — invalid string returns 0", () => {
  assertEquals(parseDuration("not a duration"), 0);
});
