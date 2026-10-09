// Dashboard: where is this pay run, what needs attention, and a one-click way into the detail.
import { loadRunData, loadPeriods, loadRuns, onLive, deleteRun, approveRun, lockRun, unlockRun, loadSignals, loadProjects, savePref, saveSetting, loadSettings, loadLinesForRuns, loadDailyForRun, loadRunLeave, loadProjectStatus, loadProjectStatusForRuns, loadAdhoc, loadEmployeesFull } from './api.js';
import { WIDGETS, resolveLayout } from './widgets.js';
import { h, clear, money, hrs, dm, dmy, addDays, ago, debounce, natCompare, confirmBox, toast, icon, donut, ring, PALETTE, initials, modal } from './ui.js';
import { ctx, currentRun, runPicker, escalationCfg, payRules } from './ctx.js';
import { normKey } from './parsers.js';
import { openEscalate, pocFor, summarise } from './escalate.js';
import { go } from './app.js';
import { openLineDrawer } from './line-drawer.js';
import { overview } from './overview.js';
import { panel } from './panels.js';

const num = (v) => +v || 0;
const who = (email) => (email ? email.split('@')[0] : 'someone');
const STEPS = [['ready', 'Ready for review'], ['approved', 'Approved'], ['locked', 'Locked']];
const STATUS_TEXT = { importing: 'Importing…', ready: 'Ready for review', approved: 'Approved', locked: 'Locked' };

