// The Payroll Online payroll template: one Excel file that holds every part of a payroll, ready to fill in and import.
import { loadStaff, loadProjects, loadLeaveTypes, loadRunLinesLite, loadCalendarPeriod, loadRunForTemplate } from './api.js';
import { h, toast, modal, dmy, natCompare } from './ui.js';
import { ctx, currentRun } from './ctx.js';
import { loadXLSX } from './xlsx.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const mondayOf = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
const plus = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const serial = (iso) => Date.parse(iso + 'T00:00:00Z') / 864e5 + 25569;
const colName = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// [header, width, what it means]
const COLS = [
  ['Project Name', 24, 'Required. The project / contract the person works on. One row per person per project (and per site if needed).'],
  ['Site Name', 16, 'Optional. Site within the project.'],
  ['Employee ID', 12, 'Optional but best. The Payroll Online ID (CFM00012). New people: leave empty — an ID is created on import.'],
  ['Employee Name', 24, 'Required. Full name.'],
  ['NI', 12, 'National Insurance number. Used to match people when there is no Employee ID.'],
  ['Email', 24, 'Optional. Used for payslips and the My Pay app (new people only).'],
  ['Phone', 14, 'Optional. Mobile number (for WhatsApp).'],
  ['Employment Type', 14, 'Permanent or Cover (temporary and cover are the same).'],
  ['Contract Type', 13, 'How the line is paid: Hourly (hours × rate), Cover (hours × rate, cover staff) or Fixed (Fixed Pay is the wage).'],
  ['Status', 12, 'Optional label, e.g. New starter, Leaver, TUPE.'],
  ['Pay date', 10, 'Pay date group: 24th, 25th, 26th, 28th, 29th, Last Working day, 5th (fortnightly: Fortnightly).'],
  ['Hourly Rate New', 10, 'Required. £ per hour.'],
  ['Budgeted Hours', 10, 'Weekly budgeted hours for this person on this project.'],
  ['Fixed Pay', 10, 'Only for Contract Type Fixed: the fixed wage for the period.'],
  ['Leave Pay', 10, 'Optional £ leave pay to add (if not using leave codes in the days).'],
  ['Addition', 10, '£ to add (bonus, back pay, travel …).'],
  ['Deduction', 10, '£ to take off (advance, overpayment …).'],
  ['SSP amount per day', 10, 'Optional. £ SSP per sick day when it is not the standard rate (e.g. 80% of average weekly earnings ÷ 5).'],
  ['Remarks', 20, 'Optional note (shown on the payroll line).'],
  ['Coments', 20, 'Optional second note.'],
  ['Tupe', 8, 'Optional: Yes if TUPE.'],
  ['Pension', 10, 'Optional: pension scheme / status.'],
  ['Employee %', 8, 'Optional: employee pension %.'],
  ['Employer %', 8, 'Optional: employer pension %.'],
  ['Allowance', 10, 'Optional: allowance note.'],
  ['Agreements', 12, 'Optional: agreement note.'],
  ['Timings', 12, 'Optional: shift timings, e.g. Mon–Fri 06:00–09:00.'],
];

