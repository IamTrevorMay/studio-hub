---
title: Mayday / Neptune Business Context
domain: context
tags: [context, mayday-media, neptune-performance, mayday-studio-app]
last_updated: 2026-07-12
---

# The Businesses Carl Advises

> This is the ground-truth context doc. Every `applied/` doc and every piece of Carl's advice should
> be framed against what's written here. Items marked *(assumption)* should be confirmed with Trevor
> and corrected in place.

## The Operator

- **Trevor May** — founder/operator. Former MLB pitcher (Minnesota Twins, New York Mets, Oakland
  Athletics, 2014–2023; career-best 21 saves in his final 2023 season with Oakland). Announced his
  retirement live on his own Twitch stream — an early signal of the media-first identity. Now a
  partnered Twitch streamer, YouTuber, DJ, and esports entrepreneur running a creator-led media
  operation and building software for it. *(Verified via Wikipedia/MLB.com, 2026-07-12.)*
- Carl's implication: Trevor has rare dual credibility — a decade of pro-baseball authority (Neptune's
  moat) plus a genuine, already-built streamer/creator audience (Mayday's engine).
- Runs multiple admin accounts in the app (trevor.may.khs = director_creative, trevormayofficial = admin).
- Works with a small core team plus freelancers/contractors (e.g., editor David Korn handles clips).

## Business 1: Mayday Media (content / creator company)

- Creator-led media company. Two YouTube channels: **More Mayday** (flagship long-form) and
  **Trevor May Baseball**; a podcast, **"Mayday! with Trevor May"** (Simplecast), with a recurring
  live "Mayday!" show on YouTube/Twitch; Instagram (**@trevmay65**) with stories as a tracked daily
  goal; TikTok/X/Threads under **IamTrevorMay**; Twitch (**iamtrevormay**, partnered); Substack
  newsletter; merch via Fourthwall. *(Account list verified against the app's platform_accounts
  table, 2026-07-12.)*
- Revenue streams visible in the operation: **sponsorships / ad reads** (managed with an external ad
  agency partner through an agency portal), platform revenue, **Substack** subscriptions, **Fourthwall**
  merch, Stripe payments.
- Content ops run through a proprietary hub (Mayday Studio app): concept → production pipeline with
  stage-based project cards, sprint planning, beat sheets, scripts (screenplay editor), teleprompter,
  post-show clipping tool, asset organization, and a research system (RSS + daily Claude-generated
  trend briefs).
- Team model: small admin core + **freelancer portal** (assignments, hour tracking on bi-weekly
  periods, document signing, Drive-based file submission, payment info) + read-only **agency portal**
  for the sponsorship agency.
- Analytics: daily platform metrics synced from YouTube, Meta, TikTok, Twitch, Fourthwall, Stripe,
  Substack, plus Metricool for scheduling/posting data.

## Business 2: Neptune Performance (baseball development lab — in buildout)

- A **new physical baseball training / player-development facility** being built out under a
  multi-phase Business Development program ("Mayday Media + Neptune Performance — buildout & ops").
- Tracked across 7 workstreams: Facility, Product, Marketing & Brand, Sales/BD, Operations, Finance,
  Tech/Systems — with launch countdown, milestones, and initiatives tagged Mayday / Neptune / Shared.
- **As of 2026-07-12** (from the live `bd_phases` table): the Neptune buildout phase has **no launch
  target date set yet**, and a second BD phase exists — **"AWA Expansion"**, a
  **content/media expansion under Mayday Media** (new show/channel/brand/vertical — confirmed by
  Trevor, 2026-07-12; exact meaning of the acronym not yet documented) with a launch target of
  **2026-10-01**. A separate "NBP Portal" Supabase project also exists, suggesting a dedicated
  Neptune-facing portal is in progress *(assumption)*.
- Implication: Carl's scaling and marketing advice must cover **local, physical-facility economics**
  (memberships/packages, coaching staff, utilization, local organic marketing) — not just digital.
- **Confirmed strategy (Trevor, 2026-07-12):** Trevor's baseball credibility + Mayday Media's
  content engine IS Neptune's primary customer-acquisition channel. Carl should treat
  content-as-CAC as core Neptune strategy, with local channels (partnerships, referrals, local SEO)
  as the supporting layer.

## Business 3 (the tool itself): Mayday Studio app

- React 18 + Supabase internal hub, deployed on Vercel; dark-themed (#0f0f1a base, indigo #6366f1
  accent, DM Sans), all inline styles, large single-file page components.
- Roles: admin, assistant, member, freelancer, agency, partner. Sidebar has Work Mode / Admin Mode.
- This app is where Carl's **UI/UX efficiency expertise** gets applied most directly: it's a
  daily-driver operations tool where the same few workflows (check dashboard, move project cards,
  plan sprints, post/schedule, review analytics, manage freelancers) run constantly — exactly the
  frequency-weighted optimization problem Carl specializes in.
- **Confirmed (Trevor, 2026-07-12):** productizing the app for other creator teams is a live
  option. Carl should occasionally weigh product/architecture decisions against future
  productization (multi-tenancy, configurability, polish of shared surfaces).

## Standing Constraints & Preferences

- Small team; founder time is the scarcest resource. Prefer leverage (systems, delegation,
  automation) over headcount.
- Organic-first marketing posture; the content engine is the moat.
- The app is built and modified rapidly with AI assistance; recommendations should be shippable in
  that mode (incremental, high-value-per-change).
- User-entered data must live in Supabase (multi-machine), never localStorage.
