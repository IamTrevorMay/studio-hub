import {
  summarizeExpenses, summarizeRevenue, resolveField, autoKey,
  loadedAnnualCents, billableHours, loadedHourlyCents, overheadPerHourCents,
  unitCost, priceForMargin, listPriceFrom, marginOf, marginBand,
  aggregateProductHours, unmatchedHours, hasHourMatching,
  computeReadout, READOUT_ROWS, MIN_HOURS_SAMPLE,
} from '../../../lib/marginModel';

// Everything the Breakdown page derives from real rows, in one pure pass.
//
// Ordering matters and is not arbitrary: a person's loaded rate depends on
// manual utilisation, product hours depend on which people did the work, and
// overhead-per-hour depends on the whole roster's billable hours. So the pass
// resolves each layer before the layer above it can ask a question of it.
//
// Money is cents throughout (see marginModel.js).

const PERIODS_PER_YEAR = 24;  // semi-monthly payroll: 1st–15th, 16th–end

export function computeBreakdown({
  settings, people, products, inputs,
  expenses, revenue, assignments, tasks,
  profilesById, salaryRows, hourlyRateByProfile,
  business,
}) {
  const s = settings || {};
  const autoValues = {};
  const put = (section, key, subjectId, value) => {
    if (value === null || value === undefined || !isFinite(value)) return;
    autoValues[autoKey(section, key, subjectId)] = value;
  };
  const resolve = (section, key, subjectId) =>
    resolveField({ section, key, subjectId, manualRows: inputs, autoValues });

  // ── Layer 1: the expense pool ────────────────────────────────────
  const expenseSummary = summarizeExpenses(expenses, s, business);
  const revenueSummary = summarizeRevenue(revenue, s, business);
  put('overhead', 'overhead_annual_cents', null, expenseSummary.totals.overhead);

  // ── Layer 2: what an hour of each person costs ───────────────────
  // Reported hours per person over the window, used both to cost hourly people
  // and to check the utilisation assumption against reality.
  const reportedHoursByProfile = {};
  const addHours = (id, h) => {
    if (!id || !h) return;
    reportedHoursByProfile[id] = (reportedHoursByProfile[id] || 0) + Number(h);
  };
  for (const a of assignments || []) addHours(a.contractor_id, a.hours_spent);
  for (const t of tasks || []) addHours(t.assignee_id, t.hours_spent);

  const activeSalary = buildSalaryIndex(salaryRows);

  for (const p of people || []) {
    if (!p.profile_id) continue;
    const salary = activeSalary.annual[p.profile_id];
    if (salary) {
      put('labour', 'annual_salary_cents', p.id, salary);
      continue;
    }
    // No annual salary. If they are paid hourly, their annual cost is the rate
    // times the hours they actually reported — real data rather than a guess,
    // though it reads low for anyone who joined partway into the window.
    const rate = activeSalary.hourly[p.profile_id] ?? hourlyRateByProfile?.[p.profile_id];
    const hours = reportedHoursByProfile[p.profile_id];
    if (rate && hours) put('labour', 'annual_salary_cents', p.id, Math.round(rate * hours));
  }

  const peopleRows = (people || []).map(p => {
    const salary = resolve('labour', 'annual_salary_cents', p.id);
    const tax = resolve('labour', 'employer_tax_pct', p.id);
    const benefits = resolve('labour', 'benefits_annual_cents', p.id);
    const paidHours = resolve('labour', 'paid_hours', p.id);
    const utilisation = resolve('labour', 'utilisation', p.id);

    const loadedAnnual = loadedAnnualCents({
      salaryCents: salary.value || 0,
      employerTaxPct: tax.value || 0,
      benefitsCents: benefits.value || 0,
    });
    const billable = billableHours(paidHours.value || 0, utilisation.value || 0);
    const reported = p.profile_id ? (reportedHoursByProfile[p.profile_id] || 0) : 0;

    return {
      ...p,
      fields: { salary, tax, benefits, paidHours, utilisation },
      loadedAnnualCents: loadedAnnual,
      billableHours: billable,
      rateCents: loadedHourlyCents(loadedAnnual, billable),
      reportedHours: reported,
      // The workbook's quarter-close reality check, running continuously:
      // assumed billable hours vs. hours anyone actually reported.
      measuredUtilisation: paidHours.value ? reported / paidHours.value : null,
    };
  });

  const totalLoadedAnnual = peopleRows.reduce((sum, p) => sum + p.loadedAnnualCents, 0);
  const totalBillableHours = peopleRows.reduce((sum, p) => sum + p.billableHours, 0);
  const blendedRateCents = loadedHourlyCents(totalLoadedAnnual, totalBillableHours);

  const ratesByProfile = {};
  for (const p of peopleRows) {
    if (p.profile_id && p.rateCents) ratesByProfile[p.profile_id] = p.rateCents;
  }

  // ── Layer 3: overhead as a per-hour number ───────────────────────
  const overheadAnnual = resolve('overhead', 'overhead_annual_cents', null);
  const contingency = resolve('overhead', 'contingency_pct', null);
  const recovery = resolve('model', 'overhead_recovery_pct', null);

  const overheadWithContingency = Math.round((overheadAnnual.value || 0) * (1 + (contingency.value || 0)));
  const ohPerHourCents = overheadPerHourCents(overheadWithContingency, recovery.value ?? 0.8, totalBillableHours);
  const breakEvenHourlyCents = blendedRateCents !== null && ohPerHourCents !== null
    ? blendedRateCents + ohPerHourCents
    : null;

  // ── Layer 4: measured hours per product ──────────────────────────
  const hoursByProduct = aggregateProductHours({
    products: products || [], assignments, tasks, profilesById, ratesByProfile, blendedRateCents,
  });
  for (const [productId, h] of Object.entries(hoursByProduct)) {
    put('products', 'hours_per_unit', productId, h.hoursPerUnit);
    put('products', 'units_per_year', productId, h.unitsPerYear);
    put('products', 'rate_cents', productId, h.rateCents);
  }
  const hoursCheck = unmatchedHours({ products: products || [], assignments, tasks, profilesById });

  // ── Layer 5: price each product ──────────────────────────────────
  const labourProducts = (products || []).filter(p => p.bucket === 'labour');
  const recurringProducts = (products || []).filter(p => p.bucket === 'recurring');

  const productRows = labourProducts.map(p => {
    const hours = resolve('products', 'hours_per_unit', p.id);
    const units = resolve('products', 'units_per_year', p.id);
    const rate = resolve('products', 'rate_cents', p.id);
    const sample = hoursByProduct[p.id] || { sampleSize: 0 };

    const cost = unitCost({
      hoursPerUnit: hours.value,
      rateCents: rate.value,
      reworkPct: Number(p.rework_pct) || 0,
      ohPerHourCents: ohPerHourCents || 0,
    });

    const targetPriceCents = cost.fullyLoadedCents === null
      ? null
      : priceForMargin(cost.fullyLoadedCents, Number(p.target_margin));
    const listCents = listPriceFrom(targetPriceCents, Number(p.headroom_pct) || 0);
    const actualCents = p.actual_price_cents ?? null;
    const actualMargin = actualCents !== null && cost.fullyLoadedCents !== null
      ? marginOf(actualCents, cost.fullyLoadedCents)
      : null;
    const gapPerUnit = actualCents !== null && targetPriceCents !== null
      ? actualCents - targetPriceCents
      : null;

    return {
      product: p,
      fields: { hours, units, rate },
      sampleSize: sample.sampleSize,
      hasAutoHours: hasHourMatching(p),
      belowSampleFloor: sample.sampleSize > 0 && sample.sampleSize < MIN_HOURS_SAMPLE,
      ...cost,
      targetPriceCents,
      listCents,
      actualCents,
      actualMargin,
      band: marginBand(actualMargin, Number(p.target_margin)),
      gapPerUnitCents: gapPerUnit,
      gapAnnualCents: gapPerUnit !== null && units.value ? Math.round(gapPerUnit * units.value) : null,
      // Direct cost excludes the overhead slice: the readout subtracts fixed
      // overhead once, at company level. Counting it here as well would charge
      // for the building twice.
      annualDirectCostCents: cost.adjustedCents !== null && units.value
        ? Math.round(cost.adjustedCents * units.value)
        : null,
      annualRevenueCents: actualCents !== null && units.value
        ? Math.round(actualCents * units.value)
        : null,
    };
  });

  // ── Layer 6: the recurring products ──────────────────────────────
  const membershipRevenueAnnual = revenueSummary.byRow.recurring_membership ?? null;
  const recurringRows = recurringProducts.map(p => {
    const kind = p.recurring_kind;
    const f = {};
    let monthlyRevenueCents = null, monthlyCostCents = null, unitPriceCents = null, contributionCents = null;

    if (kind === 'membership') {
      put('recurring', 'membership_revenue_annual_cents', p.id, membershipRevenueAnnual);
      f.members = resolve('recurring', 'members', p.id);
      f.processing = resolve('recurring', 'processing_pct', p.id);
      f.merchCost = resolve('recurring', 'merch_cost_cents', p.id);
      f.otherCost = resolve('recurring', 'other_cost_cents', p.id);
      f.unitsPerMemberMonth = resolve('recurring', 'units_per_member_month', p.id);
      f.cannibalisation = resolve('recurring', 'cannibalisation_pct', p.id);
      f.revenueAnnual = resolve('recurring', 'membership_revenue_annual_cents', p.id);

      unitPriceCents = p.actual_price_cents ?? null;
      const costPerMember = unitPriceCents !== null
        ? Math.round(unitPriceCents * (f.processing.value || 0)) + (f.merchCost.value || 0) + (f.otherCost.value || 0)
        : null;
      contributionCents = unitPriceCents !== null && costPerMember !== null ? unitPriceCents - costPerMember : null;

      // Substack revenue is the truth when we have it; price x members is the
      // fallback for modelling a member count you have not reached yet.
      monthlyRevenueCents = f.revenueAnnual.value != null
        ? Math.round(f.revenueAnnual.value / 12)
        : (unitPriceCents !== null && f.members.value ? unitPriceCents * f.members.value : null);
      monthlyCostCents = costPerMember !== null && f.members.value ? costPerMember * f.members.value : null;
      f.costPerMemberCents = costPerMember;
    }

    if (kind === 'saas') {
      f.value = resolve('recurring', 'value_cents', p.id);
      f.pricePct = resolve('recurring', 'price_pct_of_value', p.id);
      f.costToServe = resolve('recurring', 'cost_to_serve_cents', p.id);
      f.customers = resolve('recurring', 'customers', p.id);

      unitPriceCents = p.actual_price_cents ?? (
        f.value.value != null && f.pricePct.value != null
          ? Math.round(f.value.value * f.pricePct.value)
          : null
      );
      contributionCents = unitPriceCents !== null ? unitPriceCents - (f.costToServe.value || 0) : null;
      monthlyRevenueCents = unitPriceCents !== null && f.customers.value ? unitPriceCents * f.customers.value : null;
      monthlyCostCents = f.customers.value ? (f.costToServe.value || 0) * f.customers.value : null;
    }

    if (kind === 'merch') {
      f.cogs = resolve('recurring', 'cogs_cents', p.id);
      f.fulfilment = resolve('recurring', 'fulfilment_cents', p.id);
      f.buffer = resolve('recurring', 'member_buffer_pct', p.id);

      const unitCostCents = (f.cogs.value || 0) + (f.fulfilment.value || 0);
      const memberPriceCents = Math.round(unitCostCents * (1 + (f.buffer.value || 0)));
      const publicPriceCents = priceForMargin(unitCostCents, Number(p.target_margin));
      f.unitCostCents = unitCostCents;
      f.memberPriceCents = memberPriceCents;
      f.publicPriceCents = publicPriceCents;
      f.marginGivenUpCents = publicPriceCents !== null ? publicPriceCents - memberPriceCents : null;
      unitPriceCents = memberPriceCents;
      contributionCents = memberPriceCents - unitCostCents;
    }

    return { product: p, kind, fields: f, unitPriceCents, contributionCents, monthlyRevenueCents, monthlyCostCents };
  });

  // The workbook reconciles the membership's merch-discount assumption against
  // the merch table so the two cannot quietly drift apart.
  const membershipRow = recurringRows.find(r => r.kind === 'membership');
  const merchRows = recurringRows.filter(r => r.kind === 'merch');
  const impliedMerchCostCents = (() => {
    if (!membershipRow || !merchRows.length) return null;
    const avgGivenUp = merchRows.reduce((sum, r) => sum + (r.fields.marginGivenUpCents || 0), 0) / merchRows.length;
    const units = membershipRow.fields.unitsPerMemberMonth?.value;
    const cann = membershipRow.fields.cannibalisation?.value;
    if (units == null || cann == null) return null;
    return Math.round(avgGivenUp * units * cann);
  })();

  // ── Layer 7: the readout ─────────────────────────────────────────
  const readoutRows = READOUT_ROWS.map(row => {
    const tillerAnnual = revenueSummary.byRow[row.key] ?? null;

    const labourForRow = productRows.filter(r => r.product.readout_row === row.key);
    const recurringForRow = recurringRows.filter(r => r.product.readout_row === row.key);

    const modelledAnnualRevenue = labourForRow.reduce(
      (sum, r) => sum + (r.annualRevenueCents || 0), 0)
      + recurringForRow.reduce((sum, r) => sum + (r.monthlyRevenueCents || 0) * 12, 0);
    const modelledAnnualCost = labourForRow.reduce(
      (sum, r) => sum + (r.annualDirectCostCents || 0), 0)
      + recurringForRow.reduce((sum, r) => sum + (r.monthlyCostCents || 0) * 12, 0);

    // Booked revenue beats modelled revenue: Tiller is what happened, the
    // product model is what should happen. Rows with no Tiller category
    // (tracers, instruction, SaaS) fall back to price x units.
    const revenueMonthly = tillerAnnual != null
      ? Math.round(tillerAnnual / 12)
      : (modelledAnnualRevenue ? Math.round(modelledAnnualRevenue / 12) : null);
    const costMonthly = modelledAnnualCost ? Math.round(modelledAnnualCost / 12) : null;

    put('readout', 'revenue_monthly_cents', row.key, revenueMonthly);
    put('readout', 'direct_cost_monthly_cents', row.key, costMonthly);

    const revenueField = resolve('readout', 'revenue_monthly_cents', row.key);
    const costField = resolve('readout', 'direct_cost_monthly_cents', row.key);

    return {
      ...row,
      revenueField,
      costField,
      revenueSource: tillerAnnual != null ? 'tiller' : (modelledAnnualRevenue ? 'model' : 'none'),
      revenueCents: revenueField.value || 0,
      costCents: costField.value || 0,
      grossCents: (revenueField.value || 0) - (costField.value || 0),
    };
  });

  const monthlyOverheadCents = Math.round(overheadWithContingency / 12);
  const expansionCapital = resolve('readout', 'expansion_capital_cents', null);
  const runwayMonths = resolve('readout', 'runway_months', null);

  const readout = computeReadout({
    rows: readoutRows,
    monthlyOverheadCents,
    expansionCapitalCents: expansionCapital.value || 0,
  });

  return {
    autoValues,
    expenseSummary,
    revenueSummary,
    peopleRows,
    productRows,
    recurringRows,
    readoutRows,
    readout,
    hoursCheck,
    impliedMerchCostCents,
    fields: { overheadAnnual, contingency, recovery, expansionCapital, runwayMonths },
    totals: {
      totalLoadedAnnual,
      totalBillableHours,
      blendedRateCents,
      overheadAnnualCents: overheadWithContingency,
      monthlyOverheadCents,
      ohPerHourCents,
      breakEvenHourlyCents,
    },
  };
}

/**
 * Latest un-ended salary row per profile, split into an annual figure and an
 * hourly rate.
 *
 * salary_type carries three meanings and they are not interchangeable:
 * `yearly` is already annual, `per_period` is paid on the semi-monthly cycle
 * Payroll uses (1st–15th, 16th–end, so 24 a year), and `hourly` is cents per
 * hour — annualising that one by 24 would report a $50/hr person as earning
 * $1,200 a year.
 */
function buildSalaryIndex(salaryRows) {
  const byProfile = {};
  for (const row of salaryRows || []) {
    if (row.ended_at) continue;
    const prev = byProfile[row.profile_id];
    if (prev && prev.effective_date >= row.effective_date) continue;
    byProfile[row.profile_id] = row;
  }
  const annual = {};
  const hourly = {};
  for (const [profileId, row] of Object.entries(byProfile)) {
    if (row.salary_type === 'hourly') hourly[profileId] = row.amount_cents;
    else if (row.salary_type === 'yearly') annual[profileId] = row.amount_cents;
    else annual[profileId] = row.amount_cents * PERIODS_PER_YEAR;
  }
  return { annual, hourly };
}