// ---------- FORTNIGHTLY and MONTHLY: the same sheet layout and formulas as the Fortnightly TimeSheet workbook ----------
// Each week: 7 day columns, Weekly Budget, Original Hours (=SUM of the days), Holidays Hours.
// Gross: Hourly / Agency = rate × (hours + holiday hours) + Addition; Fixed = Budgeted Wages + Addition.
export async function buildTimesheet({ stream, label, start, weeks = 2, prefill, runId }) {
  const XLSX = await loadXLSX();
  const MONTHLY = stream === 'monthly', SHEET = MONTHLY ? 'Monthly TimeSheet Details' : 'Fortnightly TimeSheet Details';
  const nW = MONTHLY ? Math.max(1, Math.min(6, weeks)) : 2;
  const projects = await loadProjects().catch(() => []);
  const s0 = mondayOf(start), wk = Array.from({ length: nW }, (_, i) => plus(s0, i * 7));
  const lead = ['S.no', 'Project', 'Employee Name', 'NI No.', MONTHLY ? 'Pay date' : 'Fortnightly type', 'Cover'];
  const C = {}; const head = [...lead];
  wk.forEach((w, i) => { C['d' + i] = head.length; for (let d = 0; d < 7; d++) head.push(serial(plus(w, d))); C['b' + i] = head.length; head.push('Weekly Budget', 'Original Hours', 'Holidays Hours'); });
  const add = (k, t) => { C[k] = head.length; head.push(t); };
  add('del', 'Total Delivered Hours'); add('hol', 'Total Holiday Hours'); add('pay', 'Total Hours to Pay'); add('adh', 'Ad-hoc Hours'); add('rate', 'New Hourly Rate'); add('bh', 'Total Budgeted Hours');
  add('ww', 'Working Weeks'); add('dc', 'Deep Cleaning'); add('ae', 'Annual Entitlement'); add('tcw', 'Total Contracted Weeks');
  wk.forEach((_, i) => add('diff' + i, `Difference in Hours Week ${String(i + 1).padStart(2, '0')}`));
  add('gross', 'Gross Wages New rate'); add('bud', 'Budgeted Wages'); add('addn', 'Addittion/Deduction'); add('type', 'Payroll type'); add('code', 'Employee ID'); add('notes', 'Notes');
  const X = (k, r) => colName(C[k]) + r;
  let people = [];
  if (prefill === 'run' && runId) {
    const [ls, staff] = await Promise.all([loadRunForTemplate(runId), loadStaff().catch(() => [])]); const m = new Map(staff.map((e) => [e.id, e]));
    people = ls.filter((l) => !/adhoc/i.test(l.employee_name)).map((l) => { const e = m.get(l.employee_id) || {}; const wb0 = l.week_budgets; const wkb = MONTHLY ? (+l.budgeted_hours || wb0[0] || '') : null;
      return { proj: l.project_name, name: l.employee_name, ni: l.ni_number, ft: MONTHLY ? (l.pay_group === 'LWD' ? 'Last Working day' : l.pay_group || '') : (l.extra || {}).fortnight_type ?? '', cover: (l.extra || {}).cover || (e.employment_type === 'cover' ? 'Yes' : 'No'),
        wb: wk.map((_, i) => (MONTHLY ? wkb : wb0[i] ?? wb0[0] ?? '')), rate: l.hourly_rate, type: l.contract_type || 'Hourly', fixed: l.fixed_pay, bo: l.budget_override, code: e.employee_code || '' }; });
  } else if (prefill === 'staff') {
    const staff = await loadStaff(); const fn = (e) => /fortnight/i.test(String(e.pay_group || ''));
    const pick = staff.filter((e) => e.emp_status !== 'terminated' && e.default_project && (MONTHLY ? !fn(e) : fn(e)));
    people = (pick.length ? pick : staff.filter((e) => e.emp_status !== 'terminated' && e.default_project)).sort((a, b) => natCompare(a.default_project, b.default_project) || natCompare(a.full_name, b.full_name))
      .map((e) => ({ proj: e.default_project, name: e.full_name, ni: e.ni_number, ft: MONTHLY ? (e.pay_group === 'LWD' ? 'Last Working day' : e.pay_group || '') : '', cover: e.employment_type === 'cover' ? 'Yes' : 'No', wb: wk.map(() => e.weekly_hours ?? ''), rate: e.default_rate, type: 'Hourly', code: e.employee_code || '' }));
  } else {
    const d = (a) => [...a, ...Array(7 * nW).fill('')].slice(0, 7 * nW);
    people = [{ proj: 'Example project', name: 'Example Hourly', ni: 'AB123456C', ft: MONTHLY ? '25th' : 1, cover: 'No', wb: wk.map(() => 10), rate: 12.71, type: 'Hourly', days: d([2, 2, 2, 2, 2, '', '', 2, 2, 'AL', 2, 2, '', '']), hol: [0, 2] },
      { proj: 'Example project', name: 'Example on SSP', ft: MONTHLY ? '25th' : 2, cover: 'No', wb: wk.map(() => 15), rate: 12.71, type: 'Hourly', days: d(['SSP', 'SSP', 'SSP', 'SSP', 'SSP', '', '', 'SSP', 'SSP', 'SSP', 'SSP', 'SSP', '', '']), add: { f: '24.65*10' }, notes: 'SSP 10 days at £24.65' },
      { proj: 'Example project', name: 'Example Fixed', ft: MONTHLY ? 'Last Working day' : 1, cover: 'No', wb: wk.map(() => 20), rate: 13, type: 'Fixed', fixed: MONTHLY ? 1100 : 520, add: 25, notes: 'Fixed wage typed in Budgeted Wages' },
      { proj: 'Example project', name: 'Example Cover', ft: MONTHLY ? '25th' : 1, cover: 'Yes', wb: wk.map(() => 6), rate: 12.71, type: 'Hourly', days: d([3, '', 3, '', '', '', '', 3, '', 3]) }];
  }
  const rows = [['Employee Details', `${MONTHLY ? 'Monthly' : 'Fortnightly'} timesheet ${dmy(s0)} – ${dmy(plus(s0, nW * 7 - 1))} · ${label}`], head];
  people.forEach((p, i) => {
    const r = i + 3, fixed = String(p.type).toUpperCase() === 'FIXED', row = Array(head.length).fill('');
    Object.assign(row, { 0: i + 1, 1: p.proj, 2: p.name, 3: p.ni || '', 4: p.ft, 5: p.cover });
    wk.forEach((_, w) => { for (let d = 0; d < 7; d++) row[C['d' + w] + d] = (p.days || [])[w * 7 + d] ?? ''; const b = C['b' + w];
      row[b] = (p.wb || [])[w] ?? ''; row[b + 1] = { f: `SUM(${colName(C['d' + w])}${r}:${colName(C['d' + w] + 6)}${r})` }; row[b + 2] = (p.hol || [])[w] || ''; });
    const orig = wk.map((_, w) => colName(C['b' + w] + 1) + r).join(','), hol = wk.map((_, w) => colName(C['b' + w] + 2) + r).join(','), bud = wk.map((_, w) => colName(C['b' + w]) + r).join(',');
    row[C.del] = { f: `SUM(${orig})` }; row[C.hol] = { f: `SUM(${hol})` }; row[C.pay] = { f: `${X('del', r)}+${X('hol', r)}` }; row[C.rate] = p.rate ?? ''; row[C.bh] = { f: `SUM(${bud})` };
    row[C.tcw] = { f: `SUM(${X('ww', r)}:${X('ae', r)})` };
    wk.forEach((_, w) => { const b = C['b' + w]; row[C['diff' + w]] = { f: `SUM(${colName(b + 1)}${r}:${colName(b + 2)}${r})-${colName(b)}${r}` }; });
    row[C.gross] = { f: `IF(UPPER(${X('type', r)})="FIXED",N(${X('bud', r)})+N(${X('addn', r)}),${X('rate', r)}*${X('pay', r)}+N(${X('addn', r)}))` };
    row[C.bud] = fixed ? (p.fixed ?? 0) : p.bo != null ? p.bo : { f: `${X('bh', r)}*${X('rate', r)}` };
    row[C.addn] = p.add ?? ''; row[C.type] = p.type || 'Hourly'; row[C.code] = p.code || ''; row[C.notes] = p.notes || '';
    rows.push(row);
  });
  const n = rows.length, tot = Array(head.length).fill(''); tot[2] = 'TOTAL';
  for (const k of ['del', 'hol', 'pay', 'bh', 'gross', 'bud', 'addn']) tot[C[k]] = { f: `SUBTOTAL(9,${colName(C[k])}3:${colName(C[k])}${n})` };
  rows.push([], tot);
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (v && typeof v === 'object' && v.f ? null : v))));
  rows.forEach((r, ri) => r.forEach((v, ci) => { if (v && typeof v === 'object' && v.f) ws[colName(ci) + (ri + 1)] = { t: 'n', f: v.f }; }));
  for (let ci = 0; ci < head.length; ci++) { const ref = colName(ci) + '2'; if (typeof head[ci] === 'number') { ws[ref].t = 'n'; ws[ref].z = 'ddd dd/mm'; } }
  ws['!cols'] = head.map((h0, i) => ({ wch: [6, 30, 26, 12, 12, 7][i] || (typeof h0 === 'number' ? 7 : 11) }));
  ws['!views'] = [{ state: 'frozen', xSplit: 3, ySplit: 2 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, SHEET);
  const ins = [[`HOW THIS ${MONTHLY ? 'MONTHLY' : 'FORTNIGHTLY'} SHEET CALCULATES PAY (the same rules Payroll Online uses)`], [''],
    ['Total Hours to Pay', '= hours typed in the day cells (words such as SSP / off / AL are ignored) + Holidays Hours of every week'],
    ['Gross – Hourly / Agency', '= New Hourly Rate × Total Hours to Pay + Addittion/Deduction'], ['Gross – Fixed', '= Budgeted Wages (type the fixed wage there) + Addittion/Deduction'],
    ['Budgeted Wages – Hourly', '= Total Budgeted Hours (all the Weekly Budgets) × New Hourly Rate. Type a number instead only for a different budget (e.g. 0 for a Vacant post).'],
    ['Addittion/Deduction', 'Money only (+ add / − take off). SSP goes here at £24.65 a day, e.g. =24.65*10. Notes go in the Notes column — words here are ignored.'],
    ['Holidays Hours', 'Paid holiday hours for that week: paid, and they count towards the budget.'], ['Difference in Hours', '= Original Hours + Holidays Hours − Weekly Budget for each week (positive = over budget).'],
    ...(MONTHLY ? [['Pay date', 'The pay date group: 24th, 25th, 26th, 28th, 29th, Last Working day, 5th (empty = the project’s pay date).']] : []),
    ['Ad-hoc Hours', 'Extra hours charged to the client that are ALREADY in the day cells (e.g. 70 worked, budget 60, 10 ad-hoc → type 10). They are paid once, kept out of the budget and shown on Ad-hoc & billing.'],
    ['ADHOC lines', 'Or put ad-hoc work on its own line named “Name(ADHOC)” with the hours in the days — the whole line is kept out of the budget. Do not put the same money in Addittion/Deduction as well.'],
    ['Employee ID', 'Optional: the Payroll Online ID (CFM00012) — matches people even when the spelling differs.'], [''], ['Import', 'Payroll Online → Import Excel → drop this file. The preview checks every line against this sheet.']];
  const wi = XLSX.utils.aoa_to_sheet(ins); wi['!cols'] = [{ wch: 26 }, { wch: 130 }]; XLSX.utils.book_append_sheet(wb, wi, 'Instructions');
  const wp = XLSX.utils.aoa_to_sheet([['Project Name', 'Pay date', 'Start Date', 'End Date'], ...projects.map((p) => [p.name, p.pay_group === 'LWD' ? 'Last Working day' : p.pay_group || '', p.start_date || '', p.end_date || ''])]); XLSX.utils.book_append_sheet(wb, wp, 'Projects');
  const wa = XLSX.utils.aoa_to_sheet([['Account', 'Manager'], ...projects.map((p) => [p.name, p.manager || ''])]); XLSX.utils.book_append_sheet(wb, wa, 'Account List');
  const wc = XLSX.utils.aoa_to_sheet([['Project', 'Collection Type', 'Status'], ...projects.map((p) => [p.name, p.collection_type || '', ''])]); XLSX.utils.book_append_sheet(wb, wc, 'Col Type');
  XLSX.writeFile(wb, `${MONTHLY ? 'Monthly' : 'Fortnightly'} TimeSheet - ${label}.xlsx`);
  return people.length;
}

