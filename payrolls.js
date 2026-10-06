// All payrolls: the open (current) payrolls and the previous (locked) ones, for both monthly and fortnightly.
import { loadAllSummaries, onLive } from './api.js';
import { h, clear, money, dmy, ago, debounce, natCompare } from './ui.js';
import { ctx, openRuns, previousRuns, currentRuns, setRun } from './ctx.js';
import { go } from './app.js';

export async function render(root) {
  let sum = new Map(), stream = '', q = '';
  const host = h('div');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'All payrolls'), h('p', null, 'What is open right now, and what has been locked. Locked payrolls can still be viewed — nobody can change them.'))), host);
  async function load() {
    const rows = await loadAllSummaries().catch(() => []); sum = new Map();
    for (const r of rows) { const s = sum.get(r.run_id) || { gross: 0, lines: 0, over: 0, under: 0, budget: 0 }; s.gross += +r.gross || 0; s.lines += +r.lines || 0; s.over += +r.over_lines || 0; s.under += +r.under_lines || 0; s.budget += +r.budgeted || 0; sum.set(r.run_id, s); }
    draw();
  }
  const match = (r) => (!stream || r.stream === stream) && (!q || r.label.toLowerCase().includes(q));
  const who = (e) => (e ? e.split('@')[0] : '');
  const card = (r, prev) => {
    const s = sum.get(r.id) || { gross: 0, lines: 0, over: 0, under: 0, budget: 0 }, cur = currentRuns().some((c) => c.id === r.id);
    const used = s.budget > 0 ? Math.min(150, (s.gross / s.budget) * 100) : 0;
    const open = (page) => () => { setRun(r.id); go(page); };
    return h('div', { class: 'card pcard' + (prev ? ' prev' : '') },
      h('div', { class: 'row' }, h('span', { class: 'pill grp' }, r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'), cur ? h('span', { class: 'pill st-approved', style: { background: '#d9f5e8', color: '#0b7a4b' } }, 'Current') : null, h('span', { class: 'pill st-' + r.status }, { ready: 'Open — ready for review', approved: 'Approved', locked: 'Locked', importing: 'Importing' }[r.status] || r.status)),
      h('h3', { style: { margin: '10px 0 2px', fontSize: '16px' } }, r.label), h('div', { class: 'small muted' }, r.period_start ? `${dmy(r.period_start)} – ${dmy(r.period_end)}` : ''),
      h('div', { class: 'row', style: { gap: '22px', margin: '10px 0 2px' } }, h('div', null, h('b', { style: { fontSize: '19px' } }, money(s.gross)), h('div', { class: 'small muted' }, `gross · ${s.lines.toLocaleString()} lines`)), h('div', null, h('b', { class: s.over ? 'neg' : '' }, String(s.over)), h('div', { class: 'small muted' }, 'over budget'))),
      h('div', { class: 'pg' }, h('i', { style: { width: Math.min(100, used) + '%', background: used > 100 ? 'linear-gradient(90deg,#f59e0b,#e11d48)' : '' } })), h('div', { class: 'small muted', style: { marginTop: '3px' } }, s.budget ? `${Math.round(used)}% of budget used` : 'no budget set'),
      r.status === 'locked' ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, `🔒 Locked${r.locked_by_email ? ' by ' + who(r.locked_by_email) : ''}${r.locked_at ? ', ' + ago(r.locked_at) : ''}`) : r.status === 'approved' ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, `✓ Approved${r.approved_by_email ? ' by ' + who(r.approved_by_email) : ''}`) : null,
      h('div', { class: 'row wrap', style: { marginTop: '12px' } }, h('button', { class: 'btn sm primary', onClick: open('dashboard') }, 'Dashboard'), ctx.can('page:payroll') ? h('button', { class: 'btn sm', onClick: open('payroll') }, prev ? 'View payroll' : 'Payroll') : null,
        !prev && ctx.can('page:timesheets') ? h('button', { class: 'btn sm', onClick: open('timesheets') }, 'Timesheets') : null, ctx.can('page:journal') ? h('button', { class: 'btn sm', onClick: open('journal') }, 'Journal') : null));
  };
  function draw() {
    const open = openRuns().filter(match).sort((a, b) => String(b.period_end).localeCompare(String(a.period_end))), prev = previousRuns().filter(match).sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)));
    clear(host).append(
      h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, [['', 'All'], ['monthly', 'Monthly'], ['fortnightly', 'Fortnightly']].map(([k, t]) => h('button', { class: stream === k ? 'on' : '', onClick: () => { stream = k; draw(); } }, t))),
        h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', placeholder: 'Payroll name…', value: q, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) }))),
      h('h3', { style: { margin: '6px 0 10px' } }, `Open payrolls (${open.length})`), open.length ? h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', marginBottom: '22px' } }, open.map((r) => card(r, false))) : h('div', { class: 'card empty', style: { marginBottom: '22px' } }, 'No open payroll. Import a file or upload hours to start one.'),
      h('h3', { style: { margin: '6px 0 10px' } }, `Previous payrolls — locked (${prev.length})`), prev.length ? h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))' } }, prev.map((r) => card(r, true))) : h('div', { class: 'card empty' }, 'Nothing locked yet. Once a payroll is approved and locked it moves here.'));
  }
  await load();
  return onLive(debounce((e) => { if (e.table === 'pay_runs') draw(); }, 400));
}
