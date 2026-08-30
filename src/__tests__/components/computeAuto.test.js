import { computeBreakdown } from '../../components/accounting/breakdown/computeAuto';

// End-to-end pass over the Breakdown model: real-shaped rows in, priced
// products and a company readout out. The unit tests in lib/marginModel cover
// each formula; this covers the wiring between them, which is where the
// interesting mistakes live — double-counted salaries, overhead charged twice,
// an override that fails to propagate.

// Figures are the live trailing-12 shape, rounded: ~$210k of Employees,
// ~$239k of genuine overhead, YouTube and Substack revenue.
const expenses = [
  { category: 'Employees',              amount_cents: -21000000, business: 'mayday_media' },
  { category: 'Contractors',            amount_cents:   -338750, business: 'mayday_media' },
  { category: 'Medical',                amount_cents:    -95119, business: 'mayday_media' },
  { category: 'Rent & Utilities',       amount_cents:  -8738522, business: 'mayday_media' },
  { category: 'Equipment',              amount_cents: -11465065, business: 'neptune_performance' },
  { category: 'Admin Subscriptions',    amount_cents:  -1557100, business: 'mayday_media' },
  { category: 'Insurance',              amount_cents:   -508560, business: 'mayday_media' },
  { category: 'R&D/Production',         amount_cents:  -2896798, business: 'mayday_media' },
];

const revenue = [
  { category: 'YouTube Income',     amount_cents: 8021745, business: 'mayday_media' },
  { category: 'Sponsorship Income', amount_cents: 4773182, business: 'mayday_media' },
  { category: 'Substack Income',    amount_cents:  375199, business: 'mayday_media' },
  { category: 'Merch Income',       amount_cents:  104408, business: 'mayday_media' },
  { category: 'Interest',           amount_cents:   42322, business: 'mayday_media' },
];

const profilesById = {
  alana: { id: 'alana', full_name: 'Alana', role: 'contractor', sub_role: 'Long Form Editor' },
  staff: { id: 'staff', full_name: 'Staff', role: 'admin' },
};

const people = [{ id: 'person-alana', profile_id: 'alana', label: 'Alana', position: 1 }];

const salaryRows = [
  { profile_id: 'alana', salary_type: 'yearly', amount_cents: 6500000, effective_date: '2026-01-01', ended_at: null },
];

const products = [
  {
    id: 'lf', name: 'YouTube long-form video', bucket: 'labour', readout_row: 'labour_content',
    unit_label: 'per video', target_margin: 0.28, rework_pct: 0.15, headroom_pct: 0,
    actual_price_cents: null, match_content_type: 'video', match_assignment_type: null,
    match_sub_role: 'Long Form Editor', match_client_work: false, match_task_keyword: null,
  },
];

const assignments = Array.from({ length: 12 }, (_, i) => ({
  id: `a${i}`, contractor_id: 'alana', created_by: 'staff',
  content_type: 'video', assignment_type: 'edit', hours_spent: 22, completed_at: '2026-05-01T00:00:00Z',
}));

function build(overrides = {}) {
  return computeBreakdown({
    settings: {}, people, products, inputs: [],
    expenses, revenue, assignments, tasks: [],
    profilesById, salaryRows, hourlyRateByProfile: {},
    business: 'all',
    ...overrides,
  });
}

describe('the overhead pool', () => {
  const model = build();

  test('salaries and contractors are kept out of it', () => {
    // Rent + Equipment + Admin Subs + Insurance. Employees, Contractors,
    // Medical and R&D all land elsewhere.
    expect(model.expenseSummary.totals.overhead).toBe(8738522 + 11465065 + 1557100 + 508560);
    expect(model.expenseSummary.totals.direct_labour).toBe(21000000 + 338750);
    expect(model.expenseSummary.totals.benefits).toBe(95119);
    expect(model.expenseSummary.totals.direct_variable).toBe(2896798);
  });

  test('retagging Employees as overhead grows the pool by exactly that much, proving it was not already in there', () => {
    const retagged = build({ settings: { category_map: { Employees: 'overhead' } } });
    expect(retagged.expenseSummary.totals.overhead)
      .toBe(model.expenseSummary.totals.overhead + 21000000);
    expect(retagged.expenseSummary.totals.direct_labour).toBe(338750); // Contractors only
  });

  test('contingency is applied on top of the pool', () => {
    // Default contingency is 5%.
    const pool = model.expenseSummary.totals.overhead;
    expect(model.totals.overheadAnnualCents).toBe(Math.round(pool * 1.05));
  });

  test('the business filter reaches the overhead pool', () => {
    const neptune = build({ business: 'neptune_performance' });
    expect(neptune.expenseSummary.totals.overhead).toBe(11465065); // Equipment only
  });
});

describe('labour rates', () => {
  const model = build();
  const alana = model.peopleRows[0];

  test('an annual salary loads up with tax and benefits and divides by billable hours', () => {
    expect(alana.loadedAnnualCents).toBe(Math.round(6500000 * 1.12)); // no benefits entered
    expect(alana.billableHours).toBeCloseTo(1248, 4);                 // 2080 * 0.6
    expect(alana.rateCents).toBe(Math.round(alana.loadedAnnualCents / 1248));
  });

  test('an hourly payroll row is not annualised as if it were per-period', () => {
    const hourly = build({
      salaryRows: [{ profile_id: 'alana', salary_type: 'hourly', amount_cents: 5000, effective_date: '2026-01-01', ended_at: null }],
    });
    // 12 assignments x 22h = 264 reported hours at $50/hr = $13,200 — not
    // $50 x 24 pay periods.
    expect(hourly.peopleRows[0].fields.salary.value).toBe(5000 * 264);
  });

  test('reported hours are measured against the assumed utilisation', () => {
    expect(alana.reportedHours).toBe(264);
    expect(alana.measuredUtilisation).toBeCloseTo(264 / 2080, 4);
  });
});

