export function parseRssItems(xml: string): Array<Record<string, string>> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc) return [];

  const items: Array<Record<string, string>> = [];
  const itemEls = doc.querySelectorAll("item");

  for (const item of itemEls) {
    const get = (tag: string) => item.querySelector(tag)?.textContent?.trim() || "";

    // Try multiple image sources
    let imageUrl = "";
    const mediaContent = item.querySelector("media\\:content, content");
    if (mediaContent?.getAttribute("url")) {
      imageUrl = mediaContent.getAttribute("url")!;
    }
    const enclosure = item.querySelector("enclosure");
    if (!imageUrl && enclosure?.getAttribute("type")?.startsWith("image")) {
      imageUrl = enclosure.getAttribute("url") || "";
    }

    items.push({
      title: get("title"),
      link: get("link"),
      description: get("description"),
      content: get("content\\:encoded") || get("content"),
      author: get("dc\\:creator") || get("author"),
      pubDate: get("pubDate"),
      guid: get("guid") || get("link"),
      imageUrl,
    });
  }

  return items;
}
