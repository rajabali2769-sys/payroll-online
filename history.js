import { loadAudit, onLive } from './api.js';
import { h, clear, ago, toast, debounce } from './ui.js';

const LABEL = { payroll_lines: 'Payroll line', line_weeks: 'Weekly hours', daily_hours: 'Daily hours', pay_runs: 'Pay run', pay_periods: 'Pay window', employees: 'Employee', projects: 'Project' };
export async function render(root) {
  let rows = [], table = '', done = false;
  const host = h('div'), more = h('button', { class: 'btn', onClick: () => load(true) }, 'Load older');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'History'), h('p', null, 'Who changed what, and when. Imports are logged as one entry.')),
    h('label', { class: 'fld' }, 'Show', h('select', { onChange: (e) => { table = e.target.value; load(false); } }, h('option', { value: '' }, 'Everything'), Object.entries(LABEL).map(([k, v]) => h('option', { value: k }, v))))), host, h('div', { style: { marginTop: '12px' } }, more));

  async function load(older) {
    try {
      const got = await loadAudit({ limit: 100, table: table || null, beforeId: older && rows.length ? rows[rows.length - 1].id : null });
      rows = older ? [...rows, ...got] : got; done = got.length < 100; draw();
    } catch (e) { toast(e.message, 'err'); }
  }
  const change = (a) => {
    const n = a.new_data || {}, o = a.old_data || {};
    const keys = Object.keys(a.action === 'DELETE' ? o : n).filter((k) => !['id', 'extra', 'created_at', 'updated_at', 'updated_by', 'run_id', 'line_id', 'employee_id', 'project_id'].includes(k)).slice(0, 6);
    if (!keys.length) return a.action === 'INSERT' ? 'created' : a.action === 'DELETE' ? 'deleted' : '';
    if (a.action === 'UPDATE') return keys.map((k) => h('div', null, h('span', { class: 'muted' }, k.replace(/_/g, ' ') + ': '), String(o[k] ?? '∅'), ' → ', h('b', null, String(n[k] ?? '∅'))));
    return keys.map((k) => `${k.replace(/_/g, ' ')}: ${(a.action === 'DELETE' ? o : n)[k] ?? ''}`).join(' · ');
  };
  function draw() {
    clear(host).append(rows.length ? h('div', { class: 'tablewrap auto' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['When', 'Who', 'What', 'Where', 'Change'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((a) => h('tr', null, h('td', { class: 'nowrap', title: new Date(a.at).toLocaleString('en-GB') }, ago(a.at)), h('td', null, (a.user_email || '—').split('@')[0]),
        h('td', null, h('span', { class: 'pill ' + (a.action === 'DELETE' ? 'over' : a.action.startsWith('IMPORT') ? 'flag' : 'grp') }, a.action.toLowerCase().replace('-', ' ')), ' ', LABEL[a.table_name] || a.table_name),
        h('td', null, a.context || ''), h('td', { style: { whiteSpace: 'normal', maxWidth: '420px' } }, change(a))))))) : h('div', { class: 'card empty' }, 'Nothing recorded yet.'));
    more.classList.toggle('hidden', done || !rows.length);
  }
  await load(false);
  return onLive(debounce(() => load(false), 1200));
}