describe('product pricing', () => {
  const model = build();
  const row = model.productRows[0];

  test('hours come from matching assignments once the sample is big enough', () => {
    expect(row.sampleSize).toBe(12);
    expect(row.fields.hours.value).toBe(22);
    expect(row.fields.hours.source).toBe('auto');
  });

  test('the rate used is the person who actually did the work', () => {
    expect(row.fields.rate.value).toBe(model.peopleRows[0].rateCents);
  });

  test('the cost stack carries overhead and rework', () => {
    expect(row.overheadCents).toBeGreaterThan(0);
    expect(row.fullyLoadedCents).toBe(row.adjustedCents + row.overheadCents);
  });

  test('the target price hits the target margin exactly', () => {
    const achieved = (row.targetPriceCents - row.fullyLoadedCents) / row.targetPriceCents;
    expect(achieved).toBeCloseTo(0.28, 4);
  });

  test('headroom lists below the target price without changing the target', () => {
    const withHeadroom = build({
      products: [{ ...products[0], headroom_pct: 0.15 }],
    }).productRows[0];
    expect(withHeadroom.targetPriceCents).toBe(row.targetPriceCents);
    expect(withHeadroom.listCents).toBe(Math.round(row.targetPriceCents * 0.85));
  });

  test('an actual price below target reads as a negative gap, and bands red', () => {
    const cheap = build({
      products: [{ ...products[0], actual_price_cents: Math.round(row.targetPriceCents * 0.7) }],
    }).productRows[0];
    expect(cheap.gapPerUnitCents).toBeLessThan(0);
    expect(cheap.band).toBe('bad');
    expect(cheap.gapAnnualCents).toBe(Math.round(cheap.gapPerUnitCents * 12));
  });

  test('a manual override beats the measured hours and repriced the product', () => {
    const overridden = build({
      inputs: [{ section: 'products', field_key: 'hours_per_unit', subject_id: 'lf', value: 30 }],
    }).productRows[0];
    expect(overridden.fields.hours).toMatchObject({ value: 30, source: 'override', autoValue: 22 });
    expect(overridden.fullyLoadedCents).toBeGreaterThan(row.fullyLoadedCents);
  });

  test('utilisation propagates all the way to the price', () => {
    // Lower utilisation → fewer billable hours → higher loaded rate AND higher
    // overhead per hour → a more expensive product. This is the interlock that
    // makes patching one field in local state wrong.
    const tight = build({
      inputs: [{ section: 'labour', field_key: 'utilisation', subject_id: 'person-alana', value: 0.4 }],
    }).productRows[0];
    expect(tight.targetPriceCents).toBeGreaterThan(row.targetPriceCents);
  });
});

describe('the readout', () => {
  const model = build();

  test('booked Tiller revenue fills the content row', () => {
    const content = model.readoutRows.find(r => r.key === 'labour_content');
    expect(content.revenueSource).toBe('tiller');
    expect(content.revenueCents).toBe(Math.round((8021745 + 4773182) / 12));
  });

  test('Substack lands in recurring, not content', () => {
    const membership = model.readoutRows.find(r => r.key === 'recurring_membership');
    expect(membership.revenueCents).toBe(Math.round(375199 / 12));
    expect(model.readout.recurring.revenueCents).toBeGreaterThan(0);
  });

  test('rows with no revenue category and no product read as having no source', () => {
    const saas = model.readoutRows.find(r => r.key === 'recurring_saas');
    expect(saas.revenueSource).toBe('none');
    expect(saas.revenueCents).toBe(0);
  });

  test('interest is excluded rather than counted as content revenue', () => {
    const total = model.readoutRows.reduce((s, r) => s + r.revenueCents, 0);
    expect(total).toBe(Math.round((8021745 + 4773182) / 12) + Math.round(375199 / 12) + Math.round(104408 / 12));
  });

  test('overhead is subtracted once, at company level, not per product', () => {
    expect(model.readout.operatingProfitCents)
      .toBe(model.readout.total.grossCents - model.totals.monthlyOverheadCents);
  });

  test('a product direct cost excludes the overhead already charged company-wide', () => {
    const priced = build({ products: [{ ...products[0], actual_price_cents: 50000 }] });
    const row = priced.productRows[0];
    expect(row.annualDirectCostCents).toBe(row.adjustedCents * 12);
  });
});

describe('unmatched hours', () => {
  test('hours that land on no product are surfaced rather than dropped', () => {
    const model = build({
      tasks: [{ id: 't1', title: 'Something else entirely', assignee_id: 'alana', hours_spent: 40, completed_at: '2026-05-01T00:00:00Z' }],
    });
    expect(model.hoursCheck.total).toBe(264 + 40);
    expect(model.hoursCheck.unmatched).toBe(40);
  });
});
