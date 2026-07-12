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

- **Trevor May** — founder/operator, former professional baseball player (MLB pitcher) *(assumption:
  the Neptune baseball-lab venture and "Mayday" branding strongly suggest this)*, now running a
  creator-led media operation and building software for it.
- Runs multiple admin accounts in the app (trevor.may.khs = director_creative, trevormayofficial = admin).
- Works with a small core team plus freelancers/contractors (e.g., editor David Korn handles clips).

## Business 1: Mayday Media (content / creator company)

- Creator-led media company. Flagship YouTube channel **More Mayday** (long-form) plus clips/short-form
  distribution; Instagram stories are a tracked daily goal; also active on TikTok, Twitch, Substack
  (newsletter), and merch via Fourthwall.
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
- Implication: Carl's scaling and marketing advice must cover **local, physical-facility economics**
  (memberships/packages, coaching staff, utilization, local organic marketing) — not just digital.
- Natural synergy: Trevor's baseball credibility + Mayday Media's content engine is Neptune's
  primary customer-acquisition asset *(assumption to pressure-test, but strongly implied)*.

## Business 3 (the tool itself): Mayday Studio app

- React 18 + Supabase internal hub, deployed on Vercel; dark-themed (#0f0f1a base, indigo #6366f1
  accent, DM Sans), all inline styles, large single-file page components.
- Roles: admin, assistant, member, freelancer, agency, partner. Sidebar has Work Mode / Admin Mode.
- This app is where Carl's **UI/UX efficiency expertise** gets applied most directly: it's a
  daily-driver operations tool where the same few workflows (check dashboard, move project cards,
  plan sprints, post/schedule, review analytics, manage freelancers) run constantly — exactly the
  frequency-weighted optimization problem Carl specializes in.
- It may also have a future as a product for other creator teams *(assumption — "for creator teams"
  phrasing in the project description suggests productization is at least a live option)*.

## Standing Constraints & Preferences

- Small team; founder time is the scarcest resource. Prefer leverage (systems, delegation,
  automation) over headcount.
- Organic-first marketing posture; the content engine is the moat.
- The app is built and modified rapidly with AI assistance; recommendations should be shippable in
  that mode (incremental, high-value-per-change).
- User-entered data must live in Supabase (multi-machine), never localStorage.
