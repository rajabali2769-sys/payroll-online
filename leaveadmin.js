// Leave requests (from the employee app) and bulk leave / SSP upload — shown at the top of the Leave & SSP page.
import { loadLeaveRequests, decideLeave, recordLeaveRequest, addLeaveRequest, loadStaff, loadLeaveTypes, loadRunLinesLite, addLeave, weekdaysOf, loadAlBalances, onLive } from './api.js';
import { h, clear, toast, modal, icon, dmy, debounce, natCompare } from './ui.js';
import { ctx, currentRun, openRuns, currentRuns } from './ctx.js';
import { panel } from './panels.js';
import { avatar } from './photos.js';
import { importModal, exportRows } from './importer.js';
import { finder } from './specs.js';
import { normKey } from './parsers.js';
import { alCalc, empLabel } from './hrkit.js';
import { waButton } from './whatsapp.js';

const fld = (l, el) => h('label', { class: 'fld' }, l, el);

// ---------- bulk upload of leave / SSP into a pay run ----------
export function leaveImportSpec(run, types, staff, onDone) {
  const typeOf = (v) => { const s = String(v || '').trim().toLowerCase(); if (!s) return undefined; const t = types.find((x) => x.code.toLowerCase() === s || x.name.toLowerCase() === s) || types.find((x) => x.name.toLowerCase().includes(s) || s.includes(x.code.toLowerCase())); if (t) return t.code; if (/ssp|statutory/.test(s)) return 'SSP'; if (/sick/.test(s)) return 'SICK'; if (/annual|holiday|^al$/.test(s)) return 'AL'; if (/unpaid/.test(s)) return 'UNPAID'; if (/bank/.test(s)) return 'BH'; return undefined; };
  const yes = (v) => (v === null || v === undefined || v === '' ? null : /^(y|yes|true|1)$/i.test(String(v).trim()));
  return {
    title: `Upload leave & SSP into ${run.label}`, file: 'leave_ssp_template.xlsx', note: 'Each row can be one day or a range (From – To). Weekends are skipped unless “Weekdays only” is No.',
    help: ['One row per person per absence. A range (From – To) is split into days for you.', `Leave type: ${types.map((t) => `${t.code} = ${t.name}`).join(', ')}.`, 'Hours per day: leave empty to use the person’s budgeted hours ÷ 5 (paid leave) — SSP and unpaid leave are recorded with 0 paid hours.', 'SSP amount per day: optional, only if you want to override the standard SSP day rate.'],
    columns: [
      { key: 'who', label: 'Employee ID or name', required: true, example: 'CFM00012', aliases: ['employee', 'employee name', 'employee id', 'name'] },
      { key: 'ni', label: 'NI number', type: 'upper', example: 'AB123456C' },
      { key: 'project', label: 'Project', help: 'Only needed when the person has lines on more than one project', example: 'NHS Cornwall' },
      { key: 'type', label: 'Leave type', required: true, map: typeOf, example: 'AL', aliases: ['type', 'leave', 'absence type'] },
      { key: 'from', label: 'From', type: 'date', required: true, example: '06/10/2026', aliases: ['date', 'start', 'from date', 'leave date'] },
      { key: 'to', label: 'To', type: 'date', example: '09/10/2026', aliases: ['end', 'to date'] },
      { key: 'hours', label: 'Hours per day', type: 'number', example: 3 },
      { key: 'amount', label: 'SSP amount per day £', type: 'number', aliases: ['amount', 'ssp amount'] },
      { key: 'weekdays', label: 'Weekdays only (Yes/No)', map: yes, example: 'Yes' },
      { key: 'note', label: 'Note' },
    ],
    rowCheck: (r) => (r.to && r.to < r.from ? 'To is before From' : null),
    save: async (rows) => {
      const lines = await loadRunLinesLite(run.id), find = finder(staff);
      const byEmp = new Map(), byNi = new Map(), byName = new Map();
      for (const l of lines) { if (l.employee_id) (byEmp.get(l.employee_id) || byEmp.set(l.employee_id, []).get(l.employee_id)).push(l); if (l.ni_number) (byNi.get(l.ni_number) || byNi.set(l.ni_number, []).get(l.ni_number)).push(l); (byName.get(normKey(l.employee_name)) || byName.set(normKey(l.employee_name), []).get(normKey(l.employee_name))).push(l); }
      const per = new Map(), missing = []; let days = 0, outside = 0;
      for (const r of rows) {
        const e = find(r.who); let cand = (e && byEmp.get(e.id)) || (r.ni && byNi.get(r.ni)) || (e && e.ni_number && byNi.get(e.ni_number)) || byName.get(normKey(e ? e.full_name : r.who)) || [];
        if (r.project && cand.length > 1) { const c2 = cand.filter((l) => normKey(l.project_name) === normKey(r.project)); if (c2.length) cand = c2; }
        if (!cand.length) { missing.push(r.who); continue; }
        const l = cand[0], ds = weekdaysOf(r.from, r.to || r.from, r.weekdays !== false);
        const noPay = r.type === 'SSP' || r.type === 'UNPAID', hpd = noPay ? 0 : r.hours != null ? r.hours : Math.round(((+l.budgeted_hours || 0) / 5) * 100) / 100;
        for (const d of ds) { if ((run.period_start && d < run.period_start) || (run.period_end && d > run.period_end)) outside++; (per.get(l.id) || per.set(l.id, []).get(l.id)).push({ date: d, hours: hpd, type: r.type, amount: r.amount ?? null, note: r.note || 'Bulk upload' }); days++; }
      }
      for (const [lid, entries] of per) await addLeave(lid, entries);
      if (onDone) onDone();
      return `${days} leave day(s) saved on ${per.size} line(s)${outside ? ` · ${outside} day(s) fall outside the payroll dates (saved anyway)` : ''}${missing.length ? ` · ${missing.length} row(s) skipped — not on this payroll: ${[...new Set(missing)].slice(0, 8).join(', ')}` : ''}`;
    },
  };
}

