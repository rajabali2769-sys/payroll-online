// "Budget is over -> one click -> email the point of contact (area manager) and log that it was done."
import { loadProjects, addEscalation, saveProjectContact, loadEscalations, sendEmails } from './api.js';
import { textToHtml, parseEmails, EMAIL_OK } from './mail.js';
import { h, modal, money, toast, dmy, ago, icon } from './ui.js';
import { ctx, escalationCfg } from './ctx.js';
import { normKey } from './parsers.js';

export const pocFor = (project, projects) => {
  const p = projects.find((x) => x.name_key === normKey(project));
  return { project: p || null, name: p?.manager || '', email: p?.manager_email || escalationCfg().default_email || '' };
};

export function summarise(lines, ps) {
  const gross = lines.reduce((s, l) => s + (+l.gross_pay || 0), 0), budget = lines.reduce((s, l) => s + (+l.budgeted_pay || 0), 0);
  const bh = lines.reduce((s, l) => s + (+l.window_budget_hours || 0), 0), wh = lines.reduce((s, l) => s + (+l.window_worked_hours || 0), 0), dh = lines.reduce((s, l) => s + (+l.hours_difference || 0), 0);
  const over = lines.filter((l) => l.budget_status === 'Over').sort((a, b) => +b.hours_difference - +a.hours_difference);
  // over budget = more HOURS worked than the weekly hours budget (money is only shown for information)
  if (ps) { const b2 = +ps.budget_hours, w2 = +ps.worked_hours, d2 = +ps.hours_difference; return { gross, budget, diff: gross - budget, pct: budget ? ((gross - budget) / budget) * 100 : 0, bh: b2, wh: w2, dh: d2, hpct: b2 ? (d2 / b2) * 100 : 0, over }; }   // the project's own weekly hours budget
  return { gross, budget, diff: gross - budget, pct: budget ? ((gross - budget) / budget) * 100 : 0, bh, wh, dh, hpct: bh ? (dh / bh) * 100 : 0, over };
}

