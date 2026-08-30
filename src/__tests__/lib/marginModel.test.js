import {
  priceForMargin, marginOf, listPriceFrom,
  loadedAnnualCents, billableHours, loadedHourlyCents, overheadPerHourCents, unitCost,
  classifyExpense, bucketRevenue, summarizeExpenses, summarizeRevenue,
  resolveField, autoFieldKeys,
  aggregateProductHours, unmatchedHours, hasHourMatching, MIN_HOURS_SAMPLE,
  computeReadout, marginBand, trailing12,
} from '../../lib/marginModel';

// The Breakdown model. These cover the places where being quietly wrong is
// easy and expensive: margin-vs-markup, double-counting salaries into the
// overhead pool, and pricing off a sample too small to mean anything.

describe('margin is not markup', () => {
  test('$100 at a 30% margin is $142.86, not $130', () => {
    expect(priceForMargin(10000, 0.30)).toBe(14286);
  });

  test('marking up by 30% only achieves a 23% margin', () => {
    const markedUp = 13000;
    expect(marginOf(markedUp, 10000)).toBeCloseTo(0.2308, 4);
  });

  test('price and margin round-trip', () => {
    const price = priceForMargin(45000, 0.28);
    expect(marginOf(price, 45000)).toBeCloseTo(0.28, 4);
  });

  test('margin divides by price, never by cost', () => {
    // (150 - 100) / 150 = 33.3%, not (150 - 100) / 100 = 50%
    expect(marginOf(15000, 10000)).toBeCloseTo(0.3333, 4);
  });

  test('a 100% margin is undefined rather than infinite', () => {
    expect(priceForMargin(10000, 1)).toBeNull();
  });

  test('margin of a zero price is null, not a divide-by-zero', () => {
    expect(marginOf(0, 10000)).toBeNull();
  });
});

describe('headroom', () => {
  test('15% headroom on a $100 target lists at $85', () => {
    expect(listPriceFrom(10000, 0.15)).toBe(8500);
  });

  test('no headroom leaves the target price alone', () => {
    expect(listPriceFrom(10000, 0)).toBe(10000);
  });
});

describe('loaded labour cost', () => {
  test('salary understates a person by roughly a third', () => {
    const loaded = loadedAnnualCents({ salaryCents: 6500000, employerTaxPct: 0.12, benefitsCents: 400000 });
    expect(loaded).toBe(7680000); // 65k * 1.12 + 4k = 76.8k
  });

  test('utilisation, not paid hours, sets the billable base', () => {
    expect(billableHours(2080, 0.6)).toBe(1248);
  });

  test('an 80% utilisation fantasy makes the hourly rate too low', () => {
    const loaded = loadedAnnualCents({ salaryCents: 6500000, employerTaxPct: 0.12, benefitsCents: 400000 });
    const realistic = loadedHourlyCents(loaded, billableHours(2080, 0.6));
    const fantasy = loadedHourlyCents(loaded, billableHours(2080, 0.8));
    expect(fantasy).toBeLessThan(realistic);
    expect(realistic - fantasy).toBeGreaterThan(1000); // over $10/hr of silent error
  });

  test('zero billable hours yields null rather than Infinity', () => {
    expect(loadedHourlyCents(7680000, 0)).toBeNull();
    expect(overheadPerHourCents(12000000, 0.8, 0)).toBeNull();
  });
});

describe('overhead per hour', () => {
  test('the recovery lever scales what each hour carries', () => {
    expect(overheadPerHourCents(12000000, 0.8, 1248)).toBe(7692);
    expect(overheadPerHourCents(12000000, 1.0, 1248)).toBe(9615);
  });
});

describe('unit cost stack', () => {
  const stack = unitCost({ hoursPerUnit: 22, rateCents: 6154, reworkPct: 0.15, ohPerHourCents: 7692 });

  test('rework applies to labour and to the overhead it drags along', () => {
    expect(stack.directCents).toBe(135388);
    expect(stack.adjustedCents).toBe(155696);
    expect(stack.overheadCents).toBe(194608); // 22 * 1.15 * 7692
    expect(stack.fullyLoadedCents).toBe(350304);
  });

  test('missing hours yields nulls, not zeros — an unknown is not free', () => {
    expect(unitCost({ hoursPerUnit: null, rateCents: 6154 }).fullyLoadedCents).toBeNull();
    expect(unitCost({ hoursPerUnit: 22, rateCents: null }).fullyLoadedCents).toBeNull();
  });
});

