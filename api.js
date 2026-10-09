// Everything that talks to Supabase lives here.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { normKey } from './parsers.js';

export const configured = !/YOUR-PROJECT|YOUR-ANON/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

const ok = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };

// Supabase returns max 1000 rows per request, so page through.
async function fetchAll(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const data = ok(await build().range(from, from + page - 1));
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

// ---------------- auth ----------------
export const auth = {
  session: async () => (await sb.auth.getSession()).data.session,
  signIn: async (email, password) => ok(await sb.auth.signInWithPassword({ email, password })),
  signOut: () => sb.auth.signOut(),
  reset: async (email) => ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })),
  setPassword: async (password) => ok(await sb.auth.updateUser({ password })),
  onChange: (cb) => sb.auth.onAuthStateChange((event, session) => cb(event, session)),
  myProfile: async (uid) => ok(await sb.from('profiles').select('*').eq('id', uid).maybeSingle()),
};

// ---------------- reading ----------------
export const loadRuns = async () => ok(await sb.from('pay_runs').select('*').order('period_end', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }));
export const loadPeriods = async (runId) => ok(await sb.from('pay_periods').select('*').eq('run_id', runId));
export const loadSummary = async (runId) => ok(await sb.from('v_run_summary').select('*').eq('run_id', runId));

export async function loadRunData(runId) {
  const [lines, weeks] = await Promise.all([
    fetchAll(() => sb.from('v_payroll_lines').select('*').eq('run_id', runId).order('project_name').order('employee_name').order('id')),
    fetchAll(() => sb.from('v_line_weeks').select('*').eq('run_id', runId).order('line_id').order('week_start')),
  ]);
  const weeksByLine = new Map();
  for (const w of weeks) { if (!weeksByLine.has(w.line_id)) weeksByLine.set(w.line_id, []); weeksByLine.get(w.line_id).push(w); }
  return { lines, weeksByLine };
}
export async function refreshLines(ids) {
  const out = { lines: [], weeks: [] };
  for (const part of chunk(ids, 80)) {
    out.lines.push(...ok(await sb.from('v_payroll_lines').select('*').in('id', part)));
    out.weeks.push(...ok(await sb.from('line_weeks').select('*').in('line_id', part)));
  }
  return out;
}
export const loadLine = async (id) => ok(await sb.from('v_payroll_lines').select('*').eq('id', id).maybeSingle());
export const loadLineWeeks = async (id) => ok(await sb.from('line_weeks').select('*').eq('line_id', id).order('week_start'));
export const loadDays = async (id) => ok(await sb.from('daily_hours').select('*').eq('line_id', id).order('work_date'));
export const explore = async (a) => ok(await sb.rpc('explore_hours', {
  p_from: a.from, p_to: a.to, p_by: a.by, p_stream: a.stream || null, p_run: a.run || null,
  p_group: a.group || null, p_project: a.project || null, p_search: a.search || null }));

// ---------------- editing (everyone sees it instantly via realtime) ----------------
export async function updateLine(id, patch) {
  ok(await sb.from('payroll_lines').update(patch).eq('id', id));
  return loadLine(id);
}
export async function upsertWeek(row) {
  ok(await sb.from('line_weeks').upsert(row, { onConflict: 'line_id,week_start' }));
  return loadLine(row.line_id);
}
export async function upsertDay(lineId, date, hours, note) {
  if ((hours === null || hours === undefined) && !note) ok(await sb.from('daily_hours').delete().eq('line_id', lineId).eq('work_date', date));
  else ok(await sb.from('daily_hours').upsert({ line_id: lineId, work_date: date, hours, note: note || null }, { onConflict: 'line_id,work_date' }));
}
export async function createLine(runId, fields, weekStarts, budget) {
  const id = crypto.randomUUID();
  const projects = ok(await sb.from('projects').select('id,name_key'));
  const proj = projects.find((p) => p.name_key === normKey(fields.project_name));
  ok(await sb.from('payroll_lines').insert({ id, run_id: runId, project_id: proj?.id ?? null, ...fields }));
  if (weekStarts.length) ok(await sb.from('line_weeks').insert(weekStarts.map((w) => ({ line_id: id, week_start: w, delivered: 0, leave: 0, budget: budget || 0, in_window: true }))));
  return id;
}
export const deleteLine = async (id) => ok(await sb.from('payroll_lines').delete().eq('id', id));
export const savePeriod = async (row) => ok(await sb.from('pay_periods').upsert(row, { onConflict: 'run_id,pay_group' }));
export const deletePeriod = async (id) => ok(await sb.from('pay_periods').delete().eq('id', id));
export const renameRun = async (id, label) => ok(await sb.from('pay_runs').update({ label }).eq('id', id));
export const deleteRun = async (id) => ok(await sb.rpc('delete_run', { p_run: id }));
export const approveRun = async (id) => ok(await sb.rpc('approve_pay_run', { p_run: id }));
export const lockRun = async (id) => ok(await sb.rpc('lock_pay_run', { p_run: id }));
export const unlockRun = async (id) => ok(await sb.rpc('unlock_pay_run', { p_run: id }));

// ---------------- reference data ----------------
export const loadProjects = async () => fetchAll(() => sb.from('projects').select('*').order('name'));
export const loadAliases = async () => fetchAll(() => sb.from('project_aliases').select('*').order('alias_key'));
export const updateProject = async (id, patch) => ok(await sb.from('projects').update(patch).eq('id', id));
export const addAlias = async (alias, projectId) => ok(await sb.from('project_aliases').upsert({ alias_key: normKey(alias), project_id: projectId }));
export const deleteAlias = async (key) => ok(await sb.from('project_aliases').delete().eq('alias_key', key));
export const applyProjectGroup = async (runId, projectId, group) => ok(await sb.from('payroll_lines').update({ pay_group: group }).eq('run_id', runId).eq('project_id', projectId));

// ---------------- history & users ----------------
export async function loadAudit({ limit = 100, beforeId = null, table = null, runId = null, lineId = null } = {}) {
  let q = sb.from('audit_log').select('*').order('id', { ascending: false }).limit(limit);
  if (beforeId) q = q.lt('id', beforeId);
  if (table) q = q.eq('table_name', table);
  if (runId) q = q.eq('run_id', runId);
  if (lineId) q = q.like('row_id', lineId + '%');
  return ok(await q);
}
export const loadProfiles = async () => ok(await sb.from('profiles').select('*').order('created_at'));
export const setRole = async (id, role) => ok(await sb.from('profiles').update({ role }).eq('id', id));

