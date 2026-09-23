// Mayday Studio suite — the app registry.
//
// Single source of truth for every card on the suite launcher and for the
// layouts' suite-view rendering (AppLayout + AppLayoutMobile). Three kinds:
//
//   internal     — lives inside this SPA. `segment` is both the URL segment
//                  and the layouts' suiteView value (Bridge is the special
//                  null-segment app: the classic tab world). `href` makes the
//                  launcher card a real anchor — right-click / cmd-click open
//                  the same URL in a new tab and routing resolves it there.
//   external     — a separate deployment. The card is a plain anchor: a left
//                  click navigates same-tab via default anchor behavior (no
//                  preventDefault-and-reimplement); `newTab: true` adds
//                  target="_blank" (Fathom always opens in a new tab).
//                  `localDefault: true` means the env var is unset — the URL
//                  only answers on a machine running that app's dev server,
//                  so the card shows a "Runs locally" hint.
//   coming-soon  — teaser route inside this SPA (pages/SuiteComingSoon.js).
//                  Same anchor semantics as internal. These routes never
//                  write suite_last_app (see src/lib/suite.js).
//
// External URLs resolve at build time from CRA env vars:
//   REACT_APP_CAST_URL    (default http://localhost:3000 — no deploy yet)
//   REACT_APP_DRIFT_URL   (default http://localhost:3001 — no deploy yet)
//   REACT_APP_FATHOM_URL  (default https://cloud.maydaystudio.net)

import { colors } from './styleTokens';

// Per-app monogram tints — a distinct hue per app, all sourced from tokens.
// Bridge keeps the flagship steel-blue gradient; every other app maps to a
// semantic tone triple (`violet` was added to styleTokens.js for Drift).
function toneTint(tone) {
  return {
    tileBg: tone.bg,
    tileFg: tone.fg,
    restBorder: colors.border,
    hoverBorder: tone.border,
    tagline: tone.fgSoft,
  };
}

// Flightline brand palette — keep in sync with the Flightline repo's
// web/src/styles.css `:root` block and public/flightline.svg.
export const FLIGHTLINE = {
  bg: '#131619',
  panel: '#1c2023',
  tile: '#171c1e',
  line: '#2e3438',
  text: '#c9ced0',
  muted: '#7f8a91',
  accent: '#d1e9ab',
  accentBright: '#d5edab',
  accentBorder: 'rgba(213,237,171,0.45)',
  accentSoft: 'rgba(209,233,171,0.16)',
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  logo: '/flightline-logo.svg', // copied from the Flightline repo's public/flightline.svg
};

const TINTS = {
  bridge: {
    tileBg: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
    tileFg: colors.white,
    restBorder: colors.accentBorder,
    hoverBorder: colors.accentA70,
    tagline: colors.accentFg,
  },
  harbor: toneTint(colors.info),    // sky — recording & comms
  cast:   toneTint(colors.danger),  // on-air red — live broadcast
  drift:  toneTint(colors.violet),  // violet — creative / graphics
  fathom: toneTint(colors.emerald), // teal — cloud storage
  anchor: toneTint(colors.warning), // amber — editor timeline
  // Flightline ships its own look (the Mac app + web Terminal): slate panels,
  // a lime tracer accent, DM Sans body + IBM Plex Mono eyebrows. The card
  // borrows that palette wholesale so it reads as Flightline, not as a
  // Mayday-tinted tile. Values mirror web/src/styles.css in the Flightline repo.
  flightline: {
    tileBg: FLIGHTLINE.tile,
    tileFg: FLIGHTLINE.accent,
    restBorder: FLIGHTLINE.line,
    hoverBorder: FLIGHTLINE.accentBorder,
    tagline: FLIGHTLINE.accent,
    // Card-level overrides (only Flightline sets these; AppCard falls back to
    // the launcher defaults when they're absent).
    cardBg: FLIGHTLINE.panel,
    nameColor: FLIGHTLINE.text,
    descriptionColor: FLIGHTLINE.muted,
    taglineFont: FLIGHTLINE.mono,
  },
  gerald: toneTint(colors.pink),    // pink — Mayday Assistant
};

