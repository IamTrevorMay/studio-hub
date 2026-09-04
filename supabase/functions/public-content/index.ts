// Public, login-free content feed for the marketing site (maydaymedia.io).
//
// Companion to `public-reach`. That one answers "how big is the audience";
// this one answers "what does the work actually look like" — the recent
// slate from the owned YouTube channels, with real thumbnails and real view
// counts, so the homepage shows the work instead of describing it.
//
// The same two rules from public-reach apply here:
//
//   1. WHITELIST, NEVER PASSTHROUGH. `platform_accounts` holds `credentials`
//      and `config`; neither is selected anywhere in this file. Every field
//      in the response is written out by hand. Adding one is a deliberate
//      edit, not a spread.
//
//   2. NEVER PUBLISH A ROW YOU CAN'T STAND BEHIND. An item without a
//      published date, a watch URL or a thumbnail is dropped rather than
//      rendered as a hole in the grid. View counts come from the newest
//      metrics snapshot for that item and are omitted when we have none —
//      a missing number is better than a stale one presented as current.
//
// Deployed --no-verify-jwt. No revenue, pay, or internal pipeline fields.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// The owned channels, in the order the site ranks them. Matching on
// account_name keeps this readable; the ids move around, the names don't.
const CHANNELS = [
  { account: 'Trevor May Baseball', platform: 'youtube' },
  { account: 'More Mayday', platform: 'youtube' },
] as const;

const PER_CHANNEL = 12;   // fetched per channel; the site shows fewer
const MAX_PER_CHANNEL = 24;

function channelUrl(platform: string, externalId: string | null): string | null {
  if (!externalId) return null;
  if (platform === 'youtube') return `https://www.youtube.com/channel/${externalId}`;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const url = new URL(req.url);
    const requested = Number(url.searchParams.get('limit') ?? PER_CHANNEL);
    const perChannel = Math.min(
      Math.max(Number.isFinite(requested) ? requested : PER_CHANNEL, 1),
      MAX_PER_CHANNEL,
    );

    // Four columns. `credentials` and `config` are not among them.
    const { data: accounts, error: acctErr } = await supabase
      .from('platform_accounts')
      .select('id, platform, account_name, external_id')
      .eq('is_active', true)
      .in('account_name', CHANNELS.map((c) => c.account));
    if (acctErr) throw acctErr;

    // One query per channel rather than one big ordered fetch: a channel
    // that posts daily would otherwise crowd a weekly one out of the feed.
    const perAccount = await Promise.all(
      CHANNELS.map(async (chan) => {
        const acct = (accounts ?? []).find(
          (a) => a.account_name === chan.account && a.platform === chan.platform,
        );
        if (!acct) return null;

        const { data: items, error } = await supabase
          .from('content_items')
          .select(
            'id, title, url, thumbnail_url, published_at, duration_seconds, content_type, series',
          )
          .eq('platform_account_id', acct.id)
          .not('published_at', 'is', null)
          .not('url', 'is', null)
          .not('thumbnail_url', 'is', null)
          .order('published_at', { ascending: false })
          .limit(perChannel);
        if (error) throw error;

        return { chan, acct, items: items ?? [] };
      }),
    );

    const groups = perAccount.filter(Boolean) as NonNullable<
      (typeof perAccount)[number]
    >[];

    // Newest metrics snapshot per item, in one round trip for all channels.
    const itemIds = groups.flatMap((g) => g.items.map((i) => i.id));
    const views = new Map<string, number>();
    const viewsAsOf = new Map<string, string>();

    if (itemIds.length) {
      const { data: metrics, error: mErr } = await supabase
        .from('content_metrics')
        .select('content_item_id, views, captured_at')
        .in('content_item_id', itemIds);
      if (mErr) throw mErr;

      for (const m of metrics ?? []) {
        const id = m.content_item_id as string;
        const at = m.captured_at as string;
        const prev = viewsAsOf.get(id);
        if (!prev || at > prev) {
          viewsAsOf.set(id, at);
          views.set(id, Number(m.views ?? 0));
        }
      }
    }

    const channels = groups.map((g) => {
      const items = g.items.map((i) => ({
        title: i.title,
        url: i.url,
        thumbnail_url: i.thumbnail_url,
        published_at: i.published_at,
        duration_seconds: i.duration_seconds ?? null,
        // 'video' | 'short' | podcast types — the site groups on this.
        format: String(i.content_type ?? 'video'),
        series: i.series ?? null,
        views: views.has(i.id) ? views.get(i.id)! : null,
      }));

      return {
        account: g.acct.account_name,
        platform: g.acct.platform,
        channel_url: channelUrl(g.acct.platform, g.acct.external_id),
        newest_published_at: items[0]?.published_at ?? null,
        items,
      };
    });

    const body = {
      generated_at: new Date().toISOString(),
      per_channel: perChannel,
      channels,
    };

    return new Response(JSON.stringify(body), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('public-content failed', err);
    return new Response(
      JSON.stringify({ error: 'Could not load the content feed right now.' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
