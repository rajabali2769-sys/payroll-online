// Excel -> normalised payroll payload. Pure functions: pass in the SheetJS module (XLSX) so the
// same code runs in the browser (CDN build) and in Node (tests).

const norm = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
export const normKey = (s) => norm(s).toLowerCase();

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const toNum = (v) => {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/^-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// Excel serial -> 'YYYY-MM-DD' (UTC maths, no timezone drift)
export function serialToISO(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}
// Header cell -> ISO date or null. Accepts Excel serial, JS Date, 'dd/mm/yyyy', 'yyyy-mm-dd'
export function headerToISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 40000 && v < 70000) return serialToISO(v);
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

const tidyType = (v) => { const s = norm(v); return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : null; };

// Daily cell -> {hours, note}. "3.00 ⚠" -> 3 + note, "BH" -> note only, 4 -> 4
function parseDay(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return { hours: v, note: null };
  const s = String(v).trim();
  const pureNumber = /^-?\d+(\.\d+)?$/.test(s);
  return { hours: pureNumber ? parseFloat(s) : toNum(s), note: pureNumber ? null : s };
}

// Canonical pay-date group: '24th','25th','26th','28th','29th','5th','LWD'
export function normPayGroup(v) {
  const s = norm(v).toLowerCase();
  if (!s) return null;
  if (s.includes('last')) return 'LWD';
  const m = s.match(/(\d{1,2})/);
  if (!m) return norm(v);
  const d = parseInt(m[1], 10);
  const suf = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
  return `${d}${suf}`;
}


const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// The reconciliation window of each pay-date group = the weeks that count towards variance for most
// of its lines (a few hand-edited rows should not widen the window).
export function derivePeriods(lines) {
  const byGroup = new Map();
  for (const l of lines) {
    const g = l.pay_group || 'Unassigned';
    const s = byGroup.get(g) || { win: new Map(), any: new Set() };
    for (const w of l.weeks) { s.any.add(w.week_start); if (w.in_window) s.win.set(w.week_start, (s.win.get(w.week_start) || 0) + 1); }
    byGroup.set(g, s);
  }
  return [...byGroup].map(([pay_group, s]) => {
    let weeks;
    if (s.win.size) { const max = Math.max(...s.win.values()); weeks = [...s.win].filter(([, n]) => n >= max * 0.5).map(([d]) => d); }
    else weeks = [...s.any];
    weeks.sort();
    return { pay_group, reconcile_from: weeks[0] || null, reconcile_to: weeks.length ? addDays(weeks[weeks.length - 1], 6) : null, pay_date: null };
  }).sort((a, b) => String(a.pay_group).localeCompare(String(b.pay_group), undefined, { numeric: true }));
}

function rowsOf(XLSX, ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
}
function findHeaderRow(rows, mustHave, maxScan = 15) {
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const set = new Set((rows[r] || []).map((c) => normKey(c)));
    if (mustHave.every((h) => set.has(h.toLowerCase()))) return r;
  }
  return -1;
}
// first column index whose header equals `name` (case-insensitive)
function colIndex(header, name, from = 0) {
  const k = name.toLowerCase();
  for (let i = from; i < header.length; i++) if (normKey(header[i]) === k) return i;
  return -1;
}

export function detectFileKind(XLSX, wb) {
  const names = wb.SheetNames.map((n) => n.trim().toLowerCase());
  if (names.includes('detailed')) return 'monthly';
  if (names.includes('fortnightly timesheet details')) return 'fortnightly';
  return null;
}
const sheetByName = (wb, name) => {
  const real = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  return real ? wb.Sheets[real] : null;
};

