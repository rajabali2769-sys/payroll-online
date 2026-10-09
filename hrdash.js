// HR dashboard: the people side at a glance — headcount, starters & leavers, right to work, HR cases, warnings, covers, leave, who is on site.
// Every section can be shown / hidden and put in order (Customise), folded, or opened full screen.
import { loadStaff, loadCases, loadAssignments, loadAlBalances, loadOpenClockIns, loadProjects, savePref, saveSetting, loadSettings, onLive } from './api.js';
import { h, clear, toast, modal, icon, dmy, hrs, debounce, donut, natCompare } from './ui.js';
import { ctx } from './ctx.js';
import { panel as section, expandAllBtn } from './panels.js';
import { avatar } from './photos.js';
import { openProfile } from './profile.js';
import { openCase } from './hrcase.js';
import { statusChip, typeChip, rtwChip, rtwState, isCover, stageChip, sevChip, today, alCalc, stageName, STAGES } from './hrkit.js';
import { waButton } from './whatsapp.js';

export const HR_WIDGETS = [
  { id: 'kpis', title: 'Headline figures', desc: 'Headcount, permanent / cover, suspended, starters & leavers, RTW, cases, warnings' },
  { id: 'mix', title: 'Workforce mix', desc: 'Status donut, permanent vs cover, headcount by project' },
  { id: 'movers', title: 'Starters & leavers', desc: 'Who joined and left this month and last month, new starters waiting for payroll' },
  { id: 'rtw', title: 'Right to work', desc: 'Expired, due within 30 / 90 days, missing dates' },
  { id: 'cases', title: 'HR cases', desc: 'Open cases by stage, overdue cases, newest cases' },
  { id: 'warnings', title: 'Live warnings', desc: 'Everyone with a live verbal / written warning and when it ends' },
  { id: 'covers', title: 'Covers', desc: 'Covers working now and who they are covering' },
  { id: 'leave', title: 'Annual leave', desc: 'Leave left by project, people over their entitlement, most leave left' },
  { id: 'onsite', title: 'On site now', desc: 'Who is clocked in right now (clock in / out app)' },
  { id: 'managers', title: 'Area managers', desc: 'Headcount, open cases and RTW issues for each area manager' },
];
const layout = (pref, def) => { const all = HR_WIDGETS.map((w) => w.id), order = [...((pref && pref.order) || []).filter((i) => all.includes(i))]; all.forEach((id, i) => { if (!order.includes(id)) order.splice(Math.min(i, order.length), 0, id); }); const hid = new Set((pref && pref.hidden) || (def && def.hidden) || []); return order.filter((i) => !hid.has(i)); };
const ym = (d) => String(d || '').slice(0, 7);

