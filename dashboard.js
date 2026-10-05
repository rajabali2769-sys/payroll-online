import { loadRuns, loadSummary, loadPeriods, sb, onLive, deleteRun } from './api.js';
import { h, clear, money, hrs, dm, dmy, debounce, natCompare, confirmBox, toast, icon } from './ui.js';
import { ctx, currentRun, runPicker } from './ctx.js';
import { go } from './app.js';

export async function render(root) {
  if (!ctx.runs.length) {
    root.append(h('div', { class: 'card empty' }, h('h2', { style: { color: '#14222b', margin: '0 0 6px' } }, 'No payroll data yet'),
      h('p', null, ctx.canEdit ? 'Import your monthly or fortnightly Excel file to get started.' : 'An editor needs to import the first file.'),
      ctx.canEdit ? h('a', { class: 'btn primary', href: '#/import' }, icon('upload'), 'Import a file') : null));
    return;
  }
  const body = h('div');
  const head = h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Dashboard'), h('p', null, 'Where this pay run stands against budget, by pay date.')),
    runPicker(() => load()));
  root.append(head, body);

  async function load() {
    const run = currentRun();
    const [summary, periods, worst, best] = await Promise.all([
      loadSummary(run.id), loadPeriods(run.id),
      sb.from('v_payroll_lines').select('id,employee_name,project_name,pay_group,gross_pay,budgeted_pay,difference').eq('run_id', run.id).order('difference', { ascending: false }).limit(8),
      sb.from('v_payroll_lines').select('id,employee_name,project_name,pay_group,gross_pay,budgeted_pay,difference').eq('run_id', run.id).order('difference', { ascending: true }).limit(8),
    ]);
    const sum = (k) => summary.reduce((s, r) => s + (+r[k] || 0), 0);
    const gross = sum('gross'), bud = sum('budgeted'), diff = sum('difference');
    const win = new Map(periods.map((p) => [p.pay_group, p]));
    const maxGross = Math.max(1, ...summary.map((r) => +r.gross));
    clear(body).append(
      h('div', { class: 'grid kpis' },
        kpi('Gross pay', money(gross), `${sum('lines').toLocaleString()} lines`),
        kpi('Budgeted pay', money(bud), 'from weekly budgets / fixed pay'),
        kpi('Difference', money(diff), diff > 0 ? 'over budget' : diff < 0 ? 'under budget' : 'on budget', diff > 0.5 ? 'neg' : diff < -0.5 ? 'pos' : ''),
        kpi('Hours worked', hrs(sum('actual_hours')).replace(/\B(?=(\d{3})+(?!\d))/g, ','), 'delivered, excl. leave'),
        kpi('Over budget', String(sum('over_lines')), 'lines to review', sum('over_lines') ? 'neg' : ''),
        kpi('Under budget', String(sum('under_lines')), 'lines to review')),
      h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('div', { class: 'tablewrap auto', style: { border: 0, boxShadow: 'none' } }, h('table', { class: 't' },
          h('thead', null, h('tr', null, ['Pay date', 'Reconciliation window', 'Lines', 'Hours', 'Gross pay', 'Budgeted', 'Difference', 'Over', 'Under', 'Share of gross', ''].map((t, i) => h('th', { class: i > 1 && i < 9 ? 'num' : '' }, t)))),
          h('tbody', null, [...summary].sort((a, b) => natCompare(a.pay_group, b.pay_group)).map((r) => {
            const p = win.get(r.pay_group);
            return h('tr', null,
              h('td', null, h('span', { class: 'pill grp' }, r.pay_group)),
              h('td', { class: 'muted' }, p && p.reconcile_from ? `${dm(p.reconcile_from)} – ${dmy(p.reconcile_to)}` : h('a', { href: '#/calendar' }, 'set window')),
              h('td', { class: 'num' }, r.lines), h('td', { class: 'num' }, hrs(r.actual_hours)), h('td', { class: 'num' }, money(r.gross)), h('td', { class: 'num' }, money(r.budgeted)),
              h('td', { class: 'num ' + (+r.difference > 0.5 ? 'neg' : +r.difference < -0.5 ? 'pos' : '') }, money(r.difference)),
              h('td', { class: 'num' }, r.over_lines || ''), h('td', { class: 'num' }, r.under_lines || ''),
              h('td', null, h('div', { class: 'bar' }, h('i', { style: { width: (100 * +r.gross / maxGross) + '%' } }))),
              h('td', null, h('a', { class: 'btn sm', href: '#/payroll?group=' + encodeURIComponent(r.pay_group) }, 'Open')));
          })))),
      ),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(380px,1fr))' } },
        listCard('Largest overspends', worst.data, 'Over'), listCard('Largest underspends', best.data, 'Under')),
      ctx.isAdmin ? h('div', { style: { marginTop: '22px' } }, h('button', { class: 'btn danger sm', onClick: async () => {
        if (await confirmBox('Delete this pay run?', `"${run.label}" and all of its lines will be permanently removed for every user.`, 'Delete run', true)) {
          try { await deleteRun(run.id); ctx.runs = await loadRuns(); toast('Run deleted', 'ok'); go('dashboard'); location.reload(); } catch (e) { toast(e.message, 'err'); }
        } } }, icon('trash'), 'Delete this run')) : null);
  }
  const kpi = (l, v, s, cls) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 's' }, s));
  const listCard = (title, rows, kind) => h('div', { class: 'card pad' }, h('h3', null, title),
    !rows.length || Math.abs(+rows[0].difference) < 0.5 ? h('div', { class: 'muted' }, 'Nothing to show') :
    h('table', { class: 't' }, h('tbody', null, rows.filter((r) => kind === 'Over' ? +r.difference > 0.5 : +r.difference < -0.5).map((r) => h('tr', null,
      h('td', null, h('a', { href: '#/payroll?q=' + encodeURIComponent(r.employee_name) }, r.employee_name), h('div', { class: 'small muted' }, r.project_name)),
      h('td', null, h('span', { class: 'pill grp' }, r.pay_group || '—')),
      h('td', { class: 'num ' + (kind === 'Over' ? 'neg' : 'pos') }, money(r.difference)))))));

  await load();
  const off = onLive(debounce(() => load().catch(() => {}), 900));
  return off;
}