// ---------- reference data (projects, managers) ----------
function parseProjectsSheet(XLSX, wb) {
  const ws = sheetByName(wb, 'Projects');
  if (!ws) return [];
  const rows = rowsOf(XLSX, ws);
  const h = rows[0] || [];
  const iN = colIndex(h, 'Project Name'), iP = colIndex(h, 'Pay date'), iE = colIndex(h, 'End Date'), iS = colIndex(h, 'Start Date');
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const name = norm(rows[r][iN]);
    if (!name) continue;
    const cell = (i) => (i >= 0 ? rows[r][i] : null);
    out.push({ name, pay_group: normPayGroup(cell(iP)), start_date: headerToISO(cell(iS)), end_date: headerToISO(cell(iE)) });
  }
  return out;
}
function parseAccountList(XLSX, wb) {
  const ws = sheetByName(wb, 'Account List');
  if (!ws) return [];
  const rows = rowsOf(XLSX, ws);
  const hr = findHeaderRow(rows, ['account', 'manager']);
  if (hr < 0) return [];
  const iA = colIndex(rows[hr], 'Account'), iM = colIndex(rows[hr], 'Manager');
  return rows.slice(hr + 1).filter((r) => norm(r[iA])).map((r) => ({ name: norm(r[iA]), manager: norm(r[iM]) || null }));
}
function parseColType(XLSX, wb) {
  const ws = sheetByName(wb, 'Col Type');
  if (!ws) return [];
  const rows = rowsOf(XLSX, ws);
  const hr = findHeaderRow(rows, ['project', 'collection type']);
  if (hr < 0) return [];
  const iP = colIndex(rows[hr], 'Project'), iT = colIndex(rows[hr], 'Collection Type');
  return rows.slice(hr + 1).filter((r) => norm(r[iP])).map((r) => ({ name: norm(r[iP]), collection_type: norm(r[iT]) || null }));
}
function mergeProjects(...lists) {
  const map = new Map();
  for (const list of lists) for (const p of list) {
    const k = normKey(p.name);
    map.set(k, { ...(map.get(k) || {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined)) });
  }
  return [...map.values()];
}

