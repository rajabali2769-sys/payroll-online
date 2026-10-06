// Dashboard: where is this pay run, what needs attention, and a one-click way into the detail.
import { loadRunData, loadPeriods, loadRuns, onLive, deleteRun, approveRun, lockRun, unlockRun, loadSignals, loadProjects, savePref, saveSetting, loadSettings } from './api.js';
import { WIDGETS, resolveLayout } from './widgets.js';
import { h, clear, money, hrs, dm, dmy, addDays, ago, debounce, natCompare, confirmBox, toast, icon, donut, ring, PALETTE, initials, modal } from './ui.js';
import { ctx, currentRun, runPicker, escalationCfg } from './ctx.js';
import { openEscalate, pocFor, summarise } from './escalate.js';
import { go } from './app.js';
import { openLineDrawer } from './line-drawer.js';

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

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Dashboard'), h('p', null, 'Where this pay run stands, what needs a look, and one click into the detail.')), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => customise() }, icon('gear'), 'Customise'), runPicker(() => load()))),
    h('div', { class: 'searchbox', style: { marginBottom: '14px' } }, h('span', { class: 'sglass' }, icon('search')), input, results),
    body);

  // ---------- maths for the page ----------
  function analyse() {
    const A = { groups: new Map(), projects: new Map(), weeks: new Map(), gross: 0, budget: 0, diff: 0, hours: 0, leave: 0, over: 0, under: 0, overSum: 0, underSum: 0,
      people: new Set(), paid: new Set(), noType: 0, noGroup: 0, bigOver: 0, overrides: 0 };
    for (const l of S.lines) {
      const g = l.pay_group || 'Unassigned', gross = num(l.gross_pay), bud = num(l.budgeted_pay), diff = num(l.difference);
      const G = A.groups.get(g) || { label: g, lines: 0, hours: 0, gross: 0, budget: 0, diff: 0, over: 0, under: 0 };
      G.lines++; G.hours += num(l.actual_hours); G.gross += gross; G.budget += bud; G.diff += diff;
      if (l.budget_status === 'Over') G.over++;
      if (l.budget_status === 'Under') G.under++;
      A.groups.set(g, G);
      const P = A.projects.get(l.project_name) || { label: l.project_name, lines: 0, gross: 0, budget: 0, diff: 0 };
      P.lines++; P.gross += gross; P.budget += bud; P.diff += diff; A.projects.set(l.project_name, P);
      A.gross += gross; A.budget += bud; A.diff += diff; A.hours += num(l.actual_hours); A.leave += num(l.leave_hours);
      const pid = l.employee_id || l.employee_name.toLowerCase(); A.people.add(pid); if (gross > 0) A.paid.add(pid);
      if (l.budget_status === 'Over') { A.over++; A.overSum += diff; if (diff > 500) A.bigOver++; }
      if (l.budget_status === 'Under') { A.under++; A.underSum += diff; }
      if (!l.contract_type) A.noType++;
      if (!l.pay_group) A.noGroup++;
      const ws = S.weeksByLine.get(l.id) || [];
      if (ws.some((w) => w.variance_override !== null && w.variance_override !== undefined)) A.overrides++;
      for (const w of ws) { const W = A.weeks.get(w.week_start) || { label: w.week_start, budget: 0, actual: 0 }; W.budget += num(w.budget); W.actual += num(w.delivered) + num(w.leave); A.weeks.set(w.week_start, W); }
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
    const used = A.budget > 0 ? (A.gross / A.budget) * 100 : 0;
    const note = st === 'locked' ? `🔒 Locked by ${who(run.locked_by_email)}${run.locked_at ? ', ' + ago(run.locked_at) : ''}. Nobody can change this pay run until an admin unlocks it.`
      : st === 'approved' ? `✓ Approved by ${who(run.approved_by_email)}${run.approved_at ? ', ' + ago(run.approved_at) : ''}. Any edit or re-import withdraws the approval.`
      : ctx.can('approve_lock') ? 'The team keeps updating this pay run while it is open. When it has been checked, approve it, then lock it.' : 'The team updates this pay run while it is open. An admin approves and locks it once checked.';
    return h('div', { class: 'hero' },
      h('div', { class: 'row wrap', style: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '18px' } },
        h('div', { style: { minWidth: '260px', flex: 1 } },
          h('div', { class: 'eyebrow' }, 'Current pay run'), h('h2', null, run.label), h('div', { class: 'meta' }, meta, ' ', h('span', { class: 'pill st-' + st }, STATUS_TEXT[st] || st)),
          h('div', { class: 'big' }, money(A.gross)), h('div', { class: 'bigsub' }, `gross pay · ${A.paid.size.toLocaleString()} people paid · ${S.lines.length.toLocaleString()} lines`),
          h('div', { class: 'hstats' },
            h('div', null, h('b', null, money(A.budget)), h('span', null, 'budgeted')),
            h('div', null, h('b', null, (A.diff > 0 ? '+' : '') + money(A.diff)), h('span', null, A.diff > 0.5 ? 'over budget' : A.diff < -0.5 ? 'under budget' : 'on budget')),
            h('div', null, h('b', null, hrs(A.hours).replace(/\B(?=(\d{3})+(?!\d))/g, ',')), h('span', null, 'hours worked'))),
          h('div', { class: 'note' }, note)),
        h('div', { class: 'row', style: { gap: '22px', alignItems: 'center' } },
          ring(used, { size: 124, thick: 13, color: used > 100.5 ? '#fda4af' : '#5eead4', label: A.budget ? Math.round(used) + '%' : '–', sub: 'of budget used' }),
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
    const expected = S.lines.filter((l) => num(l.budget_hours_total) > 0 || (l.fixed_pay !== null && l.fixed_pay !== undefined));
    const withHours = expected.filter((l) => num(l.actual_hours) > 0 || (l.fixed_pay !== null && l.fixed_pay !== undefined)).length;
    const lv = sg.leave, paidL = lv.filter((x) => x.paid && !x.ssp).length, sspL = lv.filter((x) => x.ssp).length, unpL = lv.filter((x) => !x.paid && !x.ssp).length;
    const escProjects = new Set(sg.escalations.map((e) => e.project_name)).size;
    const within = S.lines.length - A.over - A.under;
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
      const list = [...A.projects.values()].sort((a, b) => (S.projectSort === 'over' ? b.diff - a.diff : b.gross - a.gross)).slice(0, 12);
      return { rows: list.map((p) => ({ label: p.label, budget: p.budget, actual: p.gross, go: () => go('payroll', { project: p.label }) })), fmt: money, aName: 'Gross pay', bName: 'Budgeted pay', hint: 'Click a project to open its lines in Payroll.' };
    }
    return { rows: [...A.groups.values()].sort((a, b) => natCompare(a.label, b.label)).map((g) => ({ label: g.label, budget: g.budget, actual: g.gross, go: () => go('payroll', { group: g.label }) })), fmt: money, aName: 'Gross pay', bName: 'Budgeted pay', hint: 'Click a pay date to open its lines in Payroll.' };
  }
  function chartCard(A) {
    const { rows, fmt, aName, bName, hint } = chartRows(A);
    const max = Math.max(1, ...rows.flatMap((r) => [r.budget, r.actual]));
    const seg = (key, label) => h('button', { class: S.view === key ? 'on' : '', onClick: () => { S.view = key; paint(); } }, label);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row wrap', style: { justifyContent: 'space-between', marginBottom: '10px' } },
        h('div', null, h('h3', { style: { margin: 0 } }, 'Budget vs actual'), h('div', { class: 'small muted' }, hint)),
        h('div', { class: 'row wrap' },
          S.view === 'project' ? h('div', { class: 'seg' }, h('button', { class: S.projectSort === 'cost' ? 'on' : '', onClick: () => { S.projectSort = 'cost'; paint(); } }, 'Biggest cost'), h('button', { class: S.projectSort === 'over' ? 'on' : '', onClick: () => { S.projectSort = 'over'; paint(); } }, 'Biggest overspend')) : null,
          h('div', { class: 'seg' }, seg('group', 'By pay date'), seg('project', 'By project'), seg('week', 'By week')))),
      h('div', { class: 'legend small muted' }, h('i', { class: 'lg b' }), bName, h('i', { class: 'lg a' }), aName, h('i', { class: 'lg o' }), 'over budget'),
      rows.length ? h('div', { class: 'chart' }, rows.map((r) => {
        const diff = r.actual - r.budget, state = (diff > 0.5 && r.budget > 0) || (r.budget === 0 && r.actual > 0.5) ? 'over' : diff < -0.5 ? 'under' : 'ok';
        return h('div', { class: 'crow', tabindex: 0, title: `${r.label}\n${bName}: ${fmt(r.budget)}\n${aName}: ${fmt(r.actual)}\nDifference: ${fmt(diff)}`, onClick: r.go, onKeydown: (e) => { if (e.key === 'Enter') r.go(); } },
          h('div', { class: 'lab' }, r.label),
          h('div', { class: 'ctrack' }, h('div', { class: 'cbar b', style: { width: Math.max(1, 100 * r.budget / max) + '%' } }), h('div', { class: 'cbar a ' + state, style: { width: Math.max(1, 100 * r.actual / max) + '%' } })),
          h('div', { class: 'val' }, h('b', null, fmt(r.actual)), h('span', { class: 'muted' }, ' / ' + fmt(r.budget)), h('div', { class: 'small ' + (state === 'over' ? 'neg' : state === 'under' ? 'amber' : 'muted') }, (diff > 0 ? '+' : '') + fmt(diff))));
      })) : h('div', { class: 'muted' }, 'No data to chart.'));
  }

  // ---------- pay date table (click headers to sort, click a row to open it) ----------
  function tableCard(A) {
    const win = new Map(S.periods.map((p) => [p.pay_group, p]));
    const cols = [['pay_group', 'Pay date'], ['window', 'Reconciliation window', true], ['lines', 'Lines'], ['hours', 'Hours'], ['gross', 'Gross'], ['budget', 'Budget'], ['diff', 'Difference'], ['over', 'Over'], ['under', 'Under']];
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
            h('td', { class: 'num' }, r.lines), h('td', { class: 'num' }, hrs(r.hours)), h('td', { class: 'num' }, money(r.gross)), h('td', { class: 'num' }, money(r.budget)),
            h('td', { class: 'num ' + (r.diff > 0.5 ? 'neg' : r.diff < -0.5 ? 'pos' : '') }, money(r.diff)), h('td', { class: 'num' }, r.over || ''), h('td', { class: 'num' }, r.under || ''),
            h('td', { style: { minWidth: '110px' } }, h('div', { class: 'bar' }, h('i', { style: { width: (100 * r.gross / maxGross) + '%' } }))),
            h('td', null, h('span', { class: 'btn sm' }, 'Open')));
        })))));
  }

  // ---------- what needs attention ----------
  function attentionCard(A) {
    const items = [
      A.over && { n: A.over, text: 'lines are over budget', sub: money(A.overSum) + ' in total', page: 'payroll', params: { status: 'Over' }, tone: 'bad' },
      A.bigOver && { n: A.bigOver, text: 'lines are more than £500 over budget', sub: 'worth checking first', page: 'payroll', params: { status: 'Over' }, tone: 'bad' },
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
    const rows = S.lines.filter((l) => (kind === 'Over' ? num(l.difference) > 0.5 : num(l.difference) < -0.5))
      .sort((a, b) => (kind === 'Over' ? num(b.difference) - num(a.difference) : num(a.difference) - num(b.difference))).slice(0, 8);
    return h('div', { class: 'card pad' }, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0 }, class: 'grow' }, title),
      rows.length ? h('a', { class: 'small', href: '#/payroll?status=' + kind }, 'See all →') : null),
      rows.length ? h('table', { class: 't' }, h('tbody', null, rows.map((l) => h('tr', { class: 'clickrow', onClick: () => openLine(l.id) },
        h('td', null, h('b', { class: 'link' }, l.employee_name), h('div', { class: 'small muted' }, [l.project_name, l.site_name].filter(Boolean).join(' · '))),
        h('td', null, h('span', { class: 'pill grp' }, l.pay_group || '—')), h('td', { class: 'num ' + (kind === 'Over' ? 'neg' : 'pos') }, money(l.difference))))))
        : h('div', { class: 'muted' }, 'Nothing to review'));
  }

  // ---------- donuts + escalation ----------
  function donutsCard(A) {
    const sspH = S.signals.leave.filter((x) => x.ssp).reduce((s, x) => s + num(x.hours), 0);
    const unpaid = S.lines.reduce((s, l) => s + num(l.unpaid_leave_hours), 0);
    const mix = [{ label: 'Worked', value: A.hours, color: '#6c5ce7' }, { label: 'Paid leave', value: A.leave, color: '#2563eb' }, { label: 'SSP (sick)', value: sspH, color: '#e84393' }, { label: 'Unpaid leave', value: unpaid, color: '#94a3b8' }];
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
    const list = [...A.projects.values()].filter((p) => p.diff > Math.max(0.5, cfg.threshold_gbp > 0 ? 0.5 : 0.5)).sort((a, b) => b.diff - a.diff).slice(0, 8);
    const sent = new Map(); for (const e of S.signals.escalations) sent.set(e.project_name, (sent.get(e.project_name) || 0) + 1);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'grow' }, h('h3', { style: { margin: 0 } }, 'Projects over budget'), h('div', { class: 'small muted' }, 'One click emails the project’s point of contact (area manager) and logs it.')), h('a', { class: 'small', href: '#/projects' }, 'Manage contacts →')),
      list.length ? list.map((p) => {
        const poc = pocFor(p.label, S.projects), big = p.diff >= cfg.threshold_gbp || (p.budget > 0 && (p.diff / p.budget) * 100 >= cfg.threshold_pct);
        return h('div', { class: 'poc' }, h('span', { class: 'avatar' }, initials(poc.name || p.label)),
          h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', null, p.label), h('div', { class: 'small muted' }, poc.name ? `${poc.name}${poc.email ? ' · ' + poc.email : ''}` : (poc.email || 'no contact saved yet'))),
          sent.get(p.label) ? h('span', { class: 'badge-sent' }, `sent ${sent.get(p.label)}×`) : null,
          h('div', { class: 'right', style: { minWidth: '110px' } }, h('b', { class: 'neg' }, '+' + money(p.diff)), h('div', { class: 'small muted' }, p.budget > 0 ? ((p.diff / p.budget) * 100).toFixed(0) + '% over' : 'no budget')),
          ctx.canEdit ? h('button', { class: 'btn sm ' + (big ? 'warn' : ''), onClick: () => openEscalate({ run: S.run, project: p.label, lines: S.lines.filter((l) => l.project_name === p.label), onSent: softReload }) }, icon('mail'), 'Escalate') : null);
      }) : h('div', { class: 'muted' }, '✓ No project is over budget.'));
  }

  // ---------- page ----------
  function missingCard() {
    const miss = S.lines.filter((l) => num(l.budget_hours_total) > 0 && num(l.actual_hours) === 0 && num(l.leave_hours) === 0 && (l.fixed_pay === null || l.fixed_pay === undefined));
    const people = new Map(); for (const l of miss) people.set(l.employee_id || l.employee_name.toLowerCase(), l);
    const list = [...people.values()].sort((a, b) => num(b.budgeted_pay) - num(a.budgeted_pay)).slice(0, 6);
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } }, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'grow' }, h('h3', { style: { margin: 0 } }, 'Missing timesheets'), h('div', { class: 'small muted' }, 'People with a budget but no hours entered yet.')), h('span', { class: 'cn ' + (people.size ? 'r' : 'g') }, `${people.size} people`),
      ctx.can('page:chase') ? h('a', { class: 'btn sm warn', href: '#/chase' }, icon('mail'), 'Chase by email') : null),
      list.length ? h('div', { class: 'chips' }, list.map((l) => h('span', { class: 'chip', title: l.project_name }, `${l.employee_name} · ${money(l.budgeted_pay)}`)), people.size > list.length ? h('span', { class: 'small muted', style: { alignSelf: 'center' } }, `+${people.size - list.length} more`) : null) : h('div', { class: 'muted' }, '✓ Everyone with a budget has hours.'));
  }
  function kpisRow(A) {
    const pct = A.budget ? (A.diff / A.budget) * 100 : 0, vTone = A.diff > 0.5 ? 'neg' : A.diff < -0.5 ? 'pos' : '';
    const kpi2 = (cls, ic, label, value, sub, o) => { const el = kpi(label, value, sub, o); el.classList.add('c', cls); el.insertBefore(h('div', { class: 'kic' }, icon(ic)), el.firstChild); return el; };
    const lv = S.signals.leave, sspPay = S.lines.reduce((s, l) => s + num(l.ssp_pay), 0);
    return h('div', { class: 'grid kpis k8' },
      kpi2('kc-violet', 'pound', 'Gross pay', money(A.gross), `${S.lines.length.toLocaleString()} payroll lines`, { page: 'payroll' }),
      kpi2('kc-blue', 'grid', 'Budgeted pay', money(A.budget), 'weekly budgets / fixed pay', { page: 'payroll' }),
      kpi2(A.diff > 0.5 ? 'kc-red' : 'kc-green', 'trend', 'Difference', money(A.diff), `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% · ${A.diff > 0.5 ? 'over budget' : A.diff < -0.5 ? 'under budget' : 'on budget'}`, { cls: vTone, page: 'payroll', params: { status: A.diff >= 0 ? 'Over' : 'Under' } }),
      kpi2('kc-teal', 'users', 'People paid', A.paid.size.toLocaleString(), `of ${A.people.size.toLocaleString()} people in this run`, { page: 'payroll' }),
      kpi2('kc-amber', 'clock', 'Hours worked', hrs(A.hours).replace(/\B(?=(\d{3})+(?!\d))/g, ','), `plus ${hrs(A.leave)} paid leave hours`, { page: 'explorer' }),
      kpi2('kc-red', 'alert', 'Over budget', String(A.over), `${money(A.overSum)} over`, { cls: A.over ? 'neg' : '', page: 'payroll', params: { status: 'Over' } }),
      kpi2('kc-green', 'check', 'Under budget', String(A.under), `${money(A.underSum)} under`, { page: 'payroll', params: { status: 'Under' } }),
      kpi2('kc-pink', 'sun', 'Leave & SSP', String(lv.length), `SSP ${money(sspPay)} · ${lv.filter((x) => !x.paid && !x.ssp).length} unpaid`, { page: 'leave' }));
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
    const W = { hero: () => heroCard(A), checklist: () => trackerCard(A), kpis: () => kpisRow(A), donuts: () => donutsCard(A), escalations: () => escalationCard(A), missing: () => missingCard(), chart: () => chartCard(A), table: () => tableCard(A),
      attention: () => h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', marginBottom: '14px' } }, attentionCard(A), exceptionCard('Largest overspends', 'Over'), exceptionCard('Largest underspends', 'Under')) };
    const ids = resolveLayout(ctx.prefs.dashboard, roleDefault());
    clear(body).append(...ids.map((id) => (W[id] ? W[id]() : null)).filter(Boolean), !ids.length ? h('div', { class: 'card empty' }, 'Everything is hidden. Use “Customise” to choose what you want to see.') : null,
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
    paint();
  }
  const softReload = debounce(() => load().catch(console.error), 700);

  clear(body).append(h('div', { class: 'empty' }, 'Loading…'));
  await load();
  const off = onLive(debounce(() => load().catch(console.error), 1000));
  return () => { off(); document.removeEventListener('click', onDoc); };
}
