// New starters: recruitment adds temporary / cover staff here; the payroll team moves them into the current payroll in one click.
import { loadStaff, addStaff, updateStaff, loadProjects, loadPeriods, moveToPayroll, onLive } from './api.js';
import { h, clear, toast, modal, dmy, money, hrs, icon, debounce, initials, ago } from './ui.js';
import { ctx, openRuns, currentRuns, runLabel } from './ctx.js';
import { typeChip, rtwChip, rtwState, shiftText, weeklyPay, today } from './hrkit.js';

const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);

export async function render(root) {
  const canAdd = ctx.can('recruit_add'), canMove = ctx.can('move_to_payroll') && ctx.canEdit;
  let staff = [], projects = [], tab = 'pending', q = '', editing = null;
  const formHost = h('div', { class: 'ns-form' }), listHost = h('div', { class: 'ns-list' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'New starters'), h('p', null, canMove ? 'Temporary and cover staff added by recruitment. Check the details, then add each person to the current payroll — from that point the payroll team pays them.' : 'Add temporary and cover staff here. The payroll team is told straight away and adds them to the payroll.'))),
    h('div', { class: 'nsws' + (canAdd ? '' : ' noform') }, canAdd ? formHost : null, listHost));

  function form() {
    const e = editing || {};
    const f = {};
    const inp = (k, label, a = {}) => fld(label, (f[k] = h('input', { type: a.type || 'text', step: 'any', placeholder: a.ph || '', list: a.list, value: e[k] ?? a.value ?? '' })), a.cls);
    f.employment_type = h('select', null, [['cover', 'Cover'], ['temporary', 'Temporary'], ...(e.employment_type === 'permanent' ? [['permanent', 'Permanent']] : [])].map(([v, t]) => h('option', { value: v, selected: (e.employment_type || 'cover') === v }, t)));
    const err = h('div', { class: 'notice err hidden' });
    clear(formHost).append(h('div', { class: 'card pad ns-card' },
      h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, editing ? `Edit ${editing.full_name}` : 'Add a new starter'), h('div', { class: 'grow' }), editing ? h('button', { class: 'btn sm', onClick: () => { editing = null; form(); } }, 'Cancel edit') : null),
      h('datalist', { id: 'ns-proj' }, projects.map((p) => h('option', { value: p.name }))),
      h('div', { class: 'form-grid' }, inp('full_name', 'Full name *', { cls: 's2' }), fld('Type', f.employment_type), inp('ni_number', 'NI number'), inp('email', 'Email', { type: 'email' }), inp('phone', 'Phone'),
        inp('default_project', 'Project *', { list: 'ns-proj', cls: 's2' }), inp('default_rate', 'Hourly rate £ *', { type: 'number' }), inp('weekly_hours', 'Weekly budgeted hours', { type: 'number' }),
        inp('contracted_weeks', 'Contracted weeks', { type: 'number', ph: 'e.g. 4' }), inp('shift_days', 'Shift days', { ph: 'Mon–Fri' }), inp('shift_start', 'Shift start', { type: 'time' }), inp('shift_end', 'Shift finish', { type: 'time' }),
        inp('rtw_type', 'RTW document', { ph: 'Passport / Share code' }), inp('rtw_expiry', 'RTW expiry date', { type: 'date' }), inp('hire_date', 'Start (hire) date *', { type: 'date', value: today() }), inp('default_site', 'Site (optional)')),
      err,
      h('button', { class: 'btn primary', style: { justifyContent: 'center', marginTop: '10px', width: '100%' }, onClick: async (ev) => {
        const row = {}; for (const [k, el] of Object.entries(f)) { const v = el.value.trim(); row[k] = v === '' ? null : ['default_rate', 'weekly_hours', 'contracted_weeks'].includes(k) ? +v : k === 'ni_number' ? v.toUpperCase().replace(/\s+/g, '') : k === 'email' ? v.toLowerCase() : v; }
        if (!row.full_name || !row.default_project || row.default_rate == null || !row.hire_date) { err.textContent = 'Name, project, hourly rate and start date are required.'; err.classList.remove('hidden'); return; }
        if (!editing && row.ni_number && staff.some((x) => x.ni_number === row.ni_number)) { err.textContent = 'Someone with this NI number is already in the system. Ask HR or payroll to check before adding them again.'; err.classList.remove('hidden'); return; }
        if (rtwState(row.rtw_expiry) === 'expired') { err.textContent = 'The right to work document has expired — they cannot start until it is renewed.'; err.classList.remove('hidden'); return; }
        row.default_contract = row.employment_type === 'permanent' ? 'Hourly' : 'Cover'; ev.target.disabled = true;
        try {
          if (editing) { await updateStaff(editing.id, row); toast('Updated', 'ok'); }
          else { await addStaff({ ...row, emp_status: 'active', payroll_state: 'pending' }); toast(`${row.full_name} sent to the payroll team`, 'ok'); }
          editing = null; await load();
        } catch (er) { ev.target.disabled = false; err.textContent = er.message; err.classList.remove('hidden'); }
      } }, editing ? 'Save changes' : 'Send to payroll')));
  }

  function moveModal(e) {
    const runs = openRuns(); if (!runs.length) return toast('There is no open payroll. Create or import one first.', 'err');
    const def = currentRuns()[0] || runs[0], proj = projects.find((p) => p.name && e.default_project && p.name.toLowerCase() === e.default_project.toLowerCase());
    modal(`Add ${e.full_name} to a payroll`, (done) => {
      const runSel = h('select', null, runs.map((r) => h('option', { value: r.id, selected: r.id === def.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${runLabel(r)}`)));
      const grp = h('select'), info = h('div', { class: 'small muted' });
      const fillGroups = async () => {
        const r = runs.find((x) => x.id === runSel.value), per = await loadPeriods(r.id).catch(() => []);
        clear(grp).append(h('option', { value: '' }, '(none)'), per.map((p) => h('option', { value: p.pay_group, selected: proj && proj.pay_group === p.pay_group }, `${p.pay_group}${p.reconcile_from ? ` · ${dmy(p.reconcile_from)} – ${dmy(p.reconcile_to)}` : ''}`)));
        const late = e.hire_date && r.period_end && e.hire_date > r.period_end;
        info.textContent = late ? `⚠ Starts ${dmy(e.hire_date)}, after this payroll ends (${dmy(r.period_end)}). You may want the next payroll.` : `A line is created for ${e.default_project} at ${money(e.default_rate)}/h (${e.employment_type === 'permanent' ? 'Hourly' : 'Cover'}), ${hrs(e.weekly_hours || 0)} budgeted hours a week, with a week for every week from their start date.`;
      };
      runSel.onchange = fillGroups; fillGroups();
      return h('div', { class: 'stack' }, h('div', { class: 'row' }, h('div', { class: 'avatar sm' }, initials(e.full_name)), h('b', null, e.full_name), typeChip(e.employment_type), h('span', { class: 'muted small' }, `starts ${dmy(e.hire_date) || '—'}`)),
        h('div', { class: 'form-grid' }, fld('Payroll', runSel), fld('Pay date group', grp)), info,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
          ev.target.disabled = true;
          try { const r = runs.find((x) => x.id === runSel.value); const res = await moveToPayroll(e, r, { pay_group: grp.value || null }); done(); toast(res.existed ? 'Already had a line in that payroll — marked as added' : `Added to ${r.label}`, 'ok'); await load(); }
          catch (er) { ev.target.disabled = false; toast(er.message, 'err'); }
        } }, 'Add to payroll')));
    });
  }

  function list() {
    const mine = (e) => e.added_by_email && ctx.me && e.added_by_email.toLowerCase() === String(ctx.me.email).toLowerCase();
    const newbies = staff.filter((e) => e.payroll_state === 'pending' || e.payroll_added_at || mine(e));
    const groups = { pending: newbies.filter((e) => e.payroll_state === 'pending'), added: newbies.filter((e) => e.payroll_state === 'in_payroll' && e.payroll_added_at).sort((a, b) => String(b.payroll_added_at).localeCompare(String(a.payroll_added_at))), mine: newbies.filter(mine) };
    const rows = groups[tab].filter((e) => !q || [e.full_name, e.default_project, e.ni_number, e.email].some((x) => x && x.toLowerCase().includes(q)));
    clear(listHost).append(
      h('div', { class: 'toolbar tight' }, h('div', { class: 'seg big' }, [['pending', 'Waiting for payroll'], ['added', 'Added to payroll'], ['mine', 'Added by me']].map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onClick: () => { tab = k; list(); } }, t, ' ', h('span', { class: 'cnt' }, String(groups[k].length))))),
        h('div', { class: 'grow' }), h('input', { type: 'search', placeholder: 'Search…', value: q, style: { width: '200px' }, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); list(); }, 150) })),
      rows.length ? h('div', { class: 'nsgrid' }, rows.map((e) => h('div', { class: 'nscard' + (e.payroll_state === 'pending' ? ' pending' : '') },
        h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'avatar sm' }, initials(e.full_name)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ell' }, e.full_name), h('div', { class: 'small muted ell' }, e.default_project || '—')), typeChip(e.employment_type)),
        h('div', { class: 'nsfacts' }, [['£/h', e.default_rate != null ? money(e.default_rate) : '—'], ['Weekly hrs', e.weekly_hours != null ? hrs(e.weekly_hours) : '—'], ['Weekly pay', money(weeklyPay(e))], ['Starts', dmy(e.hire_date) || '—'], ['Shift', shiftText(e) || '—'], ['Weeks', e.contracted_weeks ?? '—']].map(([l, v]) => h('div', null, h('span', null, l), h('b', null, String(v))))),
        h('div', { class: 'row small', style: { gap: '6px' } }, h('span', { class: 'muted' }, 'RTW'), rtwChip(e.rtw_expiry), h('div', { class: 'grow' }), h('span', { class: 'muted', title: e.added_by_email || '' }, e.payroll_added_at ? `Added to payroll ${ago(e.payroll_added_at)}${e.payroll_added_by ? ' by ' + e.payroll_added_by.split('@')[0] : ''}` : `Sent ${ago(e.created_at)}${e.added_by_email ? ' by ' + e.added_by_email.split('@')[0] : ''}`)),
        e.payroll_state === 'pending' ? h('div', { class: 'row', style: { gap: '6px' } },
          canAdd && (e.employment_type !== 'permanent' || ctx.can('manage_hr')) ? h('button', { class: 'btn sm', onClick: () => { editing = e; form(); } }, 'Edit') : null, h('div', { class: 'grow' }),
          canMove ? h('button', { class: 'btn sm primary', onClick: () => moveModal(e) }, icon('plus'), 'Add to payroll') : h('span', { class: 'small muted' }, 'Waiting for payroll')) : null))) : h('div', { class: 'card empty' }, tab === 'pending' ? 'Nobody is waiting — all new starters are on the payroll.' : 'Nothing here yet.'));
  }

  async function load() { [staff, projects] = await Promise.all([loadStaff(), loadProjects().catch(() => [])]); if (canAdd) form(); list(); }
  await load();
  return onLive(debounce((e) => { if (e.table === 'employees' && !document.querySelector('.modal-wrap')) { loadStaff().then((s) => { staff = s; list(); }).catch(() => {}); } }, 800));
}