describe('expense classification', () => {
  test('salaries and contractors are labour, never overhead', () => {
    // The double-count trap: these are priced per hour on the Labour tab, so
    // adding them to the overhead pool charges for every person twice.
    expect(classifyExpense('Employees')).toBe('direct_labour');
    expect(classifyExpense('Contractors')).toBe('direct_labour');
  });

  test('medical is a benefit, which belongs to a loaded rate', () => {
    expect(classifyExpense('Medical')).toBe('benefits');
  });

  test('rent and subscriptions are the overhead pool', () => {
    expect(classifyExpense('Rent & Utilities')).toBe('overhead');
    expect(classifyExpense('Creative Subscriptions')).toBe('overhead');
  });

  test('a settings override beats the seeded default', () => {
    expect(classifyExpense('Travel', { category_map: { Travel: 'overhead' } })).toBe('overhead');
  });

  test('an unrecognised category is untagged, not silently binned', () => {
    expect(classifyExpense('Some New Tiller Category')).toBeNull();
  });

  test('untagged dollars are counted so nothing hides', () => {
    const { totals } = summarizeExpenses([
      { category: 'Rent & Utilities', amount_cents: -100000 },
      { category: 'Employees', amount_cents: -500000 },
      { category: 'Brand New Thing', amount_cents: -7000 },
    ]);
    expect(totals.overhead).toBe(100000);
    expect(totals.direct_labour).toBe(500000);
    expect(totals.untagged).toBe(7000);
  });

  test('expense sign is normalised — Tiller writes them negative', () => {
    const { totals } = summarizeExpenses([{ category: 'Insurance', amount_cents: -25000 }]);
    expect(totals.overhead).toBe(25000);
  });

  test('the business filter excludes the other company', () => {
    const rows = [
      { category: 'Insurance', amount_cents: -10000, business: 'mayday_media' },
      { category: 'Insurance', amount_cents: -30000, business: 'neptune_performance' },
    ];
    expect(summarizeExpenses(rows, null, 'neptune_performance').totals.overhead).toBe(30000);
    expect(summarizeExpenses(rows, null, 'all').totals.overhead).toBe(40000);
  });

  test('rows predating the business split default to Mayday Media', () => {
    const rows = [{ category: 'Insurance', amount_cents: -10000 }];
    expect(summarizeExpenses(rows, null, 'mayday_media').totals.overhead).toBe(10000);
  });
});

describe('revenue buckets', () => {
  test('Substack is the membership, so it counts as recurring', () => {
    expect(bucketRevenue('Substack Income')).toBe('recurring_membership');
  });

  test('platform and sponsor income is content labour', () => {
    expect(bucketRevenue('YouTube Income')).toBe('labour_content');
    expect(bucketRevenue('Sponsorship Income')).toBe('labour_content');
  });

  test('interest and reimbursements stay out of the model', () => {
    const { byRow } = summarizeRevenue([
      { category: 'Interest', amount_cents: 5000 },
      { category: 'YouTube Income', amount_cents: 120000 },
    ]);
    expect(byRow.labour_content).toBe(120000);
    expect(byRow.excluded).toBeUndefined();
  });

  test('revenue with no mapped category surfaces as untagged', () => {
    const { untagged } = summarizeRevenue([{ category: 'Lesson Income', amount_cents: 40000 }]);
    expect(untagged).toBe(40000);
  });

  test('per-category detail carries the effective bucket, so a new Tiller category can be mapped in the UI', () => {
    const { byCategory } = summarizeRevenue([
      { category: 'YouTube Income', amount_cents: 120000 },
      { category: 'Lesson Income', amount_cents: 40000 },
      { category: 'Lesson Income', amount_cents: 10000 },
    ]);
    const lessons = byCategory.find(c => c.category === 'Lesson Income');
    expect(lessons).toMatchObject({ cents: 50000, count: 2, bucket: null });
    expect(byCategory[0].category).toBe('YouTube Income'); // sorted by size
  });

  test('a settings override remaps a revenue category without a code change', () => {
    const settings = { revenue_map: { 'Lesson Income': 'labour_instruction' } };
    const { byRow, untagged } = summarizeRevenue([{ category: 'Lesson Income', amount_cents: 40000 }], settings);
    expect(byRow.labour_instruction).toBe(40000);
    expect(untagged).toBe(0);
  });
});