const CAST_ENV = process.env.REACT_APP_CAST_URL;
const DRIFT_ENV = process.env.REACT_APP_DRIFT_URL;
const FATHOM_ENV = process.env.REACT_APP_FATHOM_URL;

export const SUITE_APPS = [
  {
    key: 'bridge',
    name: 'Bridge',
    monogram: 'B',
    tagline: 'Organize & build',
    description: "Projects, sprints, calendar, deliverables, analytics — the team's operations hub.",
    kind: 'internal',
    segment: null, // the classic tab world; owns every unprefixed route
    // Deterministic new-tab target — bare '/' resolves via suite_last_app,
    // so a fresh tab on '/' could land back on the launcher.
    href: '/dashboard',
    tint: TINTS.bridge,
  },
  {
    key: 'harbor',
    name: 'Harbor',
    monogram: 'H',
    tagline: 'Podcast & remote recording',
    description: 'Live calls with remote guests — sessions, tokenized guest links, up to 4 on a call.',
    kind: 'internal',
    segment: 'harbor',
    href: '/harbor',
    tint: TINTS.harbor,
  },
  {
    key: 'cast',
    name: 'Cast',
    monogram: 'C',
    tagline: 'Live broadcast production',
    description: 'Scenes, sources, and show control for live broadcasts. Separate app — Triton login.',
    kind: 'external',
    href: CAST_ENV || 'http://localhost:3000',
    localDefault: !CAST_ENV,
    tint: TINTS.cast,
  },
  {
    key: 'drift',
    name: 'Drift',
    monogram: 'D',
    tagline: 'Graphics builder',
    description: 'Design lower thirds, overlays, and stingers for the shows. Separate app.',
    kind: 'external',
    href: DRIFT_ENV || 'http://localhost:3001',
    localDefault: !DRIFT_ENV,
    tint: TINTS.drift,
  },
  {
    key: 'fathom',
    name: 'Fathom',
    monogram: 'F',
    tagline: 'Cloud storage',
    description: 'Browse and manage everything on Mayday Cloud. Always opens in a new tab.',
    kind: 'external',
    href: FATHOM_ENV || 'https://cloud.maydaystudio.net',
    newTab: true,
    tint: TINTS.fathom,
  },
  {
    key: 'anchor',
    name: 'Anchor',
    monogram: 'A',
    tagline: 'Video editor',
    description: 'A native macOS video editor, built for speed. In development.',
    kind: 'coming-soon',
    segment: 'anchor',
    href: '/anchor',
    tint: TINTS.anchor,
  },
  {
    key: 'flightline',
    name: 'Flightline',
    monogram: 'F',
    icon: FLIGHTLINE.logo, // shown in place of the monogram
    tagline: 'Tracer production',
    description: 'Shared projects, footage processing, and editing Terminals.',
    kind: 'internal',
    segment: 'flightline',
    href: '/flightline',
    tint: TINTS.flightline,
  },
  {
    // Gerald — the Mayday Assistant (a separate deployment). Strict-admin only;
    // the launcher hides this card for everyone else (see SuiteLauncher).
    key: 'gerald',
    name: 'Gerald',
    monogram: 'G',
    tagline: 'Mayday Assistant',
    description: 'Your admin AI assistant — a read-only snapshot of projects, sprint, deadlines, and events. Opens in a new tab.',
    kind: 'external',
    href: 'https://assist.mmcreate.io',
    newTab: true,
    strictAdmin: true,
    tint: TINTS.gerald,
  },
];

// URL segments owned by suite views ('harbor', 'anchor', 'flightline' — Bridge has
// none). Consumed by src/lib/suite.js to build SUITE_VIEW_SEGMENTS.
export const SUITE_APP_SEGMENTS = SUITE_APPS.filter((a) => a.segment).map((a) => a.segment);

// Segment → registry entry ('harbor' → Harbor, 'anchor' → Anchor, …).
// Returns null for 'launcher', bare '/', and anything unknown.
export function getSuiteAppForSegment(segment) {
  return SUITE_APPS.find((a) => a.segment === segment) || null;
}
