// One HR case: details, stage stepper, case file timeline, letters, emails, escalation, outcome. Also "New case".
import { loadCase, updateCase, addCase, loadCaseEvents, addCaseEvent, uploadHrFile, hrFileUrl, loadStaffOne, loadStaff, updateStaff, loadProjects, sendEmails, deleteCase, onLive } from './api.js';
import { h, clear, toast, modal, dmy, ago, icon, confirmBox, initials, debounce } from './ui.js';
import { ctx } from './ctx.js';
import { CASE_TYPES, CATEGORIES, SEVERITY, STAGES, OUTCOMES, stageChip, sevChip, statusChip, typeChip, templates, ESCALATION_TEMPLATE, letterVars, fill, letterHtml, printLetter, hrCfg, warningFor, addMonths, today } from './hrkit.js';
import { textToHtml, parseEmails as parseList } from './mail.js';
import { waButton } from './whatsapp.js';

const canHR = () => ctx.can('manage_hr');
const sel = (opts, val, attrs = {}) => h('select', attrs, opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === val }, t); }));
const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);
const localDT = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

// ---------------- the case drawer ----------------
export async function openCase(caseId, { onChange } = {}) {
  const overlay = h('div', { class: 'overlay' }), panel = h('div', { class: 'drawer xl' }, h('div', { class: 'muted' }, 'Loading…'));
  overlay.append(panel);
  let stop = null;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', escKey); if (stop) stop(); };
  const escKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) close(); };
  document.addEventListener('keydown', escKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);

  let c, emp, events = [];
  async function load() { c = await loadCase(caseId); if (!c) { clear(panel).append(h('div', { class: 'notice err' }, 'This case no longer exists.')); return false; } [emp, events] = await Promise.all([loadStaffOne(c.employee_id), loadCaseEvents(caseId)]); return true; }
  const changed = () => { if (onChange) onChange(c); };
  async function save(patch, eventTitle) {
    try { c = await updateCase(c.id, patch); if (eventTitle) await addCaseEvent({ case_id: c.id, kind: 'stage', title: eventTitle }); events = await loadCaseEvents(c.id); toast('Saved', 'ok'); draw(); changed(); } catch (e) { toast(e.message, 'err'); }
  }

  function draw() {
    const edit = canHR() && c.stage !== 'closed';
    const stepper = h('div', { class: 'stepper' }, STAGES.map(([k, t], i) => {
      const idx = STAGES.findIndex((s) => s[0] === c.stage);
      return h('button', { class: 'step' + (k === c.stage ? ' on' : i < idx ? ' done' : ''), disabled: !canHR() || k === c.stage, onClick: () => (k === 'closed' ? outcomeModal(true) : save({ stage: k, closed_on: null }, `Stage changed to ${t}`)) }, h('i', null, i < idx ? '✓' : String(i + 1)), t);
    }));
    // details (left)
    const f = {};
    const inp = (k, label, a = {}) => fld(label, (f[k] = h(a.tag || 'input', { type: a.type || 'text', value: a.value !== undefined ? a.value : c[k] ?? '', disabled: !edit, rows: a.rows }, a.tag === 'textarea' ? (c[k] || '') : null)), a.cls);
    const left = h('div', { class: 'hc-left' },
      h('div', { class: 'card pad' }, h('h3', null, 'Case details'),
        h('div', { class: 'form-grid g3' },
          fld('Case type', (f.case_type = sel(CASE_TYPES, c.case_type, { disabled: !edit }))), fld('Category', (f.category = sel(['', ...CATEGORIES], c.category || '', { disabled: !edit }))), fld('Severity', (f.severity = sel(SEVERITY, c.severity, { disabled: !edit }))),
          inp('incident_date', 'Incident date', { type: 'date' }), inp('due_date', 'Target date', { type: 'date' }), inp('reported_by', 'Reported by'),
          inp('investigator', 'Investigating manager'), inp('manager_name', 'Area manager'), inp('manager_email', 'Area manager email', { type: 'email' }),
          inp('meeting_at', 'Meeting date & time', { type: 'datetime-local', value: localDT(c.meeting_at) }), inp('meeting_place', 'Meeting place', { cls: 's2' })),
        inp('summary', 'Summary (one line)'), h('div', { style: { height: '10px' } }), inp('details', 'Allegations / details (used in letters)', { tag: 'textarea', rows: 5 }),
        edit ? h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, h('button', { class: 'btn primary', onClick: () => {
          const p = {}; for (const k of ['case_type', 'category', 'severity', 'incident_date', 'due_date', 'reported_by', 'investigator', 'manager_name', 'manager_email', 'meeting_place', 'summary', 'details']) { const v = f[k].value.trim(); p[k] = v === '' ? null : v; }
          if (!p.summary) return toast('Add a summary', 'err'); p.meeting_at = f.meeting_at.value ? new Date(f.meeting_at.value).toISOString() : null; save(p);
        } }, 'Save details')) : null),
      c.outcome ? h('div', { class: 'card pad outcomecard' }, h('h3', null, 'Outcome'), h('div', { class: 'row wrap' }, h('b', null, c.outcome), c.warning_level ? h('span', { class: 'hpill v-high' }, `${c.warning_level} · live until ${dmy(c.warning_expiry)}`) : null, c.closed_on ? h('span', { class: 'muted small' }, 'Closed ' + dmy(c.closed_on)) : null)) : null);

    // timeline (right)
    const note = h('textarea', { rows: 2, placeholder: 'Add a note to the case file (meeting notes, phone calls, evidence received)…', disabled: !canHR() });
    const file = h('input', { type: 'file', class: 'hidden', onChange: async (e) => { const fl = e.target.files[0]; e.target.value = ''; if (!fl) return; try { const path = await uploadHrFile(c.id, fl); await addCaseEvent({ case_id: c.id, kind: 'file', title: fl.name, meta: { path, size: fl.size } }); events = await loadCaseEvents(c.id); toast('File added to the case', 'ok'); draw(); } catch (er) { toast(er.message, 'err'); } } });
    const right = h('div', { class: 'hc-right' },
      h('div', { class: 'card pad tl-card' }, h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, 'Case file'), h('div', { class: 'grow' }), h('span', { class: 'small muted' }, `${events.length} entr${events.length === 1 ? 'y' : 'ies'}`)),
        canHR() ? h('div', { class: 'composer' }, note, h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => file.click() }, icon('upload'), 'Attach file'), file, h('div', { class: 'grow' }),
          h('button', { class: 'btn sm primary', onClick: async () => { if (!note.value.trim()) return; try { await addCaseEvent({ case_id: c.id, kind: 'note', title: 'Note', body: note.value.trim() }); events = await loadCaseEvents(c.id); draw(); } catch (e) { toast(e.message, 'err'); } } }, 'Add note'))) : null,
        h('div', { class: 'timeline' }, events.length ? events.map(evRow) : h('div', { class: 'muted small' }, 'Nothing recorded yet.'))));

    clear(panel).append(
      h('div', { class: 'hc-head' },
        h('div', { class: 'avatar' }, initials(c.employee_name)),
        h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, c.case_ref, ' · opened ', dmy(c.opened_on), c.created_by_email ? ' by ' + c.created_by_email : ''),
          h('h2', null, c.summary), h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '6px' } }, h('b', null, c.employee_name), emp ? statusChip(emp.emp_status) : null, emp ? typeChip(emp.employment_type) : null, c.project_name ? h('span', { class: 'hpill grp' }, c.project_name) : null, sevChip(c.severity), stageChip(c.stage))),
        h('button', { class: 'btn sm', onClick: close }, icon('x'))),
      stepper,
      canHR() ? h('div', { class: 'hc-actions' },
        h('button', { class: 'btn primary', onClick: () => letterModal(c, emp, after) }, icon('file'), 'Letter / email to employee'),
        h('button', { class: 'btn', onClick: () => escalateModal(c, emp, after) }, icon('alert'), 'Escalate to manager'), emp ? waButton(emp, { label: 'WhatsApp' }) : null,
        h('button', { class: 'btn', onClick: () => outcomeModal(false) }, icon('check'), 'Record outcome'),
        emp && emp.emp_status !== 'suspended' && emp.emp_status !== 'terminated' ? h('button', { class: 'btn', onClick: () => setEmpStatus('suspended') }, 'Suspend employee') : null,
        emp && emp.emp_status === 'suspended' ? h('button', { class: 'btn', onClick: () => setEmpStatus('active') }, 'Lift suspension') : null,
        h('div', { class: 'grow' }),
        ctx.isSuper ? h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmBox('Delete this case?', 'The case and its whole case file will be deleted permanently. Usually you should close it instead.', 'Delete', true)) { try { await deleteCase(c.id); toast('Case deleted', 'ok'); close(); changed(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash')) : null) : null,
      h('div', { class: 'hc-body' }, left, right));
  }
  const after = async () => { c = await loadCase(c.id); emp = await loadStaffOne(c.employee_id); events = await loadCaseEvents(c.id); draw(); changed(); };

  function evRow(e) {
    const ico = { note: 'file', stage: 'trend', letter: 'book', email: 'mail', escalation: 'alert', file: 'upload', status: 'users', outcome: 'check' }[e.kind] || 'file';
    return h('div', { class: 'ev k-' + e.kind }, h('div', { class: 'evi' }, icon(ico)),
      h('div', { class: 'evb' }, h('div', { class: 'row', style: { gap: '6px' } }, h('b', null, e.title || e.kind), h('div', { class: 'grow' }), h('span', { class: 'small muted', title: new Date(e.created_at).toLocaleString('en-GB') }, ago(e.created_at))),
        h('div', { class: 'small muted' }, e.by_email || ''),
        e.meta && e.meta.to ? h('div', { class: 'small' }, 'To: ', e.meta.to, e.meta.cc && e.meta.cc.length ? ' · cc ' + e.meta.cc.join(', ') : '') : null,
        e.body ? h('details', { open: e.kind === 'note' }, h('summary', { class: 'small' }, e.kind === 'note' ? 'Note' : 'Show text'), h('div', { class: 'evtext' }, e.body)) : null,
        e.kind === 'file' && e.meta && e.meta.path ? h('a', { href: '#', class: 'small', onClick: async (ev) => { ev.preventDefault(); try { window.open(await hrFileUrl(e.meta.path), '_blank'); } catch (er) { toast(er.message, 'err'); } } }, 'Open file') : null));
  }

  async function setEmpStatus(st) {
    if (!emp) return;
    try { emp = await updateStaff(emp.id, { emp_status: st }); await addCaseEvent({ case_id: c.id, kind: 'status', title: st === 'suspended' ? 'Employee suspended' : 'Suspension lifted – employee active' }); toast(st === 'suspended' ? 'Employee marked as suspended' : 'Employee is active again', 'ok'); await after(); } catch (e) { toast(e.message, 'err'); }
  }

  function outcomeModal(closing) {
    modal(closing ? 'Close the case' : 'Record the outcome', (done) => {
      const out = sel(OUTCOMES, c.outcome || OUTCOMES[0]), dt = h('input', { type: 'date', value: c.closed_on || today() });
      const notes = h('textarea', { rows: 3, placeholder: 'Reasons / what was decided (goes in the case file)' });
      const exp = h('input', { type: 'date' }), lvl = h('div', { class: 'small muted' });
      const term = h('input', { type: 'checkbox' }), termDate = h('input', { type: 'date', value: today() }), lift = h('input', { type: 'checkbox', checked: emp && emp.emp_status === 'suspended' });
      const closeIt = h('input', { type: 'checkbox', checked: true });
      const sync = () => { const w = warningFor(out.value); if (w) { exp.value = addMonths(dt.value || today(), w.months); lvl.textContent = `${w.level}: live for ${w.months} months`; exp.disabled = false; } else { exp.value = ''; lvl.textContent = 'No warning recorded for this outcome.'; exp.disabled = true; } term.checked = /^dismissal/i.test(out.value); };
      out.onchange = sync; dt.onchange = sync; setTimeout(sync);
      return h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, fld('Outcome', out), fld('Decision date', dt), fld('Warning live until', exp), h('div', { style: { alignSelf: 'end' } }, lvl)), fld('Notes', notes),
        h('label', { class: 'row small' }, closeIt, 'Close the case'),
        emp && emp.emp_status !== 'terminated' ? h('label', { class: 'row small' }, term, 'Terminate the employee on ', termDate, ' (they become a leaver for payroll)') : null,
        emp && emp.emp_status === 'suspended' ? h('label', { class: 'row small' }, lift, 'Lift the suspension (back to Active)') : null,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          try {
            const w = warningFor(out.value);
            c = await updateCase(c.id, { outcome: out.value, warning_level: w ? w.level : null, warning_expiry: w && exp.value ? exp.value : null, stage: closeIt.checked ? 'closed' : 'outcome', closed_on: closeIt.checked ? dt.value || today() : null });
            await addCaseEvent({ case_id: c.id, kind: 'outcome', title: `Outcome: ${out.value}${closeIt.checked ? ' · case closed' : ''}`, body: notes.value.trim() || null, meta: { warning_expiry: exp.value || null } });
            if (emp && term.checked) { await updateStaff(emp.id, { emp_status: 'terminated', termination_date: termDate.value || today(), termination_reason: `${out.value} (${c.case_ref})` }); await addCaseEvent({ case_id: c.id, kind: 'status', title: `Employee terminated from ${dmy(termDate.value || today())}` }); }
            else if (emp && lift.checked && emp.emp_status === 'suspended') { await updateStaff(emp.id, { emp_status: 'active' }); await addCaseEvent({ case_id: c.id, kind: 'status', title: 'Suspension lifted – employee active' }); }
            done(); toast('Outcome recorded', 'ok'); await after();
            if (await confirmBox('Send the outcome letter?', 'Open the letter for this outcome now, so you can check it and email it to the employee?', 'Open letter')) letterModal(c, emp, after, pickTemplate(out.value));
          } catch (e) { toast(e.message, 'err'); }
        } }, 'Save outcome')));
    });
  }

  if (await load()) draw();
  stop = onLive(debounce(async (e) => { if ((e.table === 'hr_cases' && ((e.row && e.row.id === caseId) || (e.old && e.old.id === caseId))) || (e.table === 'hr_case_events' && e.row && e.row.case_id === caseId)) { if (!document.querySelector('.modal-wrap') && await load()) draw(); } }, 600));
}