// ---------- MONTHLY (sheet "Detailed") ----------
export function parseMonthly(XLSX, wb, fileName = '') {
  const ws = sheetByName(wb, 'Detailed');
  if (!ws) throw new Error('Sheet "Detailed" not found');
  const rows = rowsOf(XLSX, ws);
  const hr = findHeaderRow(rows, ['employee name', 'project name', 'hourly rate new']);
  if (hr < 0) throw new Error('Could not find the header row (Project Name / Employee Name / Hourly Rate New) in "Detailed"');
  const H = rows[hr];
  const c = {
    project: colIndex(H, 'Project Name'), site: colIndex(H, 'Site Name'), emp: colIndex(H, 'Employee Name'),
    blip: colIndex(H, 'Blip Site Name'), status: colIndex(H, 'Status'), ni: colIndex(H, 'NI'),
    rate: colIndex(H, 'Hourly Rate New'), type: colIndex(H, 'Contract Type'), budget: colIndex(H, 'Budgeted Hours'),
    fixed: colIndex(H, 'Fixed Pay'), leavePay: colIndex(H, 'Leave Pay'), add: colIndex(H, 'Addition'), ded: colIndex(H, 'Deduction'),
    remarks: colIndex(H, 'Remarks'), weeksRec: colIndex(H, 'No of weeks Reconciled'), comments: colIndex(H, 'Coments'),
    payDate: colIndex(H, 'Pay date'), tupe: colIndex(H, 'Tupe'), phone: colIndex(H, 'Phone'), pension: colIndex(H, 'Pension'),
    empPct: colIndex(H, 'Employee %'), emprPct: colIndex(H, 'Employer %'), allowance: colIndex(H, 'Allowance'),
    agreements: colIndex(H, 'Agreements'), timings: colIndex(H, 'Timings'),
    // Excel's own results, kept only so we can prove the maths matches
    xActual: colIndex(H, 'Actual Hours'), xLeave: colIndex(H, 'Actual Leaves Hours'), xOver: colIndex(H, 'Over Hours'),
    xLess: colIndex(H, 'Less Hours'), xHourly: colIndex(H, 'Hourly Payment'), xGross: colIndex(H, 'Gross Pay'),
    xBud: colIndex(H, 'Budgetted Pay'), xDiff: colIndex(H, 'Difference'),
  };
  for (const k of ['project', 'emp', 'rate', 'type', 'budget']) if (c[k] < 0) throw new Error(`Missing column for ${k} in "Detailed"`);

  // Weekly blocks: 7 date columns followed by "Total wc …", "Leaves…", "Variance…"
  const blocks = [];
  for (let i = 0; i < H.length; i++) {
    if (/^total wc/i.test(norm(H[i]))) {
      const days = [];
      for (let j = i - 7; j < i; j++) days.push({ col: j, iso: headerToISO(H[j]) });
      if (days.some((d) => !d.iso)) continue;
      blocks.push({ totalCol: i, leaveCol: i + 1, varCol: i + 2, days, weekStart: days[0].iso, label: norm(H[i]) });
    }
  }
  if (!blocks.length) throw new Error('No weekly blocks ("Total wc …") found in "Detailed"');

  const projects = parseProjectsSheet(XLSX, wb);
  const groupByProject = new Map(projects.map((p) => [normKey(p.name), p.pay_group]));
  const lines = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r];
    const project = norm(row[c.project]), emp = norm(row[c.emp]);
    if (!project || !emp) continue;
    const weeks = [], days = [];
    const budget = toNum(row[c.budget]);
    for (const b of blocks) {
      const delivered = toNum(row[b.totalCol]), leave = toNum(row[b.leaveCol]);
      const variancePresent = !isBlank(row[b.varCol]);
      if (delivered !== null || leave !== null || variancePresent) {
        const w = { week_start: b.weekStart, delivered: delivered ?? 0, leave: leave ?? 0, budget: budget ?? 0, in_window: variancePresent, variance_override: null };
        if (variancePresent) {
          const srcVar = toNum(row[b.varCol]);
          if (srcVar !== null && Math.abs(srcVar - (w.delivered + w.leave - w.budget)) > 0.011) w.variance_override = srcVar;
        }
        weeks.push(w);
      }
      for (const d of b.days) {
        const p = parseDay(row[d.col]);
        if (p && (p.hours !== null || p.note)) days.push({ d: d.iso, hours: p.hours, note: p.note });
      }
    }
    const pg = c.payDate >= 0 && !isBlank(row[c.payDate]) ? normPayGroup(row[c.payDate]) : groupByProject.get(normKey(project)) || null;
    lines.push({
      project, site: norm(row[c.site]) || null, employee_name: emp, ni: norm(row[c.ni]).replace(/\s+/g, '').toUpperCase() || null,
      blip_site: norm(row[c.blip]) || null, status: norm(row[c.status]) || null, contract_type: tidyType(row[c.type]),
      hourly_rate: toNum(row[c.rate]) ?? 0, budgeted_hours: budget ?? 0,
      fixed_pay: c.fixed >= 0 ? toNum(row[c.fixed]) : null, leave_pay: (c.leavePay >= 0 ? toNum(row[c.leavePay]) : 0) ?? 0,
      addition: (c.add >= 0 ? toNum(row[c.add]) : 0) ?? 0, deduction: (c.ded >= 0 ? toNum(row[c.ded]) : 0) ?? 0,
      weeks_reconciled: c.weeksRec >= 0 ? toNum(row[c.weeksRec]) : null,
      remarks: c.remarks >= 0 ? norm(row[c.remarks]) || null : null, comments: c.comments >= 0 ? norm(row[c.comments]) || null : null,
      pay_group: pg,
      extra: {
        tupe: c.tupe >= 0 ? norm(row[c.tupe]) || null : null, phone: c.phone >= 0 ? norm(row[c.phone]) || null : null,
        pension: c.pension >= 0 ? norm(row[c.pension]) || null : null, employee_pct: c.empPct >= 0 ? toNum(row[c.empPct]) : null,
        employer_pct: c.emprPct >= 0 ? toNum(row[c.emprPct]) : null, allowance: c.allowance >= 0 ? norm(row[c.allowance]) || null : null,
        agreements: c.agreements >= 0 ? norm(row[c.agreements]) || null : null, timings: c.timings >= 0 ? norm(row[c.timings]) || null : null,
      },
      weeks, days,
      check: { actual: toNum(row[c.xActual]), leave: toNum(row[c.xLeave]), over: toNum(row[c.xOver]), less: toNum(row[c.xLess]),
        hourly: toNum(row[c.xHourly]), gross: toNum(row[c.xGross]), budgeted: toNum(row[c.xBud]), diff: toNum(row[c.xDiff]) },
      source_row: r + 1,
    });
  }
  const dates = blocks.flatMap((b) => b.days.map((d) => d.iso)).sort();
  return {
    stream: 'monthly', source_file: fileName, sheet: 'Detailed',
    period_start: dates[0], period_end: dates[dates.length - 1],
    weeks: blocks.map((b) => ({ week_start: b.weekStart, label: b.label })),
    lines, periods: derivePeriods(lines), projects: mergeProjects(projects), warnings: [],
  };
}

