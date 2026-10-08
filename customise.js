// The customisation centre: access & roles, dashboard defaults, branding, email wording, AI. (Opened from the Settings page.)
import { loadRolePerms, saveRolePerm, saveSetting, loadSettings, sendEmails, aiChat } from './api.js';
import { h, clear, toast, icon } from './ui.js';
import { ctx, brand, BRAND_DEFAULTS } from './ctx.js';
import { PAGE_LIST, applyBranding } from './app.js';
import { DEFAULT_REMINDER } from './mail.js';
import { WIDGETS } from './widgets.js';

export const ACTIONS = [
  ['edit_payroll', 'Edit payroll, hours, leave and timesheets', 'Enforced by the database'], ['approve_lock', 'Approve and lock a pay run', 'Enforced by the database'], ['unlock', 'Unlock a locked pay run', 'Enforced by the database'],
  ['delete_run', 'Delete a pay run', 'Enforced by the database'], ['manage_settings', 'Change settings and customisation', 'Enforced by the database'], ['manage_users', 'Manage users and roles', 'Enforced by the database'],
  ['send_emails', 'Send emails (reminders, reports, escalations)', 'Enforced by the email function'], ['send_payslips', 'Send payslips to employees', 'Enforced by the email function'],
  ['manage_hr', 'Edit employee HR records, open HR cases, send HR letters', 'Enforced by the database and email function'], ['recruit_add', 'Add temporary / cover new starters (recruitment)', 'Enforced by the database'], ['move_to_payroll', 'Move new starters into a payroll', 'Screen setting (also needs “Edit payroll”)'],
  ['use_ai_timesheet', 'Read timesheets with AI', 'Enforced by the AI function'], ['use_chatbot', 'Use the AI chat assistant', 'Enforced by the AI function'], ['import_data', 'Import Excel / upload hours', 'Screen setting'], ['manage_journal', 'Build and export the manual journal', 'Screen setting'],
];
const ROLES = [['admin', 'Admin (your team)'], ['editor', 'Editor'], ['viewer', 'Viewer'], ['hr', 'HR team'], ['recruitment', 'Recruitment']];
const canChange = () => ctx.can('manage_settings');
const saveSet = async (key, value, msg = 'Saved') => { try { await saveSetting(key, value); ctx.settings = await loadSettings(); toast(msg, 'ok'); } catch (e) { toast(e.message, 'err'); } };

