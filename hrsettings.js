// Settings → HR letters: sender, copy-to address, warning lengths, and the letter templates (edit, add, import from Word).
import { saveSetting, loadSettings } from './api.js';
import { h, clear, toast, modal, icon, confirmBox } from './ui.js';
import { ctx } from './ctx.js';
import { hrCfg, DEFAULT_TEMPLATES, CASE_TYPES, templates } from './hrkit.js';
import { loadMammoth } from './xlsx.js';

const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);
const PLACEHOLDERS = '{first_name} {employee_name} {job_title} {project} {case_ref} {case_type} {category} {severity} {summary} {allegations} {incident_date} {opened_on} {meeting_date} {meeting_time} {meeting_place} {investigator} {outcome} {outcome_notes} {warning_expiry} {warning_months} {appeal_days} {possible_outcome} {suspended_from} {shift} {termination_date} {hire_date} {rtw_type} {rtw_expiry} {lift_suspension} {today} {company} {sender} {signoff}';

export async function hrTab(host) {
  const can = ctx.can('manage_settings');
  let H = hrCfg(), list = templates().map((t) => ({ ...t }));
  const save = async (patch, msg = 'Saved') => { try { H = { ...H, ...patch }; await saveSetting('hr', H); ctx.settings = await loadSettings(); toast(msg, 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } };

  function edit(t, isNew) {
    modal(isNew ? 'New letter template' : `Edit: ${t.name}`, (done) => {
      const name = h('input', { type: 'text', value: t.name || '' }), subj = h('input', { type: 'text', value: t.subject || '' }), body = h('textarea', { rows: 16 }, t.body || '');
      const types = new Set(t.types || []);
      const word = h('input', { type: 'file', accept: '.docx', class: 'hidden', onChange: async (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try { const m = await loadMammoth(); const r = await m.extractRawText({ arrayBuffer: await f.arrayBuffer() }); body.value = r.value.replace(/\n{3,}/g, '\n\n').trim(); if (!name.value) name.value = f.name.replace(/\.docx$/i, ''); toast('Text copied in from the Word file — now add the {placeholders}', 'ok'); } catch (er) { toast(er.message, 'err'); }
      } });
      return h('div', { class: 'stack' },
        h('div', { class: 'form-grid' }, fld('Template name', name), fld('Email subject', subj)),
        h('div', { class: 'fld' }, 'Suggest for these case types', h('div', { class: 'row wrap', style: { gap: '6px' } }, CASE_TYPES.map((c) => h('button', { class: 'chip' + (types.has(c) ? ' on' : ''), onClick: (ev) => { types.has(c) ? types.delete(c) : types.add(c); ev.target.classList.toggle('on'); } }, c)))),
        fld('Letter text', body), h('div', { class: 'small muted' }, 'Placeholders: ', PLACEHOLDERS),
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('button', { class: 'btn', onClick: () => word.click() }, icon('upload'), 'Copy text from a Word file'), word,
          h('div', { class: 'row' }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
            if (!name.value.trim() || !body.value.trim()) return toast('Add a name and the letter text', 'err');
            const row = { id: t.id || 'tpl_' + Date.now().toString(36), name: name.value.trim(), subject: subj.value.trim() || name.value.trim(), body: body.value, types: [...types] };
            list = isNew ? [...list, row] : list.map((x) => (x.id === t.id ? row : x)); done(); await save({ templates: list }, 'Template saved');
          } }, 'Save template'))));
    }, { wide: true });
  }

  function draw() {
    const f = {};
    const wm = H.warning_months || {};
    clear(host).append(h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(320px,1fr) minmax(420px,2fr)', alignItems: 'start' } },
      h('div', { class: 'card pad' }, h('h3', null, 'HR emails & letters'),
        h('div', { class: 'stack' }, fld('Signed by (name / job title)', (f.sender = h('input', { type: 'text', value: H.sender, disabled: !can }))), fld('Sign-off', (f.signoff = h('input', { type: 'text', value: H.signoff, disabled: !can }))),
          fld('Company address on letters', (f.address = h('textarea', { rows: 3, disabled: !can }, H.address || ''))), fld('Always copy HR emails to (comma separated)', (f.cc = h('input', { type: 'text', value: H.cc || '', placeholder: 'hr@crystalfm.co.uk', disabled: !can }))),
          h('div', { class: 'form-grid g3' }, fld('Verbal warning (months)', (f.v = h('input', { type: 'number', value: wm.verbal ?? 6, disabled: !can }))), fld('First written (months)', (f.f = h('input', { type: 'number', value: wm.first ?? 12, disabled: !can }))), fld('Final written (months)', (f.fi = h('input', { type: 'number', value: wm.final ?? 12, disabled: !can })))),
          can ? h('button', { class: 'btn primary', onClick: () => save({ sender: f.sender.value.trim(), signoff: f.signoff.value.trim(), address: f.address.value.trim(), cc: f.cc.value.trim(), warning_months: { verbal: +f.v.value || 6, first: +f.f.value || 12, final: +f.fi.value || 12 } }) }, 'Save') : null)),
      h('div', { class: 'card pad' }, h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, `Letter templates (${list.length})`), h('div', { class: 'grow' }),
        can ? h('button', { class: 'btn sm', onClick: async () => { if (await confirmBox('Reset templates?', 'Replace all templates with the standard set? Your own templates will be removed.', 'Reset', true)) { list = DEFAULT_TEMPLATES.map((t) => ({ ...t })); await save({ templates: list }, 'Standard templates restored'); } } }, 'Reset to standard') : null,
        can ? h('button', { class: 'btn sm primary', onClick: () => edit({}, true) }, icon('plus'), 'New template') : null),
        h('div', { class: 'tplgrid' }, list.map((t) => h('div', { class: 'tpl' }, h('b', null, t.name), h('div', { class: 'small muted ell' }, t.subject), h('div', { class: 'row wrap', style: { gap: '4px' } }, (t.types || []).slice(0, 3).map((x) => h('span', { class: 'hpill grp' }, x))),
          h('div', { class: 'row', style: { gap: '6px', marginTop: 'auto' } }, h('button', { class: 'btn sm', onClick: () => edit(t, false) }, can ? 'Edit' : 'View'),
            can ? h('button', { class: 'btn sm', onClick: async () => { if (await confirmBox('Delete template?', `Delete “${t.name}”?`, 'Delete', true)) { list = list.filter((x) => x.id !== t.id); await save({ templates: list }, 'Template deleted'); } } }, icon('trash')) : null)))))));
  }
  draw();
}
