// The margin-target model behind Accounting → Breakdown.
//
// Pure functions only — no Supabase, no React. Everything the Breakdown page
// computes goes through here so the arithmetic has exactly one home, and so
// src/__tests__/lib/marginModel.test.js can hold it still.
//
// MONEY IS CENTS. Every *Cents value in and out of this module is an integer
// number of cents, including derived per-hour rates. Ratios (margins, tax,
// utilisation) are plain 0..1 floats. Mixing the two is the single easiest way
// to be quietly wrong here, so the suffix is not optional.

// ─── Margin vs markup ──────────────────────────────────────────────
//
// The workbook spends a page on this because the error compounds silently:
// $100 at a 30% MARGIN is $142.86. Marking $100 up BY 30% gives $130, which is
// only a 23% margin. Seven points, on every product, for a year.

/** Price that hits `margin` on a given cost. margin is 0..1, exclusive of 1. */
export function priceForMargin(costCents, margin) {
  if (!isFinite(costCents) || !isFinite(margin) || margin >= 1) return null;
  return Math.round(costCents / (1 - margin));
}

/** Margin actually achieved at a price. Always divides by PRICE, never cost. */
export function marginOf(priceCents, costCents) {
  if (!priceCents) return null;
  return (priceCents - costCents) / priceCents;
}

/**
 * The guide's "if you think it's worth $100, charge $85" move. The gap is
 * deliberate headroom — room to add value later instead of clawing it back.
 */
export function listPriceFrom(targetPriceCents, headroomPct) {
  if (targetPriceCents == null) return null;
  return Math.round(targetPriceCents * (1 - (headroomPct || 0)));
}

// ─── Labour cost ───────────────────────────────────────────────────

/** Salary understates a person by roughly a third. This is the rest of it. */
export function loadedAnnualCents({ salaryCents = 0, employerTaxPct = 0, benefitsCents = 0 }) {
  return Math.round(salaryCents * (1 + employerTaxPct) + benefitsCents);
}

/** Nobody bills 8 hours a day. 60% is realistic, 80% is a fantasy. */
export function billableHours(paidHours = 0, utilisation = 0) {
  return paidHours * utilisation;
}

export function loadedHourlyCents(annualCents, hours) {
  if (!hours) return null;
  return Math.round(annualCents / hours);
}

/**
 * Overhead is one pool. Every hour sold carries a slice, or the rent comes out
 * of profit instead of price. `recoveryPct` is the tab-3 lever: what share of
 * overhead the hourly products carry (the rest rides on recurring revenue).
 */
export function overheadPerHourCents(annualOverheadCents, recoveryPct, annualBillableHours) {
  if (!annualBillableHours) return null;
  return Math.round((annualOverheadCents * recoveryPct) / annualBillableHours);
}

/** Full unit cost stack for one labour product. */
export function unitCost({ hoursPerUnit, rateCents, reworkPct = 0, ohPerHourCents = 0 }) {
  if (hoursPerUnit == null || rateCents == null) {
    return { directCents: null, adjustedCents: null, overheadCents: null, fullyLoadedCents: null };
  }
  const directCents = Math.round(hoursPerUnit * rateCents);
  const adjustedCents = Math.round(directCents * (1 + reworkPct));
  const overheadCents = Math.round(hoursPerUnit * (1 + reworkPct) * ohPerHourCents);
  return {
    directCents,
    adjustedCents,
    overheadCents,
    fullyLoadedCents: adjustedCents + overheadCents,
  };
}

// ─── Expense classification ────────────────────────────────────────
//
// The trap this exists to avoid: `Employees` and `Contractors` are NOT
// overhead. The workbook keeps salaries off tab 1 on purpose, because tab 2
// already prices them per hour. Sum them into the overhead pool as well and
// every person is counted twice — once in the loaded hourly rate, once in
// overhead per hour — and every price downstream comes out high.

export const CLASSIFICATIONS = {
  overhead:        { key: 'overhead',        label: 'Fixed overhead',  help: 'Paid whether or not you sell anything. Carried per billable hour.' },
  direct_labour:   { key: 'direct_labour',   label: 'Direct labour',   help: 'People cost. Priced per hour on the Labour tab — never also overhead.' },
  direct_variable: { key: 'direct_variable', label: 'Direct variable', help: 'Scales with the work. A direct cost in the readout, not a fixed cost.' },
  benefits:        { key: 'benefits',        label: 'Benefits',        help: 'Belongs to a person’s loaded rate, not the overhead pool.' },
  excluded:        { key: 'excluded',        label: 'Excluded',        help: 'Kept out of the model entirely.' },
};

