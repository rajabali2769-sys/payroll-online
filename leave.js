// Leave & SSP: every leave record in this pay run, by type (paid / unpaid / SSP).
import { loadRunLeave, onLive, deleteLeave } from './api.js';
import { h, clear, money, hrs, dmy, debounce, natCompare, toast, downloadCSV, icon, donut } from './ui.js';
import { ctx, currentRun, runPicker, runEditable, payRules } from './ctx.js';
import { openLineDrawer } from './line-drawer.js';
import { leaveRequestsPanel, bulkLeaveButton } from './leaveadmin.js';

export async function render(root) {
  const run = currentRun();
  const reqHost = h('div', { style: { marginBottom: '14px' } });
  let reqPanel = null;
  leaveRequestsPanel({ onChange: () => { if (run) loadRunLeave(run.id).then((r) => { rows = r; draw(); }).catch(() => {}); } }).then((p) => { reqPanel = p; reqHost.append(p); }).catch((e) => reqHost.append(h('div', { class: 'notice err' }, e.message)));
  if (!run) { root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Leave & SSP'))), reqHost, h('div', { class: 'card empty' }, 'Open or create a payroll to record leave on it.')); return () => reqPanel && reqPanel.stop && reqPanel.stop(); }
  let rows = [], type = '', q = '';
  const host = h('div');
  const bulkHost = h('span');
  if (runEditable(run.id)) bulkLeaveButton(run, () => loadRunLeave(run.id).then((r) => { rows = r; draw(); })).then((b) => bulkHost.append(b));
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Leave & SSP'), h('p', null, 'Leave requests from the My Pay app, and every leave / SSP day in this payroll. Upload many at once with “Upload leave & SSP”.')), h('div', { class: 'row wrap' }, bulkHost, runPicker(() => location.reload()))), reqHost, host);

  function draw() {
    const rules = payRules(), perDay = rules.ssp_weekly_rate / rules.ssp_days;
    const shown = rows.filter((r) => (!type || r.type_code === type) && (!q || [r.employee_name, r.project_name, r.site_name].some((x) => x && x.toLowerCase().includes(q))));
    const byType = new Map(); for (const r of rows) { const t = byType.get(r.type_code) || { name: r.type_name, color: r.color, n: 0, hours: 0, pay: 0, paid: r.paid, ssp: r.ssp }; t.n++; t.hours += +r.hours || 0; t.pay += r.ssp ? (r.amount ?? perDay) : 0; byType.set(r.type_code, t); }
    const sspTotal = rows.filter((r) => r.ssp).reduce((s, r) => s + (r.amount ?? perDay), 0);
    clear(host).append(
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(380px,1fr))', marginBottom: '14px' } },
        h('div', { class: 'card pad' }, h('h3', null, 'Leave by type'), h('div', { class: 'chartrow' },
          donut([...byType.values()].map((t) => ({ label: t.name, value: t.n, color: t.color || '#6c5ce7' })), { size: 150, thick: 22, center: String(rows.length), sub: 'days' }),
          h('div', { class: 'legend-list' }, [...byType.entries()].map(([code, t]) => h('div', { class: 'li click', onClick: () => { type = type === code ? '' : code; draw(); } }, h('i', { class: 'sw', style: { background: t.color } }), t.name, h('b', null, String(t.n))))))),
        h('div', { class: 'card pad' }, h('h3', null, 'SSP at a glance'),
          h('div', { class: 'big', style: { fontSize: '28px', fontWeight: 800 } }, money(sspTotal)),
          h('div', { class: 'small muted' }, `${rows.filter((r) => r.ssp).length} SSP days · default ${money(perDay)} a day (£${rules.ssp_weekly_rate} a week ÷ ${rules.ssp_days}) · change it in Settings`),
          h('div', { class: 'notice warn', style: { marginTop: '10px' } }, 'From 6 April 2026 SSP is paid from day one at the lower of £123.25 a week or 80% of average weekly earnings. For part-time or low-paid staff enter the reduced amount on the day (✎) after checking their average earnings.'))),
      h('div', { class: 'toolbar' }, h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', placeholder: 'Employee, project…', value: q, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) })),
        h('label', { class: 'fld' }, 'Type', h('select', { onChange: (e) => { type = e.target.value; draw(); } }, h('option', { value: '' }, 'All types'), ctx.leaveTypes.map((t) => h('option', { value: t.code, selected: t.code === type }, t.name)))),
        h('div', { class: 'grow' }), h('button', { class: 'btn', onClick: () => downloadCSV(`leave_${run.label.replace(/\W+/g, '_')}.csv`, [['Employee', 'NI', 'Project', 'Site', 'Date', 'Type', 'Paid', 'SSP', 'Hours', 'Amount'], ...shown.map((r) => [r.employee_name, r.ni_number || '', r.project_name, r.site_name || '', r.leave_date, r.type_name, r.paid ? 'Yes' : 'No', r.ssp ? 'Yes' : 'No', r.hours, r.ssp ? (r.amount ?? perDay) : ''])]) }, icon('download'), 'Export CSV')),
      shown.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['Date', 'Employee', 'Project', 'Type', 'Hours', 'Amount', 'Note', ''].map((t, i) => h('th', { class: i === 4 || i === 5 ? 'num' : '' }, t)))),
        h('tbody', null, shown.map((r) => h('tr', null, h('td', null, dmy(r.leave_date)), h('td', null, h('a', { href: '#', onClick: (e) => { e.preventDefault(); openLineDrawer(r.line_id, { onChange: () => {} }); } }, r.employee_name)),
          h('td', { class: 'muted' }, [r.project_name, r.site_name].filter(Boolean).join(' · ')), h('td', null, h('span', { class: 'tag', style: { background: r.color || '#6c5ce7' } }, r.type_name)),
          h('td', { class: 'num' }, r.ssp ? '' : hrs(r.hours)), h('td', { class: 'num' }, r.ssp ? money(r.amount ?? perDay) : r.paid ? 'paid' : '£0.00'), h('td', { class: 'muted' }, r.note || ''),
          h('td', null, runEditable(run.id) ? h('button', { class: 'btn sm danger', onClick: async () => { try { await deleteLeave(r.id); rows = rows.filter((x) => x.id !== r.id); draw(); } catch (e) { toast(e.message, 'err'); } } }, '×') : null)))))) : h('div', { class: 'card empty' }, rows.length ? 'No leave matches.' : 'No leave recorded yet. Open an employee in Payroll and use “Leave & absence”.'));
  }
  async function load() { try { rows = await loadRunLeave(run.id); } catch (e) { rows = []; toast(e.message, 'err'); } draw(); }
  await load();
  const stopL = onLive(debounce((e) => { if (e.table === 'line_leave' || e.table === 'leave_types') load(); }, 600));
  return () => { stopL && stopL(); reqPanel && reqPanel.stop && reqPanel.stop(); };
}
