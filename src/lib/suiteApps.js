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
  radar:  toneTint(colors.success), // scope green — tracking
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
    key: 'radar',
    name: 'Radar',
    monogram: 'R',
    tagline: 'Pitch tracer & creator assets',
    description: 'Ball tracking, pitch tracers, and creator assets. In development.',
    kind: 'coming-soon',
    segment: 'radar',
    href: '/radar',
    tint: TINTS.radar,
  },
];

// URL segments owned by suite views ('harbor', 'anchor', 'radar' — Bridge has
// none). Consumed by src/lib/suite.js to build SUITE_VIEW_SEGMENTS.
export const SUITE_APP_SEGMENTS = SUITE_APPS.filter((a) => a.segment).map((a) => a.segment);

// Segment → registry entry ('harbor' → Harbor, 'anchor' → Anchor, …).
// Returns null for 'launcher', bare '/', and anything unknown.
export function getSuiteAppForSegment(segment) {
  return SUITE_APPS.find((a) => a.segment === segment) || null;
}
