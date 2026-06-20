// Vercel serverless function — server-renders the <head> for careers pages so
// search engines and job aggregators (Google for Jobs, LinkedIn, Indeed) see
// per-listing titles, meta tags, and JobPosting JSON-LD. The React SPA still
// hydrates normally for humans.
//
// Routed via vercel.json: /careers and /careers/(.*) → /api/careers
//
// Reads open listings with the public anon key (RLS already allows anon read
// of status='open'). Requires env at runtime:
//   SUPABASE_URL (or REACT_APP_SUPABASE_URL)
//   SUPABASE_ANON_KEY (or REACT_APP_SUPABASE_ANON_KEY)

const SITE = 'https://www.mmcreate.io';
const ORG = {
  '@type': 'Organization',
  name: 'Mayday Media',
  sameAs: SITE,
  logo: `${SITE}/logo.png`,
};
const EMP_MAP = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  freelance: 'CONTRACTOR',
};

function env(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return '';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseDescription(raw) {
  try {
    const p = JSON.parse(raw);
    if (p && p.structured) return p;
  } catch { /* plain text */ }
  return null;
}

function bulletsHtml(text) {
  if (!text) return '';
  const items = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

// Render the structured description into clean HTML for JobPosting.description.
function descriptionHtml(listing) {
  const p = parseDescription(listing.description);
  if (!p) return `<p>${esc(listing.description || listing.title)}</p>`;
  let h = '';
  if (p.intro) h += `<p>${esc(p.intro)}</p>`;
  if (p.responsibilities) h += `<h3>What You'll Do</h3>${bulletsHtml(p.responsibilities)}`;
  if (p.requirements) h += `<h3>Requirements</h3>${bulletsHtml(p.requirements)}`;
  if (p.reporting) h += `<p>${esc(p.reporting)}</p>`;
  if (p.compensation) h += `<p>${esc(p.compensation)}</p>`;
  return h || `<p>${esc(listing.title)}</p>`;
}

function plainSummary(listing, max = 160) {
  const p = parseDescription(listing.description);
  const txt = (p && (p.subtitle || p.intro)) || listing.description || listing.title;
  const flat = String(txt).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function jobPostingLd(listing, canonical) {
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: listing.title,
    description: descriptionHtml(listing),
    datePosted: listing.published_at || listing.created_at,
    hiringOrganization: ORG,
    directApply: true,
    url: canonical,
  };
  if (listing.expires_at) ld.validThrough = listing.expires_at;
  if (listing.employment_type && EMP_MAP[listing.employment_type]) {
    ld.employmentType = EMP_MAP[listing.employment_type];
  }
  if (listing.work_mode === 'remote') {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: 'US' };
  }
  if (listing.location) {
    ld.jobLocation = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: listing.location, addressCountry: 'US' },
    };
  }
  // < keeps the JSON safe inside a <script> tag.
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}

async function fetchListing(slug) {
  const url = env('SUPABASE_URL', 'REACT_APP_SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  const select = 'title,description,department,employment_type,work_mode,location,comp_range,published_at,created_at,expires_at,slug';
  const endpoint = `${url}/rest/v1/job_listings?slug=eq.${encodeURIComponent(slug)}&status=eq.open&select=${select}&limit=1`;
  try {
    const r = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

async function loadShell(host) {
  try {
    const r = await fetch(`https://${host}/index.html`);
    if (r.ok) return await r.text();
  } catch { /* fall through */ }
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Mayday Careers</title></head><body><div id="root"></div></body></html>';
}

function injectHead(shell, { title, tags }) {
  let html = shell.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (html === shell || !/<title>/i.test(shell)) {
    html = shell.replace(/<head>/i, `<head>\n<title>${esc(title)}</title>`);
  }
  return html.replace(/<\/head>/i, `${tags}\n</head>`);
}

module.exports = async (req, res) => {
  const host = req.headers.host || 'www.mmcreate.io';
  const path = (req.url || '/careers').split('?')[0];
  const m = path.match(/^\/careers\/([^/]+)/);
  const slug = m ? decodeURIComponent(m[1]) : null;

  const shell = await loadShell(host);
  let title = 'Careers — Mayday';
  let tags = `<meta name="description" content="Open roles at Mayday. Join the team."/>\n<link rel="canonical" href="${SITE}/careers"/>`;

  if (slug && slug !== 'privacy') {
    const listing = await fetchListing(slug);
    if (listing) {
      const canonical = `${SITE}/careers/${esc(listing.slug || slug)}`;
      const summary = plainSummary(listing);
      title = `${listing.title} — Mayday Careers`;
      tags = [
        `<meta name="description" content="${esc(summary)}"/>`,
        `<link rel="canonical" href="${canonical}"/>`,
        `<meta property="og:type" content="website"/>`,
        `<meta property="og:title" content="${esc(listing.title)} — Mayday"/>`,
        `<meta property="og:description" content="${esc(summary)}"/>`,
        `<meta property="og:url" content="${canonical}"/>`,
        `<meta name="twitter:card" content="summary"/>`,
        `<meta name="twitter:title" content="${esc(listing.title)} — Mayday"/>`,
        `<meta name="twitter:description" content="${esc(summary)}"/>`,
        `<script type="application/ld+json">${jobPostingLd(listing, canonical)}</script>`,
      ].join('\n');
    } else {
      // Unknown/closed role — don't let crawlers index a dead page.
      title = 'Role not found — Mayday Careers';
      tags = `<meta name="robots" content="noindex"/>\n<link rel="canonical" href="${SITE}/careers"/>`;
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(injectHead(shell, { title, tags }));
};