export async function accessTab(host) {
  const rows = await loadRolePerms().catch(() => []), has = (role, perm) => !!(rows.find((r) => r.role === role && r.perm === perm) || {}).allowed;
  const sup = ctx.isSuper, cell = (role, perm) => h('td', null, h('input', { type: 'checkbox', checked: has(role, perm), disabled: !sup, onChange: async (e) => { try { await saveRolePerm(role, perm, e.target.checked); const r = rows.find((x) => x.role === role && x.perm === perm); if (r) r.allowed = e.target.checked; else rows.push({ role, perm, allowed: e.target.checked }); toast('Saved', 'ok'); } catch (er) { toast(er.message, 'err'); e.target.checked = !e.target.checked; } } }));
  const sub = (t) => h('tr', { class: 'sub' }, h('td', { colspan: ROLES.length + 2 }, t));
  clear(host).append(
    h('div', { class: 'notice', style: { marginBottom: '12px' } }, sup ? 'You are the super admin: you always have every permission, and you decide what each other role can see and do. Changes apply the next time that person opens the app.' : 'Only the super admin can change this. You can see what each role may do.'),
    h('div', { class: 'tablewrap auto matrix' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Permission'), h('th', null, 'Super admin'), ROLES.map(([, t]) => h('th', null, t)))),
      h('tbody', null, sub('Pages & reports each role can see (hidden from the menu when switched off)'),
        PAGE_LIST.map((p) => h('tr', null, h('td', null, `${p.title}`, h('span', { class: 'small muted' }, ` · ${p.group}`)), h('td', null, h('input', { type: 'checkbox', checked: true, disabled: true })), ROLES.map(([r]) => cell(r, p.perm)))),
        sub('What each role can do'),
        ACTIONS.map(([perm, title, how]) => h('tr', null, h('td', null, title, h('div', { class: 'small muted' }, how)), h('td', null, h('input', { type: 'checkbox', checked: true, disabled: true })), ROLES.map(([r]) => cell(r, perm))))))),
    h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Employees (the Employee app) have no staff permissions at all — they can only ever see their own hours and published payslips. Give people their role on the Users & roles page.'));
}

export async function dashboardTab(host) {
  const d = ctx.settings.dashboard_defaults || {}, can = canChange(), draw = () => clear(host).append(
    h('div', { class: 'notice', style: { marginBottom: '12px' } }, 'Choose what each role sees on its dashboard by default. Anyone can still customise their own dashboard with the “Customise” button on the Dashboard.'),
    h('div', { class: 'tablewrap auto matrix' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Dashboard section'), ROLES.map(([, t]) => h('th', null, t)))),
      h('tbody', null, WIDGETS.map((w) => h('tr', null, h('td', null, h('b', null, w.title), h('div', { class: 'small muted' }, w.desc)), ROLES.map(([r]) => h('td', null, h('input', { type: 'checkbox', checked: !((d[r] || {}).hidden || []).includes(w.id), disabled: !can, onChange: async (e) => {
        const hid = new Set((d[r] || {}).hidden || []); e.target.checked ? hid.delete(w.id) : hid.add(w.id); d[r] = { hidden: [...hid] }; await saveSet('dashboard_defaults', d); } })))))))));
  draw();
}

export async function brandTab(host) {
  const B = brand(), can = canChange(), f = {};
  const inp = (k, label, o = {}) => h('label', { class: 'fld' }, label, (f[k] = h('input', { type: o.type || 'text', value: B[k] ?? '', disabled: !can, ...o })));
  clear(host).append(h('div', { class: 'card pad' }, h('h3', null, 'Name, owner and colours'),
    h('div', { class: 'set-grid' }, inp('app_name', 'System name'), inp('company', 'Company name'), inp('owner_name', 'System owner'), inp('owner_title', 'Owner’s job title'), inp('accent1', 'Main colour', { type: 'color' }), inp('accent2', 'Second colour', { type: 'color' })),
    h('label', { class: 'fld', style: { marginTop: '12px' } }, 'Pop-up message when someone signs in (leave empty for the standard one)', (f.popup_text = h('textarea', { rows: 3, disabled: !can }, B.popup_text || ''))),
    h('label', { class: 'row small', style: { gap: '8px', marginTop: '10px' } }, (f.popup = h('input', { type: 'checkbox', checked: B.popup !== false, disabled: !can })), 'Show the “system owner” pop-up once each time someone signs in'),
    can ? h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onClick: async () => { const v = { app_name: f.app_name.value.trim() || BRAND_DEFAULTS.app_name, company: f.company.value.trim(), owner_name: f.owner_name.value.trim(), owner_title: f.owner_title.value.trim(), accent1: f.accent1.value, accent2: f.accent2.value, popup_text: f.popup_text.value.trim(), popup: f.popup.checked };
      await saveSet('branding', v, 'Branding saved'); applyBranding(); } }, 'Save branding'), h('button', { class: 'btn', onClick: () => { Object.entries(BRAND_DEFAULTS).forEach(([k, v]) => { if (f[k] && k !== 'popup') f[k].value = v; }); } }, 'Reset to the standard look')) : null));
}