const pickTemplate = (outcome) => (/^verbal/i.test(outcome) ? 'warn_verbal' : /^first/i.test(outcome) ? 'warn_first' : /^final/i.test(outcome) ? 'warn_final' : /^dismissal/i.test(outcome) ? 'dismissal' : /^grievance/i.test(outcome) ? 'griev_outcome' : 'outcome_nfa');

// ---------------- letter / email ----------------
export function letterModal(c, emp, after, preset) {
  const list = templates(), H = hrCfg();
  const fit = list.filter((t) => !t.types || !t.types.length || t.types.includes(c.case_type));
  let t = list.find((x) => x.id === preset) || fit[0] || list[0];
  modal('Letter / email to the employee', (done) => {
    const pick = sel(list.map((x) => [x.id, (fit.includes(x) ? '★ ' : '') + x.name]), t.id);
    const notes = h('textarea', { rows: 2, placeholder: 'Extra wording for {outcome_notes} (optional)' });
    const subj = h('input', { type: 'text' }), body = h('textarea', { rows: 14, class: 'mono-ish' });
    const to = h('input', { type: 'email', value: (emp && emp.email) || '' }), cc = h('input', { type: 'text', value: [c.manager_email, H.cc].filter(Boolean).join(', ') });
    const refill = () => { const v = letterVars(c, emp, { outcome_notes: notes.value.trim() }); subj.value = fill(t.subject, v); body.value = fill(t.body, v); };
    pick.onchange = () => { t = list.find((x) => x.id === pick.value); refill(); }; notes.addEventListener('input', debounce(refill, 300)); refill();
    const letter = () => ({ subject: subj.value, body: body.value, to: (emp && emp.full_name) || c.employee_name });
    const log = (kind, title, meta) => !c.id ? Promise.resolve() : addCaseEvent({ case_id: c.id, kind, title, body: `${subj.value}\n\n${body.value}`, meta });
    return h('div', { class: 'stack' },
      h('div', { class: 'form-grid' }, fld('Template (★ = suits this case type)', pick), fld('Outcome notes', notes)),
      fld('Subject', subj), fld('Letter (edit freely before sending)', body),
      h('div', { class: 'form-grid' }, fld('Send to (employee email)', to), fld('Copy to (area manager, HR) – comma separated', cc)),
      !to.value ? h('div', { class: 'notice warn' }, 'This employee has no email on file. Add one on their profile, or print the letter and hand it over.') : null,
      h('div', { class: 'row wrap', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onClick: done }, 'Cancel'),
        h('button', { class: 'btn', onClick: async () => { try { printLetter(letter()); await log('letter', `Letter printed: ${t.name}`, { template: t.id }); if (after) after(); } catch (e) { toast(e.message, 'err'); } } }, icon('download'), 'Print / save as PDF'),
        h('button', { class: 'btn', onClick: async () => { try { if (!c.id) return toast('This letter is not linked to a case — print it or email it instead', 'err'); await log('letter', `Letter saved to file: ${t.name}`, { template: t.id }); done(); toast('Saved to the case file', 'ok'); if (after) after(); } catch (e) { toast(e.message, 'err'); } } }, 'Save to case file only'),
        h('button', { class: 'btn primary', onClick: async (ev) => {
          const toAddr = to.value.trim(); if (!toAddr) return toast('Add the employee’s email address', 'err');
          ev.target.disabled = true;
          try {
            const ccList = parseList(cc.value);
            const r = await sendEmails('hr_case', [{ to: toAddr, cc: ccList, subject: subj.value, html: letterHtml(letter(), false), text: body.value, employee_id: c.employee_id }]);
            if (!r.sent) throw new Error((r.results[0] && r.results[0].error) || 'Not sent');
            await log('email', `Emailed: ${t.name}`, { to: toAddr, cc: ccList, template: t.id });
            if (emp && !emp.email) await updateStaff(emp.id, { email: toAddr.toLowerCase() }).catch(() => {});
            done(); toast(c.id ? 'Email sent and saved to the case file' : 'Email sent', 'ok'); if (after) after();
          } catch (e) { ev.target.disabled = false; toast(e.message, 'err'); }
        } }, icon('mail'), 'Send email')));
  }, { wide: true });
}

