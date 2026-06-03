// Resolve all data bindings on a tree of EmailBlocks.
// Returns map of blockId -> data passed to that block's renderer.
//
// Mayday currently supports two sources: 'rss' and 'static'. The full
// Triton resolver had briefs / daily_cards / stats_query / claude
// (baseball-only) — dropped here.

const Parser = require('rss-parser');

const parser = new Parser({ timeout: 10000 });

function collectBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    out.push(b);
    if (Array.isArray(b.children)) out.push(...collectBlocks(b.children));
  }
  return out;
}

async function resolveRss(rssUrl) {
  if (!rssUrl) return {};
  try {
    const feed = await parser.parseURL(rssUrl);
    const item = (feed.items || [])[0];
    if (!item) return {};
    let imageUrl = (item.enclosure && item.enclosure.url) || null;
    if (!imageUrl && item['content:encoded']) {
      const match = String(item['content:encoded']).match(/<img[^>]+src="([^"]+)"/);
      if (match) imageUrl = match[1];
    }
    return {
      title: item.title || '',
      link: item.link || '',
      description: (item.contentSnippet || '').slice(0, 200),
      author: item.creator || item['dc:creator'] || undefined,
      imageUrl,
    };
  } catch (e) {
    return { _error: String((e && e.message) || e) };
  }
}

async function resolveBinding(binding) {
  if (!binding || !binding.source) return {};
  switch (binding.source) {
    case 'rss':    return resolveRss(binding.rssUrl);
    case 'static':
    default:       return {};
  }
}

async function resolveAllBindings(blocks) {
  const all = collectBlocks(blocks || []);
  const bound = all.filter((b) => b.binding);
  const result = {};
  const settled = await Promise.all(
    bound.map(async (b) => ({ id: b.id, data: await resolveBinding(b.binding) }))
  );
  for (const r of settled) result[r.id] = r.data;
  return result;
}

module.exports = { resolveAllBindings, resolveBinding };