/**
 * Seed tagging for the Tiller expense categories. Overridable per category in
 * margin_settings.data.category_map, so a new category added to the sheet is a
 * retag in the UI rather than a deploy.
 *
 * `Entertainment/Fun` and `Food` are seeded `excluded` and flagged for review —
 * they are genuinely ambiguous and should be a deliberate call, not a default.
 */
export const DEFAULT_EXPENSE_CLASSIFICATION = {
  'Employees':              'direct_labour',
  'Contractors':            'direct_labour',
  'Medical':                'benefits',
  'Rent & Utilities':       'overhead',
  'Insurance':              'overhead',
  'Equipment':              'overhead',
  'Equipment - Neptune':    'overhead',
  'Admin Subscriptions':    'overhead',
  'Creative Subscriptions': 'overhead',
  'Administration':         'overhead',
  'Supplies':              'overhead',
  'Bank Fees':              'overhead',
  'Taxes':                  'overhead',
  'Misc Expense':           'overhead',
  'R&D/Production':         'direct_variable',
  'Travel':                 'direct_variable',
  'Entertainment/Fun':      'excluded',
  'Food':                   'excluded',
};

/** Categories whose seeded tag is a guess worth confirming on first load. */
export const REVIEW_TAGS = new Set(['Entertainment/Fun', 'Food', 'Taxes', 'Misc Expense']);

// ─── Revenue buckets ───────────────────────────────────────────────
//
// The readout splits by COST STRUCTURE, not business line: labour products
// where an hour of somebody's time is the cost, and near-zero-marginal-cost
// recurring products. Instruction is baseball but behaves like editing;
// membership is media but behaves like SaaS.

export const READOUT_ROWS = [
  { key: 'labour_content',       bucket: 'labour',    label: 'Labour — content',              note: 'Ad revenue + sponsorships' },
  { key: 'labour_production',    bucket: 'labour',    label: 'Labour — production services',  note: 'Client editing' },
  { key: 'labour_tracers',       bucket: 'labour',    label: 'Labour — tracers',              note: 'Per-unit piece work' },
  { key: 'labour_instruction',   bucket: 'labour',    label: 'Labour — instruction & biomech', note: 'Lessons and assessments' },
  { key: 'recurring_membership', bucket: 'recurring', label: 'Recurring — membership',        note: 'Substack' },
  { key: 'recurring_saas',       bucket: 'recurring', label: 'Recurring — facility SaaS',     note: 'No revenue category yet' },
  { key: 'recurring_merch',      bucket: 'recurring', label: 'Recurring — merch',             note: 'Thin by design' },
];

/**
 * Substack is the membership, so its income is recurring — it counts toward
 * overhead-coverage-by-recurring, which is the ratio that decides when labour
 * margins can safely come down.
 *
 * Tracers, instruction and SaaS have no Tiller category yet, so those readout
 * rows have no auto source and stay hand-entered until one exists.
 */
export const DEFAULT_REVENUE_BUCKET = {
  'YouTube Income':      'labour_content',
  'TikTok Income':       'labour_content',
  'Twitch Income':       'labour_content',
  'Facebook Income':     'labour_content',
  'Sponsorship Income':  'labour_content',
  'Production Services': 'labour_production',
  'Services':            'labour_production',
  'Substack Income':     'recurring_membership',
  'Merch Income':        'recurring_merch',
  'Interest':            'excluded',
  'Reimbursement':       'excluded',
};

export function classifyExpense(category, settings) {
  const overrides = settings?.category_map || {};
  return overrides[category] || DEFAULT_EXPENSE_CLASSIFICATION[category] || null;
}

export function bucketRevenue(category, settings) {
  const overrides = settings?.revenue_map || {};
  return overrides[category] || DEFAULT_REVENUE_BUCKET[category] || null;
}

// ─── Field registry ────────────────────────────────────────────────
//
// Every input on the page is declared here. `auto: true` means the field has a
// derivable value, which is what makes Recalculate correct: it clears only the
// manual rows whose field can be re-derived. Membership assumptions and SaaS
// tiers (auto: false) survive a Recalculate, because nothing could put them
// back.

