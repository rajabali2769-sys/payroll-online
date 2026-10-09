// The top of the dashboard: greeting, three headline cards, the payroll activity list with photos, and the profile card.
import { loadStaff } from './api.js';
import { h, clear, money, hrs, icon, natCompare, debounce } from './ui.js';
import { ctx } from './ctx.js';
import { avatar } from './photos.js';
import { profileCard } from './profilecard.js';
import { openProfile } from './profile.js';
import { openLineDrawer } from './line-drawer.js';

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? 0 : +v);
let staffCache = null, staffAt = 0;

export function overview({ run, lines, periods, adhoc, onReload, state, picker, parts = ['head', 'main'] }) {
  const host = h('div', { class: 'ov' });
  const st = Object.assign(state || {}, { group: '', status: '', q: '', sel: null, ...(state || {}) });
  const payDateOf = (g) => (periods.find((p) => p.pay_group === g) || {}).pay_date || null;
  const runState = run.status === 'locked' ? ['Paid', 'paid'] : run.status === 'approved' ? ['Approved', 'appr'] : ['Pending', 'pend'];
  let staffById = new Map();

  const meName = (ctx.me && (ctx.me.full_name || String(ctx.me.email || '').split('@')[0])) || 'there';
  const first = String(meName).split(/[\s._]+/)[0].replace(/^./, (c) => c.toUpperCase());
  const gross = lines.reduce((s, l) => s + num(l.gross_pay), 0), people = new Set(lines.map((l) => l.employee_id || l.employee_name)).size;
  const overH = lines.reduce((s, l) => s + Math.max(0, num(l.hours_difference)), 0), overN = lines.filter((l) => l.budget_status === 'Over').length;
  const adhocH = (adhoc || []).reduce((s, a) => s + num(a.hours), 0) || lines.reduce((s, l) => s + num(l.adhoc_hours), 0);
  const ssp = lines.reduce((s, l) => s + num(l.ssp_pay), 0), leaveH = lines.reduce((s, l) => s + num(l.leave_hours), 0), onLeave = lines.filter((l) => num(l.leave_hours) > 0 || num(l.ssp_days) > 0).length;

  const card = (cls, ic, label, value, sub) => h('div', { class: 'ovk ' + cls }, h('div', { class: 'row', style: { gap: '10px' } }, h('span', { class: 'ovk-ic' }, icon(ic)), h('div', null, h('div', { class: 'ovk-l' }, label), h('div', { class: 'ovk-v' }, value))), h('div', { class: 'ovk-s' }, sub));
  const tableHost = h('div', { class: 'ov-tw' }), cardHost = h('div', { class: 'ov-card' });
  const groups = [...new Set(lines.map((l) => l.pay_group || 'Unassigned'))].sort(natCompare);
  const statusOf = (l) => (l.budget_status === 'Over' ? ['Over budget', 'over'] : runState);
  const rows = () => lines.filter((l) => (!st.group || (l.pay_group || 'Unassigned') === st.group) && (!st.status || statusOf(l)[1] === st.status) && (!st.q || [l.employee_name, l.project_name, l.ni_number].some((x) => x && x.toLowerCase().includes(st.q))))
    .sort((a, b) => natCompare(a.employee_name, b.employee_name));

  function drawCard() {
    const l = lines.find((x) => x.id === st.sel) || null, e = l && l.employee_id ? staffById.get(l.employee_id) : null;
    clear(cardHost).append(profileCard(e, { line: l, payDate: l ? payDateOf(l.pay_group) : null,
      onOpen: e ? () => openProfile(e.id, { onChange: () => onReload && onReload() }) : l ? () => openLineDrawer(l.id, { onChange: () => onReload && onReload() }) : null,
      onHistory: e ? () => openProfile(e.id, { tab: 'pay' }) : null, onPhoto: () => { drawTable(); drawCard(); } }));
  }
  function drawTable() {
    const list = rows();
    if (!st.sel && list.length) st.sel = list[0].id;
    clear(tableHost).append(h('table', { class: 't ovt' }, h('thead', null, h('tr', null, ['Employee name', 'Position', 'Project', 'Pay date', 'Hours', 'Gross pay', 'Status'].map((t, i) => h('th', { class: i === 4 || i === 5 ? 'num' : '' }, t)))),
      h('tbody', null, list.slice(0, 600).map((l) => { const e = l.employee_id ? staffById.get(l.employee_id) : null, [st1, sc] = statusOf(l);
        return h('tr', { class: 'click' + (st.sel === l.id ? ' sel' : ''), onClick: () => { st.sel = l.id; tableHost.querySelectorAll('tr.sel').forEach((r) => r.classList.remove('sel')); tableHost.querySelector(`tr[data-id="${l.id}"]`)?.classList.add('sel'); drawCard(); }, onDblclick: () => openLineDrawer(l.id, { onChange: () => onReload && onReload() }), 'data-id': l.id },
          h('td', null, h('div', { class: 'who' }, avatar(e || { full_name: l.employee_name }, 'sm'), h('b', null, l.employee_name))), h('td', { class: 'small' }, (e && e.job_title) || (l.contract_type || '')), h('td', { class: 'small' }, l.project_name),
          h('td', { class: 'small' }, l.pay_group || '—'), h('td', { class: 'num' }, hrs(l.actual_hours)), h('td', { class: 'num' }, money(l.gross_pay)), h('td', null, h('span', { class: 'spill ' + sc }, st1))); }))),
      list.length > 600 ? h('div', { class: 'small muted', style: { padding: '8px' } }, `Showing 600 of ${list.length} — use the filters or search.`) : null, !list.length ? h('div', { class: 'small muted', style: { padding: '16px' } }, 'Nobody matches.') : null);
  }

  host.append(
    parts.includes('head') ? h('div', { class: 'ov-headwrap' }, h('div', { class: 'ov-head' },
      h('div', null, h('div', { class: 'ov-hi' }, `Welcome back, ${first} 👋`), h('h1', { class: 'ov-title' }, `Payroll - ${run.label}`)), picker ? h('div', { class: 'ov-pick' }, picker) : null,
      h('div', { class: 'grow' }),
      h('button', { class: 'ov-search', onClick: () => import('./search.js').then((m) => m.quickSearch()) }, icon('search'), h('span', null, 'Search now'), h('kbd', null, 'Ctrl K')),
      h('a', { class: 'ov-bell', href: '#/payroll', title: `${overN} line(s) over budget` }, icon('alert'), overN ? h('i', null, String(overN)) : null),
      h('span', { class: 'avatar sm', title: ctx.me ? ctx.me.email : '' }, String(first).slice(0, 2).toUpperCase())),
    h('div', { class: 'ov-kpis' },
      card('k1', 'pound', 'Total payroll processed', money(gross), `${people} employee${people === 1 ? '' : 's'} on this payroll · ${runState[0].toLowerCase()}`),
      card('k2', 'trend', 'Hours over budget & ad-hoc', `${hrs(overH)} h`, `${overN} line${overN === 1 ? '' : 's'} over budget · ${hrs(adhocH)} ad-hoc hours charged to clients`),
      card('k3', 'cal', 'Leave & sick pay', money(ssp), `${hrs(leaveH)} h paid leave · ${onLeave} employee${onLeave === 1 ? '' : 's'} on leave or sick`))) : null,
    parts.includes('main') ? h('div', { class: 'ov-main' },
      h('div', { class: 'ov-list' },
        h('div', { class: 'ov-lh' }, h('div', null, h('b', null, 'Payroll activities'), h('div', { class: 'small muted' }, 'Every employee on this payroll — click a row to see their details, double-click to open the line')), h('div', { class: 'grow' }),
          h('input', { type: 'search', class: 'ov-q', placeholder: 'Find…', value: st.q, onInput: debounce((ev) => { st.q = ev.target.value.toLowerCase(); st.sel = null; drawTable(); drawCard(); }, 150) }),
          h('select', { class: 'ov-chip', title: 'Pay date', onChange: (ev) => { st.group = ev.target.value; st.sel = null; drawTable(); drawCard(); } }, h('option', { value: '' }, 'All pay dates'), groups.map((g) => h('option', { value: g, selected: st.group === g }, g))),
          h('select', { class: 'ov-chip', title: 'Status', onChange: (ev) => { st.status = ev.target.value; st.sel = null; drawTable(); drawCard(); } }, h('option', { value: '' }, 'All statuses'), [['pend', 'Pending'], ['appr', 'Approved'], ['paid', 'Paid'], ['over', 'Over budget']].map(([v, t]) => h('option', { value: v, selected: st.status === v }, t))),
          ctx.canEdit ? h('a', { class: 'ov-plus', href: '#/payroll', title: 'Open the payroll to add a line' }, '+') : null),
        tableHost),
      cardHost) : null);
  drawTable(); drawCard();
  // photos and job titles come from the employee records
  (async () => { try { if (!staffCache || Date.now() - staffAt > 120000) { staffCache = await loadStaff(); staffAt = Date.now(); } staffById = new Map(staffCache.map((e) => [e.id, e])); drawTable(); drawCard(); } catch { /* no access to employees */ } })();
  return host;
}
