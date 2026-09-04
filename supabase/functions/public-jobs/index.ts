// Public, login-free jobs feed for the marketing site (maydaymedia.io).
//
// The listings live in `job_listings` and the application pipeline lives in
// the Studio app at /careers/<slug>. This function exists so the marketing
// site can show the open roles without shipping a Supabase client, an anon
// key, or a second copy of the apply flow: it lists, the app applies.
//
// Three rules:
//
//   1. WHITELIST, NEVER PASSTHROUGH. `job_listings` carries
//      `screening_questions`, `onboarding_checklist`, `notify_user_ids` and
//      `created_by` — internal hiring machinery that has no business on a
//      public page. Every field below is written out by hand.
//
//   2. EXPIRED IS NOT OPEN. `status = 'open'` is set once and rarely unset;
//      `expires_at` is what people actually maintain. A role past its date
//      is dropped here, so the site can never advertise a closed listing.
//
//   3. THE DESCRIPTION IS STRUCTURED JSON. Listings store a JSON blob (see
//      api/careers.js). We surface the subtitle and the intro for the card
//      and leave the full text to the app — one canonical copy of a job
//      description, not two that drift.
//
// Deployed --no-verify-jwt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SUMMARY_CHARS = 260;

// Stored values → what a human reads on a card.
const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  freelance: 'Freelance',
  internship: 'Internship',
};
const WORK_MODE_LABEL: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On site',
  on_site: 'On site',
};

/** Pull the human-facing bits out of the structured description blob. */
function readDescription(raw: string | null): {
  subtitle: string | null;
  summary: string | null;
} {
  if (!raw) return { subtitle: null, summary: null };

  let subtitle: string | null = null;
  let text = raw;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.structured) {
      subtitle = String(parsed.subtitle ?? '').trim() || null;
      text = String(parsed.intro ?? '').trim();
    }
  } catch {
    // Older listings are plain text; use them as written.
  }

  // First paragraph only — the card wants a hook, not the whole posting.
  const first = text.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!first) return { subtitle, summary: null };

  const summary =
    first.length > SUMMARY_CHARS
      ? `${first.slice(0, SUMMARY_CHARS).replace(/[\s,;:.-]+\S*$/, '')}…`
      : first;

  return { subtitle, summary };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('job_listings')
      .select(
        'id, title, slug, description, department, employment_type, work_mode, location, comp_range, published_at, expires_at, position',
      )
      .eq('status', 'open')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('position', { ascending: true })
      .order('published_at', { ascending: false, nullsFirst: false });
    if (error) throw error;

    const jobs = (data ?? []).map((j) => {
      const { subtitle, summary } = readDescription(j.description);
      return {
        title: j.title,
        slug: j.slug,
        subtitle,
        summary,
        department: j.department ?? null,
        employment_type: j.employment_type ?? null,
        employment_label: j.employment_type
          ? EMPLOYMENT_LABEL[j.employment_type] ?? j.employment_type
          : null,
        work_mode: j.work_mode ?? null,
        work_mode_label: j.work_mode
          ? WORK_MODE_LABEL[j.work_mode] ?? j.work_mode
          : null,
        location: j.location ?? null,
        comp_range: j.comp_range ?? null,
        published_at: j.published_at ?? null,
        expires_at: j.expires_at ?? null,
        // The site prefixes its own careers base. One apply flow, in the app.
        apply_path: `/careers/${j.slug}`,
      };
    });

    return new Response(
      JSON.stringify({ generated_at: nowIso, count: jobs.length, jobs }),
      {
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          // Shorter than the reach feed: a role closing should disappear in
          // minutes, not an hour.
          'Cache-Control': 'public, max-age=120, s-maxage=600',
        },
      },
    );
  } catch (err) {
    console.error('public-jobs failed', err);
    return new Response(
      JSON.stringify({ error: 'Could not load open roles right now.' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
