// New starters & covers. Recruitment adds temporary / cover staff, says who each cover is replacing (one cover can replace several people),
// and records the cover's hours (typed in or from an uploaded timesheet). The payroll team adds new starters to a payroll and sends cover hours into it.
import { loadStaff, addStaff, updateStaff, loadProjects, loadPeriods, moveToPayroll, onLive, loadAssignments, addAssignments, deleteAssignment, loadCoverHours, saveCoverHours, uploadCoverFile, coverFileUrl, syncCoverHours, importStaff } from './api.js';
import { h, clear, toast, modal, dmy, dm, money, hrs, icon, debounce, initials, ago, addDays, mondayOf, DOW, confirmBox, natCompare } from './ui.js';
import { ctx, openRuns, currentRuns, runLabel } from './ctx.js';
import { typeChip, rtwChip, rtwState, shiftText, weeklyPay, today, isCover, COVER_REASONS, empLabel } from './hrkit.js';
import { panel, panelGrid, expandAllBtn } from './panels.js';
import { importModal, exportRows } from './importer.js';
import { coverStarterSpec, assignmentSpec, hoursSpec, finder } from './specs.js';
import { waButton } from './whatsapp.js';

const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);
const TABS = [['queue', 'New starters'], ['add', 'Add a cover'], ['assign', 'Who is covering whom'], ['hours', 'Cover hours']];

