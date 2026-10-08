// Settings: pay rules (SSP), leave types, journal accounts, escalation. Everyone can read; admins change.
import { saveSetting, saveLeaveType, deleteLeaveType, loadLeaveTypes, loadSettings } from './api.js';
import { h, clear, toast, icon, confirmBox } from './ui.js';
import { ctx, payRules, escalationCfg } from './ctx.js';
import { DEFAULT_JOURNAL, DEFAULT_ESTIMATE } from './timesheet.js';
import { accessTab, dashboardTab, brandTab, emailTab, aiTab } from './customise.js';
import { hrTab } from './hrsettings.js';

async function payTab(root) {
  const admin = ctx.can('manage_settings');
  const host = h('div', { class: 'stack' });
  root.append(host);
  const num = (v) => (v === '' ? null : +v);
  const fld = (label, input, hint) => h('label', { class: 'fld' }, label, input, hint ? h('span', { class: 'small', style: { fontWeight: 400 } }, hint) : null);
  const inp = (v, o = {}) => h('input', { type: o.type || 'text', value: v ?? '', step: 'any', disabled: !admin, ...o });
  const save = async (key, value, msg = 'Saved') => { try { await saveSetting(key, value); ctx.settings = await loadSettings(); toast(msg, 'ok'); } catch (e) { toast(e.message, 'err'); } };

  function draw() {
    const pr = payRules(), es = escalationCfg(), jc = { ...DEFAULT_JOURNAL, ...(ctx.settings.journal || {}), accounts: { ...DEFAULT_JOURNAL.accounts, ...((ctx.settings.journal || {}).accounts || {}) } };
    // pay rules
    const ssp = inp(pr.ssp_weekly_rate, { type: 'number' }), days = inp(pr.ssp_days, { type: 'number' }), tol = inp(pr.budget_tolerance_hours ?? 0.25, { type: 'number' });
    const payCard = h('div', { class: 'card pad' }, h('h3', null, 'Pay rules'),
      h('div', { class: 'set-grid' }, fld('SSP weekly rate (£)', ssp, '2026/27: £123.25, or 80% of average weekly earnings if lower'), fld('Qualifying days per week', days, 'SSP per day = weekly rate ÷ this'), fld('Budget tolerance (hours)', tol, 'Over / under budget is decided on hours. A line within this many hours of its budget counts as “within budget” (0.25 = 15 minutes).')),
      admin ? h('button', { class: 'btn primary sm', style: { marginTop: '12px' }, onClick: () => save('pay_rules', { ssp_weekly_rate: num(ssp.value) || 123.25, ssp_days: num(days.value) || 5, budget_tolerance_hours: num(tol.value) ?? 0.25 }) }, 'Save pay rules') : null);
    // escalation
    const em = inp(es.default_email, { type: 'email', placeholder: 'fallback if a project has no contact' }), cc = inp(es.cc, { type: 'email' }), hrsT = inp(es.threshold_hours ?? 8, { type: 'number' }), pct = inp(es.threshold_pct, { type: 'number' });
    const escCard = h('div', { class: 'card pad' }, h('h3', null, 'Budget escalation'),
      h('div', { class: 'set-grid' }, fld('Default point of contact', em, 'Used when a project has no area manager saved'), fld('Always copy (CC)', cc), fld('Highlight when over by (hours)', hrsT, 'Projects this many hours over (or more) are shown as urgent'), fld('…or over by (%)', pct)),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Each project’s area manager and email are managed under Projects & POCs.'),
      admin ? h('button', { class: 'btn primary sm', style: { marginTop: '12px' }, onClick: () => save('escalation', { default_email: em.value.trim(), cc: cc.value.trim(), threshold_hours: num(hrsT.value) ?? 8, threshold_pct: num(pct.value) ?? 5 }) }, 'Save escalation settings') : null);
    // journal
    const acc = {}; const labels = {};
    const accFields = Object.keys(DEFAULT_JOURNAL.accounts).map((k) => { acc[k] = inp(jc.accounts[k]); labels[k] = inp((jc.labels || {})[k] ?? DEFAULT_JOURNAL.labels[k]);
      return h('div', { class: 'form-grid', style: { alignItems: 'end' } }, fld(DEFAULT_JOURNAL.labels[k] + ' — description', labels[k]), fld('Account code', acc[k])); });
    const tax = inp(jc.tax_rate);
    const jCard = h('div', { class: 'card pad', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Manual journal (Xero)'), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'The wording and account codes used on every line of the exported journal.'),
      h('div', { class: 'stack', style: { gap: '8px' } }, accFields, h('div', { class: 'form-grid' }, fld('Tax rate', tax))),
      admin ? h('button', { class: 'btn primary sm', style: { marginTop: '12px' }, onClick: () => save('journal', { tax_rate: tax.value.trim() || 'No VAT', accounts: Object.fromEntries(Object.entries(acc).map(([k, i]) => [k, i.value.trim()])), labels: Object.fromEntries(Object.entries(labels).map(([k, i]) => [k, i.value.trim()])) }, 'Journal settings saved') }, 'Save journal settings') : null);
    // leave types
    const rows = ctx.leaveTypes.map((t) => {
      const name = inp(t.name), color = h('input', { type: 'color', value: t.color || '#6c5ce7', disabled: !admin, style: { width: '46px', padding: 0, height: '32px' } });
      const paid = h('input', { type: 'checkbox', checked: t.paid, disabled: !admin }), sspC = h('input', { type: 'checkbox', checked: t.ssp, disabled: !admin }), active = h('input', { type: 'checkbox', checked: t.active !== false, disabled: !admin });
      const commit = async () => { try { await saveLeaveType({ code: t.code, name: name.value.trim() || t.name, paid: paid.checked && !sspC.checked, ssp: sspC.checked, color: color.value, sort: t.sort, active: active.checked }); ctx.leaveTypes = await loadLeaveTypes(); toast('Leave type saved', 'ok'); } catch (e) { toast(e.message, 'err'); } };
      [name, color, paid, sspC, active].forEach((el) => el.addEventListener('change', commit));
      return h('tr', null, h('td', null, h('span', { class: 'tag', style: { background: t.color } }, t.code)), h('td', null, name), h('td', null, color), h('td', { class: 'center' }, paid), h('td', { class: 'center' }, sspC), h('td', { class: 'center' }, active),
        h('td', null, admin ? h('button', { class: 'btn sm danger', onClick: async () => { if (!(await confirmBox('Delete leave type?', `“${t.name}” can only be deleted if no leave uses it.`, 'Delete', true))) return; try { await deleteLeaveType(t.code); ctx.leaveTypes = await loadLeaveTypes(); draw(); } catch (e) { toast('Cannot delete: it is in use. Untick “Active” instead.', 'err'); } } }, '×') : null));
    });
    const newCode = inp('', { placeholder: 'CODE', style: { width: '90px' } }), newName = inp('', { placeholder: 'Name, e.g. Jury service (paid)' });
    const leaveCard = h('div', { class: 'card pad', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Leave types'), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Paid = paid at the hourly rate and counts towards budget. Unpaid = recorded, no pay. SSP = paid per day at the SSP rate.'),
      h('div', { class: 'tablewrap auto' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Code', 'Name', 'Colour', 'Paid', 'SSP', 'Active', ''].map((t, i) => h('th', { class: i > 2 && i < 6 ? 'center' : '' }, t)))), h('tbody', null, rows))),
      admin ? h('div', { class: 'row wrap', style: { marginTop: '10px' } }, newCode, h('div', { class: 'grow' }, newName), h('button', { class: 'btn sm', onClick: async () => { const c = newCode.value.trim().toUpperCase(); if (!c || !newName.value.trim()) return toast('Add a code and a name', 'err');
        try { await saveLeaveType({ code: c, name: newName.value.trim(), paid: true, ssp: false, color: '#0d9488', sort: ctx.leaveTypes.length + 1, active: true }); ctx.leaveTypes = await loadLeaveTypes(); draw(); } catch (e) { toast(e.message, 'err'); } } }, icon('plus'), 'Add leave type')) : null);
    // estimate rules (used by "journal from our own hours")
    const est = { ...DEFAULT_ESTIMATE, ...(ctx.settings.estimate || {}) }, eF = {};
    const ef = (k, label, hint, o = {}) => fld(label, (eF[k] = inp(est[k], { type: 'number', ...o })), hint);
    const estCard = h('div', { class: 'card pad', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Journal estimate rules (employer NI and pension)'), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Used when you build a journal from your own hours, before the payroll provider has run. 2026/27 values; change them if the rules change or you get the Employment Allowance.'),
      h('div', { class: 'set-grid' }, ef('er_ni_rate', 'Employer NI rate (%)'), ef('er_ni_threshold_year', 'NI secondary threshold (£ a year)'), ef('er_pension_pct', 'Employer pension (% of qualifying earnings)'), ef('pension_trigger_year', 'Auto-enrolment trigger (£ a year)'), ef('pension_lel_year', 'Qualifying earnings lower limit (£ a year)'), ef('pension_uel_year', 'Qualifying earnings upper limit (£ a year)'),
        fld('Accrual account code', (eF.accrual_account = inp(est.accrual_account)), 'The single credit line'), fld('Accrual line wording', (eF.accrual_label = inp(est.accrual_label)))),
      h('label', { class: 'row small', style: { gap: '8px', marginTop: '10px' } }, (eF.apply_pension = h('input', { type: 'checkbox', checked: est.apply_pension, disabled: !admin })), 'Include employer pension in the estimate'),
      admin ? h('button', { class: 'btn primary sm', style: { marginTop: '12px' }, onClick: () => save('estimate', { er_ni_rate: num(eF.er_ni_rate.value) ?? 15, er_ni_threshold_year: num(eF.er_ni_threshold_year.value) ?? 5000, er_pension_pct: num(eF.er_pension_pct.value) ?? 3, pension_trigger_year: num(eF.pension_trigger_year.value) ?? 10000, pension_lel_year: num(eF.pension_lel_year.value) ?? 6240, pension_uel_year: num(eF.pension_uel_year.value) ?? 50270, accrual_account: eF.accrual_account.value.trim() || '2200', accrual_label: eF.accrual_label.value.trim(), apply_pension: eF.apply_pension.checked }, 'Estimate rules saved') }, 'Save estimate rules') : null);
    clear(host).append(h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))' } }, payCard, escCard, leaveCard, jCard, estCard));
  }
  draw();
}

const TABS = [['pay', 'Pay, leave & journal'], ['access', 'Access & roles'], ['dashboard', 'Dashboard defaults'], ['brand', 'Branding & owner'], ['email', 'Email'], ['hr', 'HR letters'], ['ai', 'AI assistant']];
export async function render(root, params) {
  let tab = (params && params.tab) || 'pay';
  const head = h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Customise & settings'), h('p', null, ctx.can('manage_settings') ? 'Change how pay, access, the dashboard, emails and the AI work. Changes apply for everyone straight away.' : 'Read-only. The system owner can change these.')));
  const bar = h('div', { class: 'tabs' }), host = h('div');
  root.append(head, bar, host);
  async function show() {
    clear(bar).append(...TABS.map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onClick: () => { tab = k; show(); } }, t)));
    clear(host);
    try { await ({ pay: payTab, access: accessTab, dashboard: dashboardTab, brand: brandTab, email: emailTab, hr: hrTab, ai: aiTab }[tab])(host); } catch (e) { host.append(h('div', { class: 'notice err' }, e.message || String(e))); }
  }
  await show();
}
