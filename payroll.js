import { loadRuns, loadRunData, updateLine, upsertWeek, refreshLines, onLive, createLine, loadPeriods } from './api.js';
import { h, clear, money, hrs, dm, dmy, addDays, debounce, toast, modal, natCompare, downloadCSV, statusPill, icon } from './ui.js';
import { ctx, currentRun, runPicker, runEditable } from './ctx.js';
import { openLineDrawer } from './line-drawer.js';
import { openEscalate, summarise } from './escalate.js';

const TYPES = ['Hourly', 'Cover', 'Fixed', ''];

export async function render(root, params) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file first.')); return; }
  let data = { lines: [], weeksByLine: new Map() }, periods = [];
  let weekList = [];
  const f = { q: params.q || '', group: params.group || '', project: params.project || '', status: params.status || '', type: params.type || '', weeks: new Set(), cols: (() => { try { return { weeks: true, variance: false, pay: false, leave: false, ...(JSON.parse(localStorage.getItem('payroll.cols') || '{}')) }; } catch { return { weeks: true, variance: false, pay: false, leave: false }; } })() };
  const localEdits = new Map();   // id -> time, so our own edits do not flash
  const rowEls = new Map();

  const lockBar = h('div');
  const canEdit = () => runEditable(run.id);
  const tableHost = h('div'), chipsHost = h('div', { class: 'chips' }), summary = h('span', { class: 'muted small' });
  const filterBar = h('div', { class: 'toolbar' });
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Payroll'), h('p', null, ctx.canEdit ? 'Click any highlighted cell to edit. Everyone sees the change straight away.' : 'Read-only view.')),
      h('div', { class: 'row' }, runPicker(() => { const prev = cleanup; prev && prev(); clear(root); render(root, {}).then((c) => { cleanup = c; }); }))),
    lockBar, filterBar, chipsHost, h('div', { style: { margin: '8px 0 10px' } }, summary), tableHost);
  let cleanup = null;

  function paintLockBar() {
    const r = ctx.runs.find((x) => x.id === run.id) || run;
    clear(lockBar);
    if (r.status === 'locked') lockBar.append(h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, `🔒 This pay run was locked${r.locked_by_email ? ' by ' + r.locked_by_email.split('@')[0] : ''}. It is read-only for everyone until an admin unlocks it on the Dashboard.`));
    else if (r.status === 'approved' && ctx.canEdit) lockBar.append(h('div', { class: 'notice', style: { marginBottom: '12px' } }, `✓ Approved${r.approved_by_email ? ' by ' + r.approved_by_email.split('@')[0] : ''}. If you change anything, the approval is withdrawn and it goes back to “ready for review”.`));
  }

  // ---------- data ----------
  async function load() {
    paintLockBar();
    [data, periods] = await Promise.all([loadRunData(run.id), loadPeriods(run.id)]);
    weekList = [...new Set([...data.weeksByLine.values()].flat().map((w) => w.week_start))].sort();
    if (!f.weeks.size) weekList.forEach((w) => f.weeks.add(w));
    buildControls(); draw();
  }
  const weeksOf = (l) => data.weeksByLine.get(l.id) || [];
  const allWeeksOn = () => weekList.every((w) => f.weeks.has(w));

  // ---------- filters ----------
  const matches = (l) => {
    if (f.group && (l.pay_group || 'Unassigned') !== f.group) return false;
    if (f.project && l.project_name !== f.project) return false;
    if (f.status && l.budget_status !== f.status) return false;
    if (f.type !== '' && (l.contract_type || '(none)') !== f.type) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (![l.employee_name, l.project_name, l.site_name, l.ni_number, l.remarks].some((x) => x && String(x).toLowerCase().includes(q))) return false; }
    return true;
  };
  function buildControls() {
    const groups = [...new Set(data.lines.map((l) => l.pay_group || 'Unassigned'))].sort(natCompare);
    const projects = [...new Set(data.lines.map((l) => l.project_name))].sort(natCompare);
    const sel = (label, key, opts, w2) => h('label', { class: 'fld' + (w2 ? ' w2' : '') }, label,
      h('select', { onChange: (e) => { f[key] = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), opts.map(([v, t]) => h('option', { value: v, selected: f[key] === v }, t ?? v))));
    clear(filterBar).append(
      h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', placeholder: 'Employee, project, site, NI…', value: f.q, onInput: debounce((e) => { f.q = e.target.value; draw(); }, 180) })),
      sel('Pay date', 'group', groups.map((g) => [g])), sel('Project', 'project', projects.map((p) => [p]), true),
      sel('Budget status', 'status', [['Over', 'Over budget (hours)'], ['Under', 'Under budget (hours)'], ['Within', 'Within budget'], ['NoBudget', 'No hours budget set']]),
      sel('Contract type', 'type', [['Hourly'], ['Cover'], ['Fixed'], ['(none)', 'No type set']]),
      h('div', { class: 'grow' }),
      h('div', { class: 'row' },
        f.project && canEdit() && summarise(data.lines.filter((l) => l.project_name === f.project)).dh > 0.25 ? h('button', { class: 'btn warn', onClick: () => openEscalate({ run, project: f.project, lines: data.lines.filter((l) => l.project_name === f.project), onSent: () => {} }) }, icon('mail'), 'Escalate this project') : null,
        h('button', { class: 'btn', onClick: () => exportCsv() }, icon('download'), 'Export CSV'),
        canEdit() ? h('button', { class: 'btn primary', onClick: addLine }, icon('plus'), 'Add line') : null));
    // week chips + column toggles
    const win = f.group ? periods.find((p) => p.pay_group === f.group) : null;
    clear(chipsHost).append(
      h('span', { class: 'small muted', style: { alignSelf: 'center', marginRight: '4px' } }, 'Weeks:'),
      weekList.map((w) => h('button', { class: 'chip' + (f.weeks.has(w) ? ' on' : ''), title: `${dmy(w)} – ${dmy(addDays(w, 6))}`, onClick: () => { f.weeks.has(w) ? f.weeks.delete(w) : f.weeks.add(w); buildControls(); draw(); } }, dm(w))),
      h('button', { class: 'chip', onClick: () => { weekList.forEach((w) => f.weeks.add(w)); buildControls(); draw(); } }, 'All'),
      win && win.reconcile_from ? h('button', { class: 'chip', title: 'Only the weeks inside this pay date’s reconciliation window', onClick: () => {
        f.weeks = new Set(weekList.filter((w) => w >= win.reconcile_from && w <= win.reconcile_to)); buildControls(); draw(); } }, `${f.group} window`) : null,
      h('span', { style: { width: '14px' } }),
      h('span', { class: 'small muted', style: { alignSelf: 'center', marginRight: '4px' } }, 'Show:'),
      [['weeks', 'Weekly hours'], ['variance', 'Over / under hours'], ['pay', 'Pay detail'], ['leave', 'Leave & SSP']].map(([k, t]) => h('button', { class: 'chip' + (f.cols[k] ? ' on' : ''), onClick: () => { f.cols[k] = !f.cols[k]; try { localStorage.setItem('payroll.cols', JSON.stringify(f.cols)); } catch { /* private mode */ } buildControls(); draw(); } }, t)));
  }

  // ---------- columns ----------
  function columns() {
    const cols = [
      { k: 'employee_name', label: 'Employee', cls: 'stick1 clip', edit: 'text', open: true },
      { k: 'project_name', label: 'Project', cls: 'clip', edit: 'text' }, { k: 'site_name', label: 'Site', cls: 'clip', edit: 'text' },
      { k: 'pay_group', label: 'Pay date', edit: 'group', pill: true },
      { k: 'contract_type', label: 'Type', edit: 'type' },
      { k: 'hourly_rate', label: 'Rate', num: true, edit: 'number', fmt: money },
    ];
    if (run.stream === 'monthly') cols.push({ k: 'budgeted_hours', label: 'Budget h/wk', num: true, edit: 'number', fmt: hrs });
    if (f.cols.weeks) for (const w of weekList) if (f.weeks.has(w)) cols.push({ week: w, label: dm(w), num: true, cls: 'wk' });
    if (!allWeeksOn()) cols.push({ sel: 'hours', label: 'Hours (selected)', num: true, cls: 'wk total' }, { sel: 'pay', label: 'Est. pay (selected)', num: true, cls: 'wk total' });
    cols.push({ k: 'actual_hours', label: 'Hours', num: true, fmt: hrs, total: true, cls: 'total' }, { k: 'leave_hours', label: 'Paid leave h', num: true, fmt: hrs, total: true });
    if (f.cols.leave) cols.push({ k: 'unpaid_leave_hours', label: 'Unpaid leave h', num: true, fmt: hrs, total: true }, { k: 'ssp_days', label: 'SSP days', num: true, total: true }, { k: 'ssp_pay', label: 'SSP £', num: true, fmt: money, total: true });
    if (f.cols.variance) cols.push({ k: 'over_hours', label: 'Over h', num: true, fmt: hrs, total: true }, { k: 'less_hours', label: 'Under h', num: true, fmt: hrs, total: true, neg: true });
    if (f.cols.pay) cols.push({ k: 'hourly_pay', label: 'Hourly pay', num: true, fmt: money, total: true }, { k: 'fixed_pay', label: 'Fixed pay', num: true, fmt: money, edit: 'number', nullable: true, total: true }, { k: 'leave_pay', label: 'Leave pay', num: true, fmt: money, edit: 'number', total: true });
    cols.push({ k: 'addition', label: 'Addition', num: true, fmt: money, edit: 'number', total: true }, { k: 'deduction', label: 'Deduction', num: true, fmt: money, edit: 'number', total: true },
      { k: 'gross_pay', label: 'Gross pay', num: true, fmt: money, total: true, cls: 'total' }, { k: 'budgeted_pay', label: 'Budgeted', num: true, fmt: money, total: true },
      { k: 'window_budget_hours', label: 'Budget h', num: true, fmt: hrs, total: true }, { k: 'window_worked_hours', label: 'Worked h', num: true, fmt: hrs, total: true }, { k: 'hours_difference', label: 'Hours diff', num: true, fmt: hrs, total: true, diff: true },
      { k: 'difference', label: 'Cost diff £', num: true, fmt: money, total: true }, { k: 'budget_status', label: 'Status', pillStatus: true },
      { k: 'remarks', label: 'Remarks', cls: 'clip', edit: 'text' });
    return cols;
  }

  // ---------- table ----------
  let cols = [], visible = [];
  function draw() {
    visible = data.lines.filter(matches);
    cols = columns();
    rowEls.clear();
    const MAX = 2500;
    const tbody = h('tbody');
    const frag = document.createDocumentFragment();
    for (const l of visible.slice(0, MAX)) { const tr = buildRow(l); rowEls.set(l.id, tr); frag.append(tr); }
    tbody.append(frag);
    const tfoot = h('tfoot', null, h('tr', null, cols.map((c, i) => h('td', { class: (c.num ? 'num ' : '') + (c.cls && c.cls.includes('stick1') ? 'stick1' : '') }, i === 0 ? `Total · ${visible.length.toLocaleString()} lines` : ''))));
    const table = h('table', { class: 't' }, h('thead', null, h('tr', null, cols.map((c) => h('th', { class: (c.num ? 'num ' : '') + (c.cls || '') }, c.label)))), tbody, tfoot);
    clear(tableHost).append(visible.length ? h('div', { class: 'tablewrap' }, table) : h('div', { class: 'card empty' }, 'No lines match these filters.'));
    updateTotals(tfoot);
    summary.textContent = `${visible.length.toLocaleString()} of ${data.lines.length.toLocaleString()} lines${visible.length > MAX ? ` (showing first ${MAX.toLocaleString()} — narrow the filters)` : ''}`;
    tableHost._tfoot = tfoot;
  }
  function selHours(l) { return weeksOf(l).filter((w) => f.weeks.has(w.week_start)).reduce((s, w) => s + (+w.delivered || 0) + (+w.leave || 0), 0); }
  const isHourly = (l) => ['hourly', 'cover'].includes(String(l.contract_type || '').toLowerCase());
  function cellValue(l, c) {
    if (c.week) { const w = weeksOf(l).find((x) => x.week_start === c.week); return w ? +w.delivered : null; }
    if (c.sel === 'hours') return selHours(l);
    if (c.sel === 'pay') return isHourly(l) ? selHours(l) * (+l.hourly_rate || 0) : null;
    return l[c.k];
  }
  function updateTotals(tfoot = tableHost._tfoot) {
    if (!tfoot) return;
    const tds = tfoot.querySelectorAll('td');
    cols.forEach((c, i) => {
      if (i === 0) return;
      if (!(c.total || c.week || c.sel)) { tds[i].textContent = ''; return; }
      const s = visible.reduce((a, l) => a + (+cellValue(l, c) || 0), 0);
      tds[i].textContent = c.fmt ? c.fmt(s) : c.sel === 'pay' ? money(s) : hrs(s);
      if (c.diff) tds[i].className = 'num ' + (s > 0.25 ? 'neg' : s < -0.25 ? 'pos' : '');
    });
  }
  function buildRow(l) {
    const tr = h('tr', { 'data-id': l.id });
    for (const c of cols) {
      const td = h('td', { class: (c.num ? 'num ' : '') + (c.cls || '') });
      fillCell(td, l, c);
      tr.append(td);
    }
    return tr;
  }
  function fillCell(td, l, c) {
    clear(td);
    const editable = canEdit() && (c.edit || c.week);
    td.classList.toggle('edit', !!editable);
    if (c.pillStatus) { td.append(statusPill(l.budget_status)); return; }
    if (c.pill) { td.append(l.pay_group ? h('span', { class: 'pill grp' }, l.pay_group) : h('span', { class: 'muted' }, '—')); }
    else if (c.open) { td.title = l.employee_name; td.append(h('a', { href: '#', onClick: (e) => { e.preventDefault(); e.stopPropagation(); open(l.id); } }, l.employee_name)); }
    else if (c.week) {
      const w = weeksOf(l).find((x) => x.week_start === c.week);
      td.append(w ? hrs(w.delivered) || '0' : '');
      if (w) { td.title = `Leave ${hrs(w.leave)}h · budget ${hrs(w.budget)}h${w.in_window ? '' : ' · outside this pay window'}`; if (!w.in_window) td.style.opacity = '.45'; }
      if (w && w.variance_override !== null && w.variance_override !== undefined) td.append(h('span', { class: 'overr', title: 'Variance typed by hand in the old Excel' }, '⚑'));
    } else {
      const v = cellValue(l, c);
      if (c.fmt) td.append(v === null || v === undefined || v === '' ? '' : c.fmt(v)); else { td.append(v === null || v === undefined ? '' : String(v)); if (c.cls && c.cls.includes('clip') && v) td.title = String(v); }
      if (c.diff) td.classList.add(+v > 0.25 ? 'neg' : +v < -0.25 ? 'pos' : 'x');
      if (c.neg && +v < 0) td.classList.add('neg');
      if (c.edit === 'number' && (+v === 0 || v === null)) td.classList.add('zero');
    }
    if (editable) td.onclick = () => startEdit(td, l, c);
  }

  // ---------- inline editing ----------
  function startEdit(td, l, c) {
    if (td.querySelector('input,select')) return;
    const cur = c.week ? cellValue(l, c) : l[c.k];
    let el, finished = false;
    const finish = (commit) => {
      if (finished) return; finished = true;
      if (commit) save(td, l, c, el.value); else fillCell(td, l, c);
    };
    if (c.edit === 'group' || c.edit === 'type') {
      const opts = c.edit === 'type' ? TYPES : ['', ...new Set([...periods.map((p) => p.pay_group), ...data.lines.map((x) => x.pay_group).filter(Boolean)])].sort(natCompare);
      el = h('select', { class: 'cell' }, opts.map((o) => h('option', { value: o, selected: (cur || '') === o }, o || '(none)')));
      el.onchange = () => finish(true);
    } else {
      el = h('input', { class: 'cell', type: c.edit === 'number' || c.week ? 'number' : 'text', step: 'any', value: cur ?? '' });
      if (c.edit !== 'number' && !c.week) el.style.textAlign = 'left';
      el.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    }
    el.onblur = () => finish(true);
    clear(td).append(el); el.focus(); if (el.select) el.select();
  }
  async function save(td, l, c, raw) {
    try {
      let fresh;
      localEdits.set(l.id, Date.now());
      if (c.week) {
        const w = weeksOf(l).find((x) => x.week_start === c.week);
        const v = raw === '' ? 0 : +raw;
        if (w && +w.delivered === v) return fillCell(td, l, c);
        fresh = await upsertWeek({ line_id: l.id, week_start: c.week, delivered: v, leave: w ? w.leave : 0, budget: w ? w.budget : (+l.budgeted_hours || 0), in_window: w ? w.in_window : true, variance_override: w ? w.variance_override : null });
        const list = weeksOf(l).filter((x) => x.week_start !== c.week);
        list.push({ line_id: l.id, week_start: c.week, delivered: v, leave: w ? w.leave : 0, budget: w ? w.budget : (+l.budgeted_hours || 0), in_window: w ? w.in_window : true, variance_override: w ? w.variance_override : null });
        data.weeksByLine.set(l.id, list.sort((a, b) => a.week_start.localeCompare(b.week_start)));
      } else {
        let v = raw;
        if (c.edit === 'number') v = raw === '' ? (c.nullable ? null : 0) : +raw;
        else if (c.edit === 'group' || c.edit === 'type') v = raw === '' ? null : raw;
        else v = String(raw).trim() === '' && c.k !== 'employee_name' && c.k !== 'project_name' ? null : String(raw).trim();
        if ((l[c.k] ?? null) === v || (v === '' && !l[c.k])) return fillCell(td, l, c);
        if ((c.k === 'employee_name' || c.k === 'project_name') && !v) { toast('This cannot be empty', 'err'); return fillCell(td, l, c); }
        fresh = await updateLine(l.id, { [c.k]: v });
      }
      replaceLine(fresh, true);
    } catch (e) { toast(e.message || String(e), 'err'); fillCell(td, l, c); }
  }
  function replaceLine(fresh, flash) {
    if (!fresh) return;
    const i = data.lines.findIndex((x) => x.id === fresh.id);
    if (i >= 0) data.lines[i] = fresh; else data.lines.push(fresh);
    const old = rowEls.get(fresh.id);
    if (old) {
      if (!matches(fresh)) { old.remove(); rowEls.delete(fresh.id); visible = visible.filter((x) => x.id !== fresh.id); }
      else { const tr = buildRow(fresh); old.replaceWith(tr); rowEls.set(fresh.id, tr); visible = visible.map((x) => (x.id === fresh.id ? fresh : x)); if (flash) tr.classList.add('flash'); }
    }
    updateTotals();
  }
  const open = (id) => openLineDrawer(id, { onChange: (line) => { if (line) replaceLine(line, false); }, onDelete: (gone) => { data.lines = data.lines.filter((x) => x.id !== gone); draw(); } });

  // ---------- add line / export ----------
  function addLine() {
    const projects = [...new Set(data.lines.map((l) => l.project_name))].sort(natCompare);
    const groups = [...new Set(periods.map((p) => p.pay_group))].sort(natCompare);
    modal('Add a line', (close) => {
      const v = {};
      const inp = (k, label, attrs = {}) => h('label', { class: 'fld' }, label, (v[k] = h('input', { type: 'text', ...attrs })));
      const dl = h('datalist', { id: 'proj-list' }, projects.map((p) => h('option', { value: p })));
      const type = (v.type = h('select', null, ['Hourly', 'Cover', 'Fixed'].map((t) => h('option', { value: t }, t))));
      const grp = (v.group = h('select', null, h('option', { value: '' }, '(none)'), groups.map((g) => h('option', { value: g }, g))));
      const err = h('div', { class: 'notice err hidden' });
      return h('div', { class: 'stack' }, dl,
        h('div', { class: 'form-grid' }, inp('emp', 'Employee name *'), inp('ni', 'NI number'), inp('project', 'Project *', { list: 'proj-list' }), inp('site', 'Site'),
          h('label', { class: 'fld' }, 'Contract type', type), h('label', { class: 'fld' }, 'Pay date', grp),
          inp('rate', 'Hourly rate (£) *', { type: 'number', step: 'any' }), inp('bud', 'Budget hours per week', { type: 'number', step: 'any' })), err,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'),
          h('button', { class: 'btn primary', onClick: async () => {
            if (!v.emp.value.trim() || !v.project.value.trim() || v.rate.value === '') { err.textContent = 'Employee, project and hourly rate are required.'; err.classList.remove('hidden'); return; }
            try {
              const g = v.group.value || null, p = periods.find((x) => x.pay_group === g);
              const weeksFor = p && p.reconcile_from ? weekList.filter((w) => w >= p.reconcile_from && w <= p.reconcile_to) : weekList;
              const id = await createLine(run.id, { employee_name: v.emp.value.trim(), ni_number: v.ni.value.trim().toUpperCase() || null, project_name: v.project.value.trim(), site_name: v.site.value.trim() || null,
                contract_type: v.type.value, hourly_rate: +v.rate.value, budgeted_hours: +v.bud.value || 0, pay_group: g }, weeksFor, +v.bud.value || 0);
              close(); toast('Line added', 'ok'); await load(); open(id);
            } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
          } }, 'Add line')));
    });
  }
  function exportCsv() {
    const head = cols.map((c) => c.label);
    const rows = visible.map((l) => cols.map((c) => { const v = cellValue(l, c); return c.pillStatus ? l.budget_status : v ?? ''; }));
    downloadCSV(`payroll_${run.label.replace(/\W+/g, '_')}${f.group ? '_' + f.group : ''}.csv`, [head, ...rows]);
  }

  // ---------- live updates from other users ----------
  const pending = { ids: new Set(), full: false };
  const flush = debounce(async () => {
    try {
      if (pending.full) { pending.full = false; pending.ids.clear(); const sy = window.scrollY; await load(); window.scrollTo(0, sy); return; }
      const ids = [...pending.ids].filter((id) => !(localEdits.has(id) && Date.now() - localEdits.get(id) < 2500)); pending.ids.clear();
      if (!ids.length) return;
      const { lines, weeks } = await refreshLines(ids);
      for (const id of ids) data.weeksByLine.set(id, weeks.filter((w) => w.line_id === id).sort((a, b) => a.week_start.localeCompare(b.week_start)));
      for (const l of lines) replaceLine(l, true);
    } catch (e) { console.error(e); }
  }, 450);
  const off = onLive((e) => {
    if (e.table === 'payroll_lines') {
      const r = e.row || e.old || {};
      if (r.run_id && r.run_id !== run.id) return;
      if (e.type === 'UPDATE' && r.id) pending.ids.add(r.id); else pending.full = true;
    } else if (e.table === 'line_weeks') { const id = (e.row || e.old || {}).line_id; if (id && data.weeksByLine.has(id)) pending.ids.add(id); else if (e.type !== 'UPDATE') pending.full = true; }
    else if (e.table === 'pay_periods') { loadPeriods(run.id).then((p) => { periods = p; }); return; }
    else if (e.table === 'pay_runs') { loadRuns().then((r) => { ctx.runs = r; paintLockBar(); buildControls(); draw(); }).catch(console.error); return; }
    else return;
    flush();
  });

  await load();
  cleanup = () => off();
  return () => cleanup && cleanup();
}
