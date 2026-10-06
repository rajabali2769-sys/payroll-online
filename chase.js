// Chase timesheets: who has not sent a timesheet / has no hours for a week, and email them a reminder.
import { loadRunData, loadTimesheets, loadEmployeesAll, loadEmailLog, sendEmails, setEmployeeEmail, saveContacts, onLive } from './api.js';
import { reminderMessage, DEFAULT_REMINDER, EMAIL_OK, fmtDate } from './mail.js';
import { h, clear, hrs, dmy, ago, toast, modal, addDays, confirmBox, icon } from './ui.js';
import { ctx, currentRun, runPicker, runEditable } from './ctx.js';
import { normKey } from './parsers.js';

export async function render(root) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file or start a pay run first.')); return; }
  let lines = [], wk = new Map(), sheets = [], emps = [], log = [], week = '', sel = new Set();
  const host = h('div'), tplS = { ...DEFAULT_REMINDER, ...((ctx.settings.email || {}).reminder || {}) };
  const deadline = h('input', { type: 'text', value: (ctx.settings.email || {}).deadline_text || 'the end of tomorrow', style: { width: '210px' } });
  const sender = h('input', { type: 'text', value: (ctx.me && (ctx.me.full_name || '')) || 'The payroll team', style: { width: '180px' } });
  const subj = h('input', { type: 'text', value: tplS.subject }), body = h('textarea', { rows: 9 }, tplS.body);
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Chase timesheets'), h('p', null, 'See who has no timesheet or hours for a week, and email them a reminder in one click. Each person gets their own email.')), runPicker(() => location.reload())), host);

  const weeks = () => [...new Set([...wk.values()].flat().map((w) => String(w.week_start).slice(0, 10)))].sort();
  function missing() {
    const have = new Set(); for (const t of sheets.filter((x) => String(x.week_start).slice(0, 10) === week)) for (const e of t.entries || []) if (e.employee) have.add(normKey(e.employee));
    const people = new Map();
    for (const l of lines) {
      const w = (wk.get(l.id) || []).find((x) => String(x.week_start).slice(0, 10) === week); if (!w || !(+w.budget > 0)) continue;
      if (+w.delivered + +w.leave > 0 || have.has(normKey(l.employee_name))) continue;
      const k = l.ni_number || 'n:' + normKey(l.employee_name), p = people.get(k) || { key: k, name: l.employee_name, ni: l.ni_number, projects: new Set(), sites: new Set(), budget: 0 };
      p.projects.add(l.project_name); if (l.site_name) p.sites.add(l.site_name); p.budget += +w.budget; people.set(k, p);
    }
    return [...people.values()].map((p) => { const e = emps.find((x) => (p.ni && x.ni_number === p.ni) || x.name_key === normKey(p.name)); return { ...p, emp: e || null, email: e && e.email || '' }; }).sort((a, b) => a.name.localeCompare(b.name));
  }
  const lastReminded = (email) => { const r = log.find((x) => x.to_email && x.to_email.toLowerCase() === email.toLowerCase() && x.status === 'sent'); return r ? r.created_at : null; };
  function draw() {
    const list = missing(), can = runEditable(run.id) || ctx.can('send_emails');
    clear(host).append(
      h('div', { class: 'toolbar' }, h('label', { class: 'fld' }, 'Week commencing', h('select', { onChange: (e) => { week = e.target.value; sel.clear(); draw(); } }, weeks().map((w) => h('option', { value: w, selected: w === week }, 'w/c ' + dmy(w))))),
        h('div', { class: 'grow' }), h('span', { class: 'cn r' }, `${list.length} missing`), h('span', { class: 'cn g' }, `${list.filter((p) => p.email).length} with an email`)),
      list.length ? h('div', { class: 'tablewrap auto', style: { maxHeight: '46vh' } }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, h('input', { type: 'checkbox', checked: list.every((p) => sel.has(p.key)), onChange: (e) => { list.forEach((p) => (e.target.checked && p.email ? sel.add(p.key) : sel.delete(p.key))); draw(); } })), ['Employee', 'Project', 'Budget h', 'Email', 'Last reminded'].map((t, i) => h('th', { class: i === 2 ? 'num' : '' }, t)))),
        h('tbody', null, list.map((p) => { const em = h('input', { type: 'email', value: p.email, placeholder: 'add email', style: { width: '230px' } }, ''); em.value = p.email;
          em.addEventListener('change', async () => { const v = em.value.trim(); if (v && !EMAIL_OK.test(v)) return toast('That is not a valid email', 'err'); try { if (p.emp) await setEmployeeEmail(p.emp.id, v); else await saveContacts([{ name: p.name, ni: p.ni, email: v }]); emps = await loadEmployeesAll(); toast('Email saved', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } });
          const lr = p.email ? lastReminded(p.email) : null;
          return h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: sel.has(p.key), disabled: !p.email, onChange: (e) => { e.target.checked ? sel.add(p.key) : sel.delete(p.key); sendBtn.textContent = `Send ${sel.size} reminder${sel.size === 1 ? '' : 's'}`; } })), h('td', null, h('b', null, p.name), p.ni ? h('div', { class: 'small muted' }, p.ni) : null),
            h('td', { class: 'muted' }, [...p.projects].join(', ')), h('td', { class: 'num' }, hrs(p.budget)), h('td', null, em), h('td', { class: 'small muted' }, lr ? ago(lr) : '—')); })))) : h('div', { class: 'card empty' }, '✓ Everyone with a budget for this week has hours or a timesheet.'),
      h('div', { class: 'card pad', style: { marginTop: '14px' } }, h('h3', null, 'The reminder'),
        h('div', { class: 'row wrap', style: { alignItems: 'flex-end' } }, h('label', { class: 'fld' }, 'Deadline to mention', deadline), h('label', { class: 'fld' }, 'Signed by', sender)),
        h('label', { class: 'fld', style: { marginTop: '10px' } }, 'Subject', subj), h('label', { class: 'fld', style: { marginTop: '10px' } }, 'Message', body),
        h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'You can use {first_name}, {week}, {site_part}, {deadline} and {sender}. Keep it friendly: unpaid hours are still owed, so avoid threats — say the hours may be paid in the next payroll if the timesheet arrives late. Change the standard wording under Customise → Email.'),
        h('div', { class: 'row wrap', style: { marginTop: '12px' } }, h('button', { class: 'btn', onClick: () => preview(list) }, 'Preview'), h('div', { class: 'grow' }), can ? sendBtn : null)));
    sendBtn.textContent = `Send ${sel.size} reminder${sel.size === 1 ? '' : 's'}`;
  }
  const build = (p) => reminderMessage({ subject: subj.value, body: body.value }, { name: p.name, week, site: [...p.sites][0] || '', deadline: deadline.value, sender: sender.value });
  function preview(list) { const p = list.find((x) => sel.has(x.key)) || list[0]; if (!p) return toast('Nobody to preview', 'err'); const m = build(p); modal('Preview', (close) => h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `To: ${p.email || '(no email yet)'}`), h('b', null, m.subject), h('div', { class: 'card pad', html: m.html }), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onClick: close }, 'Close')))); }
  const sendBtn = h('button', { class: 'btn warn', onClick: async () => {
    const list = missing().filter((p) => sel.has(p.key) && p.email); if (!list.length) return toast('Tick at least one person who has an email', 'err');
    if (!(await confirmBox('Send reminders?', `${list.length} people will each get their own email asking for their timesheet for w/c ${fmtDate(week)}.`, 'Send now'))) return;
    sendBtn.disabled = true;
    try { const r = await sendEmails('timesheet_reminder', list.map((p) => { const m = build(p); return { to: p.email, subject: m.subject, html: m.html, text: m.text, employee_id: p.emp && p.emp.id }; }), { run_id: run.id, reply_to: ctx.me && ctx.me.email });
      toast(`${r.sent} sent${r.failed ? `, ${r.failed} failed (see the email log)` : ''}`, r.failed ? 'err' : 'ok'); sel.clear(); log = await loadEmailLog(run.id, 'timesheet_reminder').catch(() => []); draw(); }
    catch (e) { toast(e.message || String(e), 'err'); } finally { sendBtn.disabled = false; }
  } }, icon('mail'), 'Send 0 reminders');

  async function load() {
    const d = await loadRunData(run.id); lines = d.lines; wk = d.weeksByLine;
    [sheets, emps, log] = await Promise.all([loadTimesheets(run.id).catch(() => []), loadEmployeesAll().catch(() => []), loadEmailLog(run.id, 'timesheet_reminder').catch(() => [])]);
    const ws = weeks(), today = new Date().toISOString().slice(0, 10); week = week || [...ws].reverse().find((w) => w <= today) || ws[ws.length - 1] || ''; draw();
  }
  await load();
  return onLive((e) => { if (e.table === 'timesheets') loadTimesheets(run.id).then((s) => { sheets = s; draw(); }); });
}
