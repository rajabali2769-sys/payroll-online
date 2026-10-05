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
  for (const table of ['payroll_lines', 'line_weeks', 'daily_hours', 'pay_runs', 'pay_periods', 'employees', 'projects']) {
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