// ---------------- escalation to the area manager ----------------
export function escalateModal(c, emp, after) {
  const H = hrCfg();
  modal('Escalate to the area manager', (done) => {
    const to = h('input', { type: 'email', value: c.manager_email || '' }), cc = h('input', { type: 'text', value: H.cc || '' });
    const action = h('input', { type: 'text', value: 'Please review and confirm next steps.' });
    const subj = h('input', { type: 'text' }), body = h('textarea', { rows: 14 });
    const refill = () => { const v = letterVars(c, emp, { action_needed: action.value.trim() || 'Please review.' }); subj.value = fill(ESCALATION_TEMPLATE.subject, v); body.value = fill(ESCALATION_TEMPLATE.body, v); };
    action.addEventListener('input', debounce(refill, 300)); refill();
    return h('div', { class: 'stack' },
      h('div', { class: 'form-grid' }, fld('To (area manager / POC)', to), fld('Copy to', cc)), fld('What do you need from them?', action), fld('Subject', subj), fld('Message', body),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'),
        h('button', { class: 'btn primary', onClick: async (ev) => {
          const t = to.value.trim(); if (!t) return toast('Add the manager’s email', 'err'); ev.target.disabled = true;
          try {
            const ccList = parseList(cc.value);
            const r = await sendEmails('hr_case', [{ to: t, cc: ccList, subject: subj.value, html: textToHtml(body.value), text: body.value, employee_id: c.employee_id }]);
            if (!r.sent) throw new Error((r.results[0] && r.results[0].error) || 'Not sent');
            await addCaseEvent({ case_id: c.id, kind: 'escalation', title: `Escalated to ${t}`, body: body.value, meta: { to: t, cc: ccList } });
            if (!c.manager_email) await updateCase(c.id, { manager_email: t }).catch(() => {});
            done(); toast('Escalation sent', 'ok'); if (after) after();
          } catch (e) { ev.target.disabled = false; toast(e.message, 'err'); }
        } }, icon('mail'), 'Send escalation')));
  }, { wide: true });
}

