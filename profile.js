// Employee profile: HR record (editable), HR cases with live warnings, and payroll history — all in one wide panel.
import { loadStaffOne, updateStaff, loadCasesFor, loadEmployeeLines, loadProjects, onLive, loadAlOne, loadEmployeeLeave, loadAssignments, loadCoverHours, loadStaff } from './api.js';
import { panel as mkPanel } from './panels.js';
import { h, clear, toast, dmy, money, hrs, icon, initials, debounce, modal } from './ui.js';
import { ctx } from './ctx.js';
import { EMP_STATUS, EMP_TYPES, statusChip, typeChip, stageChip, sevChip, rtwChip, rtwState, daysTo, shiftText, weeklyPay, activeWarning, today, alCalc, isCover } from './hrkit.js';
import { openCase, newCaseModal, letterModal } from './hrcase.js';

const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);

export async function openProfile(empId, { onChange, tab: startTab } = {}) {
  const overlay = h('div', { class: 'overlay' }), panel = h('div', { class: 'drawer xl' }, h('div', { class: 'muted' }, 'Loading…'));
  overlay.append(panel);
  let stop = null;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', escKey); if (stop) stop(); };
  const escKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-wrap') && document.querySelectorAll('.overlay').length === 1) close(); };
  document.addEventListener('keydown', escKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);

  let e, cases = [], lines = null, projects = [], tab = startTab || 'overview';
  const canHR = ctx.can('manage_hr'), canSeeCases = ctx.can('page:hrcases'), canSeePay = ctx.can('page:payroll');
  async function load() {
    e = await loadStaffOne(empId);
    if (!e) return false;
    cases = canSeeCases ? await loadCasesFor(empId).catch(() => []) : [];
    if (!projects.length) projects = await loadProjects().catch(() => []);
    return true;
  }
  const changed = () => { if (onChange) onChange(e); };

  async function patch(p, msg = 'Saved') {
    try { e = await updateStaff(e.id, p); toast(msg, 'ok'); draw(); changed(); } catch (er) { toast(er.message, 'err'); }
  }

  function statusModal(target) {
    modal(target === 'terminated' ? 'Terminate employment' : target === 'suspended' ? 'Suspend employee' : 'Make active', (done) => {
      const d = h('input', { type: 'date', value: today() }), why = h('input', { type: 'text', placeholder: target === 'terminated' ? 'e.g. Resigned, End of contract, Dismissed' : 'Reason (optional)' });
      return h('div', { class: 'stack' },
        h('p', { style: { margin: 0 } }, target === 'terminated' ? `${e.full_name} will be marked as a leaver. They stay in the system for history and the payroll team will see they have left.` : target === 'suspended' ? `${e.full_name} will be shown as suspended (normally on full pay, so they stay on the payroll). Open an HR case to record why.` : `${e.full_name} will be shown as active again.`),
        target !== 'active' ? h('div', { class: 'form-grid' }, fld(target === 'terminated' ? 'Termination date' : 'Suspended from', d), fld('Reason', why)) : null,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn ' + (target === 'terminated' ? 'danger' : 'primary'), onClick: async () => {
          const p = { emp_status: target };
          if (target === 'terminated') { p.termination_date = d.value || today(); p.termination_reason = why.value.trim() || null; }
          if (target === 'suspended') p.suspended_from = d.value || today();
          done(); await patch(p, target === 'terminated' ? 'Marked as terminated' : target === 'suspended' ? 'Marked as suspended' : 'Marked as active');
        } }, 'Confirm')));
    });
  }

  function overview() {
    const f = {}, dis = !canHR;
    const inp = (k, label, a = {}) => fld(label, (f[k] = h('input', { type: a.type || 'text', value: e[k] ?? '', step: 'any', disabled: dis, list: a.list, placeholder: a.ph })), a.cls);
    const selx = (k, label, opts) => fld(label, (f[k] = h('select', { disabled: dis }, opts.map(([v, t]) => h('option', { value: v, selected: (e[k] || '') === v }, t)))));
    const dl = h('datalist', { id: 'prof-proj' }, projects.map((p) => h('option', { value: p.name })));
    const wp = h('b', null, money(weeklyPay(e)));
    const recalc = () => { wp.textContent = money((+f.weekly_hours.value || 0) * (+f.default_rate.value || 0)); };
    const groups = [...new Set(projects.map((p) => p.pay_group).filter(Boolean))].sort();
    const dg = h('datalist', { id: 'prof-grp' }, groups.map((g) => h('option', { value: g })));
    const block = (title, id, ...kids) => mkPanel(title, h('div', null, ...kids), { id: 'prof.' + id, expand: false });
    const view = h('div', { class: 'pgrid3' }, dl, dg,
      block('Personal & contact', 'personal', h('div', { class: 'form-grid' }, fld('Employee ID', h('input', { type: 'text', value: e.employee_code || '', disabled: true, class: 'mono' })), inp('full_name', 'Full name'), inp('ni_number', 'NI number'), inp('email', 'Email', { type: 'email' }), inp('phone', 'Phone'), inp('job_title', 'Job title', { ph: 'Cleaning Operative' }))),
      block('Project & pay', 'pay', h('div', { class: 'form-grid' }, selx('employment_type', 'Employment type', EMP_TYPES), inp('default_project', 'Project', { list: 'prof-proj' }), inp('pay_group', 'Pay date', { list: 'prof-grp', ph: '25th' }), inp('default_site', 'Site'), inp('default_rate', 'Hourly rate £', { type: 'number' }), inp('weekly_hours', 'Weekly budgeted hours', { type: 'number' }), inp('contracted_weeks', 'Contracted weeks / year', { type: 'number', ph: '52' })),
        h('div', { class: 'wpay' }, 'Weekly pay ', wp, h('span', { class: 'small muted' }, ' = weekly hours × hourly rate'))),
      block('Shift, right to work & dates', 'dates', h('div', { class: 'form-grid' }, inp('shift_days', 'Shift days', { ph: 'Mon–Fri' }), h('div', { class: 'row s2', style: { gap: '8px' } }, inp('shift_start', 'Start', { type: 'time' }), inp('shift_end', 'Finish', { type: 'time' })), inp('rtw_type', 'RTW document', { ph: 'Passport / Share code / BRP' }), inp('rtw_expiry', 'RTW expiry date', { type: 'date' }), inp('hire_date', 'Hire date', { type: 'date' }),
        fld('Termination date', h('input', { type: 'date', value: e.termination_date || '', disabled: true })), fld('Termination reason', h('input', { type: 'text', value: e.termination_reason || '', disabled: true }), 's2'))),
      block('Annual leave set-up', 'al', h('div', { class: 'form-grid' }, inp('al_entitlement', 'AL days a full year', { type: 'number', ph: '20' }), inp('al_carry', 'Carried over (days)', { type: 'number' }), inp('al_taken_before', 'Taken outside the system (days)', { type: 'number', cls: 's2' })), h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Leave builds up at a twelfth of the yearly days each month from the hire date. See the Leave tab for the balance.')),
      mkPanel('HR notes', fld('Private notes', (f.hr_notes = h('textarea', { rows: 5, disabled: dis }, e.hr_notes || ''))), { id: 'prof.notes', expand: false, span: 2 }));
    f.weekly_hours.addEventListener('input', recalc); f.default_rate.addEventListener('input', recalc);
    return h('div', null, view, canHR ? h('div', { class: 'savebar' }, h('span', { class: 'small muted' }, e.added_by_email ? `Added by ${e.added_by_email}${e.created_at ? ' on ' + dmy(e.created_at) : ''}` : ''), h('div', { class: 'grow' }), h('button', { class: 'btn primary', onClick: () => {
      const p = {}; const nums = ['default_rate', 'weekly_hours', 'contracted_weeks', 'al_entitlement', 'al_carry', 'al_taken_before'];
      for (const [k, el] of Object.entries(f)) { const v = el.value.trim(); p[k] = v === '' ? (['al_entitlement'].includes(k) ? 20 : ['al_carry', 'al_taken_before'].includes(k) ? 0 : null) : nums.includes(k) ? +v : k === 'ni_number' ? v.toUpperCase().replace(/\s+/g, '') : k === 'email' ? v.toLowerCase() : v; }
      if (!p.full_name) return toast('Name is required', 'err');
      patch(p, 'Profile saved');
    } }, 'Save changes')) : null);
  }

  function casesTab() {
    const w = activeWarning(cases);
    return h('div', { class: 'stack' },
      w ? h('div', { class: 'notice warn' }, h('b', null, `Live ${w.warning_level.toLowerCase()}`), ` until ${dmy(w.warning_expiry)} (${w.case_ref})`) : null,
      canHR ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: () => newCaseModal(e, { onCreated: async () => { await load(); draw(); changed(); } }) }, icon('plus'), 'New HR case'),
        h('button', { class: 'btn', onClick: () => letterModal({ id: null, employee_id: e.id, employee_name: e.full_name, project_name: e.default_project, case_type: 'Other' }, e, null, 'rtw_expiry') }, icon('mail'), 'Letter without a case')) : null,
      cases.length ? h('div', { class: 'casegrid' }, cases.map((c) => h('div', { class: 'casecard', onClick: () => openCase(c.id, { onChange: async () => { await load(); draw(); changed(); } }) },
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'small muted' }, c.case_ref), h('div', { class: 'grow' }), stageChip(c.stage)),
        h('b', null, c.summary), h('div', { class: 'row wrap', style: { gap: '6px' } }, h('span', { class: 'hpill grp' }, c.case_type), sevChip(c.severity), c.outcome ? h('span', { class: 'hpill g-outcome' }, c.outcome) : null),
        h('div', { class: 'small muted' }, `Opened ${dmy(c.opened_on)}${c.closed_on ? ' · closed ' + dmy(c.closed_on) : c.due_date ? ' · target ' + dmy(c.due_date) : ''}`)))) : h('div', { class: 'card empty' }, 'No HR cases for this employee.'));
  }

  function payTab() {
    const host = h('div', null, h('div', { class: 'muted' }, 'Loading payroll lines…'));
    (async () => {
      try { if (!lines) lines = await loadEmployeeLines(e.id); } catch (er) { clear(host).append(h('div', { class: 'notice err' }, er.message)); return; }
      const runs = new Map(ctx.runs.map((r) => [r.id, r])); const rows = lines.slice().sort((a, b) => String((runs.get(b.run_id) || {}).period_end || '').localeCompare(String((runs.get(a.run_id) || {}).period_end || '')));
      clear(host).append(
        h('div', { class: 'notice' }, e.payroll_state === 'pending' ? 'Waiting for the payroll team to add this person to a payroll (New starters page).' : e.payroll_added_at ? `Added to payroll on ${dmy(e.payroll_added_at)}${e.payroll_added_by ? ' by ' + e.payroll_added_by : ''}.` : 'On the payroll.'),
        rows.length ? h('div', { class: 'tablewrap', style: { maxHeight: '52vh', marginTop: '10px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Pay run', 'Project', 'Type', '£/h', 'Hours', 'Gross'].map((t, i) => h('th', { class: i >= 3 ? 'num' : '' }, t)))),
          h('tbody', null, rows.map((l) => h('tr', null, h('td', null, l.run_label || (runs.get(l.run_id) || {}).label || ''), h('td', null, l.project_name), h('td', null, l.contract_type || ''), h('td', { class: 'num' }, money(l.hourly_rate)), h('td', { class: 'num' }, hrs(l.actual_hours)), h('td', { class: 'num' }, money(l.gross_pay))))))) : h('div', { class: 'card empty', style: { marginTop: '10px' } }, 'No payroll lines yet.'));
    })();
    return host;
  }

  function leaveTab() {
    const host = h('div', null, h('div', { class: 'muted' }, 'Loading leave…'));
    (async () => {
      let b = null, days = [];
      try { [b, days] = await Promise.all([loadAlOne(e.id).catch(() => null), loadEmployeeLeave(e.id).catch(() => [])]); } catch { /* ignore */ }
      const c = b || { ...alCalc(e), taken: +e.al_taken_before || 0, booked: 0 };
      if (!b) { c.available = c.accrued - c.taken; c.remaining = c.entitlement - c.taken; }
      const r = (n) => (Math.round(+n * 100) / 100).toString();
      const pct = Math.max(0, Math.min(100, (+c.taken + +c.booked) / Math.max(+c.entitlement, 0.01) * 100));
      const tile = (l, v, s2, cls) => h('div', { class: 'altile ' + (cls || '') }, h('span', null, l), h('b', null, v), s2 ? h('em', null, s2) : null);
      clear(host).append(h('div', { class: 'pgrid3' },
        mkPanel('Balance', h('div', null, h('div', { class: 'altiles' }, tile('This leave year', r(c.entitlement) + ' d', `${dmy(c.year_start)} – ${dmy(c.year_end)}`), tile('Accrued so far', r(c.accrued) + ' d', `${r(c.per_month)} days a month`), tile('Taken', r(c.taken) + ' d', c.booked ? `+ ${r(c.booked)} booked` : null), tile('Available now', r(c.available) + ' d', null, +c.available < 0 ? 'neg' : 'pos'), tile('Left this year', r(c.remaining) + ' d', null, +c.remaining < 0 ? 'neg' : '')),
          h('div', { class: 'albar' }, h('i', { style: { width: pct + '%' } })), h('div', { class: 'small muted' }, `Hire date ${dmy(e.hire_date) || 'not set'} · ${+e.al_entitlement || 20} days a full year${+e.al_carry ? ` · ${e.al_carry} carried over` : ''}${+e.al_taken_before ? ` · ${e.al_taken_before} taken before the system` : ''}`)), { id: 'prof.alb', span: 2, expand: false }),
        mkPanel('How it is worked out', h('div', { class: 'small', style: { lineHeight: 1.6 } }, `${+e.al_entitlement || 20} days ÷ 12 = ${r(c.per_month)} days for each month worked. Leave builds up from the hire date (or the start of the leave year) and is counted at the end of each full month. Annual leave days recorded on payroll lines (type AL) count as taken; future dates count as booked.`), { id: 'prof.alh', expand: false }),
        mkPanel(`Leave days (${days.length})`, days.length ? h('div', { class: 'tablewrap', style: { maxHeight: '40vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Date', 'Type', 'Hours', 'Project'].map((t) => h('th', null, t)))), h('tbody', null, days.map((d) => h('tr', null, h('td', null, dmy(d.leave_date)), h('td', null, d.type_name || d.type_code), h('td', null, hrs(d.hours)), h('td', { class: 'small' }, d.project_name))))))
          : h('div', { class: 'muted small' }, 'No leave recorded yet. Leave is recorded on the payroll line (Payroll → line → Leave).'), { id: 'prof.ald', span: 3 })));
    })();
    return host;
  }
  function coverTab() {
    const host = h('div', null, h('div', { class: 'muted' }, 'Loading…'));
    (async () => {
      const [as, hr, all] = await Promise.all([loadAssignments().catch(() => []), loadCoverHours().catch(() => []), loadStaff().catch(() => [])]);
      const names = new Map(all.map((x) => [x.id, `${x.full_name}${x.employee_code ? ' (' + x.employee_code + ')' : ''}`]));
      const mineAs = as.filter((a) => a.cover_employee_id === e.id), coveredBy = as.filter((a) => a.absent_employee_id === e.id), mineH = hr.filter((x) => x.cover_employee_id === e.id);
      const sent = mineH.filter((x) => x.synced_at).reduce((s2, x) => s2 + +x.hours, 0), unsent = mineH.filter((x) => !x.synced_at).reduce((s2, x) => s2 + +x.hours, 0);
      const aRow = (a, who) => h('tr', null, h('td', null, h('b', null, who)), h('td', { class: 'small' }, a.reason), h('td', { class: 'small nowrap' }, `${dmy(a.date_from)} – ${a.date_to ? dmy(a.date_to) : 'open'}`), h('td', { class: 'num' }, a.expected_hours != null ? hrs(a.expected_hours) : '—'));
      clear(host).append(h('div', { class: 'pgrid3' },
        isCover(e) ? mkPanel(`Covering for (${mineAs.length})`, mineAs.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'Reason', 'Dates', 'Exp. h/wk'].map((t) => h('th', null, t)))), h('tbody', null, mineAs.map((a) => aRow(a, names.get(a.absent_employee_id) || a.absent_name || '—')))) : h('div', { class: 'small muted' }, 'No cover assignments yet.'), { id: 'prof.cv1', span: 2 }) : null,
        isCover(e) ? mkPanel('Cover hours', h('div', { class: 'altiles' }, h('div', { class: 'altile' }, h('span', null, 'Sent to payroll'), h('b', null, hrs(sent) + ' h')), h('div', { class: 'altile' }, h('span', null, 'Waiting to send'), h('b', null, hrs(unsent) + ' h'))), { id: 'prof.cv2' }) : null,
        mkPanel(`Covered by others (${coveredBy.length})`, coveredBy.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Cover', 'Reason', 'Dates', 'Exp. h/wk'].map((t) => h('th', null, t)))), h('tbody', null, coveredBy.map((a) => aRow(a, names.get(a.cover_employee_id) || '—')))) : h('div', { class: 'small muted' }, 'Nobody has covered this person.'), { id: 'prof.cv3', span: 3 })));
    })();
    return host;
  }

  function draw() {
    const rs = rtwState(e.rtw_expiry), dleft = daysTo(e.rtw_expiry), w = activeWarning(cases), open = cases.filter((c) => c.stage !== 'closed').length;
    const tabs = [['overview', 'Profile'], ['leave', 'Leave'], ['cover', isCover(e) ? 'Cover work' : 'Cover'], canSeeCases ? ['cases', `HR cases (${cases.length})`] : null, canSeePay ? ['pay', 'Payroll'] : null].filter(Boolean);
    const body = tab === 'cases' ? casesTab() : tab === 'pay' ? payTab() : tab === 'leave' ? leaveTab() : tab === 'cover' ? coverTab() : overview();
    const stat = (l, v, cls) => h('div', { class: 'pstat ' + (cls || '') }, h('span', null, l), h('b', null, v));
    clear(panel).append(
      h('div', { class: 'phead s-' + (e.emp_status || 'active') },
        h('div', { class: 'avatar big' }, initials(e.full_name)),
        h('div', { class: 'grow' }, h('div', { class: 'eyebrow', style: { color: 'rgba(255,255,255,.85)' } }, e.employee_code || ''), h('h2', null, e.full_name), h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '4px' } }, statusChip(e.emp_status), typeChip(e.employment_type), e.default_project ? h('span', { class: 'hpill grp' }, e.default_project) : null, e.payroll_state === 'pending' ? h('span', { class: 'hpill r-d30' }, 'Waiting for payroll') : null, w ? h('span', { class: 'hpill v-high' }, `${w.warning_level} until ${dmy(w.warning_expiry)}`) : null),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, [e.job_title, e.email, e.phone].filter(Boolean).join(' · '))),
        canHR ? h('div', { class: 'row wrap', style: { gap: '6px' } },
          e.emp_status !== 'active' ? h('button', { class: 'btn sm', onClick: () => statusModal('active') }, 'Make active') : null,
          e.emp_status === 'active' ? h('button', { class: 'btn sm', onClick: () => statusModal('suspended') }, 'Suspend') : null,
          e.emp_status !== 'terminated' ? h('button', { class: 'btn sm danger', onClick: () => statusModal('terminated') }, 'Terminate') : null) : null,
        h('button', { class: 'btn sm', onClick: close }, icon('x'))),
      h('div', { class: 'pstats' }, stat('Pay date', e.pay_group || '—'), stat('Hourly rate', e.default_rate != null ? money(e.default_rate) : '—'), stat('Weekly hours', e.weekly_hours != null ? hrs(e.weekly_hours) : '—'), stat('Weekly pay', money(weeklyPay(e)) || '—'),
        stat('Shift', shiftText(e) || '—'), stat('Hire date', dmy(e.hire_date) || '—'), stat('AL accrued', (Math.round(alCalc(e).accrued * 10) / 10) + ' d'),
        stat('RTW expiry', e.rtw_expiry ? `${dmy(e.rtw_expiry)}${dleft < 0 ? ' (expired)' : dleft <= 90 ? ` (${dleft}d)` : ''}` : '—', 'r-' + rs),
        canSeeCases ? stat('Open HR cases', String(open), open ? 'r-d30' : '') : null, e.emp_status === 'terminated' ? stat('Terminated', dmy(e.termination_date), 'r-expired') : e.emp_status === 'suspended' ? stat('Suspended from', dmy(e.suspended_from), 'r-d30') : null),
      h('div', { class: 'tabs' }, tabs.map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onClick: () => { tab = k; draw(); } }, t))),
      body);
  }

  if (await load()) draw(); else clear(panel).append(h('div', { class: 'notice err' }, 'Employee not found.'));
  stop = onLive(debounce(async (ev) => { if (document.querySelector('.modal-wrap')) return; if ((ev.table === 'employees' && ev.row && ev.row.id === empId) || (ev.table === 'hr_cases' && ev.row && ev.row.employee_id === empId)) { if (tab === 'overview' && ev.table === 'employees') return; if (await load()) draw(); } }, 700));
}
void rtwChip;