export const FIELDS = [
  // Overhead pool
  { section: 'overhead', key: 'overhead_annual_cents', label: 'Annual fixed overhead', kind: 'money', auto: true,
    help: 'Sum of expense categories tagged Fixed overhead over the trailing 12 months.' },
  { section: 'overhead', key: 'contingency_pct', label: 'Contingency buffer', kind: 'pct', auto: false, defaultValue: 0.05,
    help: '5–10%. Things you have not thought of yet. The Suite B move will surface several.' },

  // Model levers
  { section: 'model', key: 'overhead_recovery_pct', label: 'Overhead recovered by hourly products', kind: 'pct', auto: false, defaultValue: 0.8,
    help: 'At 100% your labour products alone cover every fixed cost. Lower it and you are betting on recurring revenue to close the gap.' },

  // Per person (subject_id = margin_people.id)
  { section: 'labour', key: 'annual_salary_cents', label: 'Annual salary', kind: 'money', auto: true,
    help: 'From payroll_salaries where the person is linked to a profile.' },
  { section: 'labour', key: 'employer_tax_pct', label: 'Employer taxes', kind: 'pct', auto: false, defaultValue: 0.12 },
  { section: 'labour', key: 'benefits_annual_cents', label: 'Benefits + tools', kind: 'money', auto: false },
  { section: 'labour', key: 'paid_hours', label: 'Paid hours per year', kind: 'hours', auto: false, defaultValue: 2080 },
  { section: 'labour', key: 'utilisation', label: 'Utilisation', kind: 'pct', auto: false, defaultValue: 0.6,
    help: '60% is realistic for a salaried editor. 70% is a well-run shop. 80% is a fantasy that makes every price downstream too low.' },

  // Per labour product (subject_id = margin_products.id)
  { section: 'products', key: 'hours_per_unit', label: 'Hours per unit', kind: 'hours', auto: true,
    help: 'Measured from reported hours on matching assignments and tasks.' },
  { section: 'products', key: 'units_per_year', label: 'Units per year', kind: 'count', auto: true },
  { section: 'products', key: 'rate_cents', label: 'Loaded rate', kind: 'money', auto: true,
    help: 'Average loaded rate of the people whose reported hours matched this product; blended company rate when nothing matched.' },

  // Recurring — membership
  { section: 'recurring', key: 'members', label: 'Members', kind: 'count', auto: false,
    help: 'Manual: Substack removed the public subscriber_count endpoint in ~March 2026, so sync-substack no longer lands a headcount.' },
  { section: 'recurring', key: 'processing_pct', label: 'Payment processing', kind: 'pct', auto: false, defaultValue: 0.05 },
  { section: 'recurring', key: 'merch_cost_cents', label: 'Merch discount cost / member / mo', kind: 'money', auto: false,
    help: 'Margin given up on sales that would have happened at full price anyway. Cross-check against the merch table.' },
  { section: 'recurring', key: 'other_cost_cents', label: 'Other cost to serve / member / mo', kind: 'money', auto: false },
  { section: 'recurring', key: 'units_per_member_month', label: 'Merch units / member / mo', kind: 'count', auto: false, defaultValue: 0.1 },
  { section: 'recurring', key: 'cannibalisation_pct', label: 'Would have sold at full price', kind: 'pct', auto: false, defaultValue: 0.4 },
  { section: 'recurring', key: 'membership_revenue_annual_cents', label: 'Membership revenue (annual)', kind: 'money', auto: true,
    help: 'Substack Income over the trailing 12 months.' },

  // Recurring — SaaS
  { section: 'recurring', key: 'value_cents', label: 'Monthly value to customer', kind: 'money', auto: false,
    help: 'Admin hours saved, double-bookings avoided, retention gained. Ask the pilot facility what it would cost them if it vanished.' },
  { section: 'recurring', key: 'price_pct_of_value', label: 'Price as % of value', kind: 'pct', auto: false, defaultValue: 0.15,
    help: '10–20% is the defensible band. Below 10% leaves money behind; above 30% starts to feel extractive.' },
  { section: 'recurring', key: 'cost_to_serve_cents', label: 'Cost to serve / mo', kind: 'money', auto: false },
  { section: 'recurring', key: 'customers', label: 'Customers', kind: 'count', auto: false },

  // Recurring — merch
  { section: 'recurring', key: 'cogs_cents', label: 'Unit COGS', kind: 'money', auto: false },
  { section: 'recurring', key: 'fulfilment_cents', label: 'Fulfilment + shipping', kind: 'money', auto: false },
  { section: 'recurring', key: 'member_buffer_pct', label: 'Member buffer', kind: 'pct', auto: false, defaultValue: 0.05,
    help: 'At dead-zero you personally absorb every misprint, return and lost parcel.' },

  // Readout rows with no revenue category yet (subject_id = readout row key hash)
  { section: 'readout', key: 'revenue_monthly_cents', label: 'Monthly revenue', kind: 'money', auto: true },
  { section: 'readout', key: 'direct_cost_monthly_cents', label: 'Monthly direct cost', kind: 'money', auto: true },
  { section: 'readout', key: 'expansion_capital_cents', label: 'Expansion capital deployed', kind: 'money', auto: false },
  { section: 'readout', key: 'runway_months', label: 'Months of runway in the bank', kind: 'count', auto: false },
];

