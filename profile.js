// Employee profile: HR record (editable), HR cases with live warnings, and payroll history — all in one wide panel.
import { loadStaffOne, updateStaff, loadCasesFor, loadEmployeeLines, loadProjects, onLive } from './api.js';
import { h, clear, toast, dmy, money, hrs, icon, initials, debounce, modal } from './ui.js';
import { ctx } from './ctx.js';
import { EMP_STATUS, EMP_TYPES, statusChip, typeChip, stageChip, sevChip, rtwChip, rtwState, daysTo, shiftText, weeklyPay, activeWarning, today } from './hrkit.js';
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
    const block = (title, ...kids) => h('div', { class: 'card pad pblock' }, h('h3', null, title), ...kids);
    const view = h('div', { class: 'pgrid' }, dl,
      block('Personal & contact', h('div', { class: 'form-grid' }, inp('full_name', 'Full name'), inp('ni_number', 'NI number'), inp('email', 'Email', { type: 'email' }), inp('phone', 'Phone'), inp('job_title', 'Job title', { ph: 'Cleaning Operative' }), selx('employment_type', 'Employment type', EMP_TYPES))),
      block('Project & pay', h('div', { class: 'form-grid' }, inp('default_project', 'Project', { list: 'prof-proj', cls: 's2' }), inp('default_site', 'Site'), inp('default_rate', 'Hourly rate £', { type: 'number' }), inp('weekly_hours', 'Weekly budgeted hours', { type: 'number' }), inp('contracted_weeks', 'Contracted weeks / year', { type: 'number', ph: '52' })),
        h('div', { class: 'wpay' }, 'Weekly pay ', wp, h('span', { class: 'small muted' }, ' = weekly hours × hourly rate'))),
      block('Shift', h('div', { class: 'form-grid' }, inp('shift_days', 'Days', { ph: 'Mon–Fri', cls: 's2' }), inp('shift_start', 'Start', { type: 'time' }), inp('shift_end', 'Finish', { type: 'time' }))),
      block('Right to work & dates', h('div', { class: 'form-grid' }, inp('rtw_type', 'RTW document', { ph: 'Passport / Share code / BRP', cls: 's2' }), inp('rtw_expiry', 'RTW expiry date', { type: 'date' }), inp('hire_date', 'Hire date', { type: 'date' }),
        fld('Termination date', h('input', { type: 'date', value: e.termination_date || '', disabled: true })), fld('Termination reason', h('input', { type: 'text', value: e.termination_reason || '', disabled: true })))),
      block('HR notes', fld('Private notes', (f.hr_notes = h('textarea', { rows: 4, disabled: dis }, e.hr_notes || '')))));
    f.weekly_hours.addEventListener('input', recalc); f.default_rate.addEventListener('input', recalc);
    return h('div', null, view, canHR ? h('div', { class: 'savebar' }, h('span', { class: 'small muted' }, e.added_by_email ? `Added by ${e.added_by_email}${e.created_at ? ' on ' + dmy(e.created_at) : ''}` : ''), h('div', { class: 'grow' }), h('button', { class: 'btn primary', onClick: () => {
      const p = {}; const nums = ['default_rate', 'weekly_hours', 'contracted_weeks'];
      for (const [k, el] of Object.entries(f)) { const v = el.value.trim(); p[k] = v === '' ? null : nums.includes(k) ? +v : k === 'ni_number' ? v.toUpperCase().replace(/\s+/g, '') : k === 'email' ? v.toLowerCase() : v; }
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

  function draw() {
    const rs = rtwState(e.rtw_expiry), dleft = daysTo(e.rtw_expiry), w = activeWarning(cases), open = cases.filter((c) => c.stage !== 'closed').length;
    const tabs = [['overview', 'Profile'], canSeeCases ? ['cases', `HR cases (${cases.length})`] : null, canSeePay ? ['pay', 'Payroll'] : null].filter(Boolean);
    const body = tab === 'cases' ? casesTab() : tab === 'pay' ? payTab() : overview();
    const stat = (l, v, cls) => h('div', { class: 'pstat ' + (cls || '') }, h('span', null, l), h('b', null, v));
    clear(panel).append(
      h('div', { class: 'phead s-' + (e.emp_status || 'active') },
        h('div', { class: 'avatar big' }, initials(e.full_name)),
        h('div', { class: 'grow' }, h('h2', null, e.full_name), h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '4px' } }, statusChip(e.emp_status), typeChip(e.employment_type), e.default_project ? h('span', { class: 'hpill grp' }, e.default_project) : null, e.payroll_state === 'pending' ? h('span', { class: 'hpill r-d30' }, 'Waiting for payroll') : null, w ? h('span', { class: 'hpill v-high' }, `${w.warning_level} until ${dmy(w.warning_expiry)}`) : null),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, [e.job_title, e.email, e.phone].filter(Boolean).join(' · '))),
        canHR ? h('div', { class: 'row wrap', style: { gap: '6px' } },
          e.emp_status !== 'active' ? h('button', { class: 'btn sm', onClick: () => statusModal('active') }, 'Make active') : null,
          e.emp_status === 'active' ? h('button', { class: 'btn sm', onClick: () => statusModal('suspended') }, 'Suspend') : null,
          e.emp_status !== 'terminated' ? h('button', { class: 'btn sm danger', onClick: () => statusModal('terminated') }, 'Terminate') : null) : null,
        h('button', { class: 'btn sm', onClick: close }, icon('x'))),
      h('div', { class: 'pstats' }, stat('Hourly rate', e.default_rate != null ? money(e.default_rate) : '—'), stat('Weekly hours', e.weekly_hours != null ? hrs(e.weekly_hours) : '—'), stat('Weekly pay', money(weeklyPay(e)) || '—'),
        stat('Shift', shiftText(e) || '—'), stat('Hire date', dmy(e.hire_date) || '—'),
        stat('RTW expiry', e.rtw_expiry ? `${dmy(e.rtw_expiry)}${dleft < 0 ? ' (expired)' : dleft <= 90 ? ` (${dleft}d)` : ''}` : '—', 'r-' + rs),
        canSeeCases ? stat('Open HR cases', String(open), open ? 'r-d30' : '') : null, e.emp_status === 'terminated' ? stat('Terminated', dmy(e.termination_date), 'r-expired') : e.emp_status === 'suspended' ? stat('Suspended from', dmy(e.suspended_from), 'r-d30') : null),
      h('div', { class: 'tabs' }, tabs.map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onClick: () => { tab = k; draw(); } }, t))),
      body);
  }

  if (await load()) draw(); else clear(panel).append(h('div', { class: 'notice err' }, 'Employee not found.'));
  stop = onLive(debounce(async (ev) => { if (document.querySelector('.modal-wrap')) return; if ((ev.table === 'employees' && ev.row && ev.row.id === empId) || (ev.table === 'hr_cases' && ev.row && ev.row.employee_id === empId)) { if (tab === 'overview' && ev.table === 'employees') return; if (await load()) draw(); } }, 700));
}
void rtwChip;