// ---------------- live sync ----------------
const listeners = new Set();
export const onLive = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
export function startLive(statusCb) {
  const ch = sb.channel('payroll-live');
  for (const table of ['payroll_lines', 'line_weeks', 'daily_hours', 'pay_runs', 'pay_periods', 'employees', 'projects', 'hr_cases', 'hr_case_events', 'cover_assignments', 'cover_hours']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
      const evt = { table, type: p.eventType, row: p.new && Object.keys(p.new).length ? p.new : null, old: p.old && Object.keys(p.old).length ? p.old : null };
      listeners.forEach((cb) => { try { cb(evt); } catch (e) { console.error(e); } });
    });
  }
  ch.subscribe((s) => statusCb && statusCb(s === 'SUBSCRIBED'));
  return () => sb.removeChannel(ch);
}

// ---------------- import ----------------
export async function importPayload(p, { label, mode = 'new', onProgress = () => {} }) {
  const existing = ok(await sb.from('pay_runs').select('*').eq('stream', p.stream).eq('label', label).maybeSingle());
  if (existing && existing.status === 'locked') throw new Error(`“${label}” is locked. An admin must unlock it on the Dashboard before it can be re-imported.`);
  if (existing && mode === 'new') throw new Error(`A ${p.stream} run called "${label}" already exists. Choose "Replace" or "Add new rows only", or change the name.`);
  let run = existing, created = false;
  const header = { period_start: p.period_start, period_end: p.period_end, source_file: p.source_file, status: 'importing' };
  let skipKeys = new Set();
  if (!existing) { run = ok(await sb.from('pay_runs').insert({ stream: p.stream, label, ...header }).select().single()); created = true; }
  else {
    if (mode === 'merge') {
      const cur = await fetchAll(() => sb.from('payroll_lines').select('project_name,site_name,employee_name,contract_type').eq('run_id', existing.id).order('id'));
      skipKeys = new Set(cur.map((c) => [c.project_name, c.site_name, c.employee_name, c.contract_type].map(normKey).join('|')));
    } else ok(await sb.rpc('clear_run', { p_run: existing.id }));
    ok(await sb.from('pay_runs').update(header).eq('id', existing.id));
  }
  try {
    // projects -------------------------------------------------------------
    const projects = await loadProjects(), aliases = await loadAliases();
    const byKey = new Map(projects.map((x) => [x.name_key, x]));
    const aliasKey = new Map(aliases.map((a) => [a.alias_key, a.project_id]));
    const wanted = new Map();
    for (const pr of p.projects) wanted.set(normKey(pr.name), pr);
    for (const l of p.lines) if (!wanted.has(normKey(l.project))) wanted.set(normKey(l.project), { name: l.project });
    const upserts = [];
    for (const [key, pr] of wanted) {
      if (aliasKey.has(key)) continue;
      const cur = byKey.get(key);
      const row = cur ? { ...cur } : { name: pr.name, name_key: key };
      let changed = !cur;
      for (const f of ['pay_group', 'manager', 'collection_type', 'start_date', 'end_date']) if ((row[f] === null || row[f] === undefined) && pr[f]) { row[f] = pr[f]; changed = true; }
      if (changed) upserts.push(row);
    }
    for (const part of chunk(upserts, 300)) ok(await sb.from('projects').upsert(part, { onConflict: 'name_key' }));
    const projAll = await loadProjects();
    const projByKey = new Map(projAll.map((x) => [x.name_key, x]));
    const projFor = (name) => { const k = normKey(name); return projByKey.get(k) || projAll.find((x) => x.id === aliasKey.get(k)) || null; };

    // employees -------------------------------------------------------------
    const emps = await fetchAll(() => sb.from('employees').select('id,name_key,ni_number').order('id'));
    const byNi = new Map(emps.filter((e) => e.ni_number).map((e) => [e.ni_number, e.id]));
    const byName = new Map(); for (const e of emps) if (!byName.has(e.name_key)) byName.set(e.name_key, e.id);
    const newEmps = new Map();
    for (const l of p.lines) {
      const nk = normKey(l.employee_name);
      if ((l.ni && byNi.has(l.ni)) || (!l.ni && byName.has(nk))) continue;
      const k = l.ni || 'n:' + nk;
      if (!newEmps.has(k)) newEmps.set(k, { id: crypto.randomUUID(), full_name: l.employee_name, name_key: nk, ni_number: l.ni || null,
        phone: l.extra?.phone || null, pension: l.extra?.pension || null, employee_pct: l.extra?.employee_pct ?? null, employer_pct: l.extra?.employer_pct ?? null, agreements: l.extra?.agreements || null });
    }
    for (const part of chunk([...newEmps.values()], 400)) ok(await sb.from('employees').insert(part));
    for (const e of newEmps.values()) { if (e.ni_number) byNi.set(e.ni_number, e.id); else byName.set(e.name_key, e.id); }
    const empFor = (l) => (l.ni && byNi.get(l.ni)) || byName.get(normKey(l.employee_name)) || null;

    // lines, weeks, days ------------------------------------------------------
    const lines = p.lines.filter((l) => !skipKeys.has([l.project, l.site, l.employee_name, l.contract_type].map(normKey).join('|')));
    const L = [], W = [], D = [];
    for (const l of lines) {
      const id = crypto.randomUUID(), pr = projFor(l.project);
      L.push({ id, run_id: run.id, employee_id: empFor(l), project_id: pr?.id ?? null, project_name: l.project, site_name: l.site, employee_name: l.employee_name,
        ni_number: l.ni, blip_site: l.blip_site, status: l.status, contract_type: l.contract_type, hourly_rate: l.hourly_rate, budgeted_hours: l.budgeted_hours,
        fixed_pay: l.fixed_pay, leave_pay: l.leave_pay, addition: l.addition, deduction: l.deduction, weeks_reconciled: l.weeks_reconciled,
        remarks: l.remarks, comments: l.comments, pay_group: l.pay_group || pr?.pay_group || null, extra: l.extra });
      for (const w of l.weeks) W.push({ line_id: id, week_start: w.week_start, delivered: w.delivered, leave: w.leave, budget: w.budget, in_window: w.in_window, variance_override: w.variance_override });
      for (const d of l.days) D.push({ line_id: id, work_date: d.d, hours: d.hours, note: d.note });
    }
    const total = L.length + W.length + D.length; let done = 0;
    const push = async (table, rows, size) => { for (const part of chunk(rows, size)) { ok(await sb.from(table).insert(part)); done += part.length; onProgress(done / total, `${table.replace('_', ' ')}… ${done.toLocaleString()} / ${total.toLocaleString()}`); } };
    await push('payroll_lines', L, 200); await push('line_weeks', W, 1000); await push('daily_hours', D, 1000);

    // pay windows: add the ones we do not have yet (never overwrite windows someone already edited)
    const have = new Set((await loadPeriods(run.id)).map((x) => x.pay_group));
    const newPeriods = (p.periods || []).filter((x) => !have.has(x.pay_group)).map((x) => ({ run_id: run.id, ...x }));
    if (newPeriods.length) ok(await sb.from('pay_periods').insert(newPeriods));
    ok(await sb.from('pay_runs').update({ status: 'ready' }).eq('id', run.id));
    ok(await sb.rpc('log_import', { p_run: run.id, p_text: `${p.source_file} · ${L.length} lines (${mode === 'merge' ? 'new rows only' : mode === 'replace' ? 'replaced run' : 'new run'})` }));
    onProgress(1, 'Done');
    return { run, lines: L.length, skipped: p.lines.length - L.length };
  } catch (e) {
    try { if (created) await sb.from('pay_runs').delete().eq('id', run.id); else await sb.from('pay_runs').update({ status: 'ready' }).eq('id', run.id); } catch { /* ignore */ }
    throw e;
  }
}

