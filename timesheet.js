// Pure helpers (no browser needed, so they can be tested): reading timesheets, hours uploads, the payroll
// provider report, and building the Xero manual journal.
import { headerToISO, normKey } from './parsers.js';

const norm = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => { if (v === null || v === undefined || v === '') return 0; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[£,]/g, '')); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const addDaysISO = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const mondayOfISO = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------------------------------------------------------------------------------------------
// 1. A day cell: "9.30-14.30", "9:30am-3:30pm", "9.30 2.30", "5", "5h", "0", "-"  ->  hours
// ---------------------------------------------------------------------------------------------
function toMinutes(h, m, ap) {
  let H = +h; const M = +m || 0;
  if (ap) { const a = ap.toLowerCase(); if (a === 'pm' && H < 12) H += 12; if (a === 'am' && H === 12) H = 0; }
  return H * 60 + M;
}
const TIME = /(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?/gi;
export function parseDayCell(raw, { breakMins = 0 } = {}) {
  const text = norm(raw);
  if (!text || /^(-+|off|n\/?a|x|o|0+)$/i.test(text)) return { hours: text && /^0+$/.test(text) ? 0 : null, in: null, out: null, kind: 'empty' };
  const times = [...text.matchAll(TIME)];
  if (times.length >= 2) {
    const a = times[0], b = times[1];
    const start = toMinutes(a[1], a[2], a[3]);
    let end = toMinutes(b[1], b[2], b[3]);
    if (end <= start && !b[3]) end += 12 * 60;                 // "2.30" after "9.30" means 14:30
    if (end <= start) end += 24 * 60;
    const hrs = Math.max(0, end - start - (+breakMins || 0)) / 60;
    const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { hours: Math.round(hrs * 100) / 100, in: fmt(start), out: fmt(end), kind: 'times' };
  }
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?)?$/i);
  if (m) return { hours: Math.round(parseFloat(m[1].replace(',', '.')) * 100) / 100, in: null, out: null, kind: 'hours' };
  return { hours: null, in: null, out: null, kind: 'invalid' };
}