export async function buildTemplate({ stream, label, start, weeks, prefill, runId }) {
  if (stream === 'fortnightly' || stream === 'monthly') return buildTimesheet({ stream, label, start, weeks, prefill, runId });
  const XLSX = await loadXLSX();
  const [projects, types] = await Promise.all([loadProjects().catch(() => []), loadLeaveTypes().catch(() => [])]);
  const wk = []; for (let i = 0, w = mondayOf(start); i < weeks; i++, w = plus(w, 7)) wk.push(w);
  // header
  const H = COLS.map((c) => c[0]), base = H.length;
  for (const w of wk) { for (let d = 0; d < 7; d++) H.push(serial(plus(w, d))); H.push(`Total wc ${dmy(w)}`, `Leaves wc ${dmy(w)}`, `Variance wc ${dmy(w)}`); }
  // rows
  let people = [];
  if (prefill === 'staff') { const s = await loadStaff(); people = s.filter((e) => e.emp_status !== 'terminated' && e.default_project).sort((a, b) => natCompare(a.default_project, b.default_project) || natCompare(a.full_name, b.full_name)).map((e) => ({ project: e.default_project, site: e.default_site, code: e.employee_code, name: e.full_name, ni: e.ni_number, email: e.email, phone: e.phone, etype: e.employment_type === 'permanent' ? 'Permanent' : 'Cover', ctype: e.employment_type === 'permanent' ? 'Hourly' : 'Cover', status: e.payroll_state === 'pending' ? 'New starter' : '', pay: e.pay_group || '', rate: e.default_rate, budget: e.weekly_hours, timings: [e.shift_days, e.shift_start ? String(e.shift_start).slice(0, 5) + '–' + String(e.shift_end || '').slice(0, 5) : ''].filter(Boolean).join(' ') })); }
  else if (prefill === 'run' && runId) { const [ls, s] = await Promise.all([loadRunLinesLite(runId), loadStaff().catch(() => [])]); const m = new Map(s.map((e) => [e.id, e])); people = ls.map((l) => { const e = m.get(l.employee_id) || {}; return { project: l.project_name, code: e.employee_code, name: l.employee_name, ni: l.ni_number, email: e.email, phone: e.phone, etype: e.employment_type === 'cover' ? 'Cover' : 'Permanent', ctype: e.employment_type === 'cover' ? 'Cover' : 'Hourly', pay: e.pay_group || '', rate: l.hourly_rate, budget: l.budgeted_hours }; }).sort((a, b) => natCompare(a.project, b.project) || natCompare(a.name, b.name)); }
  else people = [
    { project: 'NHS Cornwall', name: 'Example Permanent', ni: 'AB123456C', etype: 'Permanent', ctype: 'Hourly', pay: 'Last Working day', rate: 12.21, budget: 15, sample: 'perm' },
    { project: 'NHS Cornwall', name: 'Example Cover', etype: 'Cover', ctype: 'Cover', status: 'New starter', pay: 'Last Working day', rate: 12.21, budget: 10, sample: 'cover' },
    { project: 'Loreto College', name: 'Example Fixed', etype: 'Permanent', ctype: 'Fixed', pay: '25th', rate: 12.21, budget: 20, fixed: 1050, add: 25, ded: 10, sample: 'fixed' },
  ];
  const rows = [H];
  people.forEach((p, i) => {
    const r = [p.project, p.site || '', p.code || '', p.name, p.ni || '', p.email || '', p.phone || '', p.etype || '', p.ctype || '', p.status || '', p.pay || '', p.rate ?? '', p.budget ?? '', p.fixed ?? '', '', p.add ?? '', p.ded ?? '', '', '', '', '', '', '', '', '', '', p.timings || ''];
    const rowNo = i + 2;
    wk.forEach((w, k) => {
      const days = Array(7).fill('');
      if (p.sample === 'perm') { if (k === 0) days.splice(0, 5, 3, 3, 3, 'AL', 3); if (k === 1) days.splice(0, 5, 3, 'SSP', 'SSP', 3, 3); }
      if (p.sample === 'cover') { if (k === 0) days.splice(0, 3, 2, 2, 2.5); }
      r.push(...days);
      const c0 = base + k * 10, a = colName(c0) + rowNo, z = colName(c0 + 6) + rowNo, budgetCell = colName(12) + rowNo;
      r.push({ f: `SUM(${a}:${z})` }, '', { f: `${colName(c0 + 7)}${rowNo}+${colName(c0 + 8)}${rowNo}-${budgetCell}` });
    });
    rows.push(r);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // date headers shown as dates; formulas
  for (let c = base; c < H.length; c++) { const ref = colName(c) + '1'; if (typeof H[c] === 'number') { ws[ref].t = 'n'; ws[ref].z = 'ddd dd/mm/yyyy'; } }
  rows.forEach((r, ri) => r.forEach((v, ci) => { if (v && typeof v === 'object' && v.f) ws[colName(ci) + (ri + 1)] = { t: 'n', f: v.f }; }));
  ws['!cols'] = [...COLS.map((c) => ({ wch: c[1] })), ...wk.flatMap(() => [...Array(7).fill({ wch: 7 }), { wch: 11 }, { wch: 11 }, { wch: 11 }])];
  ws['!freeze'] = { xSplit: 4, ySplit: 1 }; ws['!views'] = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detailed');
  // instructions
  const ins = [['PAYROLL ONLINE — PAYROLL TEMPLATE'], [''], ['How to use it'],
    ['1. Fill in one row per person per project in the “Detailed” sheet (keep the headings in row 1 exactly as they are).'],
    ['2. Type the hours worked each day under the dates. Leave the day empty if they did not work.'],
    ['3. For leave or sickness type a code in the day instead of hours (see the leave codes below). You can add hours after the code: “AL 3”.'],
    ['   A code without hours uses Budgeted Hours ÷ 5 for paid leave. SSP and UNPAID are recorded with 0 paid hours (SSP is paid at the SSP day rate).'],
    ['4. “Total wc” and “Variance wc” work themselves out. “Leaves wc” can stay empty — leave codes are counted for you.'],
    ['5. Save, then in Payroll Online go to Import Excel and drop the file in. You see a preview before anything is saved.'],
    ['6. Re-importing the same payroll name lets you replace it or add new rows only.'], [''],
    ['Column', 'What to put in it'], ...COLS.map((c) => [c[0], c[2]]), ['(dates)', 'One column per day: hours worked (e.g. 3 or 2.5), or a leave code.'], ['Total wc …', 'Formula: hours worked that week.'], ['Leaves wc …', 'Optional: leave hours that week (otherwise counted from the codes).'], ['Variance wc …', 'Formula: worked + leave − weekly budget.'], [''],
    ['Leave codes (type in a day)', 'Meaning'], ...types.map((t) => [t.code, `${t.name}${t.ssp ? ' — paid at the SSP rate' : t.paid ? ' — paid' : ' — not paid'}`]), [''],
    ['Contract types', 'Hourly = hours × rate · Cover = hours × rate (cover / temporary staff) · Fixed = Fixed Pay is the wage (+ Addition − Deduction)'],
    ['Employment types', 'Permanent · Cover'], ['Pay dates', [...new Set(projects.map((p) => p.pay_group).filter(Boolean))].sort(natCompare).join(' · ') || '24th · 25th · 26th · 28th · 29th · Last Working day · 5th']];
  const wi = XLSX.utils.aoa_to_sheet(ins); wi['!cols'] = [{ wch: 28 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wi, 'Instructions');
  const wp = XLSX.utils.aoa_to_sheet([['Project Name', 'Pay date', 'Start Date', 'End Date', 'Area manager', 'Area manager email'], ...projects.sort((a, b) => natCompare(a.name, b.name)).map((p) => [p.name, p.pay_group || '', p.start_date || '', p.end_date || '', p.manager || '', p.manager_email || ''])]);
  wp['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wp, 'Projects');
  const wl = XLSX.utils.aoa_to_sheet([['Code', 'Leave type', 'Paid', 'SSP'], ...types.map((t) => [t.code, t.name, t.paid ? 'Yes' : 'No', t.ssp ? 'Yes' : 'No'])]); wl['!cols'] = [{ wch: 10 }, { wch: 34 }, { wch: 6 }, { wch: 6 }];
  XLSX.utils.book_append_sheet(wb, wl, 'Leave codes');
  const info = XLSX.utils.aoa_to_sheet([['Payroll Online template', 'Do not delete this sheet — it tells the importer how to read the file.'], ['Payroll type', stream === 'fortnightly' ? 'Fortnightly' : 'Monthly'], ['Payroll name', label], ['First week', dmy(wk[0])], ['Weeks', weeks], ['Made', new Date().toLocaleString('en-GB')]]);
  info['!cols'] = [{ wch: 22 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, info, 'Template Info');
  XLSX.writeFile(wb, `Payroll template - ${label}.xlsx`);
  return people.length;
}

export function templateModal() {
  const run = currentRun();
  modal('Download the payroll template', (done) => {
    const stream = h('select', null, [['monthly', 'Monthly'], ['fortnightly', 'Fortnightly']].map(([v, t]) => h('option', { value: v, selected: run && run.stream === v }, t)));
    const now = new Date(); const lab = h('input', { type: 'text', value: `${MONTHS[now.getMonth()]} ${now.getFullYear()}` });
    const start = h('input', { type: 'date', value: mondayOf(new Date().toISOString().slice(0, 10)) }), weeks = h('input', { type: 'number', min: 1, max: 6, value: 5 });
    const info = h('div', { class: 'small muted' });
    const look = async () => { const rows = await loadCalendarPeriod(stream.value, lab.value.trim()).catch(() => []); if (rows.length) { const f = rows.map((r) => r.reconcile_from).filter(Boolean).sort()[0], t = rows.map((r) => r.reconcile_to).filter(Boolean).sort().pop(); start.value = mondayOf(f); weeks.value = Math.min(6, Math.ceil((Date.parse(t) - Date.parse(mondayOf(f))) / (7 * 864e5) + 0.01)); info.textContent = `Dates taken from the pay calendar for ${lab.value.trim()}: ${dmy(f)} – ${dmy(t)}.`; } else info.textContent = 'Not in the pay calendar — choose the first Monday and the number of weeks.'; };
    lab.addEventListener('change', look); stream.onchange = () => { weeks.value = stream.value === 'fortnightly' ? 2 : 5; if (stream.value === 'fortnightly') lab.value = 'Fortnight ' + ((ctx.runs.filter((r) => r.stream === 'fortnightly').length || 0) + 1); look(); };
    setTimeout(look);
    const pre = h('select', null, [['sample', 'Example rows (shows how every column works)'], ['staff', 'All current employees (project, rate, hours, pay date filled in)'], ...(run ? [['run', `Copy the people from ${run.label}`]] : [])].map(([v, t]) => h('option', { value: v }, t)));
    return h('div', { class: 'stack' },
      h('div', { class: 'small' }, 'Monthly and fortnightly use the same layout and formulas as your Fortnightly TimeSheet workbook: Hourly / Agency = rate × (hours + holiday hours) + Addition; Fixed = Budgeted Wages + Addition. Monthly has one block per week (4–6 weeks) and a Pay date column. Words in the days (SSP, AL, off…) are only notes; holiday hours go in Holidays Hours and SSP money in Addittion/Deduction. An Instructions sheet explains each column.'),
      h('div', { class: 'form-grid g3' }, h('label', { class: 'fld' }, 'Payroll type', stream), h('label', { class: 'fld' }, 'Payroll name', lab), h('label', { class: 'fld' }, 'Fill it with', pre), h('label', { class: 'fld' }, 'First Monday', start), h('label', { class: 'fld' }, 'Number of weeks', weeks)), info,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Making…';
        try { const n = await buildTemplate({ stream: stream.value, label: lab.value.trim() || 'Payroll', start: start.value, weeks: Math.max(1, Math.min(6, +weeks.value || 4)), prefill: pre.value, runId: run && run.id }); done(); toast(`Template downloaded with ${n} row(s)`, 'ok'); }
        catch (e) { b.disabled = false; b.textContent = 'Download'; toast(e.message, 'err'); }
      } }, 'Download')));
  }, { wide: true });
}
void DOW;