const FIELD_INDEX = new Map(FIELDS.map(f => [`${f.section}:${f.key}`, f]));

export function getField(section, key) {
  return FIELD_INDEX.get(`${section}:${key}`) || null;
}

/** Field keys Recalculate is allowed to clear — the ones that can be re-derived. */
export function autoFieldKeys(section) {
  return FIELDS.filter(f => f.auto && (!section || f.section === section)).map(f => f.key);
}

// ─── Resolution: auto vs manual ────────────────────────────────────

/**
 * The one function every input on the page reads through, so the badge next to
 * a number can never disagree with the number.
 *
 *   auto     — no manual row; showing the derived value
 *   override — a manual row exists AND a derived value exists; yours wins
 *   manual   — a manual row exists and there is nothing to derive
 *   default  — nothing anywhere; showing the registry default
 *   empty    — nothing anywhere and no default. Needs you.
 */
export function resolveField({ section, key, subjectId = null, manualRows, autoValues }) {
  const field = getField(section, key);
  const manual = findManual(manualRows, section, key, subjectId);
  const autoValue = autoValues?.[autoKey(section, key, subjectId)];
  const hasAuto = autoValue !== undefined && autoValue !== null;
  const hasManual = manual && manual.value !== null && manual.value !== undefined;

  if (hasManual) {
    return {
      value: Number(manual.value),
      source: hasAuto ? 'override' : 'manual',
      autoValue: hasAuto ? autoValue : null,
      note: manual.note || null,
    };
  }
  if (hasAuto) return { value: autoValue, source: 'auto', autoValue, note: null };
  if (field?.defaultValue !== undefined) {
    return { value: field.defaultValue, source: 'default', autoValue: null, note: null };
  }
  return { value: null, source: 'empty', autoValue: null, note: null };
}

export function autoKey(section, key, subjectId) {
  return subjectId ? `${section}:${key}:${subjectId}` : `${section}:${key}`;
}

function findManual(rows, section, key, subjectId) {
  if (!rows) return null;
  return rows.find(r =>
    r.section === section && r.field_key === key &&
    (subjectId ? r.subject_id === subjectId : !r.subject_id)
  ) || null;
}

// ─── Period ────────────────────────────────────────────────────────
//
// Trailing 12 months, fixed. The page ignores Accounting's range selector on
// purpose: overhead is monthly, salaries are annual, hours-per-unit needs a
// sample, and a 30-day window makes all three swing on one slow month.

export function trailing12(todayStr) {
  const end = todayStr || fmtDate(new Date());
  const [y, m, d] = end.split('-').map(Number);
  // Step back a year by parts, clamping the day to the target month's length.
  // Date#setFullYear would overflow Feb 29 into Mar 1 and lose a day off the
  // front of the window; clamping to Feb 28 then adding one lands on Mar 1.
  const prevYear = y - 1;
  const day = Math.min(d, daysInMonth(prevYear, m));
  return { start: fmtDate(new Date(prevYear, m - 1, day + 1)), end };
}

function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ─── Aggregation over real rows ────────────────────────────────────