// =====================================================================================================
// v3: settings, leave, timesheets, hours upload, provider report, journal, escalations
// =====================================================================================================
const ymd = (d) => String(d).slice(0, 10);
const mondayOf = (iso) => { const d = new Date(ymd(iso) + 'T00:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
const plus = (iso, n) => new Date(Date.parse(ymd(iso) + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ---------- settings + leave types ----------
export const loadSettings = async () => Object.fromEntries(ok(await sb.from('app_settings').select('*')).map((r) => [r.key, r.value]));
export const saveSetting = async (key, value) => ok(await sb.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
export const loadLeaveTypes = async () => ok(await sb.from('leave_types').select('*').order('sort'));
export const saveLeaveType = async (row) => ok(await sb.from('leave_types').upsert(row, { onConflict: 'code' }));
export const deleteLeaveType = async (code) => ok(await sb.from('leave_types').delete().eq('code', code));

// ---------- leave ----------
export const loadLineLeave = async (lineId) => ok(await sb.from('v_leave').select('*').eq('line_id', lineId).order('leave_date'));
export const loadRunLeave = async (runId) => fetchAll(() => sb.from('v_leave').select('*').eq('run_id', runId).order('leave_date').order('id'));
export const deleteLeave = async (id) => ok(await sb.from('line_leave').delete().eq('id', id));
// Make sure a weekly row exists for every week touched, so itemised paid leave counts towards that week.
async function ensureWeeks(lineId, dates) {
  const weeks = [...new Set(dates.map(mondayOf))];
  const have = new Set(ok(await sb.from('line_weeks').select('week_start').eq('line_id', lineId).in('week_start', weeks)).map((w) => ymd(w.week_start)));
  const missing = weeks.filter((w) => !have.has(w));
  if (!missing.length) return;
  const line = ok(await sb.from('payroll_lines').select('budgeted_hours').eq('id', lineId).maybeSingle());
  ok(await sb.from('line_weeks').insert(missing.map((w) => ({ line_id: lineId, week_start: w, delivered: 0, leave: 0, budget: num0(line?.budgeted_hours), in_window: true }))));
}
const num0 = (v) => +v || 0;
export async function addLeave(lineId, entries) {
  if (!entries.length) return;
  await ensureWeeks(lineId, entries.map((e) => e.date));
  ok(await sb.from('line_leave').upsert(entries.map((e) => ({ line_id: lineId, leave_date: e.date, hours: num0(e.hours), type_code: e.type, amount: e.amount ?? null, note: e.note || null })), { onConflict: 'line_id,leave_date' }));
}

// ---------- hours + timesheets: one writer used by timesheets and by "upload hours" ----------
// entries: [{project, site, employee_name, ni, rate, contract_type, pay_group, days:[{date, hours|null}], leave:[{date,hours,type,amount,note}]}]
export async function commitEntries(run, entries, onProgress = () => {}) {
  const lines = await fetchAll(() => sb.from('payroll_lines').select('id,employee_name,ni_number,project_name,site_name,budgeted_hours').eq('run_id', run.id).order('id'));
  const projects = await loadProjects(); const aliases = await loadAliases();
  const projKey = new Map(projects.map((p) => [p.name_key, p]));
  const aliasProj = new Map(aliases.map((a) => [a.alias_key, projects.find((p) => p.id === a.project_id)]));
  const emps = await fetchAll(() => sb.from('employees').select('id,name_key,ni_number').order('id'));
  const byNi = new Map(emps.filter((e) => e.ni_number).map((e) => [e.ni_number, e.id])), byName = new Map(emps.map((e) => [e.name_key, e.id]));
  const out = { created: 0, updated: 0, days: 0, leave: 0, adhoc: 0, lineIds: [] };
  let i = 0;
  for (const e of entries) {
    const nk = normKey(e.employee_name), pk = normKey(e.project), sk = normKey(e.site || '');
    const cands = lines.filter((l) => normKey(l.project_name) === pk && ((e.ni && l.ni_number === e.ni) || normKey(l.employee_name) === nk));
    let line = cands.find((l) => normKey(l.site_name || '') === sk) || (sk ? null : cands[0]) || (cands.length && !sk ? cands[0] : null);
    if (!line && cands.length && !e.site) line = cands[0];
    if (!line) {
      let empId = (e.ni && byNi.get(e.ni)) || byName.get(nk) || null;
      if (!empId) { empId = crypto.randomUUID(); ok(await sb.from('employees').insert({ id: empId, full_name: e.employee_name, name_key: nk, ni_number: e.ni || null })); byName.set(nk, empId); if (e.ni) byNi.set(e.ni, empId); }
      const pr = projKey.get(pk) || aliasProj.get(pk) || null;
      const id = crypto.randomUUID();
      const row = { id, run_id: run.id, employee_id: empId, project_id: pr?.id ?? null, project_name: e.project, site_name: e.site || null, employee_name: e.employee_name, ni_number: e.ni || null,
        contract_type: e.contract_type || 'Hourly', hourly_rate: num0(e.rate), budgeted_hours: num0(e.budget_hours), pay_group: e.pay_group || pr?.pay_group || null, status: 'timesheet' };
      ok(await sb.from('payroll_lines').insert(row));
      line = { id, employee_name: e.employee_name, ni_number: e.ni || null, project_name: e.project, site_name: e.site || null, budgeted_hours: row.budgeted_hours };
      lines.push(line); out.created++;
    } else {
      out.updated++;
      if (e.rate && num0(e.rate) > 0) ok(await sb.from('payroll_lines').update({ hourly_rate: num0(e.rate) }).eq('id', line.id));
    }
    out.lineIds.push(line.id);
    const days = (e.days || []).filter((d) => d.date);
    const put = days.filter((d) => d.hours !== null && d.hours !== undefined && !Number.isNaN(+d.hours) && +d.hours > 0);
    const del = days.filter((d) => !put.includes(d)).map((d) => d.date);
    if (del.length) ok(await sb.from('daily_hours').delete().eq('line_id', line.id).in('work_date', del));
    if (put.length) { ok(await sb.from('daily_hours').upsert(put.map((d) => ({ line_id: line.id, work_date: d.date, hours: +d.hours, note: d.note || null })), { onConflict: 'line_id,work_date' })); out.days += put.length; }
    if ((e.clearLeaveDates || []).length) ok(await sb.from('line_leave').delete().eq('line_id', line.id).in('leave_date', e.clearLeaveDates));
    const allDates = [...days.map((d) => d.date), ...(e.leave || []).map((l) => l.date)];
    if (days.length) {                                                       // weekly totals follow the days
      const weeks = [...new Set(days.map((d) => mondayOf(d.date)))];
      const lo = weeks.slice().sort()[0], hi = plus(weeks.slice().sort().pop(), 6);
      const stored = ok(await sb.from('daily_hours').select('work_date,hours').eq('line_id', line.id).gte('work_date', lo).lte('work_date', hi));
      const have = ok(await sb.from('line_weeks').select('*').eq('line_id', line.id).in('week_start', weeks));
      for (const w of weeks) {
        const sum = stored.filter((s) => mondayOf(s.work_date) === w).reduce((a, s) => a + num0(s.hours), 0);
        const cur = have.find((x) => ymd(x.week_start) === w);
        ok(await sb.from('line_weeks').upsert({ line_id: line.id, week_start: w, delivered: Math.round(sum * 100) / 100, leave: cur ? cur.leave : 0, budget: cur ? cur.budget : num0(line.budgeted_hours), in_window: cur ? cur.in_window : true, variance_override: cur ? cur.variance_override : null }, { onConflict: 'line_id,week_start' }));
      }
    }
    if ((e.leave || []).length) { await addLeave(line.id, e.leave); out.leave += e.leave.length; }
    if ((e.clearAdhocDates || []).length) ok(await sb.from('adhoc_hours').delete().eq('line_id', line.id).in('work_date', e.clearAdhocDates));
    if ((e.adhoc || []).length) { ok(await sb.from('adhoc_hours').upsert(e.adhoc.map((x) => ({ line_id: line.id, work_date: x.date, hours: +x.hours || 0, note: x.note || null })), { onConflict: 'line_id,work_date' })); out.adhoc += e.adhoc.length; }
    void allDates; onProgress(++i / entries.length, `${e.employee_name}`);
  }
  return out;
}

// ---------- timesheets (record + file) ----------
export const loadTimesheets = async (runId) => ok(await sb.from('timesheets').select('*').eq('run_id', runId).order('week_start', { ascending: false }).order('created_at', { ascending: false }));
export const saveTimesheet = async (row) => { if (row.id) { const { id, ...rest } = row; ok(await sb.from('timesheets').update(rest).eq('id', id)); return id; } const id = crypto.randomUUID(); ok(await sb.from('timesheets').insert({ id, ...row })); return id; };
export const deleteTimesheet = async (ts) => { if (ts.file_path) { try { await sb.storage.from('timesheets').remove([ts.file_path]); } catch { /* keep going */ } } ok(await sb.from('timesheets').delete().eq('id', ts.id)); };
export async function uploadTimesheetFile(runId, file) {
  const path = `${runId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await sb.storage.from('timesheets').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error('Could not store the file: ' + error.message);
  return path;
}
export async function timesheetUrl(path) { const { data, error } = await sb.storage.from('timesheets').createSignedUrl(path, 3600); if (error) throw new Error(error.message); return data.signedUrl; }

// ---------- pay runs from scratch ----------
export async function createRun({ stream, label, period_start, period_end }) {
  return ok(await sb.from('pay_runs').insert({ stream, label, period_start, period_end, source_file: 'created in Payroll Online', status: 'ready' }).select().single());
}

// ---------- provider report + journal ----------
export const loadProvider = async (runId) => fetchAll(() => sb.from('provider_pay').select('*').eq('run_id', runId).order('department').order('id'));
export async function replaceProvider(runId, rows, source) {
  ok(await sb.from('provider_pay').delete().eq('run_id', runId));
  for (const part of chunk(rows.map((r) => ({ run_id: runId, source_file: source, ...r })), 400)) ok(await sb.from('provider_pay').insert(part));
}
export const loadJournalExtra = async (runId) => ok(await sb.from('journal_extra').select('*').eq('run_id', runId).order('created_at'));
export const addJournalExtra = async (row) => ok(await sb.from('journal_extra').insert(row));
export const deleteJournalExtra = async (id) => ok(await sb.from('journal_extra').delete().eq('id', id));
export const loadJournalExports = async (runId) => ok(await sb.from('journal_exports').select('*').eq('run_id', runId).order('created_at', { ascending: false }));
export const logJournalExport = async (row) => ok(await sb.from('journal_exports').insert(row));

// ---------- escalations ----------
export const loadEscalations = async (runId) => ok(await sb.from('escalations').select('*').eq('run_id', runId).order('created_at', { ascending: false }));
export const addEscalation = async (row) => ok(await sb.from('escalations').insert(row));
export const saveProjectContact = async (id, patch) => ok(await sb.from('projects').update(patch).eq('id', id));

// ---------- the numbers for the readiness tracker ----------
export async function loadSignals(runId) {
  const [ts, lv, es, pv, je] = await Promise.all([
    fetchAll(() => sb.from('timesheets').select('id,status,kind').eq('run_id', runId).order('id')),
    fetchAll(() => sb.from('v_leave').select('id,paid,ssp,hours').eq('run_id', runId).order('id')),
    loadEscalations(runId).catch(() => []),
    fetchAll(() => sb.from('provider_pay').select('id').eq('run_id', runId).order('id')),
    loadJournalExports(runId).catch(() => []),
  ]);
  return { timesheets: ts, leave: lv, escalations: es, provider: pv.length, exports: je };
}

// =====================================================================================================
// v4: permissions, preferences, email + AI functions, contacts, payslips
// =====================================================================================================
export const loadRolePerms = async () => ok(await sb.from('role_permissions').select('*'));
export const saveRolePerm = async (role, perm, allowed) => ok(await sb.from('role_permissions').upsert({ role, perm, allowed }, { onConflict: 'role,perm' }));
export const loadPref = async (key) => { const r = ok(await sb.from('user_prefs').select('value').eq('key', key).maybeSingle()); return r ? r.value : null; };
export const savePref = async (key, value) => ok(await sb.from('user_prefs').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' }));
export const loadAllSummaries = async () => fetchAll(() => sb.from('v_run_summary').select('*').order('run_id'));

// Calls to the cloud functions (send-email, ai). Errors come back as plain, readable messages.
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || String(error);
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch { /* keep the generic message */ }
    if (/Failed to send a request|FunctionsFetchError|not found/i.test(msg)) msg = `The “${name}” function is not set up yet. Follow the setup guide (Settings → Email / AI).`;
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
export const sendEmails = (kind, messages, extra = {}) => callFn('send-email', { kind, messages, ...extra });
export const aiReadTimesheet = async ({ path, text, hint }) => (await callFn('ai', { action: 'read_timesheet', path, text, hint })).result;
export const aiChat = (messages, current_run) => callFn('ai', { action: 'chat', messages, current_run });

// ---------- employee contacts (email) ----------
export const loadEmployeesAll = async () => fetchAll(() => sb.from('employees').select('id,full_name,name_key,ni_number,email,phone').order('full_name').order('id'));
// rows: [{name, ni, email}] -> match on NI number, then on name; create anyone who is missing
export async function saveContacts(rows) {
  const emps = await loadEmployeesAll(); const byNi = new Map(emps.filter((e) => e.ni_number).map((e) => [e.ni_number, e])), byName = new Map(emps.map((e) => [e.name_key, e]));
  let updated = 0, created = 0, skipped = 0;
  for (const r of rows) {
    const email = String(r.email || '').trim(); if (!email) { skipped++; continue; }
    const ni = String(r.ni || '').replace(/\s+/g, '').toUpperCase(), nk = normKey(r.name), e = (ni && byNi.get(ni)) || byName.get(nk);
    if (e) { if ((e.email || '').toLowerCase() !== email.toLowerCase()) { ok(await sb.from('employees').update({ email }).eq('id', e.id)); updated++; } else skipped++; }
    else { ok(await sb.from('employees').insert({ id: crypto.randomUUID(), full_name: r.name, name_key: nk, ni_number: ni || null, email })); created++; }
  }
  return { updated, created, skipped };
}
export const setEmployeeEmail = async (id, email) => ok(await sb.from('employees').update({ email: email || null }).eq('id', id));
export const loadEmailLog = async (runId, kind) => { let q = sb.from('email_log').select('*').order('created_at', { ascending: false }).limit(1000); if (runId) q = q.eq('run_id', runId); if (kind) q = q.eq('kind', kind); return ok(await q); };
export const setPayslipsPublished = async (runId, on) => ok(await sb.from('pay_runs').update({ payslips_published_at: on ? new Date().toISOString() : null }).eq('id', runId));
export async function uploadAiCopy(path, blob) {
  const { error } = await sb.storage.from('timesheets').upload(path + '__ai.jpg', blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
}

// ---------- v4.2: hours-based budget views for the dashboard ----------
export const loadLinesForRuns = async (runIds) => fetchAll(() => sb.from('v_payroll_lines').select('id,run_id,run_label,stream,project_name,pay_group,employee_name,window_budget_hours,window_worked_hours,hours_difference,gross_pay,budgeted_pay,budget_status').in('run_id', runIds).order('id'));
export const loadDailyForRun = async (runId) => fetchAll(() => sb.from('v_daily').select('work_date,hours,project_name,employee_name,hourly_rate,contract_type,line_id').eq('run_id', runId).order('work_date').order('line_id'));


// =====================================================================================================
// v4.3: project budgets, ad-hoc hours, active employees, employee budgets
// =====================================================================================================
export const loadProjectBudgets = async () => fetchAll(() => sb.from('project_budgets').select('*').order('project_name'));
export const saveProjectBudget = async (row) => ok(await sb.from('project_budgets').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'name_key' }));
export async function saveProjectBudgets(rows) { for (const part of chunk(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), 200)) ok(await sb.from('project_budgets').upsert(part, { onConflict: 'name_key' })); }
export const deleteProjectBudget = async (key) => ok(await sb.from('project_budgets').delete().eq('name_key', key));
export const loadProjectStatus = async (runId) => fetchAll(() => sb.from('v_project_status').select('*').eq('run_id', runId).order('project_key'));
export const loadProjectStatusForRuns = async (ids) => fetchAll(() => sb.from('v_project_status').select('*').in('run_id', ids).order('project_key'));
export const loadAdhoc = async (runId) => fetchAll(() => sb.from('v_adhoc').select('*').eq('run_id', runId).order('work_date').order('line_id'));
export const loadLineAdhoc = async (lineId) => ok(await sb.from('adhoc_hours').select('*').eq('line_id', lineId).order('work_date'));
export async function addAdhoc(lineId, entries) { if (entries.length) ok(await sb.from('adhoc_hours').upsert(entries.map((e) => ({ line_id: lineId, work_date: e.date, hours: +e.hours || 0, note: e.note || null })), { onConflict: 'line_id,work_date' })); }
export const deleteAdhoc = async (id) => ok(await sb.from('adhoc_hours').delete().eq('id', id));

export const loadEmployeesFull = async () => fetchAll(() => sb.from('employees').select('id,employee_code,full_name,name_key,ni_number,email,phone,active,leaver_date,default_project,default_site,default_rate,default_contract,emp_status').order('full_name').order('id'));
export const setEmployeeFields = async (id, patch) => ok(await sb.from('employees').update(patch).eq('id', id));
// rows from parseEmployeeRows(); match on NI number, then on name; create anyone missing; only fill in what the file actually contains
export async function saveEmployeesList(rows) {
  const emps = await loadEmployeesFull(); const byNi = new Map(emps.filter((e) => e.ni_number).map((e) => [e.ni_number, e])), byName = new Map(emps.map((e) => [e.name_key, e]));
  let created = 0, updated = 0; const fresh = [];
  for (const r of rows) {
    const cur = (r.ni_number && byNi.get(r.ni_number)) || byName.get(r.name_key);
    const patch = { active: r.active }; for (const k of ['email', 'phone', 'default_project', 'default_site', 'default_rate', 'default_contract', 'ni_number']) if (r[k] !== null && r[k] !== undefined && r[k] !== '') patch[k] = r[k];
    if (r.active === false) patch.leaver_date = cur && cur.leaver_date ? cur.leaver_date : new Date().toISOString().slice(0, 10); else patch.leaver_date = null;
    if (cur) { ok(await sb.from('employees').update(patch).eq('id', cur.id)); updated++; }
    else { fresh.push({ id: crypto.randomUUID(), full_name: r.full_name, name_key: r.name_key, ...patch }); created++; }
  }
  for (const part of chunk(fresh, 200)) ok(await sb.from('employees').insert(part));
  return { created, updated };
}
export const loadEmployeeBudgets = async () => fetchAll(() => sb.from('employee_budgets').select('*').order('employee_name').order('id'));
export async function saveEmployeeBudgets(rows) { for (const part of chunk(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), 200)) ok(await sb.from('employee_budgets').upsert(part, { onConflict: 'name_key,project_key' })); }
export const deleteEmployeeBudget = async (id) => ok(await sb.from('employee_budgets').delete().eq('id', id));
// Copy each person's budget onto their line(s) in a pay run (line budget + the weekly budget of every week)
export async function applyEmployeeBudgets(run) {
  const budgets = await loadEmployeeBudgets(); if (!budgets.length) return 0;
  const lines = await fetchAll(() => sb.from('payroll_lines').select('id,employee_name,ni_number,project_name').eq('run_id', run.id).order('id'));
  const byNi = new Map(budgets.filter((b) => b.ni_number).map((b) => [b.ni_number + '|' + b.project_key, b])), byName = new Map(budgets.map((b) => [b.name_key + '|' + b.project_key, b]));
  const groups = new Map();
  for (const l of lines) { const pk = normKey(l.project_name), b = (l.ni_number && byNi.get(l.ni_number + '|' + pk)) || byName.get(normKey(l.employee_name) + '|' + pk); if (b) { const k = String(+b.weekly_hours); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l.id); } }
  let n = 0;
  for (const [hours, ids] of groups) for (const part of chunk(ids, 80)) { ok(await sb.from('payroll_lines').update({ budgeted_hours: +hours }).in('id', part)); ok(await sb.from('line_weeks').update({ budget: +hours }).in('line_id', part)); n += part.length; }
  return n;
}

export const deleteAdhocDay = async (lineId, date) => ok(await sb.from('adhoc_hours').delete().eq('line_id', lineId).eq('work_date', date));


// =====================================================================================================
// v4.4: HR — employee records, HR cases, recruitment new starters
// =====================================================================================================
export const STAFF_COLS = 'id,employee_code,pay_group,al_entitlement,al_carry,al_taken_before,full_name,name_key,ni_number,email,phone,active,leaver_date,default_project,default_site,default_rate,default_contract,employment_type,emp_status,job_title,contracted_weeks,shift_days,shift_start,shift_end,weekly_hours,weekly_pay,rtw_type,rtw_expiry,hire_date,termination_date,termination_reason,suspended_from,payroll_state,payroll_run_id,payroll_added_at,payroll_added_by,added_by_email,hr_notes,created_at,updated_at';
export const loadStaff = async () => fetchAll(() => sb.from('employees').select(STAFF_COLS).order('full_name').order('id'));
export const loadStaffOne = async (id) => ok(await sb.from('employees').select(STAFF_COLS).eq('id', id).maybeSingle());
export async function addStaff(row) {
  const id = crypto.randomUUID();
  ok(await sb.from('employees').insert({ id, name_key: normKey(row.full_name), ...row }));
  return id;
}
export async function updateStaff(id, patch) { const p = { ...patch }; if (p.full_name) p.name_key = normKey(p.full_name); ok(await sb.from('employees').update(p).eq('id', id)); return loadStaffOne(id); }
export const loadPendingCount = async () => { const { count, error } = await sb.from('employees').select('id', { count: 'exact', head: true }).eq('payroll_state', 'pending'); if (error) throw new Error(error.message); return count || 0; };
export const loadEmployeeLines = async (empId) => ok(await sb.from('v_payroll_lines').select('id,run_id,run_label,stream,project_name,site_name,contract_type,hourly_rate,actual_hours,gross_pay,budget_status').eq('employee_id', empId).order('run_id').limit(200));

// HR cases
export const loadCases = async () => fetchAll(() => sb.from('hr_cases').select('*').order('opened_on', { ascending: false }).order('id'));
export const loadCasesFor = async (empId) => ok(await sb.from('hr_cases').select('*').eq('employee_id', empId).order('opened_on', { ascending: false }));
export const loadCase = async (id) => ok(await sb.from('hr_cases').select('*').eq('id', id).maybeSingle());
export const addCase = async (row) => ok(await sb.from('hr_cases').insert(row).select().single());
export const updateCase = async (id, patch) => ok(await sb.from('hr_cases').update(patch).eq('id', id).select().single());
export const deleteCase = async (id) => ok(await sb.from('hr_cases').delete().eq('id', id));
export const loadCaseEvents = async (caseId) => ok(await sb.from('hr_case_events').select('*').eq('case_id', caseId).order('created_at', { ascending: false }));
export const addCaseEvent = async (row) => ok(await sb.from('hr_case_events').insert(row));
export async function uploadHrFile(caseId, file) {
  const path = `${caseId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await sb.storage.from('hr').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error('Could not store the file: ' + error.message);
  return path;
}
export async function hrFileUrl(path) { const { data, error } = await sb.storage.from('hr').createSignedUrl(path, 3600); if (error) throw new Error(error.message); return data.signedUrl; }

// Recruitment → payroll: put a new starter on a pay run (one line, a week row for every week they can work in that window)
export async function moveToPayroll(emp, run, { pay_group = null, site = null } = {}) {
  const have = ok(await sb.from('payroll_lines').select('id').eq('run_id', run.id).eq('employee_id', emp.id).limit(1));
  let id = have.length ? have[0].id : null;
  if (!id) {
    const periods = await loadPeriods(run.id), p = periods.find((x) => x.pay_group === pay_group);
    const from = (p && p.reconcile_from) || run.period_start, to = (p && p.reconcile_to) || run.period_end;
    const weeks = [];
    if (from && to) {
      const start = emp.hire_date && ymd(emp.hire_date) > ymd(from) ? emp.hire_date : from;
      for (let w = mondayOf(start); w <= ymd(to); w = plus(w, 7)) weeks.push(w);
    }
    const type = emp.employment_type === 'permanent' ? 'Hourly' : 'Cover';
    id = await createLine(run.id, { employee_id: emp.id, employee_name: emp.full_name, ni_number: emp.ni_number || null, project_name: emp.default_project, site_name: site || emp.default_site || null,
      contract_type: type, hourly_rate: num0(emp.default_rate), budgeted_hours: num0(emp.weekly_hours), pay_group, status: 'new starter',
      remarks: `New starter (${emp.employment_type}) added ${new Date().toISOString().slice(0, 10)}${emp.hire_date ? ' · start ' + ymd(emp.hire_date) : ''}` }, weeks, num0(emp.weekly_hours));
  }
  const me = (await sb.auth.getUser()).data.user;
  ok(await sb.from('employees').update({ payroll_state: 'in_payroll', payroll_run_id: run.id, payroll_added_at: new Date().toISOString(), payroll_added_by: me ? me.email : null }).eq('id', emp.id));
  return { lineId: id, existed: have.length > 0 };
}
export const loadRunEmployeeHours = async (runId) => fetchAll(() => sb.from('v_payroll_lines').select('employee_id,employee_name,actual_hours').eq('run_id', runId).order('id'));

// =====================================================================================================
// v4.5: employee IDs, bulk upload, delete, annual leave, cover assignments & hours
// =====================================================================================================
export async function deleteEmployees(ids) { let n = 0; for (const part of chunk(ids, 100)) { const d = ok(await sb.from('employees').delete().in('id', part).select('id')); n += d.length; } return n; }
export const loadAlBalances = async () => fetchAll(() => sb.from('v_al_balance').select('*').order('employee_id'));
export const loadAlOne = async (id) => { const d = ok(await sb.rpc('al_summary', { p_emp: id })); return d && d[0] ? d[0] : null; };
export const loadEmployeeLeave = async (empId) => ok(await sb.from('v_leave').select('leave_date,type_code,type_name,hours,project_name,line_id').in('line_id', (ok(await sb.from('payroll_lines').select('id').eq('employee_id', empId))).map((l) => l.id).concat(['00000000-0000-0000-0000-000000000000'])).order('leave_date', { ascending: false }).limit(400));
// rows already parsed by the importer: match on Employee ID, then NI number, then name; new people get an ID from the database
export async function importStaff(rows, { onProgress = () => {} } = {}) {
  const emps = await loadStaff();
  const byCode = new Map(emps.filter((e) => e.employee_code).map((e) => [e.employee_code.toUpperCase(), e])), byNi = new Map(emps.filter((e) => e.ni_number).map((e) => [e.ni_number, e])), byName = new Map(emps.map((e) => [e.name_key, e]));
  let created = 0, updated = 0; const fresh = [];
  let i = 0;
  for (const r of rows) {
    const nk = normKey(r.full_name || '');
    const cur = (r.employee_code && byCode.get(String(r.employee_code).toUpperCase())) || (r.ni_number && byNi.get(r.ni_number)) || (nk && byName.get(nk));
    const patch = {}; for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && v !== '') patch[k] = v;
    if (cur) { delete patch.employee_code; if (Object.keys(patch).length) { ok(await sb.from('employees').update({ ...patch, ...(patch.full_name ? { name_key: nk } : {}) }).eq('id', cur.id)); } updated++; }
    else { fresh.push({ id: crypto.randomUUID(), name_key: nk, ...patch }); created++; }
    onProgress(++i / rows.length);
  }
  for (const part of chunk(fresh, 200)) ok(await sb.from('employees').insert(part));
  const codes = fresh.length ? (await fetchAll(() => sb.from('employees').select('id,employee_code').in('id', fresh.map((f) => f.id)).order('id'))) : [];
  return { created, updated, newIds: codes };
}

export const loadAssignments = async () => fetchAll(() => sb.from('cover_assignments').select('*').order('date_from', { ascending: false }).order('id'));
export const addAssignments = async (rows) => ok(await sb.from('cover_assignments').insert(rows).select());
export const updateAssignment = async (id, patch) => ok(await sb.from('cover_assignments').update(patch).eq('id', id));
export const deleteAssignment = async (id) => ok(await sb.from('cover_assignments').delete().eq('id', id));
export const loadCoverHours = async (from) => fetchAll(() => { let q = sb.from('cover_hours').select('*').order('work_date').order('id'); if (from) q = q.gte('work_date', from); return q; });
export async function saveCoverHours(rows) {
  // one row per cover per day per assignment; hours 0 / empty removes the day
  const del = rows.filter((r) => !(+r.hours > 0)), put = rows.filter((r) => +r.hours > 0);
  for (const r of del) { let q = sb.from('cover_hours').delete().eq('cover_employee_id', r.cover_employee_id).eq('work_date', r.work_date); q = r.assignment_id ? q.eq('assignment_id', r.assignment_id) : q.is('assignment_id', null); ok(await q); }
  for (const r of put) {
    let q = sb.from('cover_hours').select('id,hours').eq('cover_employee_id', r.cover_employee_id).eq('work_date', r.work_date); q = r.assignment_id ? q.eq('assignment_id', r.assignment_id) : q.is('assignment_id', null);
    const cur = ok(await q.maybeSingle());
    if (cur) { if (+cur.hours !== +r.hours || r.file_path) ok(await sb.from('cover_hours').update({ hours: +r.hours, note: r.note ?? null, source: r.source || 'manual', ...(r.file_path ? { file_path: r.file_path } : {}) }).eq('id', cur.id)); }
    else ok(await sb.from('cover_hours').insert({ cover_employee_id: r.cover_employee_id, assignment_id: r.assignment_id || null, work_date: r.work_date, hours: +r.hours, note: r.note || null, source: r.source || 'manual', file_path: r.file_path || null }));
  }
}
export async function uploadCoverFile(empId, file) {
  const path = `${empId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await sb.storage.from('cover').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error('Could not store the file: ' + error.message);
  return path;
}
export async function coverFileUrl(path) { const { data, error } = await sb.storage.from('cover').createSignedUrl(path, 3600); if (error) throw new Error(error.message); return data.signedUrl; }
// Send unsent cover hours into a pay run (creates the cover's line if needed) and mark them as sent
export async function syncCoverHours(run, emp, hoursRows, payGroup) {
  const days = hoursRows.map((r) => ({ date: ymd(r.work_date), hours: +r.hours }));
  const byDate = new Map(); for (const d of days) byDate.set(d.date, (byDate.get(d.date) || 0) + d.hours);
  const entry = { project: emp.default_project, site: emp.default_site || null, employee_name: emp.full_name, ni: emp.ni_number || null, rate: emp.default_rate, contract_type: 'Cover', pay_group: payGroup || emp.pay_group || null, budget_hours: emp.weekly_hours || 0, days: [...byDate].map(([date, hours]) => ({ date, hours })) };
  const res = await commitEntries(run, [entry]);
  const me = (await sb.auth.getUser()).data.user;
  for (const part of chunk(hoursRows.map((r) => r.id), 100)) ok(await sb.from('cover_hours').update({ synced_run_id: run.id, synced_at: new Date().toISOString(), synced_by_email: me ? me.email : null }).in('id', part));
  if (emp.payroll_state === 'pending') ok(await sb.from('employees').update({ payroll_state: 'in_payroll', payroll_run_id: run.id, payroll_added_at: new Date().toISOString(), payroll_added_by: me ? me.email : null }).eq('id', emp.id));
  return res;
}

// =====================================================================================================
// v4.6: custom reports, clock in / out
// =====================================================================================================
const inRuns = (q, runIds) => (runIds && runIds.length ? q.in('run_id', runIds) : q);
export async function loadDataset(key, { runIds = [], from = null, to = null } = {}) {
  switch (key) {
    case 'employees': { const [rows, al] = await Promise.all([loadStaff(), loadAlBalances().catch(() => [])]); const m = new Map(al.map((a) => [a.employee_id, a])); return rows.map((e) => { const a = m.get(e.id) || {}; return { ...e, al_entitlement_year: a.entitlement ?? null, al_accrued: a.accrued ?? null, al_taken: a.taken ?? null, al_available: a.available ?? null, al_remaining: a.remaining ?? null }; }); }
    case 'payroll_lines': return fetchAll(() => inRuns(sb.from('v_payroll_lines').select('*'), runIds).order('id'));
    case 'daily_hours': return fetchAll(() => { let q = inRuns(sb.from('v_daily').select('*'), runIds); if (from) q = q.gte('work_date', from); if (to) q = q.lte('work_date', to); return q.order('line_id').order('work_date'); });
    case 'leave': return fetchAll(() => inRuns(sb.from('v_leave').select('*'), runIds).order('id'));
    case 'project_status': return fetchAll(() => inRuns(sb.from('v_project_status').select('*'), runIds).order('project_key'));
    case 'run_summary': return fetchAll(() => inRuns(sb.from('v_run_summary').select('*'), runIds).order('run_id'));
    case 'timesheets': return fetchAll(() => inRuns(sb.from('timesheets').select('*'), runIds).order('id'));
    case 'hr_cases': return loadCases();
    case 'cover_assignments': { const [a, s] = await Promise.all([loadAssignments(), loadStaff()]); const m = new Map(s.map((e) => [e.id, e])); return a.map((x) => ({ ...x, cover_name: (m.get(x.cover_employee_id) || {}).full_name, cover_code: (m.get(x.cover_employee_id) || {}).employee_code, absent_code: (m.get(x.absent_employee_id) || {}).employee_code })); }
    case 'cover_hours': { const [hh, s, a] = await Promise.all([loadCoverHours(from), loadStaff(), loadAssignments()]); const m = new Map(s.map((e) => [e.id, e])), am = new Map(a.map((x) => [x.id, x])); return hh.filter((x) => !to || String(x.work_date) <= to).map((x) => ({ ...x, cover_name: (m.get(x.cover_employee_id) || {}).full_name, cover_code: (m.get(x.cover_employee_id) || {}).employee_code, project_name: (m.get(x.cover_employee_id) || {}).default_project, covering_for: (am.get(x.assignment_id) || {}).absent_name || null, sent_to_payroll: !!x.synced_at })); }
    case 'clock_shifts': return fetchAll(() => { let q = sb.from('v_clock_shifts').select('*'); if (from) q = q.gte('work_date', from); if (to) q = q.lte('work_date', to); return q.order('clock_in'); });
    case 'projects': return loadProjects();
    case 'email_log': return fetchAll(() => sb.from('email_log').select('kind,to_email,subject,status,error,created_at').order('created_at', { ascending: false }), 1000);
    default: throw new Error('Unknown data source');
  }
}
export const loadSavedReports = async () => ok(await sb.from('saved_reports').select('*').order('name'));
export const saveReport = async (row) => (row.id ? ok(await sb.from('saved_reports').update({ name: row.name, definition: row.definition, shared: row.shared, updated_at: new Date().toISOString() }).eq('id', row.id).select().single()) : ok(await sb.from('saved_reports').insert({ name: row.name, definition: row.definition, shared: row.shared }).select().single()));
export const deleteReport = async (id) => ok(await sb.from('saved_reports').delete().eq('id', id));

// clock in / out (office side)
export const loadShifts = async (from, to) => fetchAll(() => sb.from('v_clock_shifts').select('*').gte('work_date', from).lte('work_date', to).order('clock_in').order('in_id'));
export const loadOpenClockIns = async () => fetchAll(() => sb.from('v_clock_shifts').select('*').is('clock_out', null).gte('clock_in', new Date(Date.now() - 18 * 3600000).toISOString()).order('clock_in').order('in_id'));
export async function addClockShift({ employee_id, project_name, clock_in, clock_out, note }) {
  const rows = [{ employee_id, kind: 'in', at: clock_in, project_name, note: note || null, source: 'manual' }];
  if (clock_out) rows.push({ employee_id, kind: 'out', at: clock_out, project_name, note: note || null, source: 'manual' });
  ok(await sb.from('clock_events').insert(rows));
}
export const updateClockEvent = async (id, patch) => ok(await sb.from('clock_events').update({ ...patch, source: 'manual' }).eq('id', id));
export const deleteClockEvent = async (id) => ok(await sb.from('clock_events').delete().eq('id', id));
export async function syncClockShifts(run, emp, shifts, payGroup) {
  const byDate = new Map(); for (const s of shifts) byDate.set(ymd(s.work_date), (byDate.get(ymd(s.work_date)) || 0) + +s.hours);
  const entry = { project: shifts[0].project_name || emp.default_project, site: emp.default_site || null, employee_name: emp.full_name, ni: emp.ni_number || null, rate: emp.default_rate, contract_type: emp.employment_type === 'permanent' ? 'Hourly' : 'Cover', pay_group: payGroup || emp.pay_group || null, budget_hours: emp.weekly_hours || 0, days: [...byDate].map(([date, hours]) => ({ date, hours: Math.round(hours * 100) / 100 })) };
  const res = await commitEntries(run, [entry]);
  for (const part of chunk(shifts.map((s) => s.in_id), 100)) ok(await sb.from('clock_events').update({ synced_run_id: run.id, synced_at: new Date().toISOString() }).in('id', part));
  return res;
}
export const saveProjectLocation = async (id, patch) => ok(await sb.from('projects').update(patch).eq('id', id));
export const addClockEvent = async (row) => ok(await sb.from('clock_events').insert(row));