// ---------------------------------------------------------------------------------------------
// 2. A digital weekly timesheet (Word / PDF text) -> client, week, per-day in/out/break/total
// ---------------------------------------------------------------------------------------------
export function parseTimesheetText(text) {
  const t = String(text || '').replace(/\u00a0/g, ' ').replace(/[“”]/g, '"');
  const squeezed = t.replace(/(\d{1,2})[ \t]*[:.][ \t]*(\d{2})(?:[ \t]*(am|pm))?/gi, (m, h, mi, ap) => `${h}:${mi}${ap ? ap.toLowerCase() : ''}`);
  const client = (squeezed.match(/CLIENT\s*NAME\s*:?\s*[.…?"'\s]*([A-Za-z0-9&' -]+?)\s*[.…?"']*\s*(?:\r?\n|WEEK|$)/i) || [])[1];
  const wc = (squeezed.match(/WEEK\s*COMMENCING\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i) || [])[1];
  const re = new RegExp(`\\b(${DAY_NAMES.join('|')})\\b`, 'gi');
  const marks = [...squeezed.matchAll(re)].map((m) => ({ day: DAY_NAMES.findIndex((d) => d.toLowerCase() === m[1].toLowerCase()), i: m.index, end: m.index + m[0].length }));
  const stop = squeezed.search(/I\s+confirm\s+and\s+agree/i);
  const days = [];
  marks.forEach((m, k) => {
    if (days.some((d) => d.dayIdx === m.day)) return;
    const next = marks[k + 1] ? marks[k + 1].i : (stop > m.end ? stop : squeezed.length);
    const seg = squeezed.slice(m.end, Math.min(next, stop > m.end ? stop : next));
    const times = [...seg.matchAll(/(\d{1,2}):(\d{2})(am|pm)?/gi)];
    const dateM = seg.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const totalM = seg.match(/(\d+(?:\.\d+)?)\s*hours?/i);
    const breakM = seg.match(/(\d+)\s*mins?/i);
    let tin = null, tout = null, hrsCalc = null;
    if (times.length >= 2) {
      const cell = parseDayCell(`${times[0][0]}-${times[1][0]}`);
      tin = cell.in; tout = cell.out; hrsCalc = cell.hours;
    }
    const iso = dateM ? `${dateM[3]}-${dateM[2].padStart(2, '0')}-${dateM[1].padStart(2, '0')}` : null;
    days.push({ dayIdx: m.day, day: DAY_NAMES[m.day], date: iso, in: tin, out: tout, breakMins: breakM ? +breakM[1] : 0, stated: totalM ? parseFloat(totalM[1]) : null, calculated: hrsCalc });
  });
  days.sort((a, b) => a.dayIdx - b.dayIdx);
  let weekStart = wc ? headerToISO(wc.replace(/^(\d)\//, '0$1/').replace(/\/(\d)\//, '/0$1/')) : null;
  if (!weekStart) { const first = days.find((d) => d.date); if (first) weekStart = addDaysISO(first.date, -first.dayIdx); }
  const weekDates = weekStart ? DAY_NAMES.map((_, i) => addDaysISO(weekStart, i)) : null;
  // pair every day with its real date (the form's own date wins; otherwise Monday + offset)
  const out = DAY_NAMES.map((name, i) => {
    const d = days.find((x) => x.dayIdx === i);
    return { day: name, date: (d && d.date) || (weekDates && weekDates[i]) || null, in: d ? d.in : null, out: d ? d.out : null, breakMins: d ? d.breakMins : 0, stated: d ? d.stated : null, calculated: d ? d.calculated : null };
  });
  return { client: client ? norm(client) : null, weekStart: weekStart ? mondayOfISO(weekStart) : null, days: out,
    statedTotal: out.reduce((s, d) => s + (d.stated || 0), 0), calculatedTotal: out.reduce((s, d) => s + (d.calculated || 0), 0) };
}

// ---------------------------------------------------------------------------------------------
// 3. Hours upload from scratch (one row per person per day, or per week)
// ---------------------------------------------------------------------------------------------
export const NI_RE = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/i;
export const HOURS_TEMPLATE_HEADERS = ['Employee Name', 'NI Number', 'Project', 'Site', 'Date', 'Time In', 'Time Out', 'Break (mins)', 'Hours', 'Ad-hoc Hours', 'Leave Type', 'Hourly Rate', 'Contract Type', 'Pay Date'];
const hKey = (s) => normKey(s).replace(/[^a-z]/g, '');
const ALIASES = { employeename: 'name', name: 'name', employee: 'name', ninumber: 'ni', ni: 'ni', nationalinsurancenumber: 'ni', project: 'project', projectname: 'project', site: 'site', sitename: 'site',
  date: 'date', workdate: 'date', hours: 'hours', hoursworked: 'hours', timein: 'tin', in: 'tin', start: 'tin', timeout: 'tout', out: 'tout', finish: 'tout', end: 'tout', break: 'brk', breakmins: 'brk', adhochours: 'adh', adhoc: 'adhflag', leavetype: 'leave', leave: 'leave', hourlyrate: 'rate', rate: 'rate', contracttype: 'type', type: 'type', paydate: 'group', paygroup: 'group', firstname: 'first', surname: 'last' };
export function parseHoursRows(rows2d) {
  const hi = rows2d.findIndex((r) => (r || []).some((c) => ALIASES[hKey(c)] === 'date') && ((r || []).some((c) => ALIASES[hKey(c)] === 'hours') || ((r || []).some((c) => ALIASES[hKey(c)] === 'tin') && (r || []).some((c) => ALIASES[hKey(c)] === 'tout'))));
  if (hi < 0) throw new Error('Could not find the header row. The file needs the columns Employee Name, Project, Date and either Hours or Time In and Time Out.');
  const col = {}; rows2d[hi].forEach((c, i) => { const k = ALIASES[hKey(c)]; if (k && col[k] === undefined) col[k] = i; });
  if (col.name === undefined && !(col.first !== undefined && col.last !== undefined)) throw new Error('Missing an "Employee Name" column.');
  if (col.project === undefined) throw new Error('Missing a "Project" column.');
  const errors = [], lines = new Map(); let rowsRead = 0, total = 0, adhocTotal = 0;
  rows2d.slice(hi + 1).forEach((r, idx) => {
    if (!r || r.every((c) => c === null || c === undefined || c === '')) return;
    const rowNo = hi + idx + 2; rowsRead++;
    const name = col.name !== undefined ? norm(r[col.name]) : norm(`${r[col.first] || ''} ${r[col.last] || ''}`);
    const ni = norm(col.ni !== undefined ? r[col.ni] : '').replace(/\s+/g, '').toUpperCase();
    const project = norm(r[col.project]); const site = col.site !== undefined ? norm(r[col.site]) : '';
    const okISO = (x) => (x && !Number.isNaN(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x ? x : null);
    const date = okISO(headerToISO(r[col.date])) || (typeof r[col.date] === 'number' ? new Date(Math.round((r[col.date] - 25569) * 86400000)).toISOString().slice(0, 10) : null);
    const leave = col.leave !== undefined ? norm(r[col.leave]).toUpperCase() : '';
    const tcell = (v) => { if (v === null || v === undefined || v === '') return ''; if (typeof v === 'number' && v >= 0 && v < 1.0001) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; } return norm(v); };
    const tin = col.tin !== undefined ? tcell(r[col.tin]) : '', tout = col.tout !== undefined ? tcell(r[col.tout]) : '', brk = col.brk !== undefined ? num(r[col.brk]) : 0;
    const hoursBlank = col.hours === undefined || r[col.hours] === null || r[col.hours] === undefined || r[col.hours] === '';
    let hours = 0, timeBad = false;
    if (!hoursBlank) hours = num(r[col.hours]);
    else if (tin && tout) { const c = parseDayCell(`${tin}-${tout}`, { breakMins: brk }); if (c.hours === null) timeBad = true; else hours = c.hours; }
    else if (tin || tout) timeBad = true;
    let adhoc = col.adh !== undefined ? num(r[col.adh]) : 0;
    if (col.adhflag !== undefined && /^(y|yes|true|1|adhoc|ad-hoc)$/i.test(norm(r[col.adhflag]))) { adhoc += hours; hours = 0; }
    const bad = [];
    if (!name) bad.push('no employee name'); if (!project) bad.push('no project');
    if (!date) bad.push('date not understood (use dd/mm/yyyy)');
    if (timeBad) bad.push('Time In and Time Out must both be filled in as times (e.g. 08:30 and 16:30)');
    if (ni && !NI_RE.test(ni)) bad.push(`NI number "${ni}" does not look right`);
    if (!(hours >= 0 && hours <= 24) || !(adhoc >= 0 && adhoc <= 24)) bad.push('hours must be between 0 and 24');
    if (bad.length) { errors.push({ row: rowNo, name, text: bad.join('; ') }); return; }
    const key = [ni || normKey(name), normKey(project), normKey(site)].join('|');
    const L = lines.get(key) || { employee_name: name, ni: ni || null, project, site: site || null, rate: null, contract_type: null, pay_group: null, days: new Map(), leave: new Map(), adhoc: new Map() };
    if (col.rate !== undefined && r[col.rate] !== '' && r[col.rate] != null && num(r[col.rate]) > 0) L.rate = num(r[col.rate]);
    if (col.type !== undefined && norm(r[col.type])) L.contract_type = norm(r[col.type])[0].toUpperCase() + norm(r[col.type]).slice(1).toLowerCase();
    if (col.group !== undefined && norm(r[col.group])) L.pay_group = norm(r[col.group]);
    if (leave) L.leave.set(date, { date, hours, type: leave });
    else { if (hours > 0 || (!adhoc)) { L.days.set(date, (L.days.get(date) || 0) + hours); total += hours; } if (adhoc > 0) { L.adhoc.set(date, (L.adhoc.get(date) || 0) + adhoc); adhocTotal += adhoc; } }
    lines.set(key, L);
  });
  const out = [...lines.values()].map((L) => ({ ...L, days: [...L.days].map(([date, hours]) => ({ date, hours })).sort((a, b) => a.date.localeCompare(b.date)), leave: [...L.leave.values()], adhoc: [...L.adhoc].map(([date, hours]) => ({ date, hours })) }));
  const dates = out.flatMap((l) => [...l.days.map((d) => d.date), ...l.leave.map((d) => d.date), ...l.adhoc.map((d) => d.date)]).sort();
  return { lines: out, errors, rowsRead, totalHours: r2(total), adhocHours: r2(adhocTotal), period_start: dates[0] || null, period_end: dates[dates.length - 1] || null };
}

// ---------------------------------------------------------------------------------------------
// 4. The payroll provider ("BP") report: Department, Name, Surname, Gross pay, Net pay, Take-home ...
// ---------------------------------------------------------------------------------------------
const PROV = { department: 'department', name: 'first', surname: 'last', grosspay: 'gross', netpay: 'net', takehomepay: 'takehome', tax: 'tax', employeenics: 'ee_nic', employernics: 'er_nic',
  employeepension: 'ee_pension', employerpension: 'er_pension', totalstatutorypay: 'statutory', studentpostgradloandeduction: 'student_loan', totalattachmentorderdeductions: 'attachment',
  expensereimbursementamount: 'expenses', nationalinsurancenumber: 'ni' };
export function parseProviderRows(rows2d) {
  const hi = rows2d.findIndex((r) => (r || []).map(hKey).includes('department') && (r || []).map(hKey).includes('grosspay'));
  if (hi < 0) return null;
  const col = {}; rows2d[hi].forEach((c, i) => { const k = PROV[hKey(c)]; if (k && col[k] === undefined) col[k] = i; });
  const out = [];
  for (const r of rows2d.slice(hi + 1)) {
    if (!r || !norm(r[col.department]) || (!norm(r[col.first]) && !norm(r[col.last]))) continue;
    if (typeof r[col.gross] !== 'number' && !String(r[col.gross] ?? '').trim()) continue;
    out.push({ department: norm(r[col.department]), first_name: norm(r[col.first]), surname: norm(r[col.last]), ni_number: norm(r[col.ni]).replace(/\s+/g, '').toUpperCase() || null,
      gross: num(r[col.gross]), net: num(r[col.net]), takehome: num(r[col.takehome]), tax: num(r[col.tax]), ee_nic: num(r[col.ee_nic]), er_nic: num(r[col.er_nic]),
      ee_pension: num(r[col.ee_pension]), er_pension: num(r[col.er_pension]), statutory: num(r[col.statutory]), student_loan: num(r[col.student_loan]),
      attachment: num(r[col.attachment]), expenses: num(r[col.expenses]) });
  }
  return out;
}

export const DEFAULT_JOURNAL = { tax_rate: 'No VAT', accounts: { wages: '6005', er_nic: '6099', er_pension: '6098', net: '2220', paye: '2210', pension: '2230', attachment: '1108', statutory: '2210' },
  labels: { wages: 'Payroll Wages', er_nic: 'Employer NI', er_pension: 'Employer Pensions', net: 'Net Wages', paye: 'PAYE (Ee, Er, Tax)', pension: 'Pension Fund (Ee and Er)', attachment: 'Total Attachment Order deductions', statutory: 'Total Statutory Pay' } };

// Rows -> balanced Xero manual journal lines, in the same layout as your MJ template.
export function buildJournal(rows, settings = {}, extra = []) {
  const J = { ...DEFAULT_JOURNAL, ...settings, accounts: { ...DEFAULT_JOURNAL.accounts, ...(settings.accounts || {}) }, labels: { ...DEFAULT_JOURNAL.labels, ...(settings.labels || {}) } };
  const c = (x) => Math.round((+x || 0) * 100);              // work in whole pence
  const by = new Map();
  for (const r of rows) {
    const d = by.get(r.department) || { project: r.department, wages: 0, er_nic: 0, er_pension: 0 };
    d.wages += c(r.gross) - c(r.statutory); d.er_nic += c(r.er_nic); d.er_pension += c(r.er_pension); by.set(r.department, d);
  }
  const sum = (k) => rows.reduce((s, r) => s + c(r[k]), 0) / 100;
  const lines = [];
  const projects = [...by.values()].sort((a, b) => a.project.localeCompare(b.project));
  for (const kind of ['er_nic', 'er_pension', 'wages']) {
    for (const p of projects) { const v = p[kind] / 100; if (Math.abs(v) < 0.005) continue; lines.push({ description: J.labels[kind], account: J.accounts[kind], tax_rate: J.tax_rate, project: p.project, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, auto: true }); }
  }
  const statutory = r2(sum('statutory'));
  if (statutory) lines.push({ description: J.labels.statutory, account: J.accounts.statutory, tax_rate: J.tax_rate, project: '', debit: statutory, credit: 0, auto: true });
  const credits = [['net', r2(sum('takehome'))], ['paye', r2(sum('tax') + sum('ee_nic') + sum('er_nic') + sum('student_loan'))], ['pension', r2(sum('ee_pension') + sum('er_pension'))], ['attachment', r2(sum('attachment'))]];
  for (const [k, v] of credits) if (Math.abs(v) >= 0.005) lines.push({ description: J.labels[k], account: J.accounts[k], tax_rate: J.tax_rate, project: '', debit: 0, credit: v, auto: true });
  for (const e of extra) lines.push({ description: e.description, account: e.account, tax_rate: e.tax_rate || J.tax_rate, project: e.project || '', debit: num(e.debit), credit: num(e.credit), auto: false, id: e.id });
  const debit = lines.reduce((s, l) => s + c(l.debit), 0) / 100, credit = lines.reduce((s, l) => s + c(l.credit), 0) / 100;
  // people whose take-home does not tie to net - pension - loans - attachment orders + expenses
  const unexplained = rows.map((r) => ({ r, d: r2(r.net - r.ee_pension - r.student_loan - r.attachment + r.expenses - r.takehome) })).filter((x) => Math.abs(x.d) > 0.02)
    .map((x) => ({ name: `${x.r.first_name} ${x.r.surname}`.trim(), department: x.r.department, diff: x.d }));
  return { lines, debit, credit, difference: (c(debit) - c(credit)) / 100, balanced: c(debit) === c(credit), unexplained, unexplainedTotal: r2(unexplained.reduce((s, x) => s + x.diff, 0)),
    totals: { gross: r2(sum('gross')), net: r2(sum('net')), takehome: r2(sum('takehome')), tax: r2(sum('tax')), ee_nic: r2(sum('ee_nic')), er_nic: r2(sum('er_nic')), ee_pension: r2(sum('ee_pension')), er_pension: r2(sum('er_pension')), statutory, people: rows.length } };
}
export function journalToRows(j) {
  const head = ['Description', 'Account', 'Tax Rate', 'Project', 'OFFICE', 'Debit GBP', 'Credit GBP'];
  const body = j.lines.map((l) => [l.description, /^\d+$/.test(String(l.account)) ? Number(l.account) : l.account, l.tax_rate, l.project || '', '', l.debit || '', l.credit || '']);
  return [head, ...body, ['', '', '', '', 'Total', j.debit, j.credit], ['', '', '', '', 'Difference', '', r2(j.credit - j.debit)]];
}

// ---------------------------------------------------------------------------------------------
// 5. Provider report vs our payroll, person by person (matched on NI number)
// ---------------------------------------------------------------------------------------------
export function reconcileProvider(provider, lines) {
  const ours = new Map();
  for (const l of lines) { const k = l.ni_number || ('n:' + normKey(l.employee_name)); const o = ours.get(k) || { ni: l.ni_number, name: l.employee_name, gross: 0 }; o.gross += +l.gross_pay || 0; ours.set(k, o); }
  const theirs = new Map();
  for (const p of provider) { const k = p.ni_number || ('n:' + normKey(`${p.first_name} ${p.surname}`)); const o = theirs.get(k) || { ni: p.ni_number, name: `${p.first_name} ${p.surname}`.trim(), gross: 0 }; o.gross += p.gross; theirs.set(k, o); }
  const out = [];
  for (const [k, t] of theirs) { const o = ours.get(k); out.push({ ni: t.ni, name: t.name, provider: r2(t.gross), payroll: o ? r2(o.gross) : 0, diff: r2((o ? o.gross : 0) - t.gross), inPayroll: !!o }); }
  for (const [k, o] of ours) if (!theirs.has(k) && Math.abs(o.gross) > 0.005) out.push({ ni: o.ni, name: o.name, provider: 0, payroll: r2(o.gross), diff: r2(o.gross), inPayroll: true, missingFromProvider: true });
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}


// ---------------------------------------------------------------------------------------------
// 6. A journal estimated from our own hours (before the payroll provider has run)
// ---------------------------------------------------------------------------------------------
export const DEFAULT_ESTIMATE = { er_ni_rate: 15, er_ni_threshold_year: 5000, apply_pension: true, er_pension_pct: 3, pension_lel_year: 6240, pension_uel_year: 50270, pension_trigger_year: 10000, accrual_account: '2200', accrual_label: 'Accrued payroll liabilities (estimate)' };
export const periodsPerYear = (stream) => (stream === 'fortnightly' ? 26 : 12);
// lines = rows of v_payroll_lines. Employer NI and pension are worked out per PERSON (across all their projects) and then shared out by pay.
export function estimateRows(lines, stream, rules = {}) {
  const R = { ...DEFAULT_ESTIMATE, ...rules }, ppy = periodsPerYear(stream), c = (x) => Math.round((+x || 0) * 100);
  const byPerson = new Map();
  for (const l of lines) { const k = l.ni_number || ('n:' + normKey(l.employee_name)); const p = byPerson.get(k) || { gross: 0, lines: [] }; p.gross += +l.gross_pay || 0; p.lines.push(l); byPerson.set(k, p); }
  const rows = new Map();
  const bump = (dep, key, cents) => { const d = rows.get(dep) || { department: dep, gross: 0, statutory: 0, er_nic: 0, er_pension: 0 }; d[key] += cents; rows.set(dep, d); };
  for (const p of byPerson.values()) {
    const niP = Math.max(0, p.gross - R.er_ni_threshold_year / ppy) * (R.er_ni_rate / 100);
    const lel = R.pension_lel_year / ppy, uel = R.pension_uel_year / ppy, trig = R.pension_trigger_year / ppy;
    const penP = R.apply_pension && p.gross > trig ? Math.max(0, Math.min(p.gross, uel) - lel) * (R.er_pension_pct / 100) : 0;
    const total = p.gross || 1;
    for (const l of p.lines) { const share = (+l.gross_pay || 0) / total, dep = l.project_name; bump(dep, 'gross', c(l.gross_pay)); bump(dep, 'statutory', c(l.ssp_pay)); bump(dep, 'er_nic', c(niP * share)); bump(dep, 'er_pension', c(penP * share)); }
  }
  return [...rows.values()].map((d) => ({ department: d.department, gross: d.gross / 100, statutory: d.statutory / 100, er_nic: d.er_nic / 100, er_pension: d.er_pension / 100 }));
}
export function buildEstimatedJournal(lines, stream, rules = {}, settings = {}, extra = []) {
  const R = { ...DEFAULT_ESTIMATE, ...rules }, J = { ...DEFAULT_JOURNAL, ...settings, accounts: { ...DEFAULT_JOURNAL.accounts, ...(settings.accounts || {}) }, labels: { ...DEFAULT_JOURNAL.labels, ...(settings.labels || {}) } };
  const rows = estimateRows(lines, stream, R), c = (x) => Math.round((+x || 0) * 100), out = [];
  for (const kind of ['er_nic', 'er_pension']) for (const r of rows.slice().sort((a, b) => a.department.localeCompare(b.department))) if (c(r[kind])) out.push({ description: J.labels[kind], account: J.accounts[kind], tax_rate: J.tax_rate, project: r.department, debit: r[kind], credit: 0, auto: true });
  for (const r of rows.slice().sort((a, b) => a.department.localeCompare(b.department))) { const v = (c(r.gross) - c(r.statutory)) / 100; if (c(v)) out.push({ description: J.labels.wages, account: J.accounts.wages, tax_rate: J.tax_rate, project: r.department, debit: v, credit: 0, auto: true }); }
  const stat = rows.reduce((s, r) => s + c(r.statutory), 0) / 100; if (c(stat)) out.push({ description: J.labels.statutory, account: J.accounts.statutory, tax_rate: J.tax_rate, project: '', debit: stat, credit: 0, auto: true });
  const sumDeb = out.reduce((s, l) => s + c(l.debit), 0);
  for (const e of extra) out.push({ description: e.description, account: e.account, tax_rate: e.tax_rate || J.tax_rate, project: e.project || '', debit: num(e.debit), credit: num(e.credit), auto: false, id: e.id });
  const debitNow = out.reduce((s, l) => s + c(l.debit), 0), creditNow = out.reduce((s, l) => s + c(l.credit), 0);
  const accrual = (debitNow - creditNow) / 100;
  if (c(accrual)) out.push({ description: R.accrual_label, account: R.accrual_account, tax_rate: J.tax_rate, project: '', debit: accrual < 0 ? -accrual : 0, credit: accrual > 0 ? accrual : 0, auto: true });
  const debit = out.reduce((s, l) => s + c(l.debit), 0) / 100, credit = out.reduce((s, l) => s + c(l.credit), 0) / 100;
  void sumDeb;
  return { lines: out, debit, credit, difference: (c(debit) - c(credit)) / 100, balanced: c(debit) === c(credit), unexplained: [], unexplainedTotal: 0, estimate: true,
    totals: { gross: rows.reduce((s, r) => s + c(r.gross), 0) / 100, er_nic: rows.reduce((s, r) => s + c(r.er_nic), 0) / 100, er_pension: rows.reduce((s, r) => s + c(r.er_pension), 0) / 100, statutory: stat, people: new Set(lines.map((l) => l.ni_number || l.employee_name)).size } };
}


// ---------------------------------------------------------------------------------------------
// 6. Budgets and employee lists (Excel / pasted text)
// ---------------------------------------------------------------------------------------------
const BKEYS = { project: 'project', projectname: 'project', weeklybudgetedhours: 'hours', weeklyhours: 'hours', budgetedhours: 'hours', hours: 'hours', weeklybudget: 'hours', clientrate: 'rate', chargerate: 'rate', rate: 'rate',
  employee: 'name', employeename: 'name', name: 'name', ni: 'ni', ninumber: 'ni', email: 'email', emailaddress: 'email', phone: 'phone', mobile: 'phone', site: 'site', contracttype: 'type', hourlyrate: 'hrate', status: 'status', active: 'status' };
function headed(rows2d, need) {
  const hi = rows2d.findIndex((r) => (r || []).some((c) => BKEYS[hKey(c)] === need[0]) && need.slice(1).some((k) => (r || []).some((c) => BKEYS[hKey(c)] === k)));
  if (hi < 0) return null; const col = {}; rows2d[hi].forEach((c, i) => { const k = BKEYS[hKey(c)]; if (k && col[k] === undefined) col[k] = i; }); return { hi, col };
}
// "Project  |  Weekly Budgeted Hours" -> [{project_name, name_key, weekly_hours, client_rate}]
export function parseProjectBudgetRows(rows2d) {
  const hd = headed(rows2d, ['project', 'hours']); if (!hd) throw new Error('Could not find the columns “Project” and “Weekly Budgeted Hours”.');
  const out = [], errors = [];
  rows2d.slice(hd.hi + 1).forEach((r, i) => { if (!r || r.every((c) => c === null || c === '' || c === undefined)) return; const name = norm(r[hd.col.project]); const hrs = r[hd.col.hours]; const n = typeof hrs === 'number' ? hrs : parseFloat(String(hrs ?? '').replace(/,/g, ''));
    if (!name) return; if (!Number.isFinite(n) || n < 0) { errors.push({ row: hd.hi + i + 2, text: `${name}: “${hrs}” is not a number of hours` }); return; }
    out.push({ project_name: name, name_key: normKey(name), weekly_hours: n, client_rate: hd.col.rate !== undefined && r[hd.col.rate] !== '' && r[hd.col.rate] != null ? num(r[hd.col.rate]) : undefined }); });
  return { rows: out, errors };
}
// "Employee | NI | Project | Weekly hours"
export function parseEmployeeBudgetRows(rows2d) {
  const hd = headed(rows2d, ['name', 'hours']); if (!hd || hd.col.project === undefined) throw new Error('Could not find the columns “Employee”, “Project” and “Weekly Hours”.');
  const out = [], errors = [];
  rows2d.slice(hd.hi + 1).forEach((r, i) => { if (!r || r.every((c) => c === null || c === '' || c === undefined)) return; const name = norm(r[hd.col.name]), project = norm(r[hd.col.project]), n = num(r[hd.col.hours]);
    const ni = hd.col.ni !== undefined ? norm(r[hd.col.ni]).replace(/\s+/g, '').toUpperCase() : ''; if (!name && !project) return;
    if (!name || !project) { errors.push({ row: hd.hi + i + 2, text: 'needs an employee and a project' }); return; } if (ni && !NI_RE.test(ni)) { errors.push({ row: hd.hi + i + 2, text: `${name}: NI number "${ni}" does not look right` }); return; }
    out.push({ employee_name: name, name_key: normKey(name), ni_number: ni || null, project_name: project, project_key: normKey(project), weekly_hours: n }); });
  return { rows: out, errors };
}
// Active employee list: Name | NI | Email | Phone | Project | Site | Hourly Rate | Contract Type | Status
export function parseEmployeeRows(rows2d) {
  const hd = headed(rows2d, ['name', 'ni', 'email', 'project']); if (!hd) throw new Error('Could not find an “Employee Name” column (plus NI Number, Email or Project).');
  const out = [], errors = [];
  rows2d.slice(hd.hi + 1).forEach((r, i) => { if (!r || r.every((c) => c === null || c === '' || c === undefined)) return; const name = norm(r[hd.col.name]); if (!name) return;
    const ni = hd.col.ni !== undefined ? norm(r[hd.col.ni]).replace(/\s+/g, '').toUpperCase() : '', email = hd.col.email !== undefined ? norm(r[hd.col.email]).toLowerCase() : '';
    if (ni && !NI_RE.test(ni)) { errors.push({ row: hd.hi + i + 2, text: `${name}: NI number "${ni}" does not look right` }); return; } if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push({ row: hd.hi + i + 2, text: `${name}: "${email}" is not an email` }); return; }
    const st = hd.col.status !== undefined ? norm(r[hd.col.status]).toLowerCase() : '';
    out.push({ full_name: name, name_key: normKey(name), ni_number: ni || null, email: email || null, phone: hd.col.phone !== undefined ? norm(r[hd.col.phone]) || null : null,
      default_project: hd.col.project !== undefined ? norm(r[hd.col.project]) || null : null, default_site: hd.col.site !== undefined ? norm(r[hd.col.site]) || null : null,
      default_rate: hd.col.hrate !== undefined && r[hd.col.hrate] !== '' && r[hd.col.hrate] != null ? num(r[hd.col.hrate]) : null, default_contract: hd.col.type !== undefined ? norm(r[hd.col.type]) || null : null,
      active: !/^(inactive|leaver|left|no|false|0|terminated)$/.test(st) }); });
  return { rows: out, errors };
}