export async function render(root, params) {
  const canAdd = ctx.can('recruit_add'), canMove = ctx.can('move_to_payroll') && ctx.canEdit;
  let staff = [], projects = [], assigns = [], hoursRows = [], tab = (params && params.tab) || 'queue', q = '', qtab = 'pending', week = mondayOf(today()), editing = null;
  const bar = h('div', { class: 'tabs big row' }), host = h('div', { class: 'ns-host' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'New starters & covers'), h('p', null, canMove ? 'Recruitment adds covers, who they replace and their hours. Check them, add new starters to the payroll and send cover hours across.' : 'Add temporary / cover staff, say who they are covering, and record their hours. The payroll team sees everything straight away.'))),
    bar, host);
  const byId = () => new Map(staff.map((e) => [e.id, e]));
  const groups = () => [...new Set([...projects.map((p) => p.pay_group), ...staff.map((e) => e.pay_group)].filter(Boolean))].sort(natCompare);
  const showTabs = () => clear(bar).append(h('span'), TABS.filter(([k]) => k !== 'add' || canAdd).map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onClick: () => { tab = k; q = ''; draw(); } }, t,
    k === 'queue' ? h('span', { class: 'cnt' }, String(staff.filter((e) => e.payroll_state === 'pending').length)) : k === 'hours' ? h('span', { class: 'cnt', title: 'days not yet in a payroll' }, String(hoursRows.filter((x) => !x.synced_at).length)) : null)), h('div', { class: 'grow' }), expandAllBtn(() => host));

  // ---------------- 1. queue ----------------
  function queueTab() {
    const mine = (e) => e.added_by_email && ctx.me && e.added_by_email.toLowerCase() === String(ctx.me.email).toLowerCase();
    const newbies = staff.filter((e) => e.payroll_state === 'pending' || e.payroll_added_at || mine(e));
    const G = { pending: newbies.filter((e) => e.payroll_state === 'pending'), added: newbies.filter((e) => e.payroll_state === 'in_payroll' && e.payroll_added_at).sort((a, b) => String(b.payroll_added_at).localeCompare(String(a.payroll_added_at))), mine: newbies.filter(mine) };
    const list = G[qtab].filter((e) => !q || [e.employee_code, e.full_name, e.default_project, e.ni_number, e.email].some((x) => x && x.toLowerCase().includes(q)));
    const map = byId();
    const card = (e) => { const cov = assigns.filter((a) => a.cover_employee_id === e.id);
      return h('div', { class: 'nscard' + (e.payroll_state === 'pending' ? ' pending' : '') },
        h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'avatar sm' }, initials(e.full_name)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ell' }, e.full_name), h('div', { class: 'small muted ell' }, `${e.employee_code || ''} · ${e.default_project || '—'}`)), waButton(e), typeChip(e.employment_type)),
        h('div', { class: 'nsfacts' }, [['£/h', e.default_rate != null ? money(e.default_rate) : '—'], ['Pay date', e.pay_group || '—'], ['Weekly hrs', e.weekly_hours != null ? hrs(e.weekly_hours) : '—'], ['Weekly pay', money(weeklyPay(e))], ['Starts', dmy(e.hire_date) || '—'], ['Shift', shiftText(e) || '—']].map(([l, v]) => h('div', null, h('span', null, l), h('b', null, String(v))))),
        cov.length ? h('div', { class: 'small covfor' }, h('b', null, 'Covering for: '), cov.map((a) => `${(map.get(a.absent_employee_id) || {}).full_name || a.absent_name || '—'} (${a.reason.toLowerCase()})`).join(', ')) : isCover(e) ? h('div', { class: 'small muted' }, 'Not linked to anyone yet.') : null,
        h('div', { class: 'row small', style: { gap: '6px' } }, h('span', { class: 'muted' }, 'RTW'), rtwChip(e.rtw_expiry), h('div', { class: 'grow' }), h('span', { class: 'muted', title: e.added_by_email || '' }, e.payroll_added_at ? `Added to payroll ${ago(e.payroll_added_at)}` : `Sent ${ago(e.created_at)}${e.added_by_email ? ' by ' + e.added_by_email.split('@')[0] : ''}`)),
        e.payroll_state === 'pending' ? h('div', { class: 'row', style: { gap: '6px' } },
          canAdd && (isCover(e) || ctx.can('manage_hr')) ? h('button', { class: 'btn sm', onClick: () => { editing = e; tab = 'add'; draw(); } }, 'Edit') : null, h('div', { class: 'grow' }),
          canMove ? h('button', { class: 'btn sm primary', onClick: () => moveModal(e) }, icon('plus'), 'Add to payroll') : h('span', { class: 'small muted' }, 'Waiting for payroll')) : null); };
    return h('div', { class: 'ns-pane' },
      h('div', { class: 'toolbar tight' }, h('div', { class: 'seg big' }, [['pending', 'Waiting for payroll'], ['added', 'Added to payroll'], ['mine', 'Added by me']].map(([k, t]) => h('button', { class: qtab === k ? 'on' : '', onClick: () => { qtab = k; draw(); } }, t, ' ', h('span', { class: 'cnt' }, String(G[k].length))))),
        h('div', { class: 'grow' }), canAdd ? h('button', { class: 'btn sm', onClick: () => importModal(coverStarterSpec(async (rows) => { const r = await importStaff(rows.map((x) => ({ ...x, employment_type: x.employment_type || 'cover', payroll_state: 'pending', emp_status: 'active', default_contract: 'Cover' }))); await load(); return `${r.created} added with new Employee IDs, ${r.updated} updated`; })) }, icon('upload'), 'Upload covers') : null,
        h('button', { class: 'btn sm', onClick: () => exportRows(coverStarterSpec(null), G[qtab], 'new_starters.xlsx').catch((er) => toast(er.message, 'err')) }, icon('download'), 'Export'),
        h('input', { type: 'search', placeholder: 'Search ID, name…', value: q, style: { width: '200px' }, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); draw(); }, 150) })),
      list.length ? h('div', { class: 'nsgrid' }, list.map(card)) : h('div', { class: 'card empty' }, qtab === 'pending' ? 'Nobody is waiting — all new starters are on the payroll.' : 'Nothing here yet.'));
  }

  function moveModal(e) {
    const runs = openRuns(); if (!runs.length) return toast('There is no open payroll. Create or import one first.', 'err');
    const def = currentRuns()[0] || runs[0], proj = projects.find((p) => p.name && e.default_project && p.name.toLowerCase() === e.default_project.toLowerCase());
    const want = e.pay_group || (proj && proj.pay_group);
    modal(`Add ${e.full_name} to a payroll`, (done) => {
      const runSel = h('select', null, runs.map((r) => h('option', { value: r.id, selected: r.id === def.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${runLabel(r)}`)));
      const grp = h('select'), info = h('div', { class: 'small muted' });
      const unsent = hoursRows.filter((x) => x.cover_employee_id === e.id && !x.synced_at);
      const sendH = h('input', { type: 'checkbox', checked: unsent.length > 0 });
      const fillGroups = async () => {
        const r = runs.find((x) => x.id === runSel.value), per = await loadPeriods(r.id).catch(() => []);
        clear(grp).append(h('option', { value: '' }, '(none)'), per.map((p) => h('option', { value: p.pay_group, selected: want === p.pay_group }, `${p.pay_group}${p.reconcile_from ? ` · ${dmy(p.reconcile_from)} – ${dmy(p.reconcile_to)}` : ''}`)));
        const late = e.hire_date && r.period_end && e.hire_date > r.period_end;
        info.textContent = late ? `⚠ Starts ${dmy(e.hire_date)}, after this payroll ends (${dmy(r.period_end)}). You may want the next payroll.` : `A line is created for ${e.default_project} at ${money(e.default_rate)}/h (${isCover(e) ? 'Cover' : 'Hourly'}), ${hrs(e.weekly_hours || 0)} budgeted hours a week.`;
      };
      runSel.onchange = fillGroups; fillGroups();
      return h('div', { class: 'stack' }, h('div', { class: 'row' }, h('div', { class: 'avatar sm' }, initials(e.full_name)), h('b', null, e.full_name), h('span', { class: 'mono small' }, e.employee_code || ''), typeChip(e.employment_type), h('span', { class: 'muted small' }, `starts ${dmy(e.hire_date) || '—'}`)),
        h('div', { class: 'form-grid' }, fld('Payroll', runSel), fld('Pay date group', grp)), info,
        unsent.length ? h('label', { class: 'row small' }, sendH, `Also send their ${unsent.length} day(s) of cover hours (${hrs(unsent.reduce((s, x) => s + +x.hours, 0))} h) into this payroll`) : null,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
          ev.target.disabled = true;
          try {
            const r = runs.find((x) => x.id === runSel.value); const res = await moveToPayroll(e, r, { pay_group: grp.value || null });
            const rowsH = unsent.filter((x) => !r.period_end || String(x.work_date) <= r.period_end);
            if (sendH.checked && rowsH.length) await syncCoverHours(r, { ...e, payroll_state: 'in_payroll' }, rowsH, grp.value || null);
            done(); toast(res.existed ? 'Already had a line in that payroll — marked as added' : `Added to ${r.label}`, 'ok'); await load();
          } catch (er) { ev.target.disabled = false; toast(er.message, 'err'); }
        } }, 'Add to payroll')));
    }, { wide: true });
  }

  // ---------------- 2. add a cover (new or existing) + who they cover ----------------
  function addTab() {
    const e = editing || {};
    let mode = 'new';
    const f = {};
    const inp = (k, label, a = {}) => fld(label, (f[k] = h('input', { type: a.type || 'text', step: 'any', placeholder: a.ph || '', list: a.list, value: e[k] ?? a.value ?? '' })), a.cls);
    const dlE = h('datalist', { id: 'ns-emps' }, staff.filter((x) => x.emp_status !== 'terminated').map((x) => h('option', { value: empLabel(x) })));
    const dlC = h('datalist', { id: 'ns-covers' }, staff.filter((x) => isCover(x) && x.emp_status !== 'terminated').map((x) => h('option', { value: empLabel(x) })));
    const dlP = h('datalist', { id: 'ns-proj' }, projects.map((p) => h('option', { value: p.name }))), dlG = h('datalist', { id: 'ns-grp' }, groups().map((g) => h('option', { value: g })));
    const pick = (v) => staff.find((x) => empLabel(x) === v) || finder(staff)(String(v).split(' · ')[0]) || null;
    const err = h('div', { class: 'notice err hidden' }), fail = (t) => { err.textContent = t; err.classList.remove('hidden'); };
    const rows = [], rowsHost = h('div', { class: 'cfrows' });
    const addRow = (pre = {}) => {
      const r = { who: h('input', { type: 'text', list: 'ns-emps', placeholder: 'Employee ID or name', value: pre.who || '' }), reason: h('select', null, COVER_REASONS.map((x) => h('option', { value: x, selected: x === (pre.reason || 'Annual leave') }, x))),
        from: h('input', { type: 'date', value: pre.from || today() }), to: h('input', { type: 'date', value: pre.to || '' }), exp: h('input', { type: 'number', step: 'any', placeholder: 'h/wk', value: pre.exp || '' }), notes: h('input', { type: 'text', placeholder: 'Notes', value: pre.notes || '' }) };
      r.who.addEventListener('change', () => { const a = pick(r.who.value); if (!a) return; if (f.default_project && !f.default_project.value) f.default_project.value = a.default_project || ''; if (f.pay_group && !f.pay_group.value) f.pay_group.value = a.pay_group || ''; if (!r.exp.value && a.weekly_hours) r.exp.value = a.weekly_hours; });
      r.el = h('div', { class: 'cfrow' }, r.who, r.reason, r.from, r.to, r.exp, r.notes, h('button', { class: 'btn sm', title: 'Copy this line for another employee', onClick: () => addRow({ reason: r.reason.value, from: r.from.value, to: r.to.value, exp: r.exp.value }) }, '⧉'), h('button', { class: 'btn sm danger', title: 'Remove', onClick: () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); if (!rows.length) addRow(); } }, icon('x')));
      rows.push(r); rowsHost.append(r.el); return r;
    };
    if (!editing) addRow();
    const existing = h('input', { type: 'text', list: 'ns-covers', placeholder: 'Find the cover by ID or name' });
    const details = panelGrid(3,
      panel('Cover details', h('div', { class: 'form-grid' }, inp('full_name', 'Full name *', { cls: 's2' }), inp('ni_number', 'NI number'), inp('phone', 'Phone'), inp('email', 'Email', { type: 'email', cls: 's2' })), { id: 'ns.p1', expand: false, open: true }),
      panel('Project, pay & hours', h('div', { class: 'form-grid' }, inp('default_project', 'Project *', { list: 'ns-proj', cls: 's2' }), inp('pay_group', 'Pay date', { list: 'ns-grp', ph: '25th' }), inp('default_rate', 'Hourly rate £ *', { type: 'number' }), inp('weekly_hours', 'Expected hours a week', { type: 'number' }), inp('contracted_weeks', 'Weeks needed', { type: 'number', ph: 'e.g. 4' })), { id: 'ns.p2', expand: false, open: true }),
      panel('Shift, start & right to work', h('div', { class: 'form-grid' }, inp('shift_days', 'Shift days', { ph: 'Mon–Fri' }), h('div', { class: 'row s2', style: { gap: '8px' } }, inp('shift_start', 'Start', { type: 'time' }), inp('shift_end', 'Finish', { type: 'time' })), inp('hire_date', 'Start date *', { type: 'date', value: today() }), inp('default_site', 'Site'), inp('rtw_type', 'RTW document', { ph: 'Passport / Share code' }), inp('rtw_expiry', 'RTW expiry', { type: 'date' })), { id: 'ns.p3', expand: false, open: true }));
    const exBox = h('div', { class: 'card pad hidden', style: { marginBottom: '12px' } }, fld('Existing cover', existing), h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Use this when the same cover is now covering somebody else as well — only the lines below are added.'));
    f.default_project.addEventListener('change', () => { const p = projects.find((x) => x.name === f.default_project.value); if (p && p.pay_group && !f.pay_group.value) f.pay_group.value = p.pay_group; });
    const segBtn = (k, t) => h('button', { class: mode === k ? 'on' : '', onClick: (ev) => { mode = k; ev.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === ev.currentTarget)); details.classList.toggle('hidden', k !== 'new'); exBox.classList.toggle('hidden', k !== 'old'); } }, t);
    return h('div', { class: 'ns-pane scroll' }, dlE, dlC, dlP, dlG,
      editing ? h('div', { class: 'notice', style: { marginBottom: '10px' } }, `Editing ${editing.full_name} (${editing.employee_code || ''}). `, h('a', { href: '#', onClick: (ev) => { ev.preventDefault(); editing = null; draw(); } }, 'Cancel edit')) :
        h('div', { class: 'seg big', style: { marginBottom: '10px' } }, segBtn('new', 'New cover'), segBtn('old', 'Existing cover — add more people they cover')),
      details, exBox,
      editing ? null : panel('Covering for', h('div', null, h('div', { class: 'cfrow head' }, ['Employee being covered', 'Reason', 'From', 'To', 'Exp. h/wk', 'Notes', '', ''].map((t) => h('span', null, t))), rowsHost,
        h('button', { class: 'btn sm', style: { marginTop: '8px' }, onClick: () => addRow() }, icon('plus'), 'Add another employee')), { id: 'ns.cf', open: true, sub: ' — one cover can replace several people: add a line for each (⧉ copies a line)' }),
      err,
      h('div', { class: 'savebar' }, h('span', { class: 'small muted' }, 'A unique Employee ID is created automatically. The payroll team is told straight away.'), h('div', { class: 'grow' }),
        h('button', { class: 'btn primary', onClick: async (ev) => {
          err.classList.add('hidden');
          const lines = rows.map((r) => ({ r, a: pick(r.who.value) })).filter((x) => x.r.who.value.trim());
          for (const x of lines) { if (!x.a) return fail(`“${x.r.who.value}” is not an employee in the system — pick from the list.`); if (!x.r.from.value) return fail('Each covering line needs a From date.'); if (x.r.to.value && x.r.to.value < x.r.from.value) return fail('A To date is before its From date.'); }
          let cover = null; const btn = ev.currentTarget; btn.disabled = true;
          try {
            if (mode === 'old' && !editing) { cover = pick(existing.value); if (!cover) throw new Error('Pick the existing cover from the list.'); if (!lines.length) throw new Error('Add at least one person they are covering.'); }
            else {
              const row = {}; for (const [k, el] of Object.entries(f)) { const v = el.value.trim(); row[k] = v === '' ? null : ['default_rate', 'weekly_hours', 'contracted_weeks'].includes(k) ? +v : k === 'ni_number' ? v.toUpperCase().replace(/\s+/g, '') : k === 'email' ? v.toLowerCase() : v; }
              if (!row.full_name || !row.default_project || row.default_rate == null || !row.hire_date) throw new Error('Name, project, hourly rate and start date are required.');
              if (!editing && row.ni_number && staff.some((x) => x.ni_number === row.ni_number)) throw new Error('Someone with this NI number is already in the system — use “Existing cover” instead.');
              if (rtwState(row.rtw_expiry) === 'expired') throw new Error('The right to work document has expired — they cannot start until it is renewed.');
              row.default_contract = 'Cover';
              if (editing) { await updateStaff(editing.id, row); cover = editing; }
              else { const id = await addStaff({ ...row, employment_type: 'cover', emp_status: 'active', payroll_state: 'pending' }); cover = { id, ...row }; }
            }
            if (lines.length) await addAssignments(lines.map(({ r, a }) => ({ cover_employee_id: cover.id, absent_employee_id: a.id, absent_name: a.full_name, project_name: a.default_project || f.default_project.value || null, reason: r.reason.value, date_from: r.from.value, date_to: r.to.value || null, expected_hours: r.exp.value === '' ? null : +r.exp.value, notes: r.notes.value.trim() || null })));
            editing = null; await load(); const n = staff.find((x) => x.id === cover.id);
            toast(`${n ? `${n.full_name} (${n.employee_code || ''})` : 'Cover'} saved${lines.length ? ` · covering ${lines.length} employee(s)` : ''}`, 'ok'); tab = 'queue'; draw();
          } catch (er) { btn.disabled = false; fail(er.message); }
        } }, editing ? 'Save changes' : 'Save & send to payroll')));
  }

  // ---------------- 3. assignments ----------------
  function assignTab() {
    const map = byId(), now = today();
    const list = assigns.filter((a) => { const c = map.get(a.cover_employee_id) || {}, b = map.get(a.absent_employee_id) || {}; return !q || [c.full_name, c.employee_code, b.full_name, b.employee_code, a.absent_name, a.project_name, a.reason].some((x) => x && x.toLowerCase().includes(q)); });
    const live = list.filter((a) => a.date_from <= now && (!a.date_to || a.date_to >= now)), soon = list.filter((a) => a.date_from > now), past = list.filter((a) => a.date_to && a.date_to < now);
    const logged = (a) => hoursRows.filter((x) => x.assignment_id === a.id).reduce((s, x) => s + +x.hours, 0);
    const table = (items) => items.length ? h('div', { class: 'tablewrap', style: { maxHeight: 'none' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Cover', 'Covering for', 'Project', 'Reason', 'From', 'To', 'Exp. h/wk', 'Hours logged', ''].map((t, i) => h('th', { class: i >= 6 && i <= 7 ? 'num' : '' }, t)))),
      h('tbody', null, items.map((a) => { const c = map.get(a.cover_employee_id) || {}, b = map.get(a.absent_employee_id); return h('tr', null, h('td', null, h('b', null, c.full_name || '—'), h('div', { class: 'small muted mono' }, c.employee_code || '')), h('td', null, b ? b.full_name : a.absent_name || '—', h('div', { class: 'small muted mono' }, b ? b.employee_code : '')),
        h('td', { class: 'small' }, a.project_name || ''), h('td', { class: 'small' }, a.reason), h('td', { class: 'small nowrap' }, dmy(a.date_from)), h('td', { class: 'small nowrap' }, a.date_to ? dmy(a.date_to) : 'open'), h('td', { class: 'num' }, a.expected_hours != null ? hrs(a.expected_hours) : '—'), h('td', { class: 'num' }, hrs(logged(a))),
        h('td', null, canAdd ? h('button', { class: 'btn sm', title: 'Delete this assignment', onClick: async () => { if (await confirmBox('Delete assignment?', 'The hours already logged stay, just unlinked from this absence.', 'Delete', true)) { try { await deleteAssignment(a.id); await load(); } catch (er) { toast(er.message, 'err'); } } } }, icon('trash')) : null)); })))) : h('div', { class: 'small muted', style: { padding: '6px 2px' } }, 'None.');
    const spec = assignmentSpec(async (rowsIn) => { const fnd = finder(staff), out = [], bad = [];
      rowsIn.forEach((r, i) => { const c = fnd(r.cover), b = fnd(r.absent); if (!c || !b) { bad.push(i + 2); return; } out.push({ cover_employee_id: c.id, absent_employee_id: b.id, absent_name: b.full_name, project_name: b.default_project || c.default_project || null, reason: r.reason || 'Annual leave', date_from: r.date_from, date_to: r.date_to || null, expected_hours: r.expected_hours ?? null, notes: r.notes || null }); });
      if (out.length) await addAssignments(out); await load(); return `${out.length} assignment(s) saved${bad.length ? ` · ${bad.length} row(s) skipped: employee not found` : ''}`; });
    return h('div', { class: 'ns-pane scroll' },
      h('div', { class: 'toolbar tight' }, h('div', { class: 'grow' }), canAdd ? h('button', { class: 'btn sm', onClick: () => importModal(spec) }, icon('upload'), 'Upload assignments') : null,
        h('button', { class: 'btn sm', onClick: () => exportRows({ columns: spec.columns.map((c) => ({ ...c, out: (a) => (c.key === 'cover' ? (map.get(a.cover_employee_id) || {}).employee_code : c.key === 'absent' ? (map.get(a.absent_employee_id) || {}).employee_code || a.absent_name : a[c.key]) })) }, list, 'cover_assignments.xlsx').catch((er) => toast(er.message, 'err')) }, icon('download'), 'Export'),
        h('input', { type: 'search', placeholder: 'Search cover, employee, project…', value: q, style: { width: '240px' }, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); draw(); }, 150) })),
      panelGrid(1, panel(`Covering now (${live.length})`, table(live), { id: 'as.live' }), panel(`Starting later (${soon.length})`, table(soon), { id: 'as.soon' }), panel(`Finished (${past.length})`, table(past), { id: 'as.past', open: false })));
  }

  // ---------------- 4. hours ----------------
  function hoursTab() {
    const map = byId(), wEnd = addDays(week, 6), days = DOW.map((d, i) => addDays(week, i));
    const act = assigns.filter((a) => a.date_from <= wEnd && (!a.date_to || a.date_to >= week));
    const keys = new Map();
    for (const a of act) keys.set(a.cover_employee_id + '|' + a.id, { emp: map.get(a.cover_employee_id), a });
    for (const x of hoursRows.filter((x) => String(x.work_date) >= week && String(x.work_date) <= wEnd)) { const k = x.cover_employee_id + '|' + (x.assignment_id || ''); if (!keys.has(k)) keys.set(k, { emp: map.get(x.cover_employee_id), a: assigns.find((a) => a.id === x.assignment_id) || null }); }
    const list = [...keys.values()].filter((r) => r.emp && (!q || [r.emp.full_name, r.emp.employee_code].some((x) => x && x.toLowerCase().includes(q)))).sort((a, b) => natCompare(a.emp.full_name, b.emp.full_name));
    const files = new Map(), inputs = [];
    const val = (r, d) => hoursRows.find((x) => x.cover_employee_id === r.emp.id && String(x.work_date) === d && (x.assignment_id || null) === (r.a ? r.a.id : null));
    const body = list.map((r) => {
      const cells = days.map((d) => { const v = val(r, d), inEff = !r.a || (r.a.date_from <= d && (!r.a.date_to || r.a.date_to >= d));
        const i = h('input', { type: 'number', step: 'any', min: 0, max: 24, value: v ? v.hours : '', disabled: !canAdd || !!(v && v.synced_at && !ctx.canEdit), class: 'hcell' + (v && v.synced_at ? ' sent' : '') + (inEff ? '' : ' off'), title: v && v.synced_at ? 'Already sent to payroll' : '' });
        i.addEventListener('input', () => { tot.textContent = hrs(cells.reduce((s, x) => s + (+x.value || 0), 0)); }); inputs.push({ r, d, i, v }); return i; });
      const tot = h('b', null, hrs(cells.reduce((s, x) => s + (+x.value || 0), 0)));
      const fileOf = hoursRows.find((x) => x.cover_employee_id === r.emp.id && x.file_path && String(x.work_date) >= week && String(x.work_date) <= wEnd);
      const clip = h('span', { class: 'small' });
      const up = h('input', { type: 'file', accept: 'image/*,.pdf,.xlsx,.xls,.doc,.docx', class: 'hidden', onChange: async (ev) => { const fl = ev.target.files[0]; ev.target.value = ''; if (!fl) return; try { files.set(r, await uploadCoverFile(r.emp.id, fl)); clip.textContent = ' 📎 ' + fl.name.slice(0, 14); toast('Timesheet attached — type the hours and press Save hours', 'ok'); } catch (er) { toast(er.message, 'err'); } } });
      return h('tr', null, h('td', null, h('b', null, r.emp.full_name), h('div', { class: 'small muted' }, `${r.emp.employee_code || ''}${r.a ? ' · for ' + ((map.get(r.a.absent_employee_id) || {}).full_name || r.a.absent_name || '') : ''}`)),
        cells.map((c) => h('td', { class: 'hc' }, c)), h('td', { class: 'num' }, tot), h('td', { class: 'num small' }, r.a && r.a.expected_hours != null ? hrs(r.a.expected_hours) : r.emp.weekly_hours ? hrs(r.emp.weekly_hours) : '—'),
        h('td', { class: 'nowrap' }, canAdd ? h('button', { class: 'btn sm', title: 'Attach the timesheet (photo, PDF, Excel)', onClick: () => up.click() }, icon('upload')) : null, up, clip, fileOf ? h('a', { href: '#', class: 'small', style: { marginLeft: '6px' }, onClick: async (ev) => { ev.preventDefault(); try { window.open(await coverFileUrl(fileOf.file_path), '_blank'); } catch (er) { toast(er.message, 'err'); } } }, 'view') : null));
    });
    const save = async (ev) => {
      const changed = inputs.filter(({ r, i, v }) => String(i.value) !== String(v ? v.hours : '') || (files.has(r) && i.value !== '')).map(({ r, d, i }) => ({ cover_employee_id: r.emp.id, assignment_id: r.a ? r.a.id : null, work_date: d, hours: i.value === '' ? 0 : +i.value, source: files.has(r) ? 'timesheet' : 'manual', file_path: files.get(r) || null }));
      if (changed.some((x) => x.hours > 24 || x.hours < 0)) return toast('Hours must be between 0 and 24', 'err');
      if (!changed.length) return toast('Nothing changed', '');
      const btn = ev.currentTarget; btn.disabled = true; try { await saveCoverHours(changed); toast(`${changed.length} day(s) saved`, 'ok'); await load(); } catch (er) { btn.disabled = false; toast(er.message, 'err'); }
    };
    const unsent = hoursRows.filter((x) => !x.synced_at), byCover = new Map(); for (const x of unsent) { if (!byCover.has(x.cover_employee_id)) byCover.set(x.cover_employee_id, []); byCover.get(x.cover_employee_id).push(x); }
    const runs = openRuns(), cr = currentRuns()[0], runSel = h('select', null, runs.map((r) => h('option', { value: r.id, selected: cr && r.id === cr.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${r.label}`)));
    const send = async (empIds, btn) => { const r = runs.find((x) => x.id === runSel.value); if (!r) return toast('No open payroll', 'err'); btn.disabled = true; let n = 0, skipped = 0;
      try { for (const id of empIds) { const e = map.get(id); if (!e) continue; if (!e.default_project) { toast(`${e.full_name} has no project — add one first`, 'err'); continue; } const all = byCover.get(id), rowsH = all.filter((x) => !r.period_end || String(x.work_date) <= r.period_end); skipped += all.length - rowsH.length; if (!rowsH.length) continue; await syncCoverHours(r, e, rowsH); n += rowsH.length; }
        toast(`${n} day(s) sent to ${r.label}${skipped ? ` · ${skipped} after the payroll end date wait for the next payroll` : ''}`, 'ok'); await load(); }
      catch (er) { btn.disabled = false; toast(er.message, 'err'); } };
    const spec = hoursSpec(async (rowsIn) => { const fnd = finder(staff), out = [], bad = [];
      rowsIn.forEach((r) => { const c = fnd(r.cover); if (!c) { bad.push(r); return; } const b = r.absent ? fnd(r.absent) : null;
        const live = assigns.filter((x) => x.cover_employee_id === c.id && x.date_from <= r.work_date && (!x.date_to || x.date_to >= r.work_date));
        const a = b ? assigns.find((x) => x.cover_employee_id === c.id && x.absent_employee_id === b.id) : live.length === 1 ? live[0] : null;
        out.push({ cover_employee_id: c.id, assignment_id: a ? a.id : null, work_date: r.work_date, hours: r.hours, note: r.note || null, source: 'import' }); });
      if (out.length) await saveCoverHours(out); await load(); return `${out.length} day(s) saved${bad.length ? ` · ${bad.length} skipped: cover not found` : ''}`; });
    return h('div', { class: 'ns-pane scroll' },
      h('div', { class: 'toolbar tight' }, h('button', { class: 'btn sm', onClick: () => { week = addDays(week, -7); draw(); } }, '‹'), h('b', null, `Week of ${dmy(week)}`), h('button', { class: 'btn sm', onClick: () => { week = addDays(week, 7); draw(); } }, '›'), h('button', { class: 'btn sm', onClick: () => { week = mondayOf(today()); draw(); } }, 'This week'),
        h('div', { class: 'grow' }), canAdd ? h('button', { class: 'btn sm', onClick: () => importModal(spec) }, icon('upload'), 'Upload hours') : null,
        h('button', { class: 'btn sm', onClick: () => exportRows({ columns: spec.columns.map((c) => ({ ...c, out: (x) => (c.key === 'cover' ? (map.get(x.cover_employee_id) || {}).employee_code : c.key === 'absent' ? ((map.get((assigns.find((a) => a.id === x.assignment_id) || {}).absent_employee_id) || {}).employee_code || '') : x[c.key]) })) }, hoursRows, 'cover_hours.xlsx').catch((er) => toast(er.message, 'err')) }, icon('download'), 'Export'),
        h('input', { type: 'search', placeholder: 'Find a cover…', value: q, style: { width: '180px' }, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); draw(); }, 200) })),
      panelGrid(canMove ? 'minmax(0, 2.3fr) minmax(300px, 1fr)' : 1,
        panel('Hours this week', list.length ? h('div', null, h('div', { class: 'tablewrap', style: { maxHeight: 'none' } }, h('table', { class: 't hgrid' }, h('thead', null, h('tr', null, h('th', null, 'Cover'), days.map((d, i) => h('th', { class: 'hc' }, DOW[i], h('div', { class: 'small muted' }, dm(d)))), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Expected'), h('th', null, 'Timesheet'))), h('tbody', null, body))),
          canAdd ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small muted' }, 'Green = already sent to payroll. Grey = outside the cover dates. Empty a box to remove a day.'), h('div', { class: 'grow' }), h('button', { class: 'btn primary', onClick: save }, 'Save hours')) : null)
          : h('div', { class: 'small muted' }, 'No covers working this week. Add a cover and who they are covering on “Add a cover”.'), { id: 'hr.grid' }),
        canMove ? panel('Send to payroll', h('div', { class: 'stack' }, runs.length ? fld('Payroll', runSel) : h('div', { class: 'notice warn' }, 'No open payroll.'),
          byCover.size ? h('div', { class: 'mini-list', style: { maxHeight: 'none' } }, [...byCover].map(([id, xs]) => { const e = map.get(id) || {}, ds = xs.map((x) => String(x.work_date)).sort(); return h('div', { class: 'mini' }, h('span', { class: 'grow' }, h('b', null, e.full_name || '?'), h('div', { class: 'small muted' }, `${e.employee_code || ''} · ${xs.length} day(s) · ${dm(ds[0])}–${dm(ds[ds.length - 1])}`)), h('b', null, hrs(xs.reduce((s, x) => s + +x.hours, 0)) + 'h'), h('button', { class: 'btn sm', onClick: (ev) => send([id], ev.currentTarget) }, 'Send')); })) : h('div', { class: 'small muted' }, 'All cover hours are already in a payroll.'),
          byCover.size > 1 && runs.length ? h('button', { class: 'btn primary', onClick: (ev) => send([...byCover.keys()], ev.currentTarget) }, `Send all (${unsent.length} days)`) : null,
          h('div', { class: 'small muted' }, 'Each cover gets a Cover line on their project (created if needed) and the hours go in day by day. Hours after the payroll end date wait for the next payroll.')), { id: 'hr.send' }) : null));
  }

  function draw() { showTabs(); clear(host).append(tab === 'add' && canAdd ? addTab() : tab === 'assign' ? assignTab() : tab === 'hours' ? hoursTab() : queueTab()); }
  async function load() {
    [staff, projects, assigns, hoursRows] = await Promise.all([loadStaff(), loadProjects().catch(() => []), loadAssignments().catch(() => []), loadCoverHours(addDays(today(), -180)).catch(() => [])]);
    draw();
  }
  await load();
  return onLive(debounce((e) => { if (['employees', 'cover_assignments', 'cover_hours'].includes(e.table) && !document.querySelector('.modal-wrap') && tab !== 'add' && !(document.activeElement && document.activeElement.classList.contains('hcell'))) load(); }, 900));
}