describe('auto vs manual resolution', () => {
  const args = { section: 'labour', key: 'utilisation', subjectId: 'p1' };

  test('auto wins when nothing was typed', () => {
    const r = resolveField({ ...args, manualRows: [], autoValues: { 'labour:utilisation:p1': 0.72 } });
    expect(r).toMatchObject({ value: 0.72, source: 'auto' });
  });

  test('a typed value overrides auto and keeps the auto value visible', () => {
    const r = resolveField({
      ...args,
      manualRows: [{ section: 'labour', field_key: 'utilisation', subject_id: 'p1', value: 0.6 }],
      autoValues: { 'labour:utilisation:p1': 0.72 },
    });
    expect(r).toMatchObject({ value: 0.6, source: 'override', autoValue: 0.72 });
  });

  test('a typed value with no auto source reads as manual, not override', () => {
    const r = resolveField({
      ...args,
      manualRows: [{ section: 'labour', field_key: 'utilisation', subject_id: 'p1', value: 0.6 }],
      autoValues: {},
    });
    expect(r.source).toBe('manual');
  });

  test('the registry default fills in when there is nothing else', () => {
    const r = resolveField({ ...args, manualRows: [], autoValues: {} });
    expect(r).toMatchObject({ value: 0.6, source: 'default' });
  });

  test('a field with no default and no data is empty, not zero', () => {
    const r = resolveField({ section: 'recurring', key: 'members', manualRows: [], autoValues: {} });
    expect(r).toMatchObject({ value: null, source: 'empty' });
  });

  test('manual rows for one subject do not leak to another', () => {
    const rows = [{ section: 'labour', field_key: 'utilisation', subject_id: 'p1', value: 0.6 }];
    const r = resolveField({ ...args, subjectId: 'p2', manualRows: rows, autoValues: {} });
    expect(r.source).toBe('default');
  });

  test('Recalculate only clears fields that can be re-derived', () => {
    const clearable = autoFieldKeys('recurring');
    // Membership assumptions have no auto source — nothing could put them back.
    expect(clearable).not.toContain('members');
    expect(clearable).not.toContain('value_cents');
    expect(clearable).toContain('membership_revenue_annual_cents');
  });
});

describe('measured hours', () => {
  const profilesById = {
    alana: { sub_role: 'Long Form Editor', role: 'contractor' },
    aaron: { sub_role: 'Short Form Editor', role: 'contractor' },
    clientCo: { role: 'client' },
    staff: { role: 'admin' },
  };
  const longForm = {
    id: 'lf', bucket: 'labour', match_content_type: 'video',
    match_sub_role: 'Long Form Editor', match_client_work: false,
  };

  const assignments = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
    id: `a${i}`, contractor_id: 'alana', created_by: 'staff',
    content_type: 'video', assignment_type: 'edit', hours_spent: 20 + i, ...over,
  }));

  test('a product with no match rules has nothing to derive', () => {
    expect(hasHourMatching({ match_content_type: null, match_client_work: null })).toBe(false);
    expect(hasHourMatching(longForm)).toBe(true);
  });

  test('hours are withheld below the sample floor', () => {
    const out = aggregateProductHours({
      products: [longForm], assignments: assignments(MIN_HOURS_SAMPLE - 1), tasks: [], profilesById,
    });
    expect(out.lf.sampleSize).toBe(9);
    expect(out.lf.hoursPerUnit).toBeNull(); // "n=9 — not enough data"
  });

  test('at the sample floor the average is reported', () => {
    const out = aggregateProductHours({
      products: [longForm], assignments: assignments(MIN_HOURS_SAMPLE), tasks: [], profilesById,
    });
    expect(out.lf.sampleSize).toBe(10);
    expect(out.lf.hoursPerUnit).toBeCloseTo(24.5, 4);
  });

  test('sub_role separates long-form from short-form work', () => {
    const mixed = [...assignments(10), ...assignments(10, { contractor_id: 'aaron' })];
    const out = aggregateProductHours({ products: [longForm], assignments: mixed, tasks: [], profilesById });
    expect(out.lf.sampleSize).toBe(10);
  });

  test('client-created assignments are excluded from internal content', () => {
    const mixed = [...assignments(10), ...assignments(5, { created_by: 'clientCo' })];
    const out = aggregateProductHours({ products: [longForm], assignments: mixed, tasks: [], profilesById });
    expect(out.lf.sampleSize).toBe(10);
  });

  test('hour-reporting tasks count toward a product that matches on title', () => {
    const p = { id: 'tr', bucket: 'labour', match_task_keyword: 'tracer', match_client_work: null };
    const tasks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, title: `Golf Tracer ${i}`, hours_spent: 0.5, assignee_id: 'alana' }));
    const out = aggregateProductHours({ products: [p], assignments: [], tasks, profilesById });
    expect(out.tr.sampleSize).toBe(10);
    expect(out.tr.hoursPerUnit).toBeCloseTo(0.5, 4);
  });

  test('assignments with no reported hours are not counted as zero-hour units', () => {
    const withNulls = [...assignments(10), { contractor_id: 'alana', created_by: 'staff', content_type: 'video', hours_spent: null }];
    const out = aggregateProductHours({ products: [longForm], assignments: withNulls, tasks: [], profilesById });
    expect(out.lf.sampleSize).toBe(10);
  });

  test('the rate is the average of who actually did the work', () => {
    const out = aggregateProductHours({
      products: [longForm], assignments: assignments(10), tasks: [], profilesById,
      ratesByProfile: { alana: 6000 }, blendedRateCents: 9999,
    });
    expect(out.lf.rateCents).toBe(6000);
  });

  test('with nobody matched it falls back to the blended rate', () => {
    const out = aggregateProductHours({
      products: [longForm], assignments: [], tasks: [], profilesById,
      ratesByProfile: {}, blendedRateCents: 9999,
    });
    expect(out.lf.rateCents).toBe(9999);
  });

  test('recurring products are skipped entirely', () => {
    const out = aggregateProductHours({ products: [{ id: 'm', bucket: 'recurring' }], assignments: [], tasks: [], profilesById });
    expect(out.m).toBeUndefined();
  });

  test('reported hours landing on no product are surfaced, not lost', () => {
    const stray = [...assignments(10), ...assignments(4, { contractor_id: 'aaron' })];
    const { total, matched, unmatched } = unmatchedHours({ products: [longForm], assignments: stray, tasks: [], profilesById });
    expect(total).toBeGreaterThan(matched);
    expect(unmatched).toBe(total - matched);
  });
});

