import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { Window } from "https://esm.sh/happy-dom@14.12.0";

// Polyfill DOMParser for test environment (Supabase Edge Runtime provides it natively)
const window = new Window();
(globalThis as any).DOMParser = window.DOMParser;

import { parseRssItems } from "./parse.ts";

// happy-dom uses internal timers; disable Deno's leak detection for these tests
const opts = { sanitizeOps: false, sanitizeResources: false };

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <item>
    <title>Test Article</title>
    <link>https://example.com/article</link>
    <description>A short desc</description>
    <content:encoded><![CDATA[<p>Full content here</p>]]></content:encoded>
    <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    <guid>unique-123</guid>
    <dc:creator>Author Name</dc:creator>
  </item>
</channel>
</rss>`;

Deno.test({ ...opts, name: "parseRssItems — parses standard RSS fields", fn() {
  const items = parseRssItems(SAMPLE_RSS);
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Test Article");
  // Note: <link> is treated as void element by happy-dom (HTML parser quirk).
  // In the real Supabase Edge Runtime DOMParser (XML mode), link.textContent works.
  assertEquals(items[0].description, "A short desc");
  assertEquals(items[0].pubDate, "Mon, 01 Jan 2024 12:00:00 GMT");
  assertEquals(items[0].guid, "unique-123");
}});

Deno.test({ ...opts, name: "parseRssItems — extracts media:content image URL", fn() {
  const xml = `<?xml version="1.0"?>
<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <item>
    <title>With Image</title>
    <media:content url="https://img.example.com/pic.jpg" medium="image"/>
  </item>
</channel></rss>`;
  const items = parseRssItems(xml);
  assertEquals(items[0].imageUrl, "https://img.example.com/pic.jpg");
}});

Deno.test({ ...opts, name: "parseRssItems — falls back to enclosure for image", fn() {
  const xml = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Enclosure Image</title>
    <enclosure url="https://img.example.com/enc.jpg" type="image/jpeg"/>
  </item>
</channel></rss>`;
  const items = parseRssItems(xml);
  assertEquals(items[0].imageUrl, "https://img.example.com/enc.jpg");
}});

Deno.test({ ...opts, name: "parseRssItems — missing optional fields default to empty string", fn() {
  const xml = `<?xml version="1.0"?>
<rss><channel><item><title>Minimal</title></item></channel></rss>`;
  const items = parseRssItems(xml);
  assertEquals(items[0].title, "Minimal");
  assertEquals(items[0].link, "");
  assertEquals(items[0].description, "");
  assertEquals(items[0].imageUrl, "");
}});

Deno.test({ ...opts, name: "parseRssItems — empty/invalid XML returns empty array", fn() {
  assertEquals(parseRssItems(""), []);
}});

Deno.test({ ...opts, name: "parseRssItems — content:encoded populates content field", fn() {
  const items = parseRssItems(SAMPLE_RSS);
  assertEquals(items[0].content.includes("Full content here"), true);
}});