/** Split trailing-12 expenses into the model's cost classes. */
export function summarizeExpenses(rows, settings, businessFilter) {
  const totals = { overhead: 0, direct_labour: 0, direct_variable: 0, benefits: 0, excluded: 0, untagged: 0 };
  const byCategory = new Map();

  for (const r of rows || []) {
    if (!matchesBusiness(r, businessFilter)) continue;
    const cents = Math.abs(r.amount_cents || 0);
    const cls = classifyExpense(r.category, settings);
    totals[cls || 'untagged'] += cents;
    const prev = byCategory.get(r.category) || { category: r.category, cents: 0, classification: cls, count: 0 };
    prev.cents += cents;
    prev.count += 1;
    byCategory.set(r.category, prev);
  }

  return {
    totals,
    byCategory: [...byCategory.values()].sort((a, b) => b.cents - a.cents),
  };
}

/** Trailing-12 revenue keyed by readout row, plus the per-category detail the
 *  Readout needs to let a new Tiller category be mapped without a deploy. */
export function summarizeRevenue(rows, settings, businessFilter) {
  const byRow = {};
  const byCategory = new Map();
  let untagged = 0;
  for (const r of rows || []) {
    if (!matchesBusiness(r, businessFilter)) continue;
    const cents = r.amount_cents || 0;
    const bucket = bucketRevenue(r.category, settings);

    const prev = byCategory.get(r.category) || { category: r.category, cents: 0, count: 0, bucket };
    prev.cents += cents;
    prev.count += 1;
    byCategory.set(r.category, prev);

    if (!bucket) { untagged += cents; continue; }
    if (bucket === 'excluded') continue;
    byRow[bucket] = (byRow[bucket] || 0) + cents;
  }
  return {
    byRow,
    untagged,
    byCategory: [...byCategory.values()].sort((a, b) => b.cents - a.cents),
  };
}

function matchesBusiness(row, businessFilter) {
  if (!businessFilter || businessFilter === 'all') return true;
  return (row.business || 'mayday_media') === businessFilter;
}

// ─── Hours ─────────────────────────────────────────────────────────

/** Below this many reported units, an average is noise. The guide's rule. */
export const MIN_HOURS_SAMPLE = 10;

/** A product with no match_* set has nothing to derive from. */
export function hasHourMatching(product) {
  return Boolean(
    product.match_content_type || product.match_assignment_type ||
    product.match_sub_role || product.match_client_work !== null ||
    product.match_task_keyword
  );
}

export function matchesAssignment(product, a, profilesById) {
  if (product.match_content_type && a.content_type !== product.match_content_type) return false;
  if (product.match_assignment_type && a.assignment_type !== product.match_assignment_type) return false;
  if (product.match_sub_role) {
    const sub = profilesById?.[a.contractor_id]?.sub_role;
    if (sub !== product.match_sub_role) return false;
  }
  if (product.match_client_work !== null && product.match_client_work !== undefined) {
    const isClient = profilesById?.[a.created_by]?.role === 'client';
    if (Boolean(product.match_client_work) !== isClient) return false;
  }
  return true;
}

export function matchesTask(product, t) {
  if (!product.match_task_keyword) return false;
  return (t.title || '').toLowerCase().includes(product.match_task_keyword.toLowerCase());
}

/**
 * Measured hours per unit, per product, from anything that reported hours:
 * completed assignments and hour-reporting tasks alike.
 *
 * `rateCents` comes back as the average loaded rate of the people who actually
 * did the work — a better answer than the blended company rate, and one the
 * spreadsheet can't produce.
 */
export function aggregateProductHours({ products, assignments, tasks, profilesById, ratesByProfile, blendedRateCents }) {
  const out = {};
  for (const p of products) {
    if (p.bucket !== 'labour') continue;
    let hours = 0, units = 0;
    const rateSamples = [];

    if (hasHourMatching(p)) {
      for (const a of assignments || []) {
        if (!a.hours_spent) continue;
        if (!matchesAssignment(p, a, profilesById)) continue;
        hours += Number(a.hours_spent);
        units += 1;
        const rate = ratesByProfile?.[a.contractor_id];
        if (rate) rateSamples.push(rate);
      }
      for (const t of tasks || []) {
        if (!t.hours_spent) continue;
        if (!matchesTask(p, t)) continue;
        hours += Number(t.hours_spent);
        units += 1;
        const rate = ratesByProfile?.[t.assignee_id];
        if (rate) rateSamples.push(rate);
      }
    }

    const enough = units >= MIN_HOURS_SAMPLE;
    out[p.id] = {
      sampleSize: units,
      totalHours: hours,
      // Withheld below the sample floor: virality is noise and one job is not
      // a price. The UI shows "n=4 — not enough data" rather than a number.
      hoursPerUnit: enough && units ? hours / units : null,
      unitsPerYear: units || null,
      rateCents: rateSamples.length
        ? Math.round(rateSamples.reduce((s, r) => s + r, 0) / rateSamples.length)
        : (blendedRateCents ?? null),
    };
  }
  return out;
}