export async function render(root) {
  if (!ctx.runs.length) {
    root.append(h('div', { class: 'card empty' }, h('h2', { style: { color: '#14222b', margin: '0 0 6px' } }, 'No payroll data yet'),
      h('p', null, ctx.canEdit ? 'Import your monthly or fortnightly Excel file to get started.' : 'An editor needs to import the first file.'),
      ctx.canEdit ? h('a', { class: 'btn primary', href: '#/import' }, icon('upload'), 'Import a file') : null));
    return;
  }

  // state that survives a refresh (so a live update does not reset what you were looking at)
  const S = { run: null, lines: [], weeksByLine: new Map(), periods: [], signals: { timesheets: [], leave: [], escalations: [], provider: 0, exports: [] }, projects: [], view: 'group', projectSort: 'cost', sort: { key: 'pay_group', dir: 1 }, hit: -1 };
  const body = h('div');
  S.pstat = new Map(); S.adhoc = []; S.emps = [];
  S.focus = new Set(((ctx.prefs.dashboard || {}).focus) || []);
  const view = () => (S.focus.size ? S.lines.filter((l) => S.focus.has(l.project_name)) : S.lines);   // the project focus applies to every widget

  // ---------- instant search (kept outside `body` so typing is never interrupted by a refresh) ----------
  const input = h('input', { type: 'search', placeholder: 'Search an employee, project, site or NI number…', autocomplete: 'off' });
  const results = h('div', { class: 'sresults hidden' });
  let shown = [];
  const closeResults = () => { results.classList.add('hidden'); S.hit = -1; };
  const openLine = (id) => {
    closeResults();
    openLineDrawer(id, { onChange: (line) => { const cur = S.lines.find((x) => x.id === line.id); if (cur && (cur.gross_pay !== line.gross_pay || cur.budgeted_pay !== line.budgeted_pay)) softReload(); }, onDelete: () => softReload() });
  };
  function runSearch() {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return closeResults();
    const hay = (l) => [l.employee_name, l.project_name, l.site_name, l.ni_number].filter(Boolean).join(' ').toLowerCase();
    const people = S.lines.filter((l) => hay(l).includes(q))
      .sort((a, b) => (+b.employee_name.toLowerCase().startsWith(q) - +a.employee_name.toLowerCase().startsWith(q)) || num(b.gross_pay) - num(a.gross_pay)).slice(0, 8);
    const pm = new Map();
    for (const l of S.lines) if (l.project_name.toLowerCase().includes(q)) { const p = pm.get(l.project_name) || { name: l.project_name, lines: 0, gross: 0 }; p.lines++; p.gross += num(l.gross_pay); pm.set(l.project_name, p); }
    const projects = [...pm.values()].sort((a, b) => b.gross - a.gross).slice(0, 4);
    shown = [...projects.map((p) => ({ kind: 'project', p })), ...people.map((l) => ({ kind: 'line', l }))];
    clear(results);
    if (!shown.length) results.append(h('div', { class: 'sitem muted' }, `Nothing matches “${input.value.trim()}”.`));
    shown.forEach((s, i) => {
      if (s.kind === 'project') results.append(h('div', { class: 'sitem', 'data-i': i, onClick: () => { closeResults(); go('payroll', { project: s.p.name }); } },
        h('span', { class: 'sicon' }, icon('folder')), h('div', { class: 'grow' }, h('b', null, s.p.name), h('div', { class: 'small muted' }, `Project · ${s.p.lines} lines`)), h('span', { class: 'mono' }, money(s.p.gross))));
      else results.append(h('div', { class: 'sitem', 'data-i': i, onClick: () => openLine(s.l.id) },
        h('span', { class: 'sicon' }, icon('users')), h('div', { class: 'grow' }, h('b', null, s.l.employee_name), h('div', { class: 'small muted' }, [s.l.project_name, s.l.site_name].filter(Boolean).join(' · '))),
        h('span', { class: 'pill grp' }, s.l.pay_group || '—'), h('span', { class: 'mono', style: { minWidth: '84px', textAlign: 'right' } }, money(s.l.gross_pay)),
        h('span', { class: 'pill ' + String(s.l.budget_status || 'within').toLowerCase() }, s.l.budget_status === 'Over' ? 'Over' : s.l.budget_status === 'Under' ? 'Under' : 'OK')));
    });
    results.append(h('div', { class: 'sfoot small muted' }, 'Enter = see all matches in Payroll · ↑ ↓ to move · Esc to close'));
    results.classList.remove('hidden'); S.hit = -1;
  }
  const mark = () => results.querySelectorAll('.sitem[data-i]').forEach((el) => el.classList.toggle('sel', +el.dataset.i === S.hit));
  input.addEventListener('input', debounce(runSearch, 120));
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) runSearch(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; closeResults(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); S.hit = Math.min(shown.length - 1, S.hit + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.hit = Math.max(0, S.hit - 1); mark(); }
    else if (e.key === 'Enter') {
      const s = shown[S.hit];
      if (s && s.kind === 'line') openLine(s.l.id);
      else if (s && s.kind === 'project') { closeResults(); go('payroll', { project: s.p.name }); }
      else if (input.value.trim()) { closeResults(); go('payroll', { q: input.value.trim() }); }
    }
  });
  const onDoc = (e) => { if (!e.target.closest || !e.target.closest('.searchbox')) closeResults(); };
  document.addEventListener('click', onDoc);

  const ovHost = h('div');
  root.append(ovHost, panel('Charts, budgets & widgets', h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Dashboard'), h('p', null, 'Where this pay run stands, what needs a look, and one click into the detail.')), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => customise() }, icon('gear'), 'Customise'), runPicker(() => load()))),
    h('div', { class: 'searchbox', style: { marginBottom: '14px' } }, h('span', { class: 'sglass' }, icon('search')), input, results),
    body), { id: 'dash.more', sub: ' · pay dates, projects over budget, trends and the rest of the dashboard' }));

  // ---------- maths for the page ----------
  function analyse() {
    const A = { groups: new Map(), projects: new Map(), weeks: new Map(), gross: 0, budget: 0, diff: 0, hours: 0, leave: 0, over: 0, under: 0, overSum: 0, underSum: 0,
      bh: 0, wh: 0, wd: 0, dh: 0, overH: 0, underH: 0, noBudget: 0, people: new Set(), paid: new Set(), noType: 0, noGroup: 0, bigOver: 0, overrides: 0 };
    const thr = +escalationCfg().threshold_hours || 8;
    for (const l of view()) {
      const g = l.pay_group || 'Unassigned', gross = num(l.gross_pay), bud = num(l.budgeted_pay), diff = num(l.difference);
      const bh = num(l.window_budget_hours), wh = num(l.window_worked_hours), dh = num(l.hours_difference);
      const G = A.groups.get(g) || { label: g, lines: 0, hours: 0, gross: 0, budget: 0, diff: 0, bh: 0, wh: 0, dh: 0, over: 0, under: 0 };
      G.lines++; G.hours += num(l.actual_hours); G.gross += gross; G.budget += bud; G.diff += diff; G.bh += bh; G.wh += wh; G.dh += dh;
      if (l.budget_status === 'Over') G.over++;
      if (l.budget_status === 'Under') G.under++;
      A.groups.set(g, G);
      const pk = normKey(l.project_name);
      const P = A.projects.get(pk) || { label: l.project_name, key: pk, lines: 0, gross: 0, budget: 0, diff: 0, bh: 0, wh: 0, dh: 0, src: 'lines' };
      P.lines++; P.gross += gross; P.budget += bud; P.diff += diff; P.bh += bh; P.wh += wh; P.dh += dh; A.projects.set(pk, P);
      A.gross += gross; A.budget += bud; A.diff += diff; A.hours += num(l.actual_hours); A.leave += num(l.leave_hours);
      const pid = l.employee_id || l.employee_name.toLowerCase(); A.people.add(pid); if (gross > 0) A.paid.add(pid);
      if (l.budget_status === 'Over') { A.over++; A.overSum += diff; A.overH += dh; if (dh >= thr) A.bigOver++; }
      if (l.budget_status === 'Under') { A.under++; A.underSum += diff; A.underH += dh; }
      if (l.budget_status === 'NoBudget') A.noBudget++;
      if (!l.contract_type) A.noType++;
      if (!l.pay_group) A.noGroup++;
      const ws = S.weeksByLine.get(l.id) || [];
      if (ws.some((w) => w.variance_override !== null && w.variance_override !== undefined)) A.overrides++;
      for (const w of ws) { if (!w.in_window) continue; A.wd += num(w.delivered); const W = A.weeks.get(w.week_start) || { label: w.week_start, budget: 0, actual: 0 }; W.budget += num(w.budget); W.actual += num(w.delivered) + num(w.leave); A.weeks.set(w.week_start, W); }
    }
    // Project-level decisions use the project's own weekly hours budget (from Budgets) when there is one
    const tol = payRules().budget_tolerance_hours ?? 0.25; A.projOver = 0; A.projUnder = 0; A.projOverH = 0; A.adhocH = 0; A.adhocCharge = 0;
    for (const P of A.projects.values()) {
      const ps = S.pstat.get(P.key);
      if (ps) { P.bh = num(ps.budget_hours); P.wh = num(ps.worked_hours); P.dh = num(ps.hours_difference); P.src = ps.budget_source; P.adhoc = num(ps.adhoc_hours); P.charge = num(ps.adhoc_charge); P.ps = ps; }
      P.status = P.bh > 0 || P.src === 'project' ? (P.dh > tol ? 'Over' : P.dh < -tol ? 'Under' : 'Within') : (P.wh > 0 ? 'NoBudget' : 'Within');
      A.bh += P.bh; A.wh += P.wh; A.dh += P.dh; A.adhocH += P.adhoc || 0; A.adhocCharge += P.charge || 0;
      if (P.status === 'Over') { A.projOver++; A.projOverH += P.dh; } else if (P.status === 'Under') A.projUnder++;
    }
    return A;
  }

  // ---------- small building blocks ----------
  const kpi = (label, value, sub, { cls = '', page, params } = {}) => h('div', { class: 'card kpi click', tabindex: 0, role: 'link', title: 'Click to open', onClick: () => go(page, params),
    onKeydown: (e) => { if (e.key === 'Enter') go(page, params); } }, h('div', { class: 'l' }, label, h('span', { class: 'go' }, '→')), h('div', { class: 'v ' + cls }, value), h('div', { class: 's' }, sub));

  function stepper(status) {
    const at = { importing: 0, ready: 0, approved: 1, locked: 2 }[status] ?? 0;
    const parts = [];
    STEPS.forEach(([key, label], i) => {
      if (i) parts.push(h('div', { class: 'step-line' + (i <= at ? ' done' : '') }));
      parts.push(h('div', { class: 'step' + (i < at ? ' done' : '') + (i === at ? (key === 'locked' ? ' locked-now' : ' now') : '') }, h('span', { class: 'dot' }, i < at ? '✓' : key === 'locked' && i === at ? '🔒' : String(i + 1)), label));
    });
    return h('div', { class: 'stepper' }, parts);
  }

  async function transition(kind) {
    const run = S.run;
    const cfg = {
      approve: { title: 'Approve this pay run?', text: `You are confirming that “${run.label}” has been checked and is ready for payroll. If anyone changes it afterwards, the approval is withdrawn automatically.`, ok: 'Approve', fn: approveRun, done: 'Pay run approved' },
      lock: { title: 'Lock this pay run?', text: `“${run.label}” will become read-only for everyone, enforced by the database, until an admin unlocks it. Do this once payroll has been submitted.`, ok: 'Lock pay run', fn: lockRun, done: 'Pay run locked' },
      unlock: { title: 'Unlock this pay run?', text: `“${run.label}” goes back to “ready for review” and can be edited again. The unlock is recorded in History.`, ok: 'Unlock', fn: unlockRun, done: 'Pay run unlocked' },
    }[kind];
    if (!(await confirmBox(cfg.title, cfg.text, cfg.ok, kind === 'unlock'))) return;
    try { await cfg.fn(run.id); ctx.runs = await loadRuns(); toast(cfg.done, 'ok'); await load(); } catch (e) { toast(e.message || String(e), 'err'); }
  }

  function heroCard(A) {
    const run = S.run, st = run.status || 'ready';
    const meta = [run.stream === 'monthly' ? 'Monthly payroll' : 'Fortnightly payroll', run.period_start ? `${dmy(run.period_start)} – ${dmy(run.period_end)}` : ''].filter(Boolean).join(' · ');
    const used = A.bh > 0 ? (A.wh / A.bh) * 100 : 0;
    const note = st === 'locked' ? `🔒 Locked by ${who(run.locked_by_email)}${run.locked_at ? ', ' + ago(run.locked_at) : ''}. Nobody can change this pay run until an admin unlocks it.`
      : st === 'approved' ? `✓ Approved by ${who(run.approved_by_email)}${run.approved_at ? ', ' + ago(run.approved_at) : ''}. Any edit or re-import withdraws the approval.`
      : ctx.can('approve_lock') ? 'The team keeps updating this pay run while it is open. When it has been checked, approve it, then lock it.' : 'The team updates this pay run while it is open. An admin approves and locks it once checked.';
    return h('div', { class: 'hero' },
      h('div', { class: 'row wrap', style: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '18px' } },
        h('div', { style: { minWidth: '260px', flex: 1 } },
          h('div', { class: 'eyebrow' }, 'Current pay run'), h('h2', null, run.label), h('div', { class: 'meta' }, meta, ' ', h('span', { class: 'pill st-' + st }, STATUS_TEXT[st] || st)),
          h('div', { class: 'big' }, hrs(A.wh).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' h'), h('div', { class: 'bigsub' }, `worked of ${hrs(A.bh).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} h budgeted · ${A.paid.size.toLocaleString()} people paid · ${view().length.toLocaleString()} lines${S.focus.size ? ' · focus: ' + S.focus.size + ' project' + (S.focus.size === 1 ? '' : 's') : ''}`),
          h('div', { class: 'hstats' },
            h('div', null, h('b', null, hrs(A.bh).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' h'), h('span', null, 'hours budget')),
            h('div', null, h('b', null, (A.dh > 0 ? '+' : '') + hrs(A.dh) + ' h'), h('span', null, A.dh > 0.25 ? 'over the hours budget' : A.dh < -0.25 ? 'under the hours budget' : 'on the hours budget')),
            h('div', null, h('b', null, money(A.gross)), h('span', null, 'gross pay'))),
          h('div', { class: 'note' }, note)),
        h('div', { class: 'row', style: { gap: '22px', alignItems: 'center' } },
          ring(used, { size: 124, thick: 13, color: used > 100.5 ? '#fda4af' : '#5eead4', label: A.bh ? Math.round(used) + '%' : '–', sub: 'of hours budget' }),
          h('div', { class: 'stack', style: { gap: '8px' } },
            ctx.can('approve_lock') && st === 'ready' ? h('button', { class: 'btn primary', onClick: () => transition('approve') }, '✓ Approve pay run') : null,
            ctx.can('approve_lock') && st === 'approved' ? h('button', { class: 'btn primary', onClick: () => transition('lock') }, '🔒 Lock pay run') : null,
            ctx.can('unlock') && st === 'approved' ? h('button', { class: 'btn', onClick: () => transition('unlock') }, 'Withdraw approval') : null,
            ctx.can('unlock') && st === 'locked' ? h('button', { class: 'btn', onClick: () => transition('unlock') }, '🔓 Unlock') : null,
            h('a', { class: 'btn', href: '#/payroll' }, 'Open payroll →')))));
  }

  // The checklist a payroll run goes through (modelled on a "pre-payroll data" tracker)
  function trackerCard(A) {
    const run = S.run, st = run.status || 'ready', sg = S.signals;
    const ts = sg.timesheets, tsDone = ts.filter((t) => t.status === 'checked').length, tsKeyed = ts.filter((t) => t.status === 'keyed').length, tsNew = ts.filter((t) => t.status === 'received').length;
    const expected = view().filter((l) => num(l.budget_hours_total) > 0 || (l.fixed_pay !== null && l.fixed_pay !== undefined));
    const withHours = expected.filter((l) => num(l.actual_hours) > 0 || (l.fixed_pay !== null && l.fixed_pay !== undefined)).length;
    const lv = sg.leave, paidL = lv.filter((x) => x.paid && !x.ssp).length, sspL = lv.filter((x) => x.ssp).length, unpL = lv.filter((x) => !x.paid && !x.ssp).length;
    const escProjects = new Set(sg.escalations.map((e) => e.project_name)).size;
    const within = view().length - A.over - A.under - A.noBudget;
    const steps = [
      { icon: 'file', label: 'Timesheets', href: '#/timesheets', sub: ts.length ? `${ts.length} received` : 'none yet', status: ts.length && tsDone === ts.length ? 'done' : ts.length ? 'active' : 'idle', counts: ts.length ? [[tsDone, 'g', 'checked'], [tsKeyed, 'b', 'keyed, to check'], [tsNew, 'r', 'received, not keyed']] : [[0, 'n']] },
      { icon: 'clock', label: 'Hours entered', href: '#/payroll', sub: expected.length ? `${withHours} of ${expected.length} lines` : 'no budgets set', status: expected.length && withHours === expected.length ? 'done' : withHours ? 'active' : 'idle', counts: [[withHours, 'g', 'lines with hours'], [expected.length - withHours, 'r', 'lines with a budget but no hours yet']] },
      { icon: 'sun', label: 'Leave & SSP', href: '#/leave', sub: lv.length ? `${lv.length} records` : 'none recorded', status: lv.length ? 'done' : 'idle', counts: [[paidL, 'g', 'paid leave'], [sspL, 'b', 'SSP days'], [unpL, 'a', 'unpaid leave']] },
      { icon: 'alert', label: 'Budget review', href: '#/payroll?status=Over', sub: A.over ? `${A.over} lines over` : 'all within budget', status: A.over === 0 ? 'done' : escProjects ? 'active' : 'idle', counts: [[within, 'g', 'within budget'], [A.over, 'r', 'over budget'], [escProjects, 'b', 'projects escalated']] },
      { icon: 'users', label: 'Provider report', href: '#/journal', sub: sg.provider ? `${sg.provider} payslips` : 'not imported', status: sg.provider ? 'done' : 'idle', counts: [[sg.provider, sg.provider ? 'g' : 'n', 'payslips imported']] },
      { icon: 'book', label: 'Manual journal', href: '#/journal', sub: sg.exports.length ? `exported ${ago(sg.exports[0].created_at)}` : 'not exported', status: sg.exports.length ? 'done' : 'idle', counts: [[sg.exports.length, sg.exports.length ? 'g' : 'n', 'exports']] },
      { icon: st === 'locked' ? 'lock' : 'check', label: 'Approve & lock', href: '#/dashboard', sub: STATUS_TEXT[st], status: st === 'locked' ? 'locked' : st === 'approved' ? 'active' : 'idle', counts: [[st === 'locked' ? 1 : 0, st === 'locked' ? 'g' : 'n', 'locked']] },
    ];
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Payroll checklist'), h('span', { class: 'small muted' }, 'Green = done · blue = in progress · red = needs attention')),
      h('div', { class: 'tracker' }, steps.map((s, i) => h('a', { class: 'tnode ' + s.status, href: s.href },
        h('div', { class: 'tdot' }, s.status === 'done' ? icon('check') : s.status === 'locked' ? icon('lock') : String(i + 1)),
        h('div', { class: 'tlabel' }, s.label),
        h('div', { class: 'tcounts' }, s.counts.map(([n, cls, title]) => h('span', { class: 'cn ' + cls, title: title || '' }, String(n)))),
        h('div', { class: 'tsub' }, s.sub)))));
  }

  // ---------- chart (budget vs actual) ----------
  function chartRows(A) {
    if (S.view === 'week') {
      return { rows: [...A.weeks.values()].sort((a, b) => a.label.localeCompare(b.label)).map((w) => ({ label: `${dm(w.label)} – ${dm(addDays(w.label, 6))}`, budget: w.budget, actual: w.actual, go: () => go('explorer', { from: w.label, to: addDays(w.label, 6), by: 'employee' }) })), fmt: (v) => hrs(v) + ' h', aName: 'Hours worked + leave', bName: 'Budget hours', hint: 'Click a week to see who worked it in the Hours explorer.' };
    }
    if (S.view === 'project') {
      const list = [...A.projects.values()].sort((a, b) => (S.projectSort === 'over' ? b.dh - a.dh : b.wh - a.wh)).slice(0, 12);
      return { rows: list.map((p) => ({ label: p.label, budget: p.bh, actual: p.wh, go: () => go('payroll', { project: p.label }) })), fmt: (v) => hrs(v) + ' h', aName: 'Hours worked', bName: 'Budget hours', hint: 'Over budget = more hours worked than the weekly hours budget. Click a project to open its lines.' };
    }
    return { rows: [...A.groups.values()].sort((a, b) => natCompare(a.label, b.label)).map((g) => ({ label: g.label, budget: g.bh, actual: g.wh, go: () => go('payroll', { group: g.label }) })), fmt: (v) => hrs(v) + ' h', aName: 'Hours worked', bName: 'Budget hours', hint: 'Hours worked against the weekly hours budget, per pay date. Click one to open its lines.' };
  }
  function chartCard(A) {
    const { rows, fmt, aName, bName, hint } = chartRows(A);
    const max = Math.max(1, ...rows.flatMap((r) => [r.budget, r.actual]));
    const seg = (key, label) => h('button', { class: S.view === key ? 'on' : '', onClick: () => { S.view = key; paint(); } }, label);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row wrap', style: { justifyContent: 'space-between', marginBottom: '10px' } },
        h('div', null, h('h3', { style: { margin: 0 } }, 'Hours budget vs hours worked'), h('div', { class: 'small muted' }, hint)),
        h('div', { class: 'row wrap' },
          S.view === 'project' ? h('div', { class: 'seg' }, h('button', { class: S.projectSort === 'cost' ? 'on' : '', onClick: () => { S.projectSort = 'cost'; paint(); } }, 'Most hours'), h('button', { class: S.projectSort === 'over' ? 'on' : '', onClick: () => { S.projectSort = 'over'; paint(); } }, 'Biggest overspend')) : null,
          h('div', { class: 'seg' }, seg('group', 'By pay date'), seg('project', 'By project'), seg('week', 'By week')))),
      h('div', { class: 'legend small muted' }, h('i', { class: 'lg b' }), bName, h('i', { class: 'lg a' }), aName, h('i', { class: 'lg o' }), 'over budget'),
      rows.length ? h('div', { class: 'chart' }, rows.map((r) => {
        const diff = r.actual - r.budget, state = (diff > 0.25 && r.budget > 0) || (r.budget === 0 && r.actual > 0.25) ? 'over' : diff < -0.25 ? 'under' : 'ok';
        return h('div', { class: 'crow', tabindex: 0, title: `${r.label}\n${bName}: ${fmt(r.budget)}\n${aName}: ${fmt(r.actual)}\nDifference: ${fmt(diff)}`, onClick: r.go, onKeydown: (e) => { if (e.key === 'Enter') r.go(); } },
          h('div', { class: 'lab' }, r.label),
          h('div', { class: 'ctrack' }, h('div', { class: 'cbar b', style: { width: Math.max(1, 100 * r.budget / max) + '%' } }), h('div', { class: 'cbar a ' + state, style: { width: Math.max(1, 100 * r.actual / max) + '%' } })),
          h('div', { class: 'val' }, h('b', null, fmt(r.actual)), h('span', { class: 'muted' }, ' / ' + fmt(r.budget)), h('div', { class: 'small ' + (state === 'over' ? 'neg' : state === 'under' ? 'amber' : 'muted') }, (diff > 0 ? '+' : '') + fmt(diff))));
      })) : h('div', { class: 'muted' }, 'No data to chart.'));
  }

  // ---------- pay date table (click headers to sort, click a row to open it) ----------
  function tableCard(A) {
    const win = new Map(S.periods.map((p) => [p.pay_group, p]));
    const cols = [['pay_group', 'Pay date'], ['window', 'Reconciliation window', true], ['lines', 'Lines'], ['bh', 'Budget h'], ['wh', 'Worked h'], ['dh', 'Hours diff'], ['over', 'Over'], ['under', 'Under'], ['gross', 'Gross £']];
    const rows = [...A.groups.values()].map((g) => ({ ...g, pay_group: g.label })).sort((a, b) => {
      const k = S.sort.key; const r = k === 'pay_group' ? natCompare(a.pay_group, b.pay_group) : num(a[k]) - num(b[k]); return r * S.sort.dir;
    });
    const maxGross = Math.max(1, ...rows.map((r) => r.gross));
    return h('div', { class: 'card', style: { marginBottom: '14px' } },
      h('div', { class: 'pad', style: { paddingBottom: 0 } }, h('h3', { style: { marginBottom: '2px' } }, 'By pay date'), h('div', { class: 'small muted' }, 'Click a column heading to sort, or a row to open those lines in Payroll.')),
      h('div', { class: 'tablewrap auto', style: { border: 0, boxShadow: 'none' } }, h('table', { class: 't' },
        h('thead', null, h('tr', null, cols.map(([k, t, nosort], i) => h('th', { class: (i > 1 ? 'num ' : '') + (nosort ? '' : 'sortable'), onClick: nosort ? null : () => { S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'pay_group' ? 1 : -1) }; paint(); } },
          t + (S.sort.key === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''))), h('th', null, 'Share of gross'), h('th'))),
        h('tbody', null, rows.map((r) => { const p = win.get(r.pay_group);
          return h('tr', { class: 'clickrow', onClick: () => go('payroll', { group: r.pay_group }) },
            h('td', null, h('span', { class: 'pill grp' }, r.pay_group)),
            h('td', { class: 'muted' }, p && p.reconcile_from ? `${dm(p.reconcile_from)} – ${dmy(p.reconcile_to)}` : h('a', { href: '#/calendar', onClick: (e) => e.stopPropagation() }, 'set window')),
            h('td', { class: 'num' }, r.lines), h('td', { class: 'num' }, hrs(r.bh)), h('td', { class: 'num' }, hrs(r.wh)),
            h('td', { class: 'num ' + (r.dh > 0.25 ? 'neg' : r.dh < -0.25 ? 'pos' : '') }, (r.dh > 0 ? '+' : '') + hrs(r.dh)), h('td', { class: 'num' }, r.over || ''), h('td', { class: 'num' }, r.under || ''), h('td', { class: 'num' }, money(r.gross)),
            h('td', { style: { minWidth: '110px' } }, h('div', { class: 'bar' }, h('i', { style: { width: (100 * r.gross / maxGross) + '%' } }))),
            h('td', null, h('span', { class: 'btn sm' }, 'Open')));
        })))));
  }

  // ---------- what needs attention ----------
  function attentionCard(A) {
    const items = [
      A.over && { n: A.over, text: 'lines worked more hours than budgeted', sub: hrs(A.overH) + ' h over in total · ' + money(A.overSum) + ' of cost', page: 'payroll', params: { status: 'Over' }, tone: 'bad' },
      A.bigOver && { n: A.bigOver, text: `lines are ${+escalationCfg().threshold_hours || 8} hours or more over budget`, sub: 'worth checking first', page: 'payroll', params: { status: 'Over' }, tone: 'bad' },
      A.noBudget && { n: A.noBudget, text: 'lines have hours but no hours budget', sub: 'set a weekly budget so they can be checked', page: 'payroll', params: { status: 'NoBudget' }, tone: 'warn' },
      A.noType && { n: A.noType, text: 'lines have no contract type', sub: 'so they are not paid by the hour', page: 'payroll', params: { type: '(none)' }, tone: 'warn' },
      A.noGroup && { n: A.noGroup, text: 'lines have no pay date', sub: 'assign one in Projects', page: 'payroll', params: { group: 'Unassigned' }, tone: 'warn' },
      A.overrides && { n: A.overrides, text: 'lines have a variance typed by hand', sub: 'marked ⚑ in the line panel', page: 'payroll', params: {}, tone: 'info' },
    ].filter(Boolean);
    return h('div', { class: 'card pad' }, h('h3', null, 'Worth a look'),
      items.length ? items.map((it) => h('div', { class: 'alert-row ' + it.tone, tabindex: 0, onClick: () => go(it.page, it.params), onKeydown: (e) => { if (e.key === 'Enter') go(it.page, it.params); } },
        h('span', { class: 'abadge' }, it.n.toLocaleString()), h('div', { class: 'grow' }, h('b', null, it.text), h('div', { class: 'small muted' }, it.sub)), h('span', { class: 'muted' }, '→')))
        : h('div', { class: 'muted' }, '✓ Nothing to flag. Every line has a contract type and a pay date, and nothing is over budget.'));
  }
  function exceptionCard(title, kind) {
    const rows = view().filter((l) => l.budget_status === kind)
      .sort((a, b) => (kind === 'Over' ? num(b.hours_difference) - num(a.hours_difference) : num(a.hours_difference) - num(b.hours_difference))).slice(0, 8);
    return h('div', { class: 'card pad' }, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0 }, class: 'grow' }, title),
      rows.length ? h('a', { class: 'small', href: '#/payroll?status=' + kind }, 'See all →') : null),
      rows.length ? h('table', { class: 't' }, h('tbody', null, rows.map((l) => h('tr', { class: 'clickrow', onClick: () => openLine(l.id) },
        h('td', null, h('b', { class: 'link' }, l.employee_name), h('div', { class: 'small muted' }, [l.project_name, l.site_name].filter(Boolean).join(' · '))),
        h('td', null, h('span', { class: 'pill grp' }, l.pay_group || '—')), h('td', { class: 'num ' + (kind === 'Over' ? 'neg' : 'pos') }, (num(l.hours_difference) > 0 ? '+' : '') + hrs(l.hours_difference) + ' h', h('div', { class: 'small muted' }, money(l.difference)))))))
        : h('div', { class: 'muted' }, 'Nothing to review'));
  }

  // ---------- donuts + escalation ----------
  function donutsCard(A) {
    const sspH = S.signals.leave.filter((x) => x.ssp).reduce((s, x) => s + num(x.hours), 0);
    const unpaid = view().reduce((s, l) => s + num(l.unpaid_leave_hours), 0);
    const mix = [{ label: 'Worked', value: A.wd, color: '#6c5ce7' }, { label: 'Paid leave', value: Math.max(0, A.wh - A.wd), color: '#2563eb' }, { label: 'SSP (sick)', value: sspH, color: '#e84393' }, { label: 'Unpaid leave', value: unpaid, color: '#94a3b8' }];
    const groups = [...A.groups.values()].sort((a, b) => natCompare(a.label, b.label));
    const mixTotal = mix.reduce((s, p) => s + p.value, 0);
    return h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(380px,1fr))', marginBottom: '14px' } },
      h('div', { class: 'card pad' }, h('h3', null, 'Where the hours went'), h('div', { class: 'chartrow' },
        donut(mix, { center: hrs(mixTotal).replace(/\B(?=(\d{3})+(?!\d))/g, ','), sub: 'total hours' }),
        h('div', { class: 'legend-list' }, mix.map((p) => h('div', { class: 'li' }, h('i', { class: 'sw', style: { background: p.color } }), p.label, h('b', null, hrs(p.value) + ' h')))))),
      h('div', { class: 'card pad' }, h('h3', null, 'Cost by pay date'), h('div', { class: 'chartrow' },
        donut(groups.map((g, i) => ({ label: g.label, value: g.gross, color: PALETTE[i % PALETTE.length] })), { center: money(A.gross), sub: 'gross pay' }),
        h('div', { class: 'legend-list' }, groups.map((g, i) => h('div', { class: 'li click', onClick: () => go('payroll', { group: g.label }) }, h('i', { class: 'sw', style: { background: PALETTE[i % PALETTE.length] } }), g.label, h('b', null, money(g.gross))))))));
  }
  function escalationCard(A) {
    const cfg = escalationCfg();
    const list = [...A.projects.values()].filter((p) => p.status === 'Over').sort((a, b) => b.dh - a.dh).slice(0, 8);
    const sent = new Map(); for (const e of S.signals.escalations) sent.set(e.project_name, (sent.get(e.project_name) || 0) + 1);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'grow' }, h('h3', { style: { margin: 0 } }, 'Projects over budget'), h('div', { class: 'small muted' }, 'One click emails the project’s point of contact (area manager) and logs it.')), h('a', { class: 'small', href: '#/projects' }, 'Manage contacts →')),
      list.length ? list.map((p) => {
        const poc = pocFor(p.label, S.projects), big = p.dh >= (+cfg.threshold_hours || 8) || (p.bh > 0 && (p.dh / p.bh) * 100 >= cfg.threshold_pct);
        return h('div', { class: 'poc' }, h('span', { class: 'avatar' }, initials(poc.name || p.label)),
          h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', null, p.label), h('div', { class: 'small muted' }, poc.name ? `${poc.name}${poc.email ? ' · ' + poc.email : ''}` : (poc.email || 'no contact saved yet'))),
          sent.get(p.label) ? h('span', { class: 'badge-sent' }, `sent ${sent.get(p.label)}×`) : null,
          h('div', { class: 'right', style: { minWidth: '110px' } }, h('b', { class: 'neg' }, '+' + hrs(p.dh) + ' h'), h('div', { class: 'small muted' }, p.bh > 0 ? ((p.dh / p.bh) * 100).toFixed(0) + '% over the hours budget' : 'no hours budget')),
          ctx.canEdit ? h('button', { class: 'btn sm ' + (big ? 'warn' : ''), onClick: () => openEscalate({ run: S.run, project: p.label, lines: view().filter((l) => normKey(l.project_name) === p.key), pstat: p.ps || null, onSent: softReload }) }, icon('mail'), 'Escalate') : null);
      }) : h('div', { class: 'muted' }, '✓ No project is over budget.'));
  }

  // ---------- page ----------
  function missingCard() {
    const miss = view().filter((l) => num(l.budget_hours_total) > 0 && num(l.actual_hours) === 0 && num(l.leave_hours) === 0 && (l.fixed_pay === null || l.fixed_pay === undefined));
    const people = new Map(); for (const l of miss) people.set(l.employee_id || l.employee_name.toLowerCase(), l);
    const list = [...people.values()].sort((a, b) => num(b.budget_hours_total) - num(a.budget_hours_total)).slice(0, 6);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } }, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'grow' }, h('h3', { style: { margin: 0 } }, 'Missing timesheets'), h('div', { class: 'small muted' }, 'People with a budget but no hours entered yet.')), h('span', { class: 'cn ' + (people.size ? 'r' : 'g') }, `${people.size} people`),
      ctx.can('page:chase') ? h('a', { class: 'btn sm warn', href: '#/chase' }, icon('mail'), 'Chase by email') : null),
      list.length ? h('div', { class: 'chips' }, list.map((l) => h('span', { class: 'chip', title: l.project_name }, `${l.employee_name} · ${hrs(num(l.window_budget_hours) || num(l.budget_hours_total))} h`)), people.size > list.length ? h('span', { class: 'small muted', style: { alignSelf: 'center' } }, `+${people.size - list.length} more`) : null) : h('div', { class: 'muted' }, '✓ Everyone with a budget has hours.'));
  }
  function kpisRow(A) {
    const pct = A.bh ? (A.dh / A.bh) * 100 : 0, vTone = A.dh > 0.25 ? 'neg' : A.dh < -0.25 ? 'pos' : '';
    const kpi2 = (cls, ic, label, value, sub, o) => { const el = kpi(label, value, sub, o); el.classList.add('c', cls); el.insertBefore(h('div', { class: 'kic' }, icon(ic)), el.firstChild); return el; };
    const lv = S.signals.leave, sspPay = view().reduce((s, l) => s + num(l.ssp_pay), 0), th = (n) => hrs(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const act = S.emps.filter((e) => e.active !== false), noHours = view().filter((l) => !l.is_adhoc_line && num(l.window_budget_hours) > 0 && num(l.actual_hours) === 0).length;
    return h('div', { class: 'grid kpis k8' },
      kpi2('kc-amber', 'clock', 'Hours worked', th(A.wh) + ' h', `of ${th(A.bh)} h budgeted · incl. paid leave`, { page: 'explorer' }),
      kpi2('kc-blue', 'grid', 'Budget hours', th(A.bh) + ' h', 'project weekly hours budgets', { page: 'budgets' }),
      kpi2(A.dh > 0.25 ? 'kc-red' : 'kc-green', 'trend', 'Hours difference', (A.dh > 0 ? '+' : '') + th(A.dh) + ' h', `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% · ${A.dh > 0.25 ? 'over the hours budget' : A.dh < -0.25 ? 'under the hours budget' : 'on the hours budget'}`, { cls: vTone, page: 'budgets' }),
      kpi2('kc-red', 'alert', 'Projects over budget', String(A.projOver), `${th(A.projOverH)} h over their weekly budget`, { cls: A.projOver ? 'neg' : '', page: 'budgets' }),
      kpi2('kc-green', 'check', 'Projects under budget', String(A.projUnder), `of ${A.projects.size} projects`, { page: 'budgets' }),
      kpi2('kc-pink', 'users', 'Employees over budget', String(A.over), `${th(A.overH)} h over their own budget`, { cls: A.over ? 'neg' : '', page: 'payroll', params: { status: 'Over' } }),
      kpi2('kc-violet', 'sun', 'Ad-hoc hours', th(A.adhocH) + ' h', 'charged to clients, not budgeted', { page: 'adhoc' }),
      kpi2('kc-teal', 'pound', 'Ad-hoc to charge', money(A.adhocCharge), 'at each client’s ad-hoc rate', { page: 'adhoc' }),
      kpi2('kc-slate', 'pound', 'Gross pay', money(A.gross), `${view().length.toLocaleString()} lines · £ is for information`, { page: 'payroll' }),
      kpi2('kc-blue', 'users', 'People paid', A.paid.size.toLocaleString(), `of ${A.people.size.toLocaleString()} people in this run`, { page: 'payroll' }),
      kpi2('kc-green', 'users', 'Active employees', act.length.toLocaleString(), noHours ? `${noHours} lines have a budget but no hours yet` : 'everyone has hours', { page: 'people' }),
      kpi2('kc-amber', 'sun', 'Leave & SSP', String(lv.length), `SSP ${money(sspPay)} · ${lv.filter((x) => !x.paid && !x.ssp).length} unpaid`, { page: 'leave' }));
  }

  // ---------- project focus: show only the projects you choose, everywhere on the dashboard ----------
  async function setFocus(set) {
    S.focus = set; const v = { ...(ctx.prefs.dashboard || {}), focus: [...set] };
    try { await savePref('dashboard', v); ctx.prefs.dashboard = v; } catch (e) { toast(e.message, 'err'); }
    paint();
  }
  function projectPicker(title, hint, initial, onDone) {
    const all = [...new Set(S.lines.map((l) => l.project_name))].sort(natCompare), stats = new Map();
    for (const l of S.lines) { const p = stats.get(l.project_name) || { wh: 0, bh: 0 }; p.wh += num(l.window_worked_hours); p.bh += num(l.window_budget_hours); stats.set(l.project_name, p); }
    modal(title, (close) => {
      const sel = new Set(initial), q = h('input', { type: 'search', placeholder: 'Search projects…' }), list = h('div', { class: 'wlist', style: { maxHeight: '46vh', overflow: 'auto' } }), count = h('span', { class: 'small muted' }, `${sel.size} selected`);
      const draw = () => clear(list).append(...all.filter((p) => !q.value || p.toLowerCase().includes(q.value.toLowerCase())).map((p) => h('label', { class: 'wrow' },
        h('input', { type: 'checkbox', checked: sel.has(p), onChange: (e) => { e.target.checked ? sel.add(p) : sel.delete(p); count.textContent = `${sel.size} selected`; } }), h('div', { class: 'grow' }, p), h('span', { class: 'small muted' }, `${hrs(stats.get(p).wh)} / ${hrs(stats.get(p).bh)} h`))));
      q.addEventListener('input', draw); draw();
      return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, hint), q, list,
        h('div', { class: 'row wrap' }, count, h('button', { class: 'btn sm', onClick: () => { const top = [...stats.entries()].sort((a, b) => b[1].wh - a[1].wh).slice(0, 3).map((x) => x[0]); sel.clear(); top.forEach((p) => sel.add(p)); count.textContent = `${sel.size} selected`; draw(); } }, 'Pick the 3 busiest'), h('div', { class: 'grow' }),
          h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { close(); await onDone(sel); } }, 'Use these')));
    }, { wide: true });
  }
  function focusBar() {
    const n = new Set(S.lines.map((l) => l.project_name)).size;
    return h('div', { class: 'focusbar' }, h('span', { class: 'small muted' }, 'Showing'),
      S.focus.size ? [...S.focus].map((p) => h('span', { class: 'chip on', title: 'Click to remove', onClick: () => { const s2 = new Set(S.focus); s2.delete(p); setFocus(s2); } }, p + ' ×')) : h('span', { class: 'chip' }, `all ${n} projects`),
      h('button', { class: 'btn sm', onClick: () => projectPicker('Choose the projects to focus on', 'Every card, chart and table on the dashboard will show only these projects. Leave none ticked to see everything.', S.focus, setFocus) }, icon('folder'), S.focus.size ? 'Change projects' : 'Choose projects'),
      S.focus.size ? h('button', { class: 'btn sm ghost', onClick: () => setFocus(new Set()) }, 'Show all') : null);
  }

  // ---------- compare pay cycles and projects ----------
  S.cmp = { key: '', lines: [] };
  function cmpCfg() {
    const c = ((ctx.prefs.dashboard || {}).compare) || {}, valid = (c.runs || []).filter((id) => ctx.runs.some((r) => r.id === id));
    return { by: c.by || 'project', metric: c.metric || 'hours', runs: valid.length ? valid : ctx.runs.slice(0, 2).map((r) => r.id), projects: c.projects || [] };
  }
  async function cmpLoad() { const c = cmpCfg(), key = c.runs.join(','); if (S.cmp.key === key) return; S.cmp.key = key; [S.cmp.lines, S.cmp.ps] = c.runs.length ? await Promise.all([loadLinesForRuns(c.runs).catch(() => []), loadProjectStatusForRuns(c.runs).catch(() => [])]) : [[], []]; }
  async function cmpSave(patch) {
    const v = { ...(ctx.prefs.dashboard || {}), compare: { ...cmpCfg(), ...patch } };
    try { await savePref('dashboard', v); ctx.prefs.dashboard = v; } catch (e) { toast(e.message, 'err'); }
    await cmpLoad(); paint();
  }
  function compareCard() {
    const c = cmpCfg(), runs = c.runs.map((id) => ctx.runs.find((r) => r.id === id)).filter(Boolean);
    const pick = c.projects.length ? c.projects : [...S.focus];
    const lines = S.cmp.lines.filter((l) => !pick.length || pick.includes(l.project_name));
    const cats = new Map();
    if (c.by === 'project') { const gx = new Map(); for (const l of S.cmp.lines) gx.set(l.run_id + '|' + normKey(l.project_name), num(l.gross_pay) + (gx.get(l.run_id + '|' + normKey(l.project_name)) || 0));
      for (const p of (S.cmp.ps || [])) { if (pick.length && !pick.some((x) => normKey(x) === p.project_key)) continue; const row = cats.get(p.project_key) || { label: p.project_name, by: new Map(), tot: 0 }; row.by.set(p.run_id, { bh: num(p.budget_hours), wh: num(p.worked_hours), dh: num(p.hours_difference), gross: gx.get(p.run_id + '|' + p.project_key) || 0 }); row.tot += num(p.worked_hours); cats.set(p.project_key, row); } }
    else for (const l of lines) { const k = l.pay_group || 'Unassigned'; const row = cats.get(k) || { label: k, by: new Map(), tot: 0 }; const r = row.by.get(l.run_id) || { bh: 0, wh: 0, dh: 0, gross: 0 };
      r.bh += num(l.window_budget_hours); r.wh += num(l.window_worked_hours); r.dh += num(l.hours_difference); r.gross += num(l.gross_pay); row.by.set(l.run_id, r); row.tot += num(l.window_worked_hours); cats.set(k, row); }
    let rows = [...cats.values()].sort((a, b) => (c.by === 'project' ? b.tot - a.tot : natCompare(a.label, b.label))); const more = c.by === 'project' && !pick.length && rows.length > 8; if (c.by === 'project' && !pick.length) rows = rows.slice(0, 8);
    const val = (r) => (c.metric === 'hours' ? r.wh : r.gross), fmt = (v) => (c.metric === 'hours' ? hrs(v) + ' h' : money(v));
    const max = Math.max(1, ...rows.flatMap((row) => runs.map((rn) => (row.by.get(rn.id) ? val(row.by.get(rn.id)) : 0))));
    const seg = (key, val2, label, cur) => h('button', { class: cur === val2 ? 'on' : '', onClick: () => cmpSave({ [key]: val2 }) }, label);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row wrap', style: { justifyContent: 'space-between', marginBottom: '8px' } },
        h('div', null, h('h3', { style: { margin: 0 } }, 'Compare pay cycles and projects'), h('div', { class: 'small muted' }, 'Pick the pay runs and projects you want side by side. Hours decide over / under budget; £ is for information.')),
        h('div', { class: 'row wrap' }, h('div', { class: 'seg' }, seg('by', 'project', 'By project', c.by), seg('by', 'pay_group', 'By pay date', c.by)), h('div', { class: 'seg' }, seg('metric', 'hours', 'Hours', c.metric), seg('metric', 'gross', 'Cost £', c.metric)))),
      h('div', { class: 'row wrap', style: { marginBottom: '8px' } },
        h('button', { class: 'btn sm', onClick: () => modal('Choose the pay runs to compare', (close) => { const sel = new Set(c.runs);
          return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Tick two or more — for example this month against last month, or monthly against fortnightly.'),
            h('div', { class: 'wlist' }, ctx.runs.map((r) => h('label', { class: 'wrow' }, h('input', { type: 'checkbox', checked: sel.has(r.id), onChange: (e) => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); } }), h('div', { class: 'grow' }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${r.label}`), h('span', { class: 'small muted' }, r.status === 'locked' ? 'previous' : 'open')))),
            h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => { if (!sel.size) return toast('Tick at least one pay run', 'err'); close(); cmpSave({ runs: [...sel] }); } }, 'Compare')));
        }) }, icon('cal'), `${runs.length} pay run${runs.length === 1 ? '' : 's'}`),
        h('button', { class: 'btn sm', onClick: () => projectPicker('Choose the projects to compare', 'Only these projects are compared. Leave none ticked to use the project focus (or the 8 busiest).', c.projects, (s) => cmpSave({ projects: [...s] })) }, icon('folder'), pick.length ? `${pick.length} project${pick.length === 1 ? '' : 's'}` : 'All projects'),
        h('div', { class: 'legend small muted', style: { margin: 0 } }, runs.map((r, i) => [h('i', { class: 'lg', style: { background: PALETTE[i % PALETTE.length] } }), r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label]))),
      rows.length ? h('div', { class: 'cmp' }, rows.map((row) => h('div', { class: 'cmprow' }, h('div', { class: 'lab', title: row.label }, row.label),
        h('div', { class: 'cmpbars' }, runs.map((rn, i) => { const r = row.by.get(rn.id); const over = r && r.bh > 0 && r.dh > 0.25;
          return h('div', { class: 'cmpbar', title: r ? `${rn.label}\nWorked ${hrs(r.wh)} h · budget ${hrs(r.bh)} h · diff ${(r.dh > 0 ? '+' : '') + hrs(r.dh)} h\nGross ${money(r.gross)}` : 'no data' },
            h('i', { style: { width: (r ? Math.max(1.5, 100 * val(r) / max) : 0) + '%', background: over ? '#e11d48' : PALETTE[i % PALETTE.length] } }),
            h('span', null, r ? fmt(val(r)) : '—', r && c.metric === 'hours' && r.bh > 0 ? h('em', { class: r.dh > 0.25 ? 'neg' : r.dh < -0.25 ? 'amber' : 'muted' }, ` ${r.dh > 0 ? '+' : ''}${hrs(r.dh)}`) : null)); })))),
        more ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Showing the 8 busiest projects — choose projects to compare others.') : null) : h('div', { class: 'muted' }, S.cmp.lines.length ? 'No data for these projects in the chosen pay runs.' : 'Loading…'));
  }

  // ---------- the two "boards" (staff-system style panels) ----------
  const lastDays = () => {
    const days = new Map(); for (const r of (S.daily || [])) { if (S.focus.size && !S.focus.has(r.project_name)) continue; const k = String(r.work_date).slice(0, 10); const dd = days.get(k) || { date: k, hours: 0, people: new Set(), pay: 0, proj: new Map() }; const hh = num(r.hours); dd.hours += hh; dd.people.add(r.employee_name);
      if (['hourly', 'cover'].includes(String(r.contract_type || '').toLowerCase())) dd.pay += hh * num(r.hourly_rate); dd.proj.set(r.project_name, (dd.proj.get(r.project_name) || 0) + hh); days.set(k, dd); }
    const today = new Date().toISOString().slice(0, 10), ks = [...days.keys()].filter((k) => days.get(k).hours > 0).sort(), past = ks.filter((k) => k <= today);
    const use = past.length >= 2 ? past : ks; return [days.get(use[use.length - 1]), days.get(use[use.length - 2])];
  };
  function panel(title, cls, ...kids) { return h('div', { class: 'vp ' + (cls || '') }, h('div', { class: 'vph' }, title), h('div', { class: 'vpb' }, kids)); }
  function boardTop(A) {
    const sspH = (S.signals.leave || []).filter((x) => x.ssp).reduce((s, x) => s + num(x.hours), 0), unpaid = view().reduce((s, l) => s + num(l.unpaid_leave_hours), 0);
    const bars = [['Worked', A.wd, '#22c55e'], ['Paid leave', Math.max(0, A.wh - A.wd), '#3b82f6'], ['SSP (sick)', sspH, '#ef4444'], ['Unpaid leave', unpaid, '#f59e0b'], ['Over the budget by', Math.max(0, A.overH), '#a855f7']];
    const mx = Math.max(1, ...bars.map((b) => b[1]));
    const [t, y] = lastDays(); const dayCol = (label, dd) => h('div', { class: 'dcol' }, h('div', { class: 'dh' }, label, dd ? h('span', null, dmy(dd.date)) : null),
      dd ? [h('div', { class: 'dstat' }, h('span', null, 'Hours worked'), h('b', null, hrs(dd.hours))), h('div', { class: 'dstat' }, h('span', null, 'People'), h('b', null, dd.people.size)), h('div', { class: 'dstat' }, h('span', null, 'Est. pay'), h('b', null, money(dd.pay))), h('div', { class: 'dstat' }, h('span', null, 'Projects'), h('b', null, dd.proj.size)),
        h('div', { class: 'dbars' }, [...dd.proj.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, hh], i) => h('div', { class: 'dbar', title: `${p}: ${hrs(hh)} h` }, h('i', { style: { height: Math.max(6, 100 * hh / Math.max(...dd.proj.values())) + '%', background: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'][i] } }), h('span', null, hrs(hh)))))] : h('div', { class: 'muted' }, 'No daily hours yet'));
    const lv = (S.leaveRows || []).filter((r) => !S.focus.size || S.focus.has(r.project_name)).slice().sort((a, b) => String(b.leave_date).localeCompare(String(a.leave_date))).slice(0, 7);
    return h('div', { class: 'vgrid' },
      panel('HOURS', 'light', ...bars.map(([l, v, col]) => h('div', { class: 'hbar' }, h('div', { class: 'hl' }, l, h('b', null, hrs(v) + ' h')), h('div', { class: 'ht' }, h('i', { style: { width: Math.max(v ? 2 : 0, 100 * v / mx) + '%', background: col } })))), h('div', { class: 'vtot' }, `Total people `, h('b', null, A.people.size.toLocaleString()))),
      panel('HOURS BY DAY', 'dark', h('div', { class: 'dgrid' }, dayCol('LATEST DAY', t), dayCol('PREVIOUS DAY', y))),
      panel('LEAVE & ABSENCES', 'light', lv.length ? h('table', { class: 'vt' }, h('thead', null, h('tr', null, ['Name', 'Project', 'Type', 'Date'].map((x) => h('th', null, x)))), h('tbody', null, lv.map((r) => h('tr', null, h('td', null, r.employee_name), h('td', null, r.project_name), h('td', null, h('span', { class: 'tag', style: { background: r.color || '#6c5ce7' } }, r.type_code)), h('td', null, dm(r.leave_date)))))) : h('div', { class: 'muted' }, 'No leave or absence recorded.')));
  }
  function boardBottom(A) {
    const weeks = [...A.weeks.values()].sort((a, b) => a.label.localeCompare(b.label)).map((w) => ({ ...w, diff: w.actual - w.budget }));
    const rem = A.bh - A.wh, mx = Math.max(1, A.bh, A.wh);
    return h('div', { class: 'vgrid two' },
      panel('PAY CYCLE DETAILS', 'light', h('table', { class: 'vt big' }, h('thead', null, h('tr', null, ['Week', 'Budget h', 'Worked h', 'Difference', 'Status'].map((x, i) => h('th', { class: i && i < 4 ? 'num' : '' }, x)))),
        h('tbody', null, weeks.map((w) => { const st = w.budget > 0 ? (w.diff > 0.25 ? 'over' : w.diff < -0.25 ? 'under' : 'ok') : (w.actual > 0 ? 'nb' : 'ok');
          return h('tr', { class: 'r-' + st, onClick: () => go('explorer', { from: w.label, to: addDays(w.label, 6), by: 'employee' }) }, h('td', null, `${dm(w.label)} – ${dm(addDays(w.label, 6))}`), h('td', { class: 'num' }, hrs(w.budget)), h('td', { class: 'num' }, hrs(w.actual)), h('td', { class: 'num' }, (w.diff > 0 ? '+' : '') + hrs(w.diff)), h('td', null, { over: 'Over budget', under: 'Under budget', ok: 'Within', nb: 'No budget' }[st])); })))),
      panel('HOURS BUDGET', 'dark', h('div', { class: 'obars' }, [['Budget hours', A.bh, '#38bdf8'], ['Hours worked', A.wh, A.wh > A.bh + 0.25 ? '#fb7185' : '#34d399'], [rem >= 0 ? 'Remaining' : 'Over by', Math.abs(rem), rem >= 0 ? '#fbbf24' : '#f43f5e']].map(([l, v, col]) => h('div', { class: 'ob' }, h('div', { class: 'ol' }, l, h('b', null, hrs(v) + ' h')), h('div', { class: 'ot' }, h('i', { style: { width: Math.max(v ? 2 : 0, 100 * v / mx) + '%', background: col } }))))),
        h('div', { class: 'small', style: { opacity: .8, marginTop: '10px' } }, 'Hours decide: more hours worked than budgeted = over budget.')));
  }

  // ---------- choose what you see (per person) ----------
  const roleDefault = () => (ctx.settings.dashboard_defaults || {})[ctx.me.role];
  function customise() {
    const pref = ctx.prefs.dashboard || {}, base = resolveLayout(pref, roleDefault());
    let order = [...((pref.order || []).filter((id) => WIDGETS.some((w) => w.id === id))), ...WIDGETS.map((w) => w.id).filter((id) => !(pref.order || []).includes(id))];
    const shown = new Set(base);
    modal('Customise your dashboard', (close) => {
      const list = h('div', { class: 'wlist' });
      const draw = () => { clear(list).append(...order.map((id, i) => { const w = WIDGETS.find((x) => x.id === id);
        return h('div', { class: 'wrow' }, h('input', { type: 'checkbox', checked: shown.has(id), onChange: (e) => { e.target.checked ? shown.add(id) : shown.delete(id); } }), h('div', { class: 'grow' }, w.title, h('div', { class: 'small muted', style: { fontWeight: 400 } }, w.desc)),
          h('button', { class: 'mv', disabled: i === 0, onClick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '↑'), h('button', { class: 'mv', disabled: i === order.length - 1, onClick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, '↓')); })); };
      draw();
      const roleSel = h('select', null, ['admin', 'editor', 'viewer'].map((r) => h('option', { value: r }, r)));
      return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Tick what you want on your dashboard and use the arrows to put it in order. This only changes your own view.'), list,
        h('div', { class: 'row wrap', style: { justifyContent: 'flex-end' } },
          ctx.can('manage_settings') ? h('div', { class: 'row small', style: { marginRight: 'auto', gap: '6px' } }, 'Make this the default for', roleSel, h('button', { class: 'btn sm', onClick: async () => { const d = { ...(ctx.settings.dashboard_defaults || {}) }; d[roleSel.value] = { hidden: WIDGETS.map((w) => w.id).filter((id) => !shown.has(id)) }; try { await saveSetting('dashboard_defaults', d); ctx.settings = await loadSettings(); toast(`Saved as the default for ${roleSel.value}`, 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Save as default')) : null,
          h('button', { class: 'btn', onClick: async () => { try { await savePref('dashboard', {}); ctx.prefs.dashboard = {}; close(); paint(); toast('Back to the standard layout', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Reset'),
          h('button', { class: 'btn primary', onClick: async () => { const v = { order, hidden: order.filter((id) => !shown.has(id)) }; try { await savePref('dashboard', v); ctx.prefs.dashboard = v; close(); paint(); toast('Dashboard saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Save my dashboard')));
    }, { wide: true });
  }

  // ---------- page ----------
  function paint() {
    const run = S.run, A = analyse();
    const W = { compare: () => compareCard(), board_top: () => boardTop(A), board_bottom: () => boardBottom(A), hero: () => heroCard(A), checklist: () => trackerCard(A), kpis: () => kpisRow(A), donuts: () => donutsCard(A), escalations: () => escalationCard(A), missing: () => missingCard(), chart: () => chartCard(A), table: () => tableCard(A),
      attention: () => h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', marginBottom: '14px' } }, attentionCard(A), exceptionCard('Most hours over budget', 'Over'), exceptionCard('Most hours under budget', 'Under')) };
    const ids = resolveLayout(ctx.prefs.dashboard, roleDefault());
    clear(body).append(focusBar(), ...ids.map((id) => (W[id] ? W[id]() : null)).filter(Boolean), !ids.length ? h('div', { class: 'card empty' }, 'Everything is hidden. Use “Customise” to choose what you want to see.') : null,
      ctx.can('delete_run') && run.status !== 'locked' ? h('div', { class: 'card pad', style: { marginTop: '22px' } }, h('h3', null, 'Administration'), h('p', { class: 'small muted' }, 'Deleting a pay run removes all of its lines for everyone.'),
        h('button', { class: 'btn danger sm', onClick: async () => {
          if (await confirmBox('Delete this pay run?', `“${run.label}” and all of its lines will be permanently removed for every user.`, 'Delete run', true)) {
            try { await deleteRun(run.id); ctx.runs = await loadRuns(); toast('Run deleted', 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
          } } }, icon('trash'), 'Delete this run')) : null);
    if (input.value.trim().length >= 2 && !results.classList.contains('hidden')) runSearch();
  }

  async function load() {
    S.run = currentRun();
    const [data, periods, signals, projects] = await Promise.all([loadRunData(S.run.id), loadPeriods(S.run.id), loadSignals(S.run.id).catch(() => S.signals), loadProjects().catch(() => [])]);
    S.run = currentRun(); S.lines = data.lines; S.weeksByLine = data.weeksByLine; S.periods = periods; S.signals = signals; S.projects = projects;
    [S.pstat, S.adhoc, S.emps] = await Promise.all([loadProjectStatus(S.run.id).then((r) => new Map(r.map((p) => [p.project_key, p]))).catch(() => new Map()), loadAdhoc(S.run.id).catch(() => []), loadEmployeesFull().catch(() => [])]);
    const vis = resolveLayout(ctx.prefs.dashboard, roleDefault());
    if (vis.includes('board_top')) { [S.daily, S.leaveRows] = await Promise.all([loadDailyForRun(S.run.id).catch(() => []), loadRunLeave(S.run.id).catch(() => [])]); }
    if (vis.includes('compare')) await cmpLoad();
    paint();
    S.ov = S.ov || {};
    try { clear(ovHost).append(overview({ run: S.run, lines: S.lines, periods: S.periods, adhoc: S.adhoc, onReload: () => softReload(), state: S.ov, picker: runPicker(() => { location.reload(); }) })); } catch (e) { console.error(e); }
  }
  const softReload = debounce(() => load().catch(console.error), 700);

  clear(body).append(h('div', { class: 'empty' }, 'Loading…'));
  await load();
  const off = onLive(debounce(() => load().catch(console.error), 1000));
  return () => { off(); document.removeEventListener('click', onDoc); };
}