export async function emailTab(host) {
  const E = ctx.settings.email || {}, R = { ...DEFAULT_REMINDER, ...(E.reminder || {}) }, can = canChange();
  const subj = h('input', { type: 'text', value: R.subject, disabled: !can }), body = h('textarea', { rows: 9, disabled: !can }, R.body), dl = h('input', { type: 'text', value: E.deadline_text || 'the end of tomorrow', disabled: !can }), pf = h('textarea', { rows: 2, disabled: !can }, E.payslip_footer || '');
  clear(host).append(
    h('div', { class: 'card pad', style: { marginBottom: '14px' } }, h('h3', null, 'Sending email from the system'),
      h('ol', { style: { margin: '0 0 10px', paddingLeft: '18px', lineHeight: 1.7 } }, h('li', null, 'Create a free account at resend.com and verify your company’s email domain.'), h('li', null, 'In Resend, create an API key.'),
        h('li', null, 'In Supabase: Edge Functions → create a function called ', h('b', null, 'send-email'), ' and paste in the code from the file send-email.ts.'), h('li', null, 'Supabase → Edge Functions → Secrets: add RESEND_API_KEY and MAIL_FROM (for example “Crystal FM Payroll <payroll@yourdomain.co.uk>”).'), h('li', null, 'Press the test button below.')),
      h('button', { class: 'btn', onClick: async () => { try { const r = await sendEmails('other', [{ to: ctx.me.email, subject: 'Test email from ' + brand().app_name, html: '<p>If you can read this, email sending is working. ✅</p>' }]); toast(r.sent ? `Test email sent to ${ctx.me.email}` : (r.results[0] && r.results[0].error) || 'Not sent', r.sent ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } }, icon('mail'), 'Send a test email to me')),
    h('div', { class: 'card pad' }, h('h3', null, 'Wording of the timesheet reminder'),
      h('label', { class: 'fld' }, 'Subject', subj), h('label', { class: 'fld', style: { marginTop: '10px' } }, 'Message', body), h('label', { class: 'fld', style: { marginTop: '10px' } }, 'Deadline wording', dl),
      h('div', { class: 'small muted', style: { margin: '4px 0 10px' } }, 'Placeholders: {first_name} {week} {site_part} {deadline} {sender}'),
      h('label', { class: 'fld' }, 'Footer line on payslip emails (optional)', pf),
      can ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onClick: () => saveSet('email', { ...E, reminder: { subject: subj.value, body: body.value }, deadline_text: dl.value.trim(), payslip_footer: pf.value.trim() }, 'Email wording saved') }, 'Save wording'), h('button', { class: 'btn', onClick: () => { subj.value = DEFAULT_REMINDER.subject; body.value = DEFAULT_REMINDER.body; } }, 'Reset to the standard wording')) : null));
}

export async function aiTab(host) {
  const A = ctx.settings.ai || {}, can = canChange();
  const chat = h('input', { type: 'checkbox', checked: A.chatbot !== false, disabled: !can }), auto = h('input', { type: 'checkbox', checked: !!A.auto_read, disabled: !can }), out = h('div', { class: 'small muted', style: { marginTop: '8px' } });
  clear(host).append(h('div', { class: 'card pad' }, h('h3', null, 'AI assistant and AI timesheet reading'),
    h('ol', { style: { margin: '0 0 10px', paddingLeft: '18px', lineHeight: 1.7 } }, h('li', null, 'Create an API key at console.anthropic.com (add a little credit).'), h('li', null, 'In Supabase: Edge Functions → create a function called ', h('b', null, 'ai'), ' and paste in the code from the file ai.ts.'), h('li', null, 'Supabase → Edge Functions → Secrets: add ANTHROPIC_API_KEY.'), h('li', null, 'Press the test button below.')),
    h('label', { class: 'row small', style: { gap: '8px' } }, chat, 'Show the ✨ chat assistant (answers questions from your data; read-only)'),
    h('label', { class: 'row small', style: { gap: '8px', margin: '8px 0' } }, auto, 'Read every uploaded timesheet photo/PDF with AI automatically (each read uses a little credit)'),
    h('div', { class: 'row wrap' }, can ? h('button', { class: 'btn primary', onClick: () => saveSet('ai', { chatbot: chat.checked, auto_read: auto.checked }, 'AI settings saved') }, 'Save') : null,
      h('button', { class: 'btn', onClick: async () => { out.textContent = 'Testing…'; try { const r = await aiChat([{ role: 'user', content: 'Reply with the single word OK.' }], null); out.textContent = '✓ The AI replied: ' + r.answer; } catch (e) { out.textContent = '✗ ' + e.message; } } }, 'Test the AI connection')), out,
    h('div', { class: 'notice warn', style: { marginTop: '12px' } }, 'The assistant only reads data through your own login, so it can never show someone more than their role allows. Photos of timesheets are sent to the AI provider to be read; they contain names and hours.')));
}