export async function openEscalate({ run, project, lines, onSent, pstat }) {
  const [projects, history] = await Promise.all([loadProjects(), loadEscalations(run.id).catch(() => [])]);
  const poc = pocFor(project, projects), S = summarise(lines, pstat), cfg = escalationCfg();
  const me = (ctx.me && (ctx.me.full_name || ctx.me.email.split('@')[0])) || 'Payroll team';
  const first = (poc.name || 'there').split(' ')[0];
  const hh = (n) => (Math.round(n * 100) / 100).toString();
  const body0 = `Hi ${first},\n\nThe ${run.label} payroll for ${project} is over its hours budget.\n\n` +
    `Hours budget:  ${hh(S.bh)} h\nHours worked:  ${hh(S.wh)} h\nOver by:  ${hh(S.dh)} h${S.bh ? ` (${S.hpct.toFixed(1)}%)` : ''}\nCost so far (for information):  ${money(S.gross)}\n\n` +
    (S.over.length ? `Biggest overspends in hours:\n${S.over.slice(0, 6).map((l) => `• ${l.employee_name}${l.site_name ? ' (' + l.site_name + ')' : ''}: ${hh(+l.hours_difference)} h over`).join('\n')}\n\n` : '') +
    `Please review the hours and let me know whether this should be challenged, or approved, before payroll is submitted.\n\nThanks,\n${me}`;
  const prior = history.filter((e) => normKey(e.project_name) === normKey(project));

  modal(`Escalate ${project}`, (close) => {
    const to = h('input', { type: 'email', value: poc.email, placeholder: 'area.manager@company.com' });
    const cc = h('input', { type: 'email', value: cfg.cc || '', placeholder: 'optional' });
    const subject = h('input', { type: 'text', value: `Hours over budget: ${project} – ${run.label} (${hh(S.dh)} h over)` });
    const body = h('textarea', { rows: 13, style: { fontFamily: 'inherit' } }, body0);
    const remember = h('input', { type: 'checkbox', checked: !poc.project?.manager_email });
    const err = h('div', { class: 'notice err hidden' });

    const log = async (how) => {
      if (!to.value.trim()) { err.textContent = 'Add the email address of the point of contact first.'; err.classList.remove('hidden'); return false; }
      try {
        await addEscalation({ run_id: run.id, project_name: project, sent_to: to.value.trim(), cc: cc.value.trim() || null, subject: subject.value, body: body.value, over_amount: Math.round(S.dh * 100) / 100, unit: 'hours',
          budget: Math.round(S.bh * 100) / 100, actual: Math.round(S.wh * 100) / 100, sent_by_email: ctx.me?.email || null });
        if (remember.checked && poc.project && to.value.trim() !== poc.project.manager_email) { try { await saveProjectContact(poc.project.id, { manager_email: to.value.trim() }); } catch { /* not allowed - fine */ } }
        toast(how === 'mail' ? 'Escalation logged — finish sending in your email app' : 'Escalation logged', 'ok');
        onSent && onSent();
        return true;
      } catch (e) { err.textContent = e.message || String(e); err.classList.remove('hidden'); return false; }
    };
    return h('div', { class: 'stack' },
      poc.name || poc.email ? h('div', { class: 'poc', style: { border: 0, padding: 0 } }, h('span', { class: 'avatar' }, (poc.name || poc.email)[0].toUpperCase()), h('div', null, h('b', null, poc.name || 'Point of contact'), h('div', { class: 'small muted' }, poc.email || 'no email saved yet')))
        : h('div', { class: 'notice warn' }, 'No point of contact is saved for this project yet. Type their email below and tick the box to remember it (you can manage them under Projects & POCs).'),
      prior.length ? h('div', { class: 'small muted' }, `Already escalated ${prior.length}× — last ${ago(prior[0].created_at)} to ${prior[0].sent_to}.`) : null,
      h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, 'To', to), h('label', { class: 'fld' }, 'CC', cc)),
      h('label', { class: 'fld' }, 'Subject', subject), h('label', { class: 'fld' }, 'Message', body),
      h('label', { class: 'row small', style: { gap: '6px' } }, remember, 'Remember this email as the point of contact for this project'),
      err,
      h('div', { class: 'row wrap', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onClick: close }, 'Cancel'),
        h('button', { class: 'btn', title: 'Use this if you sent it another way', onClick: async () => { if (await log('log')) close(); } }, 'Just log it'),
        h('button', { class: 'btn', onClick: async () => { try { await navigator.clipboard.writeText(`${subject.value}\n\n${body.value}`); toast('Message copied', 'ok'); } catch { toast('Could not copy', 'err'); } } }, 'Copy'),
        ctx.can('send_emails') ? h('button', { class: 'btn good', title: 'Sends the email straight from the system (needs email set up in Customise → Email)', onClick: async () => {
          const rcpt = parseEmails(to.value + ' ' + cc.value); if (!rcpt.length || rcpt.some((r) => !EMAIL_OK.test(r))) { err.textContent = 'Check the email addresses.'; err.classList.remove('hidden'); return; }
          try { const r = await sendEmails('escalation', rcpt.map((a) => ({ to: a, subject: subject.value, html: textToHtml(body.value) })), { run_id: run.id, reply_to: ctx.me && ctx.me.email });
            if (!r.sent) { err.textContent = (r.results[0] && r.results[0].error) || 'Not sent'; err.classList.remove('hidden'); return; }
            if (await log('sent')) { toast(`Escalation emailed to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`, 'ok'); close(); } } catch (e) { err.textContent = e.message || String(e); err.classList.remove('hidden'); } } }, icon('mail'), 'Send now') : null,
        h('button', { class: 'btn warn', onClick: async () => {
          if (!(await log('mail'))) return;
          const text = body.value.length > 1500 ? body.value.slice(0, 1450) + '\n\n(…full detail in Payroll Online)' : body.value;
          const href = `mailto:${encodeURIComponent(to.value.trim())}?${cc.value.trim() ? 'cc=' + encodeURIComponent(cc.value.trim()) + '&' : ''}subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(text)}`;
          window.__lastMailto = href;
          const a = h('a', { href, style: { display: 'none' } }); document.body.append(a); a.click(); a.remove();   // a link click opens the mail app without leaving this page
          close();
        } }, '✉ Email the area manager')));
  }, { wide: true });
}
