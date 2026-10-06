// The building blocks of the dashboard, so each person (and each role) can choose what to see and in what order.
export const WIDGETS = [
  { id: 'hero', title: 'Pay run banner', desc: 'Big gross-pay number, budget ring and the Approve / Lock buttons' },
  { id: 'checklist', title: 'Payroll checklist', desc: 'The 7 steps from timesheets to lock, with counters' },
  { id: 'kpis', title: 'Key figures', desc: 'Gross, budget, difference, people, hours, over/under, leave & SSP' },
  { id: 'donuts', title: 'Hours & cost donuts', desc: 'Where the hours went, and cost by pay date' },
  { id: 'escalations', title: 'Projects over budget', desc: 'With the one-click Escalate button' },
  { id: 'missing', title: 'Missing timesheets', desc: 'People with a budget but no hours yet' },
  { id: 'chart', title: 'Budget vs actual chart', desc: 'By pay date, project or week' },
  { id: 'table', title: 'By pay date table', desc: 'Sortable table of each pay date' },
  { id: 'attention', title: 'Worth a look & biggest differences', desc: 'Things to check and the largest over / underspends' },
];
// userPref = {order:[ids], hidden:[ids]} (this person's own choice) | roleDefault = {hidden:[ids]} (set by the super admin)
export function resolveLayout(userPref, roleDefault) {
  const all = WIDGETS.map((w) => w.id), order = [...((userPref && userPref.order) || []).filter((id) => all.includes(id)), ...all.filter((id) => !((userPref && userPref.order) || []).includes(id))];
  const hidden = new Set((userPref && userPref.hidden) || (roleDefault && roleDefault.hidden) || []);
  return order.filter((id) => !hidden.has(id));
}
