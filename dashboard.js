// Dashboard: where is this pay run, what needs attention, and a one-click way into the detail.
import { loadRunData, loadPeriods, loadRuns, onLive, deleteRun, approveRun, lockRun, unlockRun } from './api.js';
import { h, clear, money, hrs, dm, dmy, addDays, ago, debounce, natCompare, confirmBox, toast, icon } from './ui.js';
import { ctx, currentRun, runPicker } from './ctx.js';
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
  const S = { run: null, lines: [], weeksByLine: new Map(), periods: [], view: 'group', projectSort: 'cost', sort: { key: 'pay_group', dir: 1 }, hit: -1 };
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
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Dashboard'), h('p', null, 'Where this pay run stands, what needs a look, and one click into the detail.')), runPicker(() => load())),
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

  function statusCard() {
    const run = S.run, st = run.status || 'ready';
    const meta = [run.stream === 'monthly' ? 'Monthly' : 'Fortnightly', run.period_start ? `${dmy(run.period_start)} – ${dmy(run.period_end)}` : ''].filter(Boolean).join(' · ');
    const note = st === 'locked' ? `🔒 Locked by ${who(run.locked_by_email)}${run.locked_at ? ', ' + ago(run.locked_at) : ''}. Nobody can change this pay run until an admin unlocks it.`
      : st === 'approved' ? `✓ Approved by ${who(run.approved_by_email)}${run.approved_at ? ', ' + ago(run.approved_at) : ''}. Any edit or re-import withdraws the approval, so it always means “nothing has changed since”.`
      : ctx.isAdmin ? 'Check the figures below. When you are happy with them, approve the pay run.' : 'An admin approves and locks a pay run once it has been checked.';
    return h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'row wrap', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', null, h('span', { class: 'pill st-' + st }, STATUS_TEXT[st] || st), h('h2', { style: { margin: '8px 0 2px', fontSize: '19px' } }, run.label), h('div', { class: 'muted' }, meta)),
        h('div', { class: 'row wrap' },
          ctx.isAdmin && st === 'ready' ? h('button', { class: 'btn primary', onClick: () => transition('approve') }, '✓ Approve pay run') : null,
          ctx.isAdmin && st === 'approved' ? [h('button', { class: 'btn primary', onClick: () => transition('lock') }, '🔒 Lock pay run'), h('button', { class: 'btn', onClick: () => transition('unlock') }, 'Withdraw approval')] : null,
          ctx.isAdmin && st === 'locked' ? h('button', { class: 'btn', onClick: () => transition('unlock') }, '🔓 Unlock') : null)),
      stepper(st), h('div', { class: 'small muted', style: { marginTop: '6px' } }, note));
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

  // ---------- page ----------
  function paint() {
    const run = S.run, A = analyse();
    const pct = A.budget ? (A.diff / A.budget) * 100 : 0;
    const vTone = A.diff > 0.5 ? 'neg' : A.diff < -0.5 ? 'pos' : '';
    clear(body).append(
      statusCard(),
      h('div', { class: 'grid kpis k8' },
        kpi('Gross pay', money(A.gross), `${S.lines.length.toLocaleString()} payroll lines`, { page: 'payroll' }),
        kpi('Budgeted pay', money(A.budget), 'weekly budgets / fixed pay', { page: 'payroll' }),
        kpi('Difference', money(A.diff), `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% · ${A.diff > 0.5 ? 'over budget' : A.diff < -0.5 ? 'under budget' : 'on budget'}`, { cls: vTone, page: 'payroll', params: { status: A.diff >= 0 ? 'Over' : 'Under' } }),
        kpi('People paid', A.paid.size.toLocaleString(), `of ${A.people.size.toLocaleString()} people in this run`, { page: 'payroll' }),
        kpi('Hours worked', hrs(A.hours).replace(/\B(?=(\d{3})+(?!\d))/g, ','), `plus ${hrs(A.leave)} leave hours`, { page: 'explorer' }),
        kpi('Over budget', String(A.over), `${money(A.overSum)} over`, { cls: A.over ? 'neg' : '', page: 'payroll', params: { status: 'Over' } }),
        kpi('Under budget', String(A.under), `${money(A.underSum)} under`, { page: 'payroll', params: { status: 'Under' } }),
        kpi('Average per person', A.paid.size ? money(A.gross / A.paid.size) : money(0), 'gross pay ÷ people paid', { page: 'payroll' })),
      chartCard(A), tableCard(A),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', marginBottom: '14px' } }, attentionCard(A), exceptionCard('Largest overspends', 'Over'), exceptionCard('Largest underspends', 'Under')),
      ctx.isAdmin && run.status !== 'locked' ? h('div', { class: 'card pad', style: { marginTop: '22px' } }, h('h3', null, 'Administration'), h('p', { class: 'small muted' }, 'Deleting a pay run removes all of its lines for everyone. You can also re-import a file on the Import page.'),
        h('button', { class: 'btn danger sm', onClick: async () => {
          if (await confirmBox('Delete this pay run?', `“${run.label}” and all of its lines will be permanently removed for every user.`, 'Delete run', true)) {
            try { await deleteRun(run.id); ctx.runs = await loadRuns(); toast('Run deleted', 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
          } } }, icon('trash'), 'Delete this run')) : null);
    if (input.value.trim().length >= 2 && !results.classList.contains('hidden')) runSearch();
  }

  async function load() {
    S.run = currentRun();
    const [data, periods] = await Promise.all([loadRunData(S.run.id), loadPeriods(S.run.id)]);
    S.run = currentRun(); S.lines = data.lines; S.weeksByLine = data.weeksByLine; S.periods = periods;
    paint();
  }
  const softReload = debounce(() => load().catch(console.error), 700);

  clear(body).append(h('div', { class: 'empty' }, 'Loading…'));
  await load();
  const off = onLive(debounce(() => load().catch(console.error), 1000));
  return () => { off(); document.removeEventListener('click', onDoc); };
}
