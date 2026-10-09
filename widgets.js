// The building blocks of the dashboard, so each person (and each role) can choose what to see and in what order.
export const WIDGETS = [
  { id: 'ov_head', title: 'Welcome & headline cards', desc: 'Payroll title, total payroll, hours over budget & ad-hoc, leave & sick pay' },
  { id: 'ov_activity', title: 'Payroll activities & profile card', desc: 'Everyone on this payroll with photos and status; click for their card' },
  { id: 'paycal', title: 'Pay calendar this month', desc: 'Every pay day: projects, windows, validation and disbursement dates, countdown' },
  { id: 'hero', title: 'Pay run banner', desc: 'Big gross-pay number, budget ring and the Approve / Lock buttons' },
  { id: 'checklist', title: 'Payroll checklist', desc: 'The 7 steps from timesheets to lock, with counters' },
  { id: 'kpis', title: 'Key figures', desc: 'Hours worked vs hours budget, over / under budget, gross, people, leave & SSP' },
  { id: 'board_top', title: 'Hours board', desc: 'Hours overview bars, latest day vs previous day, and leave & absences' },
  { id: 'board_bottom', title: 'Pay cycle board', desc: 'Week-by-week table (budget vs worked hours) and the hours-budget bars' },
  { id: 'compare', title: 'Compare pay cycles & projects', desc: 'Put several pay runs and projects side by side (hours or cost)' },
  { id: 'donuts', title: 'Hours & cost donuts', desc: 'Where the hours went, and cost by pay date' },
  { id: 'escalations', title: 'Projects over budget', desc: 'With the one-click Escalate button' },
  { id: 'missing', title: 'Missing timesheets', desc: 'People with a budget but no hours yet' },
  { id: 'chart', title: 'Hours budget vs hours worked chart', desc: 'By pay date, project or week' },
  { id: 'table', title: 'By pay date table', desc: 'Sortable table of each pay date' },
  { id: 'attention', title: 'Worth a look & biggest differences', desc: 'Things to check and the largest over / underspends' },
];
// userPref = {order:[ids], hidden:[ids]} (this person's own choice) | roleDefault = {hidden:[ids]} (set by the super admin)
export function resolveLayout(userPref, roleDefault) {
  const all = WIDGETS.map((w) => w.id), saved = ((userPref && userPref.order) || []).filter((id) => all.includes(id));
  const order = [...saved];
  all.forEach((id, i) => { if (!order.includes(id)) order.splice(Math.min(i, order.length), 0, id); });   // new widgets go in their standard place
  const hidden = new Set((userPref && userPref.hidden) || (roleDefault && roleDefault.hidden) || []);
  return order.filter((id) => !hidden.has(id));
}