/** Reported hours that exist but landed on no product — the reality check. */
export function unmatchedHours({ products, assignments, tasks, profilesById }) {
  const matchable = products.filter(p => p.bucket === 'labour' && hasHourMatching(p));
  let total = 0, matched = 0;
  for (const a of assignments || []) {
    if (!a.hours_spent) continue;
    total += Number(a.hours_spent);
    if (matchable.some(p => matchesAssignment(p, a, profilesById))) matched += Number(a.hours_spent);
  }
  for (const t of tasks || []) {
    if (!t.hours_spent) continue;
    total += Number(t.hours_spent);
    if (matchable.some(p => matchesTask(p, t))) matched += Number(t.hours_spent);
  }
  return { total, matched, unmatched: total - matched };
}

// ─── Readout ───────────────────────────────────────────────────────

/**
 * The four numbers that actually say how you are doing. Blended gross margin is
 * deliberately last: it is a readout of your revenue mix, not a target. When it
 * moves, it is telling you the mix moved.
 */
export function computeReadout({ rows, monthlyOverheadCents, expansionCapitalCents }) {
  const sum = (pred, field) => rows.filter(pred).reduce((s, r) => s + (r[field] || 0), 0);
  const isLabour = r => r.bucket === 'labour';
  const isRecurring = r => r.bucket === 'recurring';

  const labourRev = sum(isLabour, 'revenueCents');
  const labourCost = sum(isLabour, 'costCents');
  const recurringRev = sum(isRecurring, 'revenueCents');
  const recurringCost = sum(isRecurring, 'costCents');

  const totalRev = labourRev + recurringRev;
  const totalCost = labourCost + recurringCost;
  const grossProfit = totalRev - totalCost;
  const operatingProfit = grossProfit - monthlyOverheadCents;

  return {
    labour:    { revenueCents: labourRev, costCents: labourCost, grossCents: labourRev - labourCost, margin: safeDiv(labourRev - labourCost, labourRev) },
    recurring: { revenueCents: recurringRev, costCents: recurringCost, grossCents: recurringRev - recurringCost, margin: safeDiv(recurringRev - recurringCost, recurringRev) },
    total:     { revenueCents: totalRev, costCents: totalCost, grossCents: grossProfit, margin: safeDiv(grossProfit, totalRev) },
    monthlyOverheadCents,
    operatingProfitCents: operatingProfit,
    operatingMargin: safeDiv(operatingProfit, totalRev),
    // THE key ratio. Past 100%, the fixed base is paid for by predictable
    // revenue — and only then is lowering labour margins a plan rather than
    // optimism.
    overheadCoverageByRecurring: safeDiv(recurringRev - recurringCost, monthlyOverheadCents),
    recurringShareOfRevenue: safeDiv(recurringRev, totalRev),
    monthsToRecoverExpansion: operatingProfit > 0 && expansionCapitalCents
      ? expansionCapitalCents / operatingProfit
      : null,
    profitNeededFor24Months: expansionCapitalCents ? Math.round(expansionCapitalCents / 24) : null,
  };
}

function safeDiv(a, b) {
  if (!b) return null;
  return a / b;
}

// ─── Variance banding ──────────────────────────────────────────────

/** At or above target, within 5 points, or below. Drives the row colour. */
export function marginBand(actual, target) {
  if (actual === null || actual === undefined || target === null) return 'none';
  if (actual >= target) return 'good';
  if (actual >= target - 0.05) return 'warn';
  return 'bad';
}

// ─── Formatting ────────────────────────────────────────────────────

export function fmtCents(cents, { decimals = 0 } = {}) {
  if (cents === null || cents === undefined || !isFinite(cents)) return '—';
  const v = cents / 100;
  const neg = v < 0;
  return `${neg ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })}`;
}

export function fmtPct(ratio, decimals = 1) {
  if (ratio === null || ratio === undefined || !isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(decimals)}%`;
}

export function fmtHours(h) {
  if (h === null || h === undefined || !isFinite(h)) return '—';
  return `${h.toFixed(h < 10 ? 2 : 1)}h`;
}

export function fmtNumber(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
