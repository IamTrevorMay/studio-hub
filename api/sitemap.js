// Vercel serverless function — emits sitemap.xml of open job listings so search
// engines discover and re-crawl careers pages.
//
// Routed via vercel.json: /sitemap.xml → /api/sitemap

const SITE = 'https://www.mmcreate.io';

function env(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return '';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function openListings() {
  const url = env('SUPABASE_URL', 'REACT_APP_SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY');
  if (!url || !key) return [];
  const endpoint = `${url}/rest/v1/job_listings?status=eq.open&select=slug,updated_at,published_at`;
  try {
    const r = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

module.exports = async (_req, res) => {
  const listings = await openListings();
  const urls = [`<url><loc>${SITE}/careers</loc><changefreq>daily</changefreq></url>`];
  for (const l of listings) {
    if (!l.slug) continue;
    const lastmod = (l.updated_at || l.published_at || '').slice(0, 10);
    urls.push(
      `<url><loc>${SITE}/careers/${esc(l.slug)}</loc>` +
      (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
      `<changefreq>weekly</changefreq></url>`,
    );
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=1200');
  res.status(200).send(xml);
};
