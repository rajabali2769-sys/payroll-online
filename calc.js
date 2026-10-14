// Pay maths. This mirrors the SQL view `v_payroll_lines` exactly (the database is the source of truth;
// this copy powers the import preview and the tests that prove it matches the old Excel).
export function calcLine(line, stream) {
  const weeks = line.weeks || [];
  const actual = weeks.reduce((s, w) => s + (+w.delivered || 0), 0);
  const leave = weeks.reduce((s, w) => s + (+w.leave || 0), 0);
  let over = 0, less = 0;
  const inc = new Map(); for (const a of line.adhoc || []) if (a.included) inc.set(a.date, (inc.get(a.date) || 0) + (+a.hours || 0));
  for (const w of weeks) {
    if (w.in_window === false) continue;
    const ai = inc.get(w.week_start) || 0;
    const v = w.variance_override != null ? +w.variance_override - (+w.leave || 0) - ai : (+w.delivered || 0) - ai - (+w.budget || 0);   // worked hours only — leave never counts against the budget
    if (v > 0) over += v; else if (v < 0) less += v;
  }
  const type = String(line.contract_type || '').toLowerCase();
  const rate = +line.hourly_rate || 0;
  const hourly = type === 'hourly' || type === 'cover' || type === 'agency' ? (actual + leave) * rate : 0;
  const fixed = line.fixed_pay === null || line.fixed_pay === undefined ? null : +line.fixed_pay;
  const gross = (fixed ?? 0) + hourly + (+line.addition || 0) + (+line.leave_pay || 0) - (+line.deduction || 0);
  const budgetHours = stream === 'monthly'
    ? (line.weeks_reconciled == null ? 0 : (+line.budgeted_hours || 0) * (+line.weeks_reconciled))
    : weeks.reduce((s, w) => s + (+w.budget || 0), 0);
  const adhoc = /ad[\s_-]*hoc/i.test(String(line.employee_name || ''));
  const budgeted = adhoc ? 0 : fixed !== null ? fixed : line.budget_override != null ? +line.budget_override : budgetHours * rate;
  return { actual, leave, over, less, hourly, gross, budget_hours: adhoc ? 0 : budgetHours, budgeted, diff: gross - ((type === 'hourly' || type === 'cover' || type === 'agency' ? leave * rate : 0) + (+line.leave_pay || 0)) - budgeted };
}