// ---------- FORTNIGHTLY (sheet "Fortnightly TimeSheet Details") ----------
export function parseFortnightly(XLSX, wb, fileName = '') {
  const ws = sheetByName(wb, 'Fortnightly TimeSheet Details');
  if (!ws) throw new Error('Sheet "Fortnightly TimeSheet Details" not found');
  const rows = rowsOf(XLSX, ws);
  const hr = findHeaderRow(rows, ['employee name', 'project', 'payroll type']);
  if (hr < 0) throw new Error('Could not find the header row (Project / Employee Name / Payroll type) in "Fortnightly TimeSheet Details"');
  const H = rows[hr];
  const c = {
    project: colIndex(H, 'Project'), emp: colIndex(H, 'Employee Name'), ni: colIndex(H, 'NI No.'), ftype: colIndex(H, 'Fortnightly type'),
    cover: colIndex(H, 'Cover'), rate: colIndex(H, 'New Hourly Rate'), add: colIndex(H, 'Addittion/Deduction'), ptype: colIndex(H, 'Payroll type'),
    xGross: colIndex(H, 'Gross Wages New rate'), xBud: colIndex(H, 'Budgeted Wages'), xDelivered: colIndex(H, 'Total Delivered Hours'),
    xToPay: colIndex(H, 'Total Hours to Pay'),
  };
  for (const k of ['project', 'emp', 'rate', 'ptype']) if (c[k] < 0) throw new Error(`Missing column for ${k} in "Fortnightly TimeSheet Details"`);
  // Blocks: 7 date columns then Weekly Budget, Original Hours, Holidays Hours
  const blocks = [];
  for (let i = 0; i < H.length; i++) {
    if (/^weekly budget/i.test(norm(H[i]))) {
      const days = [];
      for (let j = i - 7; j < i; j++) days.push({ col: j, iso: headerToISO(H[j]) });
      if (days.some((d) => !d.iso)) continue;
      blocks.push({ budgetCol: i, origCol: i + 1, holCol: i + 2, days, weekStart: days[0].iso });
    }
  }
  if (!blocks.length) throw new Error('No weekly blocks ("Weekly Budget") found in the fortnightly sheet');

  // Fortnightly staff are paid on their own cycle, so they all sit in one 'Fortnightly' pay group.
  const projectRefs = mergeProjects(parseAccountList(XLSX, wb), parseColType(XLSX, wb));
  const lines = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r];
    const project = norm(row[c.project]), emp = norm(row[c.emp]);
    if (!project || !emp) continue;
    const weeks = [], days = [];
    for (const b of blocks) {
      const orig = toNum(row[b.origCol]), hol = toNum(row[b.holCol]), bud = toNum(row[b.budgetCol]);
      weeks.push({ week_start: b.weekStart, delivered: orig ?? 0, leave: hol ?? 0, budget: bud ?? 0, in_window: true, variance_override: null });
      for (const d of b.days) {
        const p = parseDay(row[d.col]);
        if (p && (p.hours !== null || p.note)) days.push({ d: d.iso, hours: p.hours, note: p.note });
      }
    }
    const ptype = tidyType(row[c.ptype]) || 'Hourly';
    const budgetedWages = c.xBud >= 0 ? toNum(row[c.xBud]) : null;
    lines.push({
      project, site: null, employee_name: emp, ni: norm(row[c.ni]).replace(/\s+/g, '').toUpperCase() || null,
      blip_site: null, status: null, contract_type: ptype,
      hourly_rate: toNum(row[c.rate]) ?? 0, budgeted_hours: 0,
      // FIXED payroll: gross = budgeted wages (+ additions), so budgeted wages become the fixed pay
      fixed_pay: ptype.toUpperCase() === 'FIXED' ? budgetedWages ?? 0 : null,
      leave_pay: 0, addition: (c.add >= 0 ? toNum(row[c.add]) : 0) ?? 0, deduction: 0,
      weeks_reconciled: null, remarks: null, comments: null,
      pay_group: 'Fortnightly',
      extra: { fortnight_type: c.ftype >= 0 ? toNum(row[c.ftype]) : null, cover: c.cover >= 0 ? norm(row[c.cover]) || null : null },
      weeks, days,
      check: { gross: c.xGross >= 0 ? toNum(row[c.xGross]) : null, budgeted: budgetedWages,
        delivered: c.xDelivered >= 0 ? toNum(row[c.xDelivered]) : null, toPay: c.xToPay >= 0 ? toNum(row[c.xToPay]) : null },
      source_row: r + 1,
    });
  }
  const dates = blocks.flatMap((b) => b.days.map((d) => d.iso)).sort();
  return {
    stream: 'fortnightly', source_file: fileName, sheet: 'Fortnightly TimeSheet Details',
    period_start: dates[0], period_end: dates[dates.length - 1],
    weeks: blocks.map((b) => ({ week_start: b.weekStart, label: `w/c ${b.weekStart}` })),
    lines, periods: derivePeriods(lines), projects: projectRefs, warnings: [],
  };
}

export function parseWorkbook(XLSX, wb, fileName = '') {
  const kind = detectFileKind(XLSX, wb);
  if (kind === 'monthly') return parseMonthly(XLSX, wb, fileName);
  if (kind === 'fortnightly') return parseFortnightly(XLSX, wb, fileName);
  throw new Error('Unrecognised file. Expected a workbook with a "Detailed" sheet (monthly) or a "Fortnightly TimeSheet Details" sheet.');
}