export async function render(root) {
  const seeCases = ctx.can('page:hrcases');
  let S = { staff: [], cases: [], assigns: [], al: new Map(), onsite: [], projects: [], proj: '' };
  const body = h('div', { class: 'hrstack' });
  const projSel = h('select', { class: 'fsel', onChange: (e) => { S.proj = e.target.value; paint(); } });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'HR dashboard'), h('p', null, 'Your people at a glance. Click anything to open it; use Customise to choose what you see.')),
    h('div', { class: 'row wrap' }, projSel, h('button', { class: 'btn sm', onClick: customise }, icon('gear'), 'Customise'), expandAllBtn(() => body))), body);

  const roleDef = () => (ctx.settings.hrdash_defaults || {})[ctx.me.role];
  const base = () => S.staff.filter((e) => !S.proj || e.default_project === S.proj);
  const open = (e) => openProfile(e.id, { onChange: () => load() });
  const person = (e, right) => h('button', { class: 'mini', onClick: () => open(e) }, avatar(e, 'sm'), h('span', { class: 'grow' }, h('b', null, e.full_name), h('span', { class: 'small muted' }, ` · ${e.employee_code || ''} · ${e.default_project || ''}`)), right || null);
  const card = (title, ...kids) => h('div', { class: 'card pad side-card' }, h('h3', null, title), ...kids);
  const bars = (rows, max) => h('div', { class: 'cmp' }, rows.map(([label, a, b, onClick]) => h('div', { class: 'cmprow', onClick, style: onClick ? { cursor: 'pointer' } : null }, h('div', { class: 'lab', title: label }, label), h('div', { class: 'cmpbar stack2' }, h('i', { class: 'b-perm', style: { width: (a / max * 100) + '%' } }), h('i', { class: 'b-cover', style: { width: (b / max * 100) + '%' } }), h('span', null, `${a + b}`)))));

  const W = {
    kpis: () => {
      const all = base(), act = all.filter((e) => e.emp_status !== 'terminated'), m = ym(today());
      const tiles = [['kc-teal', 'Headcount', act.length, 'users', '#/staff'], ['kc-blue', 'Permanent', act.filter((e) => !isCover(e)).length, 'users', '#/staff'], ['kc-violet', 'Temp / cover', act.filter(isCover).length, 'users', '#/staff'],
        ['kc-amber', 'Suspended', all.filter((e) => e.emp_status === 'suspended').length, 'lock', '#/staff'], ['kc-green', 'Starters this month', all.filter((e) => ym(e.hire_date) === m).length, 'plus', '#/recruit'], ['kc-slate', 'Leavers this month', all.filter((e) => ym(e.termination_date) === m).length, 'x', '#/staff'],
        ['kc-red', 'RTW expired / ≤30d', act.filter((e) => ['expired', 'd30'].includes(rtwState(e.rtw_expiry))).length, 'alert', '#/staff'], seeCases ? ['kc-pink', 'Open HR cases', S.cases.filter((c) => c.stage !== 'closed' && (!S.proj || c.project_name === S.proj)).length, 'file', '#/hrcases'] : null,
        seeCases ? ['kc-amber', 'Live warnings', S.cases.filter((c) => c.warning_level && c.warning_expiry >= today() && (!S.proj || c.project_name === S.proj)).length, 'book', '#/hrcases'] : null, ['kc-green', 'Waiting for payroll', all.filter((e) => e.payroll_state === 'pending').length, 'clock', '#/recruit']].filter(Boolean);
      return h('div', { class: 'kstrip' }, tiles.map(([c, l, v, ic, href]) => h('a', { class: 'ktile ' + c, href }, h('span', { class: 'kic' }, icon(ic)), h('span', { class: 'kv' }, String(v)), h('span', { class: 'kl' }, l))));
    },
    mix: () => {
      const all = base(), act = all.filter((e) => e.emp_status !== 'terminated');
      const sA = all.filter((e) => e.emp_status === 'active').length, sS = all.filter((e) => e.emp_status === 'suspended').length, sT = all.filter((e) => e.emp_status === 'terminated').length;
      const by = new Map(); for (const e of act) { const k = e.default_project || '(no project)'; const o = by.get(k) || [0, 0]; isCover(e) ? o[1]++ : o[0]++; by.set(k, o); }
      const rows = [...by].sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]), max = Math.max(1, ...rows.map(([, o]) => o[0] + o[1]));
      return h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', gap: '12px' } },
        card('Status', h('div', { class: 'row', style: { gap: '14px' } }, donut([{ label: 'Active', value: sA, color: '#10b981' }, { label: 'Suspended', value: sS, color: '#f59e0b' }, { label: 'Terminated', value: sT, color: '#94a3b8' }], { size: 120, thick: 16, center: String(act.length), sub: 'current' }),
          h('div', { class: 'leg' }, [['#10b981', 'Active', sA], ['#f59e0b', 'Suspended', sS], ['#94a3b8', 'Terminated', sT], ['#3b82f6', 'Permanent', act.filter((e) => !isCover(e)).length], ['#c026d3', 'Temp / cover', act.filter(isCover).length]].map(([c, l, v]) => h('div', null, h('i', { style: { background: c } }), l, h('b', null, String(v))))))),
        card(`Headcount by project (${rows.length})`, h('div', { class: 'small muted', style: { marginBottom: '6px' } }, h('i', { class: 'lgd b-perm' }), ' permanent  ', h('i', { class: 'lgd b-cover' }), ' temp / cover — click a project to filter'),
          h('div', { style: { maxHeight: '320px', overflow: 'auto' } }, bars(rows.map(([k, o]) => [k, o[0], o[1], () => { S.proj = k === '(no project)' ? '' : k; projSel.value = S.proj; paint(); }]), max))));
    },
    movers: () => {
      const all = base(), m = ym(today()), lm = ym(new Date(Date.now() - 30 * 864e5).toISOString());
      const list = (rows, field) => (rows.length ? h('div', { class: 'mini-list' }, rows.sort((a, b) => String(b[field]).localeCompare(String(a[field]))).map((e) => person(e, h('span', { class: 'small' }, dmy(e[field]))))) : h('div', { class: 'small muted' }, 'Nobody.'));
      return h('div', { class: 'side-in' },
        card(`Starters this month (${all.filter((e) => ym(e.hire_date) === m).length})`, list(all.filter((e) => ym(e.hire_date) === m), 'hire_date')),
        card(`Leavers this month (${all.filter((e) => ym(e.termination_date) === m).length})`, list(all.filter((e) => ym(e.termination_date) === m), 'termination_date')),
        card(`Last month: ${all.filter((e) => ym(e.hire_date) === lm).length} starters · ${all.filter((e) => ym(e.termination_date) === lm).length} leavers`, list(all.filter((e) => ym(e.hire_date) === lm || ym(e.termination_date) === lm), 'hire_date')),
        card(`Waiting for payroll (${all.filter((e) => e.payroll_state === 'pending').length})`, list(all.filter((e) => e.payroll_state === 'pending'), 'created_at'), h('a', { class: 'btn sm', href: '#/recruit', style: { marginTop: '8px' } }, 'New starters & covers')));
    },
    rtw: () => {
      const act = base().filter((e) => e.emp_status !== 'terminated');
      const grp = (st) => act.filter((e) => rtwState(e.rtw_expiry) === st).sort((a, b) => String(a.rtw_expiry).localeCompare(String(b.rtw_expiry)));
      const col = (t, rows, cls) => card(`${t} (${rows.length})`, rows.length ? h('div', { class: 'mini-list' }, rows.slice(0, 40).map((e) => person(e, [rtwChip(e.rtw_expiry), waButton(e)]))) : h('div', { class: 'small muted' }, 'None.'));
      return h('div', { class: 'side-in' }, col('Expired', grp('expired')), col('Within 30 days', grp('d30')), col('Within 90 days', grp('d90')), card(`No RTW date on file (${act.filter((e) => !e.rtw_expiry).length})`, h('div', { class: 'mini-list' }, act.filter((e) => !e.rtw_expiry).slice(0, 40).map((e) => person(e)))));
    },
    cases: () => {
      if (!seeCases) return null;
      const cs = S.cases.filter((c) => !S.proj || c.project_name === S.proj), openC = cs.filter((c) => c.stage !== 'closed');
      const overdue = openC.filter((c) => c.due_date && c.due_date < today()), max = Math.max(1, ...STAGES.map(([k]) => openC.filter((c) => c.stage === k).length));
      const item = (c) => h('button', { class: 'mini', onClick: () => openCase(c.id, { onChange: load }) }, h('span', { class: 'grow' }, h('b', null, c.employee_name), h('span', { class: 'small muted' }, ` · ${c.case_ref} · ${c.summary}`)), sevChip(c.severity), stageChip(c.stage));
      return h('div', { class: 'side-in' },
        card(`Open cases by stage (${openC.length})`, h('div', { class: 'cmp' }, STAGES.filter(([k]) => k !== 'closed').map(([k, t]) => { const n = openC.filter((c) => c.stage === k).length; return h('div', { class: 'cmprow' }, h('div', { class: 'lab' }, t), h('div', { class: 'cmpbar' }, h('i', { style: { width: (n / max * 100) + '%' } }), h('span', null, String(n)))); }))),
        card(`Overdue (${overdue.length})`, overdue.length ? h('div', { class: 'mini-list' }, overdue.map(item)) : h('div', { class: 'small muted' }, 'Nothing overdue.')),
        card('Newest cases', h('div', { class: 'mini-list' }, cs.slice(0, 12).map(item)), h('a', { class: 'btn sm', href: '#/hrcases', style: { marginTop: '8px' } }, 'All HR cases')));
    },
    warnings: () => {
      if (!seeCases) return null;
      const live = S.cases.filter((c) => c.warning_level && c.warning_expiry >= today() && (!S.proj || c.project_name === S.proj)).sort((a, b) => String(a.warning_expiry).localeCompare(String(b.warning_expiry)));
      return live.length ? h('div', { class: 'tablewrap', style: { maxHeight: '50vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'Project', 'Warning', 'Given', 'Live until', 'Case'].map((t) => h('th', null, t)))),
        h('tbody', null, live.map((c) => h('tr', { class: 'click', onClick: () => openCase(c.id, { onChange: load }) }, h('td', null, h('b', null, c.employee_name)), h('td', { class: 'small' }, c.project_name || ''), h('td', null, h('span', { class: 'hpill v-high' }, c.warning_level)), h('td', { class: 'small' }, dmy(c.closed_on)), h('td', { class: 'small' }, dmy(c.warning_expiry)), h('td', { class: 'small' }, c.case_ref))))))
        : h('div', { class: 'card pad small muted' }, 'No live warnings.');
    },
    covers: () => {
      const map = new Map(S.staff.map((e) => [e.id, e])), now = today();
      const live = S.assigns.filter((a) => a.date_from <= now && (!a.date_to || a.date_to >= now)).filter((a) => !S.proj || a.project_name === S.proj);
      const byReason = new Map(); for (const a of live) byReason.set(a.reason, (byReason.get(a.reason) || 0) + 1);
      return h('div', { class: 'card pad' }, h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } }, h('b', null, `${live.length} cover assignment(s) live today`), [...byReason].map(([r, n]) => h('span', { class: 'hpill grp' }, `${r}: ${n}`)), h('div', { class: 'grow' }), h('a', { class: 'btn sm', href: '#/recruit?tab=assign' }, 'Who is covering whom')),
        live.length ? h('div', { class: 'tablewrap', style: { maxHeight: '45vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Cover', 'Covering for', 'Reason', 'Project', 'Until', 'Exp. h/wk'].map((t) => h('th', null, t)))),
          h('tbody', null, live.map((a) => { const c = map.get(a.cover_employee_id) || {}, b = map.get(a.absent_employee_id); return h('tr', { class: 'click', onClick: () => c.id && open(c) }, h('td', null, h('div', { class: 'who' }, avatar(c, 'sm'), h('b', null, c.full_name || '—'))), h('td', null, b ? b.full_name : a.absent_name || '—'), h('td', { class: 'small' }, a.reason), h('td', { class: 'small' }, a.project_name || ''), h('td', { class: 'small' }, a.date_to ? dmy(a.date_to) : 'open'), h('td', { class: 'num' }, a.expected_hours != null ? hrs(a.expected_hours) : '—')); })))) : h('div', { class: 'small muted' }, 'No covers working today.'));
    },
    leave: () => {
      const act = base().filter((e) => e.emp_status !== 'terminated');
      const bal = (e) => { const b = S.al.get(e.id); if (b) return b; const c = alCalc(e); return { ...c, taken: +e.al_taken_before || 0, remaining: c.entitlement - (+e.al_taken_before || 0) }; };
      const over = act.filter((e) => +bal(e).remaining < 0), most = act.slice().sort((a, b) => +bal(b).remaining - +bal(a).remaining).slice(0, 12);
      const by = new Map(); for (const e of act) { const k = e.default_project || '(no project)'; const o = by.get(k) || { acc: 0, left: 0, n: 0 }; const b = bal(e); o.acc += +b.accrued || 0; o.left += +b.remaining || 0; o.n++; by.set(k, o); }
      const r1 = (n) => String(Math.round(n * 10) / 10);
      return h('div', { class: 'side-in' },
        card('Leave left by project', h('div', { class: 'tablewrap', style: { maxHeight: '300px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Project', 'People', 'Accrued', 'Left'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))), h('tbody', null, [...by].sort((a, b) => natCompare(a[0], b[0])).map(([k, o]) => h('tr', null, h('td', { class: 'small' }, k), h('td', { class: 'num' }, o.n), h('td', { class: 'num' }, r1(o.acc)), h('td', { class: 'num' }, r1(o.left)))))))),
        card(`Over their entitlement (${over.length})`, over.length ? h('div', { class: 'mini-list' }, over.map((e) => person(e, h('b', { class: 'neg' }, r1(bal(e).remaining) + ' d')))) : h('div', { class: 'small muted' }, 'Nobody.')),
        card('Most leave left', h('div', { class: 'mini-list' }, most.map((e) => person(e, h('b', null, r1(bal(e).remaining) + ' d'))))));
    },
    onsite: () => {
      const rows = S.onsite.filter((s) => !S.proj || s.project_name === S.proj), map = new Map(S.staff.map((e) => [e.id, e]));
      return h('div', { class: 'card pad' }, h('div', { class: 'row', style: { marginBottom: '8px' } }, h('b', { class: 'grow' }, `${rows.length} clocked in now`), h('a', { class: 'btn sm', href: '#/clock' }, 'Clock in / out')),
        rows.length ? h('div', { class: 'nowgrid' }, rows.map((s) => { const e = map.get(s.employee_id) || { full_name: s.employee_name }; const mins = Math.round((Date.now() - Date.parse(s.clock_in)) / 60000);
          return h('div', { class: 'nowcard' }, avatar(e, 'sm'), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ell' }, s.employee_name), h('div', { class: 'small muted ell' }, `${s.project_name || ''} · ${Math.floor(mins / 60)}h ${mins % 60}m`)), s.in_area_in === false ? h('span', { class: 'hpill r-expired' }, 'away') : null); })) : h('div', { class: 'small muted' }, 'Nobody is clocked in right now.'));
    },
    managers: () => {
      const act = S.staff.filter((e) => e.emp_status !== 'terminated'), m = new Map();
      for (const e of act) { const k = e.area_manager || '(no area manager)'; const o = m.get(k) || { n: 0, cover: 0, rtw: 0, cases: 0, projects: new Set() }; o.n++; if (isCover(e)) o.cover++; if (['expired', 'd30'].includes(rtwState(e.rtw_expiry))) o.rtw++; if (e.default_project) o.projects.add(e.default_project); m.set(k, o); }
      const caseBy = new Map(); for (const c of S.cases.filter((x) => x.stage !== 'closed')) { const e = S.staff.find((x) => x.id === c.employee_id); const k = (e && e.area_manager) || '(no area manager)'; caseBy.set(k, (caseBy.get(k) || 0) + 1); }
      return h('div', { class: 'tablewrap', style: { maxHeight: '50vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Area manager', 'Projects', 'Headcount', 'Temp / cover', 'RTW issues', 'Open HR cases'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
        h('tbody', null, [...m].sort((a, b) => b[1].n - a[1].n).map(([k, o]) => h('tr', null, h('td', null, h('b', null, k)), h('td', { class: 'small' }, [...o.projects].sort(natCompare).join(', ')), h('td', { class: 'num' }, o.n), h('td', { class: 'num' }, o.cover), h('td', { class: 'num' + (o.rtw ? ' neg' : '') }, o.rtw), h('td', { class: 'num' }, seeCases ? caseBy.get(k) || 0 : '—'))))));
    },
  };

  function paint() {
    const ids = layout(ctx.prefs.hrdash, roleDef());
    clear(projSel).append(h('option', { value: '' }, 'All projects'), [...new Set(S.staff.map((e) => e.default_project).filter(Boolean))].sort(natCompare).map((p) => h('option', { value: p, selected: p === S.proj }, p)));
    clear(body).append(...ids.map((id) => { let el; try { el = W[id](); } catch (e) { console.error(e); el = h('div', { class: 'notice err' }, e.message); } if (!el) return null; const w = HR_WIDGETS.find((x) => x.id === id); return section(w.title, el, { id: 'hrd.' + id, open: true, sub: S.proj ? ` · ${S.proj}` : '' }); }).filter(Boolean),
      !ids.length ? h('div', { class: 'card empty' }, 'Everything is hidden — use Customise.') : null);
  }
  function customise() {
    const pref = ctx.prefs.hrdash || {}, cur = layout(pref, roleDef());
    let order = [...cur, ...HR_WIDGETS.map((w) => w.id).filter((id) => !cur.includes(id))]; const shown = new Set(cur);
    modal('Customise the HR dashboard', (close) => {
      const list = h('div', { class: 'wlist' });
      const draw = () => clear(list).append(...order.map((id, i) => { const w = HR_WIDGETS.find((x) => x.id === id); return h('div', { class: 'wrow' }, h('input', { type: 'checkbox', checked: shown.has(id), onChange: (e) => { e.target.checked ? shown.add(id) : shown.delete(id); } }), h('div', { class: 'grow' }, w.title, h('div', { class: 'small muted', style: { fontWeight: 400 } }, w.desc)),
        h('button', { class: 'mv', disabled: i === 0, onClick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '↑'), h('button', { class: 'mv', disabled: i === order.length - 1, onClick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, '↓')); }));
      draw();
      const roleSel = h('select', null, ['admin', 'editor', 'viewer', 'hr', 'recruitment'].map((r) => h('option', { value: r }, r)));
      return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Tick what you want to see and use the arrows to order it. This changes your own view.'), list,
        h('div', { class: 'row wrap', style: { justifyContent: 'flex-end' } },
          ctx.can('manage_settings') ? h('div', { class: 'row small', style: { marginRight: 'auto', gap: '6px' } }, 'Make this the default for', roleSel, h('button', { class: 'btn sm', onClick: async () => { const d = { ...(ctx.settings.hrdash_defaults || {}) }; d[roleSel.value] = { hidden: HR_WIDGETS.map((w) => w.id).filter((id) => !shown.has(id)) }; try { await saveSetting('hrdash_defaults', d); ctx.settings = await loadSettings(); toast('Default saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Set')) : null,
          h('button', { class: 'btn', onClick: async () => { await savePref('hrdash', {}); ctx.prefs.hrdash = {}; close(); paint(); } }, 'Reset'),
          h('button', { class: 'btn primary', onClick: async () => { const v = { order, hidden: order.filter((id) => !shown.has(id)) }; try { await savePref('hrdash', v); ctx.prefs.hrdash = v; close(); paint(); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Save')));
    }, { wide: true });
  }
  async function load() {
    const [staff, cases, assigns, al, onsite, projects] = await Promise.all([loadStaff(), seeCases ? loadCases().catch(() => []) : [], loadAssignments().catch(() => []), loadAlBalances().catch(() => []), loadOpenClockIns().catch(() => []), loadProjects().catch(() => [])]);
    S = { ...S, staff, cases, assigns, al: new Map(al.map((b) => [b.employee_id, b])), onsite, projects };
    paint();
  }
  body.append(h('div', { class: 'card empty' }, 'Loading…'));
  await load();
  return onLive(debounce((e) => { if (document.querySelector('.modal-wrap, .overlay, .panel.max')) return; if (['employees', 'hr_cases', 'cover_assignments', 'clock_events'].includes(e.table)) load(); }, 1200));
}
void stageName; void statusChip; void typeChip;
