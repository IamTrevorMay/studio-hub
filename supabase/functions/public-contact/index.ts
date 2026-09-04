// Contact form handler for the marketing site (maydaymedia.io).
//
// Takes a submission from the public form and emails it to the studio. No
// database row: the enquiry is the email, and Resend is the durable copy.
// If that ever stops being good enough — an outage losing a lead — add a
// `contact_submissions` table here and write it before sending.
//
// Sending identity is deliberately split:
//
//   FROM     RESEND_FROM_EMAIL — a domain verified in Resend. Sending as the
//            visitor's own address would fail SPF/DKIM and land in spam.
//   REPLY-TO the visitor. Hitting reply in the inbox goes to them, which is
//            the only behaviour anyone actually wants from a contact form.
//   TO       CONTACT_TO, default contact@maydaymedia.io (Google Workspace MX).
//
// Deployed --no-verify-jwt, so it is a public write endpoint. Three guards:
// an origin allowlist, a honeypot, and the shared public_rate_limits table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resendSend } from '../shared/resend.ts';

// Unlike the read-only public-* feeds, this one accepts writes and sends
// mail, so it does not answer to '*'.
const ALLOWED_ORIGINS = new Set([
  'https://maydaymedia.io',
  'https://www.maydaymedia.io',
  'http://localhost:3000',
  'http://localhost:3100',
]);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed =
    ALLOWED_ORIGINS.has(origin) || origin.endsWith('.vercel.app')
      ? origin
      : 'https://www.maydaymedia.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const CONTACT_TO = Deno.env.get('CONTACT_TO') ?? 'contact@maydaymedia.io';

const LIMITS = { name: 120, email: 254, message: 5000, company: 160 };

// Mirrors the labels in the form; anything unrecognised becomes "General".
const TOPICS: Record<string, string> = {
  partnership: 'Brand partnership',
  production: 'Production work',
  press: 'Press & booking',
  general: 'General',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Deliberately loose. Bouncing a real address over a clever regex costs more
// than accepting a fake one, which the rate limiter handles anyway.
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    // Honeypot: a hidden field no human ever fills. Answer 200 so the bot
    // records a success and doesn't retry with the field cleared.
    if (clean(body.website, 200)) return reply({ ok: true });

    const name = clean(body.name, LIMITS.name);
    const email = clean(body.email, LIMITS.email).toLowerCase();
    const message = clean(body.message, LIMITS.message);
    const company = clean(body.company, LIMITS.company);
    const topicKey = clean(body.topic, 40);
    const topic = TOPICS[topicKey] ?? TOPICS.general;

    if (!name || !email || !message) {
      return reply({ error: 'Please fill in your name, email and message.' }, 400);
    }
    if (!looksLikeEmail(email)) {
      return reply({ error: 'That email address doesn’t look right.' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const { count: ipCount } = await admin
      .from('public_rate_limits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket', 'contact_ip')
      .eq('key', ip)
      .gte('created_at', hourAgo);
    if ((ipCount ?? 0) >= 5) {
      return reply(
        { error: 'Too many messages from this network. Try again later.' },
        429,
      );
    }

    const { count: emailCount } = await admin
      .from('public_rate_limits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket', 'contact_email')
      .eq('key', email)
      .gte('created_at', dayAgo);
    if ((emailCount ?? 0) >= 3) {
      return reply(
        { error: 'We already have your message — we’ll be in touch.' },
        429,
      );
    }

    const from = Deno.env.get('RESEND_FROM_EMAIL');
    if (!from) {
      console.error('public-contact: RESEND_FROM_EMAIL not set');
      return reply({ error: 'Contact form is misconfigured.' }, 500);
    }

    const rows = [
      ['From', `${name} <${email}>`],
      company ? ['Company', company] : null,
      ['Topic', topic],
    ].filter(Boolean) as string[][];

    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55;color:#231f20">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8a8a8a">
          maydaymedia.io &middot; contact form
        </p>
        <h2 style="margin:0 0 16px;font-size:20px">${escapeHtml(topic)}</h2>
        <table style="border-collapse:collapse;margin-bottom:18px">
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td style="padding:3px 14px 3px 0;color:#8a8a8a">${k}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`,
            )
            .join('')}
        </table>
        <div style="white-space:pre-wrap;border-left:3px solid #bb4430;padding-left:14px">${escapeHtml(message)}</div>
        <p style="margin-top:22px;font-size:12px;color:#8a8a8a">
          Reply to this email to answer ${escapeHtml(name)} directly.
        </p>
      </div>`;

    const text = [
      `${topic} — via maydaymedia.io`,
      '',
      `From: ${name} <${email}>`,
      company ? `Company: ${company}` : null,
      '',
      message,
    ]
      .filter((l) => l !== null)
      .join('\n');

    await resendSend({
      from,
      to: CONTACT_TO,
      subject: `[maydaymedia.io] ${topic} — ${name}`,
      html,
      text,
      reply_to: email,
      tags: [{ name: 'source', value: 'marketing_contact' }],
    });

    // Only count submissions that actually sent, so a Resend outage doesn't
    // burn someone's daily allowance on messages that never arrived.
    await admin.from('public_rate_limits').insert([
      { bucket: 'contact_ip', key: ip },
      { bucket: 'contact_email', key: email },
    ]);

    return reply({ ok: true });
  } catch (err) {
    console.error('public-contact failed', err);
    return reply(
      { error: 'Could not send your message right now. Please try again.' },
      500,
    );
  }
});
