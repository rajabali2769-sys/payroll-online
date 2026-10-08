// HR toolkit: case types, outcomes, letter templates and the shared bits used by the HR screens.
import { h, dmy } from './ui.js';
import { ctx, brand } from './ctx.js';

export const EMP_STATUS = [['active', 'Active'], ['suspended', 'Suspended'], ['terminated', 'Terminated']];
export const EMP_TYPES = [['permanent', 'Permanent'], ['temporary', 'Temporary'], ['cover', 'Cover']];
export const CASE_TYPES = ['Investigation', 'Disciplinary', 'Suspension', 'Grievance', 'Absence / attendance', 'Performance / capability', 'Probation', 'Complaint (client / colleague)', 'Other'];
export const CATEGORIES = ['Misconduct', 'Gross misconduct', 'Lateness / timekeeping', 'Unauthorised absence', 'Attendance (Bradford)', 'Health & safety', 'Conduct on client site', 'Theft / fraud', 'Bullying / harassment', 'Performance / standards', 'Right to work', 'Other'];
export const SEVERITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['gross', 'Gross misconduct']];
export const STAGES = [['open', 'Open'], ['investigation', 'Investigation'], ['hearing', 'Hearing / meeting'], ['outcome', 'Outcome issued'], ['appeal', 'Appeal'], ['closed', 'Closed']];
export const OUTCOMES = ['No further action', 'Informal advice / guidance', 'Verbal warning', 'First written warning', 'Final written warning', 'Dismissal', 'Dismissal (gross misconduct)', 'Grievance upheld', 'Grievance partly upheld', 'Grievance not upheld', 'Resolved informally', 'Withdrawn'];
export const stageName = (k) => (STAGES.find((s) => s[0] === k) || [k, k])[1];
export const statusName = (k) => (EMP_STATUS.find((s) => s[0] === k) || [k, k || 'Active'])[1];
export const typeName = (k) => (EMP_TYPES.find((s) => s[0] === k) || [k, k || 'Permanent'])[1];
export const sevName = (k) => (SEVERITY.find((s) => s[0] === k) || [k, k])[1];
export const isCover = (e) => e.employment_type === 'temporary' || e.employment_type === 'cover';