// ---------- requests panel ----------
export async function leaveRequestsPanel({ onChange } = {}) {
  const canDecide = ctx.canEdit || ctx.can('manage_hr');
  let reqs = [], staff = [], types = [], al = new Map(), tab = 'pending';
  const body = h('div'), sub = h('span', { class: 'psub2' });
  const acts = h('div', { class: 'row', style: { gap: '6px' } }, canDecide ? h('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); officeAdd(); } }, icon('plus'), 'Add leave for someone') : null);
  const p = panel(h('span', null, 'Leave requests ', sub), body, { id: 'leave.req', actions: acts });
  const empOf = (id) => staff.find((e) => e.id === id) || {};
  const tName = (c) => (types.find((t) => t.code === c) || {}).name || c;
  const bal = (e) => { const b = al.get(e.id); if (b) return b; const c = alCalc(e); return { ...c, remaining: c.entitlement - (+e.al_taken_before || 0) }; };

  function decide(r, status) {
    const e = empOf(r.employee_id);
    modal(status === 'approved' ? `Approve leave — ${e.full_name}` : `Reject leave — ${e.full_name}`, (done) => {
      const note = h('input', { type: 'text', placeholder: status === 'approved' ? 'Optional note to the employee' : 'Reason (the employee sees this)' });
      const runs = openRuns(), cr = currentRuns().find((x) => x.stream === 'monthly') || currentRuns()[0];
      const runSel = h('select', null, h('option', { value: '' }, 'Do not record in a payroll yet'), runs.map((x) => h('option', { value: x.id, selected: cr && x.id === cr.id }, `${x.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${x.label}`)));
      const hpd = h('input', { type: 'number', step: 'any', placeholder: 'auto: weekly budget ÷ 5' });
      return h('div', { class: 'stack' },
        h('div', { class: 'row' }, avatar(e, 'sm'), h('b', null, e.full_name), h('span', { class: 'hpill grp' }, tName(r.type_code)), h('span', null, `${dmy(r.date_from)}${r.date_to !== r.date_from ? ' – ' + dmy(r.date_to) : ''} · ${r.days} day(s)`)),
        r.type_code === 'AL' && e.id ? h('div', { class: 'small muted' }, `Annual leave left this year before this request: ${Math.round(+bal(e).remaining * 10) / 10} day(s)`) : null,
        fld('Note', note),
        status === 'approved' && canDecide && ctx.canEdit ? h('div', { class: 'form-grid' }, fld('Put the days on the payroll line in', runSel), fld('Paid hours per day', hpd)) : null,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn ' + (status === 'approved' ? 'primary' : 'danger'), onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await decideLeave(r.id, status, note.value.trim());
            let msg = status === 'approved' ? 'Approved' : 'Rejected';
            if (status === 'approved' && runSel.value) { const run = runs.find((x) => x.id === runSel.value); const n = await recordLeaveRequest(r, run, { hoursPerDay: hpd.value === '' ? null : +hpd.value }); msg += ` · ${n} day(s) put on the payroll`; }
            done(); toast(msg, 'ok'); await load(); if (onChange) onChange();
          } catch (er) { toast(er.message, 'err'); }
        } }, status === 'approved' ? 'Approve' : 'Reject')));
    }, { wide: true });
  }
  function officeAdd() {
    modal('Add leave for an employee', (done) => {
      const dl = h('datalist', { id: 'lr-emps' }, staff.filter((e) => e.emp_status !== 'terminated').map((e) => h('option', { value: empLabel(e) })));
      const who = h('input', { type: 'text', list: 'lr-emps', placeholder: 'Employee ID or name' }), type = h('select', null, types.map((t) => h('option', { value: t.code }, t.name)));
      const from = h('input', { type: 'date' }), to = h('input', { type: 'date' }), reason = h('input', { type: 'text' });
      return h('div', { class: 'stack' }, dl, h('div', { class: 'form-grid' }, fld('Employee', who), fld('Leave type', type), fld('From', from), fld('To', to)), fld('Reason / note', reason),
        h('div', { class: 'small muted' }, 'Saved as approved. Approve-and-record from the list to put the days on a payroll line.'),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          const e = staff.find((x) => empLabel(x) === who.value) || finder(staff)(who.value); if (!e) return toast('Pick the employee from the list', 'err'); if (!from.value) return toast('Add the first day', 'err');
          const t = to.value || from.value; if (t < from.value) return toast('To is before From', 'err');
          try { await addLeaveRequest({ employee_id: e.id, type_code: type.value, date_from: from.value, date_to: t, days: weekdaysOf(from.value, t).length, reason: reason.value.trim() || null, status: 'pending' }); done(); toast('Added — approve it to record it', 'ok'); load(); } catch (er) { toast(er.message, 'err'); }
        } }, 'Add')));
    }, { wide: true });
  }
  function draw() {
    const pend = reqs.filter((r) => r.status === 'pending');
    sub.textContent = `· ${pend.length} waiting`;
    if (pend.length) p.setOpen(true);
    const list = reqs.filter((r) => (tab === 'pending' ? r.status === 'pending' : tab === 'decided' ? ['approved', 'rejected'].includes(r.status) : true)).slice(0, 300);
    const pill = (s) => h('span', { class: 'spill ' + ({ pending: 'pend', approved: 'paid', rejected: 'over', cancelled: '' }[s] || '') }, s[0].toUpperCase() + s.slice(1));
    clear(body).append(h('div', { class: 'toolbar tight' }, h('div', { class: 'seg big' }, [['pending', `Waiting (${pend.length})`], ['decided', 'Approved / rejected'], ['all', 'All']].map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onClick: () => { tab = k; draw(); } }, t))),
        h('div', { class: 'grow' }), h('button', { class: 'btn sm', onClick: () => exportRows({ columns: [['employee', 'Employee', (r) => empOf(r.employee_id).full_name], ['code', 'Employee ID', (r) => empOf(r.employee_id).employee_code], ['type', 'Leave type', (r) => tName(r.type_code)], ['date_from', 'From'], ['date_to', 'To'], ['days', 'Days'], ['status', 'Status'], ['reason', 'Reason'], ['decided_by_email', 'Decided by'], ['decision_note', 'Note']].map(([key, label, out]) => ({ key, label, out })) }, list, 'leave_requests.xlsx').catch((er) => toast(er.message, 'err')) }, icon('download'), 'Export')),
      list.length ? h('div', { class: 'tablewrap', style: { maxHeight: '55vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'Type', 'Dates', 'Days', 'AL left', 'Reason', 'Status', ''].map((t) => h('th', null, t)))),
        h('tbody', null, list.map((r) => { const e = empOf(r.employee_id);
          return h('tr', null, h('td', null, h('div', { class: 'who' }, avatar(e, 'sm'), h('div', null, h('b', null, e.full_name || '?'), h('div', { class: 'small muted' }, `${e.employee_code || ''} · ${e.default_project || ''}`)))),
            h('td', null, h('span', { class: 'hpill grp' }, tName(r.type_code))), h('td', { class: 'small nowrap' }, `${dmy(r.date_from)}${r.date_to !== r.date_from ? ' – ' + dmy(r.date_to) : ''}${r.half_day ? ' (half day)' : ''}`), h('td', { class: 'num' }, String(r.days)),
            h('td', { class: 'num small' }, r.type_code === 'AL' && e.id ? String(Math.round(+bal(e).remaining * 10) / 10) : ''), h('td', { class: 'small' }, r.reason || ''), h('td', null, pill(r.status), r.recorded_run_id ? h('div', { class: 'small muted' }, 'on payroll') : null, r.decision_note ? h('div', { class: 'small muted' }, r.decision_note) : null),
            h('td', { class: 'nowrap' }, r.status === 'pending' && canDecide ? [h('button', { class: 'btn sm primary', onClick: () => decide(r, 'approved') }, 'Approve'), ' ', h('button', { class: 'btn sm', onClick: () => decide(r, 'rejected') }, 'Reject')] : r.status === 'approved' && !r.recorded_run_id && ctx.canEdit ? h('button', { class: 'btn sm', onClick: () => decide({ ...r }, 'approved') }, 'Record on payroll') : null, waButton(e))); }))))
        : h('div', { class: 'small muted' }, tab === 'pending' ? 'No requests waiting. Employees ask for leave in the My Pay app (Leave tab).' : 'Nothing here.'));
  }
  async function load() {
    try { [reqs, staff, types] = await Promise.all([loadLeaveRequests(), staff.length ? staff : loadStaff(), types.length ? types : loadLeaveTypes()]); al = new Map((await loadAlBalances().catch(() => [])).map((b) => [b.employee_id, b])); }
    catch (e) { clear(body).append(h('div', { class: 'notice err' }, 'Could not load leave requests: ' + e.message + ' — run the latest schema.sql.')); return; }
    draw();
  }
  await load();
  const stop = onLive(debounce((e) => { if (e.table === 'leave_requests' && !document.querySelector('.modal-wrap')) load(); }, 800));
  p.stop = stop;
  return p;
}
export async function bulkLeaveButton(run, onDone) {
  return h('button', { class: 'btn', onClick: async () => { const [types, staff] = await Promise.all([loadLeaveTypes(), loadStaff()]); importModal(leaveImportSpec(run, types, staff, onDone)); } }, icon('upload'), 'Upload leave & SSP');
}
void natCompare;