// ---------------- new case ----------------
export async function newCaseModal(empPreset, { onCreated } = {}) {
  const [staff, projects] = await Promise.all([empPreset ? [empPreset] : loadStaff(), loadProjects().catch(() => [])]);
  const pocFor = (name) => projects.find((p) => p.name && name && p.name.toLowerCase() === String(name).toLowerCase()) || {};
  modal('Open a new HR case', (done) => {
    const f = {};
    const empSel = empPreset ? null : h('input', { type: 'text', list: 'hr-emp-list', placeholder: 'Type an Employee ID or name…' });
    const dl = empPreset ? null : h('datalist', { id: 'hr-emp-list' }, staff.filter((e) => e.emp_status !== 'terminated').map((e) => h('option', { value: `${e.employee_code ? e.employee_code + ' · ' : ''}${e.full_name}${e.default_project ? ' — ' + e.default_project : ''}` })));
    const findEmp = () => empPreset || staff.find((e) => `${e.employee_code ? e.employee_code + ' · ' : ''}${e.full_name}${e.default_project ? ' — ' + e.default_project : ''}` === empSel.value) || staff.find((e) => e.full_name.toLowerCase() === empSel.value.trim().toLowerCase() || (e.employee_code && e.employee_code.toLowerCase() === empSel.value.trim().toLowerCase()));
    const mgr = h('input', { type: 'text' }), mgrMail = h('input', { type: 'email' });
    const fillPoc = () => { const e = findEmp(); if (!e) return; const p = pocFor(e.default_project); const n = e.area_manager || p.manager, m = e.area_manager_email || p.manager_email; if (n && !mgr.value) mgr.value = n; if (m && !mgrMail.value) mgrMail.value = m; };
    if (empSel) empSel.addEventListener('change', fillPoc); setTimeout(fillPoc);
    const suspend = h('input', { type: 'checkbox' }), escalate = h('input', { type: 'checkbox' });
    f.type = sel(CASE_TYPES, 'Investigation'); f.type.onchange = () => { suspend.checked = f.type.value === 'Suspension'; };
    f.cat = sel(['', ...CATEGORIES], ''); f.sev = sel(SEVERITY, 'medium'); f.sev.onchange = () => { if (f.sev.value === 'gross') suspend.checked = true; };
    f.inc = h('input', { type: 'date' }); f.due = h('input', { type: 'date', value: addMonths(today(), 1) });
    f.rep = h('input', { type: 'text', placeholder: 'e.g. Client site manager' }); f.inv = h('input', { type: 'text' });
    f.sum = h('input', { type: 'text', placeholder: 'e.g. Left site early without permission on 3 occasions' }); f.det = h('textarea', { rows: 4, placeholder: 'The allegation(s) or concerns, as they should appear in letters' });
    const err = h('div', { class: 'notice err hidden' });
    return h('div', { class: 'stack' }, dl,
      empPreset ? h('div', { class: 'row' }, h('div', { class: 'avatar sm' }, initials(empPreset.full_name)), h('b', null, empPreset.full_name), typeChip(empPreset.employment_type), statusChip(empPreset.emp_status), h('span', { class: 'muted small' }, empPreset.default_project || '')) : fld('Employee *', empSel),
      h('div', { class: 'form-grid g3' }, fld('Case type', f.type), fld('Category', f.cat), fld('Severity', f.sev), fld('Incident date', f.inc), fld('Target date', f.due), fld('Reported by', f.rep),
        fld('Investigating manager', f.inv), fld('Area manager', mgr), fld('Area manager email', mgrMail)),
      fld('Summary *', f.sum), fld('Allegations / details', f.det),
      h('div', { class: 'row wrap', style: { gap: '18px' } }, h('label', { class: 'row small' }, suspend, 'Suspend the employee now (on full pay)'), h('label', { class: 'row small' }, escalate, 'Email the area manager straight after saving')),
      err,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
        const e = findEmp(); if (!e) { err.textContent = 'Pick the employee from the list.'; err.classList.remove('hidden'); return; }
        if (!f.sum.value.trim()) { err.textContent = 'Add a one-line summary.'; err.classList.remove('hidden'); return; }
        ev.target.disabled = true;
        try {
          const row = { employee_id: e.id, employee_name: e.full_name, project_name: e.default_project || null, case_type: f.type.value, category: f.cat.value || null, severity: f.sev.value,
            stage: f.type.value === 'Investigation' || f.type.value === 'Suspension' ? 'investigation' : 'open', incident_date: f.inc.value || null, due_date: f.due.value || null, reported_by: f.rep.value.trim() || null,
            investigator: f.inv.value.trim() || null, manager_name: mgr.value.trim() || null, manager_email: mgrMail.value.trim() || null, summary: f.sum.value.trim(), details: f.det.value.trim() || null };
          const c = await addCase(row);
          await addCaseEvent({ case_id: c.id, kind: 'stage', title: `Case opened (${row.case_type})`, body: row.details });
          let emp = e;
          if (suspend.checked && e.emp_status !== 'suspended') { emp = await updateStaff(e.id, { emp_status: 'suspended' }); await addCaseEvent({ case_id: c.id, kind: 'status', title: 'Employee suspended' }); }
          done(); toast(`Case ${c.case_ref} opened`, 'ok');
          if (onCreated) onCreated(c);
          if (escalate.checked) escalateModal(c, emp, () => onCreated && onCreated(c));
          else openCase(c.id, { onChange: () => onCreated && onCreated(c) });
        } catch (er) { ev.target.disabled = false; err.textContent = er.message; err.classList.remove('hidden'); }
      } }, 'Open case')));
  }, { wide: true });
}
