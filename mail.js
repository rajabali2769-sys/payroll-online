// Pure helpers for the emails the system sends: payslips, timesheet reminders and hours reports.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = (n) => (+n < 0 ? '-' : '') + '£' + Math.abs(+n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
export const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };
export const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || 'there';
export const fillTemplate = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
export const textToHtml = (text) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1b1f3a">' + esc(text).replace(/\n/g, '<br>') + '</div>';
export const maskNI = (ni) => (ni ? String(ni).replace(/^(.{2}).*(.{3})$/, '$1 ** ** $2') : '');

// ---- the earnings statement an employee receives ----
// p = a provider-report row; extra = { hours, rate } from payroll (optional); run = {label, period_start, period_end}
export function payslipLines(p) {
  const other = r2(p.net - p.ee_pension - p.student_loan - p.attachment + p.expenses - p.takehome);
  const rows = [['Income tax', p.tax], ['Employee National Insurance', p.ee_nic], ['Employee pension', p.ee_pension], ['Student / postgraduate loan', p.student_loan], ['Attachment of earnings', p.attachment], ['Other deductions', other]];
  return rows.filter(([, v]) => Math.abs(+v) >= 0.005).map(([label, v]) => ({ label, amount: r2(v) }));
}
export function payslipHtml({ p, run, extra = {}, company = 'Crystal Facilities Management', footer = '' }) {
  const ded = payslipLines(p), dedTotal = r2(ded.reduce((s, d) => s + d.amount, 0));
  const name = `${p.first_name || ''} ${p.surname || ''}`.trim();
  const td = 'padding:7px 10px;border-bottom:1px solid #e6e9f2;';
  const row = (a, b, bold) => `<tr><td style="${td}${bold ? 'font-weight:bold;' : ''}">${esc(a)}</td><td style="${td}text-align:right;${bold ? 'font-weight:bold;' : ''}">${b}</td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1b1f3a">
<div style="background:linear-gradient(135deg,#6c5ce7,#2563eb);color:#fff;padding:18px 20px;border-radius:12px 12px 0 0"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(company)}</div><div style="font-size:20px;font-weight:bold;margin-top:2px">Earnings statement</div><div style="opacity:.9;font-size:13px">${esc(run.label || '')}${run.period_start ? ' · ' + fmtDate(run.period_start) + ' – ' + fmtDate(run.period_end) : ''}</div></div>
<div style="border:1px solid #e6e9f2;border-top:0;border-radius:0 0 12px 12px;padding:16px 20px">
<p style="margin:0 0 4px"><b>${esc(name)}</b></p><p style="margin:0 0 14px;color:#6a7392;font-size:13px">${p.ni_number ? 'NI number: ' + esc(maskNI(p.ni_number)) + ' · ' : ''}${esc(p.department || '')}</p>
${extra.hours ? `<p style="margin:0 0 12px;font-size:13px;color:#6a7392">Hours worked: <b style="color:#1b1f3a">${r2(extra.hours)}</b>${extra.rate ? ' at ' + gbp(extra.rate) + ' an hour' : ''}</p>` : ''}
<table style="width:100%;border-collapse:collapse;font-size:14px">${row('Gross pay', gbp(p.gross), true)}${p.statutory ? row('   of which statutory pay (e.g. SSP)', gbp(p.statutory)) : ''}
<tr><td colspan="2" style="padding:12px 10px 4px;color:#6a7392;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Deductions</td></tr>
${ded.length ? ded.map((d) => row(d.label, '-' + gbp(d.amount).replace('-', ''))).join('') : row('No deductions', gbp(0))}
${row('Total deductions', '-' + gbp(dedTotal).replace('-', ''), true)}${p.expenses ? row('Expenses paid', gbp(p.expenses)) : ''}
<tr><td style="padding:12px 10px;background:#f1f4ff;font-weight:bold;font-size:16px">Take-home pay</td><td style="padding:12px 10px;background:#f1f4ff;text-align:right;font-weight:bold;font-size:16px">${gbp(p.takehome)}</td></tr></table>
<p style="font-size:12px;color:#6a7392;margin:14px 0 0">${esc(footer || 'This is a summary of your pay for this period. If anything looks wrong, please reply to this email and we will check it.')}</p></div></div>`;
}

// ---- reminder to an employee who has not sent a timesheet ----
export const DEFAULT_REMINDER = {
  subject: 'Timesheet needed – week commencing {week}',
  body: `Hi {first_name},\n\nWe haven't received your timesheet for the week commencing {week}{site_part}.\n\nPlease send it back to us as soon as you can, and by {deadline} at the latest, so that we can pay you correctly and on time. Without it we may not be able to include those hours in this payroll.\n\nIf you have already sent it, or you did not work that week, please reply and let us know.\n\nThank you,\n{sender}`,
};
export function reminderMessage(tpl, { name, week, site, deadline, sender }) {
  const vars = { first_name: firstName(name), week: fmtDate(week), site_part: site ? ` (${site})` : '', deadline: deadline || 'the deadline', sender: sender || 'The payroll team' };
  const t = { ...DEFAULT_REMINDER, ...(tpl || {}) };
  const text = fillTemplate(t.body, vars);
  return { subject: fillTemplate(t.subject, vars), text, html: textToHtml(text) };
}

// ---- an hours report as an email + CSV ----
export function reportHtml({ title, subtitle, headers, rows, totals, note }) {
  const th = 'padding:7px 9px;background:#eef1fb;text-align:left;font-size:12px;border-bottom:1px solid #d8dded';
  const td = 'padding:6px 9px;border-bottom:1px solid #eef1f7;font-size:13px';
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1b1f3a;max-width:760px"><h2 style="margin:0 0 4px">${esc(title)}</h2><p style="margin:0 0 12px;color:#6a7392">${esc(subtitle || '')}</p>
<table style="border-collapse:collapse;width:100%"><thead><tr>${headers.map((h, i) => `<th style="${th}${i ? ';text-align:right' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map((c, i) => `<td style="${td}${i ? ';text-align:right' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}
${totals ? `<tr>${totals.map((c, i) => `<td style="${td};font-weight:bold;background:#f6f7fd${i ? ';text-align:right' : ''}">${esc(c)}</td>`).join('')}</tr>` : ''}</tbody></table>${note ? `<p style="color:#6a7392;font-size:12px;margin-top:10px">${esc(note)}</p>` : ''}</div>`;
}
export const csvText = (rows) => '\ufeff' + rows.map((r) => r.map((v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
export const toBase64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
export const parseEmails = (s) => [...new Set(String(s || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
export const EMAIL_OK = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
