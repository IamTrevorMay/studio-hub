// RSS/Atom item parsing without DOMParser — the Supabase edge runtime no
// longer provides a global DOMParser (removed in a runtime upgrade ~2026-06),
// which silently killed ingestion: parse threw, the per-feed catch returned
// zero items, and fetch-rss kept responding 200. fast-xml-parser is pure JS.
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.0";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep guids/dates as strings — numeric-looking guids must not become numbers.
  parseTagValue: false,
  trimValues: true,
});

// deno-lint-ignore no-explicit-any
type Node = any;

function text(v: Node): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object" && "#text" in v) return text(v["#text"]);
  return "";
}

function first(v: Node): Node {
  return Array.isArray(v) ? v[0] : v;
}

function itemImage(item: Node): string {
  const media = first(item["media:content"]);
  if (media?.["@_url"]) return media["@_url"];
  // Atom (e.g. YouTube): <media:group><media:thumbnail url="..."/>
  const thumb = first(first(item["media:group"])?.["media:thumbnail"]);
  if (thumb?.["@_url"]) return thumb["@_url"];
  const enclosure = first(item.enclosure);
  if (String(enclosure?.["@_type"] || "").startsWith("image")) {
    return enclosure?.["@_url"] || "";
  }
  return "";
}

function itemLink(item: Node): string {
  const raw = first(item.link);
  // Atom links are <link href="..."/> (possibly several — prefer rel="alternate")
  if (raw && typeof raw === "object" && !("#text" in raw)) {
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const alt = links.find((l: Node) => l?.["@_rel"] === "alternate" || !l?.["@_rel"]);
    return (alt ?? links[0])?.["@_href"] || "";
  }
  return text(raw);
}

function itemAuthor(item: Node): string {
  const creator = text(first(item["dc:creator"]));
  if (creator) return creator;
  const author = first(item.author);
  if (author && typeof author === "object") return text(author.name);
  return text(author);
}

export function parseRssItems(xml: string): Array<Record<string, string>> {
  // deno-lint-ignore no-explicit-any
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  // RSS 2.0: rss.channel.item[] — Atom: feed.entry[] (e.g. YouTube feeds)
  const rawItems = doc?.rss?.channel?.item ?? doc?.channel?.item ?? doc?.feed?.entry ?? [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).filter(Boolean);

  return items.map((item: Node) => {
    const link = itemLink(item);
    return {
      title: text(first(item.title)),
      link,
      description: text(first(item.description)) || text(first(item.summary)),
      content: text(first(item["content:encoded"])) || text(first(item.content)),
      author: itemAuthor(item),
      pubDate: text(first(item.pubDate)) || text(first(item.published)) || text(first(item.updated)),
      guid: text(first(item.guid)) || text(first(item.id)) || link,
      imageUrl: itemImage(item),
    };
  });
}