describe('readout', () => {
  const rows = [
    { bucket: 'labour', revenueCents: 1000000, costCents: 720000 },
    { bucket: 'recurring', revenueCents: 500000, costCents: 100000 },
  ];

  test('operating profit subtracts fixed overhead once, at company level', () => {
    const r = computeReadout({ rows, monthlyOverheadCents: 300000, expansionCapitalCents: 0 });
    expect(r.total.grossCents).toBe(680000);
    expect(r.operatingProfitCents).toBe(380000);
  });

  test('blended margin is arithmetic on the mix, not a target', () => {
    const r = computeReadout({ rows, monthlyOverheadCents: 300000 });
    expect(r.total.margin).toBeCloseTo(0.4533, 4);
    expect(r.labour.margin).toBeCloseTo(0.28, 4);
    expect(r.recurring.margin).toBeCloseTo(0.80, 4);
  });

  test('overhead coverage by recurring is the ratio that unlocks lower margins', () => {
    const r = computeReadout({ rows, monthlyOverheadCents: 400000 });
    expect(r.overheadCoverageByRecurring).toBeCloseTo(1.0, 4); // 400k gross / 400k overhead
  });

  test('recovery months are null at a loss, not a negative timeline', () => {
    const r = computeReadout({ rows, monthlyOverheadCents: 900000, expansionCapitalCents: 5000000 });
    expect(r.operatingProfitCents).toBeLessThan(0);
    expect(r.monthsToRecoverExpansion).toBeNull();
  });

  test('zero revenue yields null margins rather than NaN', () => {
    const r = computeReadout({ rows: [], monthlyOverheadCents: 300000 });
    expect(r.total.margin).toBeNull();
    expect(r.operatingMargin).toBeNull();
  });
});

describe('variance banding', () => {
  test('at or above target is good, within five points warns, below is bad', () => {
    expect(marginBand(0.30, 0.28)).toBe('good');
    expect(marginBand(0.28, 0.28)).toBe('good');
    expect(marginBand(0.25, 0.28)).toBe('warn');
    expect(marginBand(0.20, 0.28)).toBe('bad');
  });

  test('an unknown actual margin has no band', () => {
    expect(marginBand(null, 0.28)).toBe('none');
  });
});

describe('trailing 12 months', () => {
  test('spans a year ending today', () => {
    const { start, end } = trailing12('2026-08-30');
    expect(end).toBe('2026-08-30');
    expect(start).toBe('2025-08-31');
  });

  test('handles a leap-year boundary without drifting', () => {
    const { start } = trailing12('2024-02-29');
    expect(start).toBe('2023-03-01');
  });
});