export const hrCfg = () => ({ cc: '', sender: 'HR Department', signoff: 'Yours sincerely', address: '', warning_months: { verbal: 6, first: 12, final: 12 }, ...(ctx.settings.hr || {}) });
export function warningFor(outcome) {
  const m = hrCfg().warning_months || {};
  if (/^verbal/i.test(outcome)) return { level: 'Verbal warning', months: +m.verbal || 6 };
  if (/^first written/i.test(outcome)) return { level: 'First written warning', months: +m.first || 12 };
  if (/^final written/i.test(outcome)) return { level: 'Final written warning', months: +m.final || 12 };
  return null;
}
export const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
export const today = () => new Date().toISOString().slice(0, 10);
export const daysTo = (iso) => (iso ? Math.round((Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000) : null);
export const rtwState = (iso) => { const d = daysTo(iso); if (d === null) return 'none'; if (d < 0) return 'expired'; if (d <= 30) return 'd30'; if (d <= 90) return 'd90'; return 'ok'; };
export const shiftText = (e) => [e.shift_days, e.shift_start ? `${String(e.shift_start).slice(0, 5)}–${String(e.shift_end || '').slice(0, 5)}` : ''].filter(Boolean).join(' ');
export const weeklyPay = (e) => Math.round((+e.weekly_hours || 0) * (+e.default_rate || 0) * 100) / 100;
export const activeWarning = (cases) => cases.filter((c) => c.warning_level && c.warning_expiry && c.warning_expiry >= today()).sort((a, b) => String(b.warning_expiry).localeCompare(String(a.warning_expiry)))[0] || null;

export const statusChip = (s) => h('span', { class: 'hpill s-' + (s || 'active') }, statusName(s || 'active'));
export const typeChip = (t) => h('span', { class: 'hpill t-' + (t || 'permanent') }, typeName(t || 'permanent'));
export const stageChip = (s) => h('span', { class: 'hpill g-' + s }, stageName(s));
export const sevChip = (s) => h('span', { class: 'hpill v-' + s }, sevName(s));
export function rtwChip(iso) {
  const st = rtwState(iso), d = daysTo(iso);
  if (st === 'none') return h('span', { class: 'muted small' }, '—');
  return h('span', { class: 'hpill r-' + st, title: st === 'expired' ? `Expired ${-d} day(s) ago` : `${d} day(s) left` }, dmy(iso));
}

// ---------- letters ----------
const T = (id, name, types, subject, body) => ({ id, name, types, subject, body });
export const DEFAULT_TEMPLATES = [
  T('inv_invite', 'Invitation to investigation meeting', ['Investigation', 'Disciplinary', 'Complaint (client / colleague)'], 'Invitation to an investigation meeting – {case_ref}',
`Dear {first_name},

I am writing to ask you to attend an investigation meeting on {meeting_date} at {meeting_time} at {meeting_place}.

The meeting is to look into the following concern:

{allegations}

This is an investigation meeting, not a disciplinary hearing. Its purpose is to establish the facts and to give you the opportunity to explain what happened. {investigator} will conduct the meeting and a note-taker may be present.

Please let me know as soon as possible if you are unable to attend at this time.

{signoff}

{sender}
{company}`),
  T('suspension', 'Confirmation of suspension (on full pay)', ['Suspension', 'Investigation', 'Disciplinary'], 'Confirmation of suspension – {case_ref}',
`Dear {first_name},

I am writing to confirm that you are suspended from work on full pay with effect from {suspended_from}, while an investigation takes place into the following:

{allegations}

Suspension is not a disciplinary action and does not mean that any decision has been made. It is a neutral act to allow the investigation to be carried out fairly.

During your suspension you must not attend any Crystal FM or client site, or contact colleagues or client staff about this matter, unless we have agreed this with you first. You must remain available during your normal working hours ({shift}) to attend meetings.

We will keep the suspension under review and keep it as short as possible. If you have any questions, please contact {sender}.

{signoff}

{sender}
{company}`),
  T('hearing_invite', 'Invitation to disciplinary hearing', ['Disciplinary', 'Investigation'], 'Invitation to a disciplinary hearing – {case_ref}',
`Dear {first_name},

Following the investigation, I am writing to ask you to attend a disciplinary hearing on {meeting_date} at {meeting_time} at {meeting_place}.

The hearing will consider the following allegation(s):

{allegations}

Copies of the evidence that will be considered at the hearing are enclosed. If proven, the allegation(s) may result in disciplinary action up to and including {possible_outcome}.

You have the right to be accompanied by a work colleague or a trade union representative. Please tell me the name of your companion before the hearing.

If you cannot attend, please contact me straight away so that we can arrange an alternative date.

{signoff}

{sender}
{company}`),
  T('outcome_nfa', 'Outcome – no further action', ['Investigation', 'Disciplinary', 'Complaint (client / colleague)'], 'Outcome of investigation – {case_ref}',
`Dear {first_name},

Thank you for your cooperation with our recent investigation into:

{allegations}

Having considered all of the information, I can confirm that no further formal action will be taken. {outcome_notes}

{lift_suspension}

{signoff}

{sender}
{company}`),
  T('warn_verbal', 'Verbal warning (written record)', ['Disciplinary', 'Absence / attendance', 'Performance / capability'], 'Record of verbal warning – {case_ref}',
`Dear {first_name},

This letter confirms the verbal warning given to you on {today} following the meeting about:

{allegations}

{outcome_notes}

This warning will remain on your file for {warning_months} months, until {warning_expiry}. Any further misconduct during this time may lead to further disciplinary action.

You have the right to appeal against this decision. If you wish to appeal, please write to {sender} within {appeal_days} working days of receiving this letter, setting out your reasons.

{signoff}

{sender}
{company}`),
  T('warn_first', 'First written warning', ['Disciplinary', 'Absence / attendance', 'Performance / capability'], 'First written warning – {case_ref}',
`Dear {first_name},

Further to the disciplinary hearing held on {meeting_date}, I am writing to confirm the outcome.

The hearing considered the following:

{allegations}

Having considered all the evidence and your explanation, I have decided to issue you with a first written warning. {outcome_notes}

This warning will remain on your file for {warning_months} months, until {warning_expiry}. You are expected to make an immediate and sustained improvement. Any further misconduct during this period may result in a final written warning or other disciplinary action.

You have the right to appeal. If you wish to appeal, please write to {sender} within {appeal_days} working days of receiving this letter, giving your reasons.

{signoff}

{sender}
{company}`),
  T('warn_final', 'Final written warning', ['Disciplinary', 'Absence / attendance', 'Performance / capability'], 'Final written warning – {case_ref}',
`Dear {first_name},

Further to the disciplinary hearing held on {meeting_date}, I am writing to confirm that you have been issued with a final written warning.

The hearing considered the following:

{allegations}

{outcome_notes}

This final written warning will remain on your file for {warning_months} months, until {warning_expiry}. Any further misconduct during this period is likely to result in your dismissal.

You have the right to appeal. If you wish to appeal, please write to {sender} within {appeal_days} working days of receiving this letter, giving your reasons.

{signoff}

{sender}
{company}`),
  T('dismissal', 'Dismissal outcome', ['Disciplinary'], 'Outcome of disciplinary hearing – {case_ref}',
`Dear {first_name},

Further to the disciplinary hearing held on {meeting_date}, I am writing to confirm the outcome.

The hearing considered the following:

{allegations}

{outcome_notes}

Having carefully considered all of the evidence, I have decided that your employment will be terminated. Your last day of employment is {termination_date}. You will receive any pay due to you, including accrued but untaken holiday, in the next payroll.

You have the right to appeal against this decision. If you wish to appeal, please write to {sender} within {appeal_days} working days of receiving this letter, giving your reasons.

{signoff}

{sender}
{company}`),
  T('griev_ack', 'Grievance – acknowledgement and meeting', ['Grievance'], 'Your grievance – {case_ref}',
`Dear {first_name},

Thank you for raising your grievance, which we received on {opened_on}. I understand your concerns to be:

{allegations}

I would like to invite you to a grievance meeting on {meeting_date} at {meeting_time} at {meeting_place}, so that you can explain your grievance fully and tell us how you would like it to be resolved.

You have the right to be accompanied by a work colleague or a trade union representative.

{signoff}

{sender}
{company}`),
  T('griev_outcome', 'Grievance – outcome', ['Grievance'], 'Outcome of your grievance – {case_ref}',
`Dear {first_name},

Thank you for attending the grievance meeting on {meeting_date}. I have now considered your grievance about:

{allegations}

Outcome: {outcome}

{outcome_notes}

If you are not satisfied with this outcome, you may appeal by writing to {sender} within {appeal_days} working days of receiving this letter.

{signoff}

{sender}
{company}`),
  T('absence', 'Attendance concern meeting', ['Absence / attendance'], 'Attendance review meeting – {case_ref}',
`Dear {first_name},

I am writing to ask you to attend an attendance review meeting on {meeting_date} at {meeting_time} at {meeting_place}.

Your recent absence record has reached a level that we need to discuss with you:

{allegations}

The purpose of the meeting is to understand the reasons for your absence, to see whether there is any support we can give, and to agree the standard of attendance expected going forward.

You may be accompanied by a work colleague or a trade union representative.

{signoff}

{sender}
{company}`),
  T('rtw_expiry', 'Right to work – document expiry reminder', ['Other'], 'Your right to work documents – action needed',
`Dear {first_name},

Our records show that your right to work documents ({rtw_type}) expire on {rtw_expiry}.

To continue working for {company} we must see your updated documents, or a valid share code, before this date. Please send these to the HR department as soon as possible.

If you have any questions, please contact {sender}.

{signoff}

{sender}
{company}`),
];
export const ESCALATION_TEMPLATE = {
  subject: 'HR case escalation – {case_ref} – {employee_name} ({project})',
  body: `Hi {manager_first},

I am escalating the following HR case for your attention:

Case reference: {case_ref}
Employee: {employee_name}
Project / site: {project}
Case type: {case_type} ({category})
Severity: {severity}
Incident date: {incident_date}
Current stage: {stage}

Summary:
{summary}

{allegations}

Action needed from you: {action_needed}

Please treat this as confidential and reply to HR with any information or questions.

Thank you,
{sender}`,
};
export const templates = () => { const t = hrCfg().templates; return Array.isArray(t) && t.length ? t : DEFAULT_TEMPLATES; };

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
export function letterVars(c, emp, extra = {}) {
  const H = hrCfg(), w = c && c.warning_level ? c : null;
  const months = w && w.warning_expiry && c.closed_on ? Math.round((Date.parse(w.warning_expiry) - Date.parse(c.closed_on)) / (30.44 * 86400000)) : '';
  return {
    first_name: String((emp && emp.full_name) || (c && c.employee_name) || '').trim().split(/\s+/)[0] || 'Sir/Madam',
    employee_name: (emp && emp.full_name) || (c && c.employee_name) || '',
    job_title: (emp && emp.job_title) || 'Cleaning Operative',
    project: (c && c.project_name) || (emp && emp.default_project) || '',
    case_ref: (c && c.case_ref) || '', case_type: (c && c.case_type) || '', category: (c && c.category) || '', severity: c ? sevName(c.severity) : '', stage: c ? stageName(c.stage) : '',
    summary: (c && c.summary) || '', allegations: (c && (c.details || c.summary)) || '',
    incident_date: dmy(c && c.incident_date) || 'not recorded', opened_on: dmy(c && c.opened_on),
    meeting_date: c && c.meeting_at ? dmy(String(c.meeting_at).slice(0, 10)) : '[date]', meeting_time: c && c.meeting_at ? timeOf(c.meeting_at) : '[time]', meeting_place: (c && c.meeting_place) || '[place]',
    investigator: (c && c.investigator) || 'A manager', outcome: (c && c.outcome) || '', outcome_notes: '',
    warning_expiry: dmy(c && c.warning_expiry) || '[expiry date]', warning_months: months || '[months]', appeal_days: '5', possible_outcome: c && c.severity === 'gross' ? 'dismissal without notice' : 'a final written warning',
    suspended_from: dmy((emp && emp.suspended_from) || today()), shift: emp ? shiftText(emp) || 'your normal shift' : 'your normal shift',
    termination_date: dmy((emp && emp.termination_date) || today()), hire_date: dmy(emp && emp.hire_date),
    rtw_type: (emp && emp.rtw_type) || 'right to work document', rtw_expiry: dmy(emp && emp.rtw_expiry) || '[date]',
    lift_suspension: emp && emp.emp_status === 'suspended' ? 'Your suspension is lifted and you should return to work on your next scheduled shift.' : '',
    manager_first: String((c && c.manager_name) || 'there').split(/\s+/)[0], action_needed: 'Please review and confirm next steps.',
    today: dmy(today()), company: brand().company === 'Crystal FM' ? 'Crystal Facilities Management Ltd' : brand().company,
    sender: H.sender || (ctx.me && ctx.me.email) || 'HR', signoff: H.signoff || 'Yours sincerely', ...extra,
  };
}
export const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m)).replace(/\n{3,}/g, '\n\n');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Letter as HTML (email body and printable page)
export function letterHtml({ subject, body, to, address }, forPrint) {
  const B = brand(), H = hrCfg();
  const head = `<div style="border-bottom:3px solid ${B.accent1 || '#6c5ce7'};padding-bottom:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end"><div><div style="font-size:20px;font-weight:bold;color:#14222b">${esc(B.company === 'Crystal FM' ? 'Crystal Facilities Management Ltd' : B.company)}</div><div style="font-size:12px;color:#61727b;white-space:pre-line">${esc(H.address || '')}</div></div><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#b4332f;font-weight:bold">Private &amp; confidential</div></div>`;
  const meta = `<p style="margin:0 0 4px">${esc(to || '')}</p>${address ? `<p style="margin:0 0 4px;white-space:pre-line;color:#444">${esc(address)}</p>` : ''}<p style="margin:12px 0">${esc(dmy(today()))}</p><p style="margin:0 0 14px"><b>${esc(subject)}</b></p>`;
  const txt = `<div style="white-space:pre-wrap">${esc(body)}</div>`;
  const inner = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#14222b;max-width:680px">${head}${meta}${txt}</div>`;
  return forPrint ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(subject)}</title><style>@page{margin:20mm}body{margin:0}</style></head><body>${inner}<script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>` : inner;
}
export function printLetter(l) {
  const w = window.open('', '_blank'); if (!w) throw new Error('Allow pop-ups for this site to print letters.');
  w.document.open(); w.document.write(letterHtml(l, true)); w.document.close();
}
