// Payslips: send each person their earnings statement (from the payroll provider report) by email, and publish it to the employee app.
import { loadProvider, loadRunData, loadEmployeesAll, loadEmailLog, sendEmails, saveContacts, setEmployeeEmail, setPayslipsPublished, loadRuns, onLive } from './api.js';
import { payslipHtml } from './mail.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { h, clear, money, ago, toast, modal, confirmBox, icon } from './ui.js';
import { ctx, currentRun, runPicker, brand } from './ctx.js';
import { normKey } from './parsers.js';
import { EMAIL_OK } from './mail.js';

export async function render(root) {
  const run0 = currentRun();
  if (!run0) { root.append(h('div', { class: 'card empty' }, 'Import a file or start a pay run first.')); return; }
  let prov = [], emps = [], lines = [], log = [], sel = new Set(), q = '';
  const run = () => ctx.runs.find((r) => r.id === run0.id) || run0;
  const host = h('div');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Payslips'), h('p', null, 'Email each person their pay summary, or publish it to the Employee app. Built from the payroll provider report you imported on the Manual journal page.')), runPicker(() => location.reload())), host);

  const keyOf = (p) => p.ni_number || 'n:' + normKey(`${p.first_name} ${p.surname}`);
  const empOf = (p) => emps.find((e) => (p.ni_number && e.ni_number === p.ni_number) || e.name_key === normKey(`${p.first_name} ${p.surname}`));
  const hoursOf = (p) => { const ls = lines.filter((l) => (p.ni_number && l.ni_number === p.ni_number) || normKey(l.employee_name) === normKey(`${p.first_name} ${p.surname}`)); const hrsT = ls.reduce((s, l) => s + (+l.actual_hours || 0) + (+l.leave_hours || 0), 0); return { hours: hrsT, rate: ls.length === 1 ? ls[0].hourly_rate : null }; };
  const num = (r) => ({ ...r, gross: +r.gross, net: +r.net, takehome: +r.takehome, tax: +r.tax, ee_nic: +r.ee_nic, ee_pension: +r.ee_pension, student_loan: +r.student_loan, attachment: +r.attachment, expenses: +r.expenses, statutory: +r.statutory });
  const html = (p) => payslipHtml({ p: num(p), run: run(), extra: hoursOf(p), company: brand().company, footer: (ctx.settings.email || {}).payslip_footer });
  const sentAt = (email) => { const r = log.find((x) => x.to_email && x.to_email.toLowerCase() === (email || '').toLowerCase() && x.status === 'sent'); return r ? r.created_at : null; };

  async function importContacts(file) {
    const XLSX = await loadXLSX(); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const rows = sheetRows(XLSX, wb.Sheets[wb.SheetNames[0]]);
    const hi = rows.findIndex((r) => (r || []).some((c) => /e-?mail/i.test(String(c)))); if (hi < 0) throw new Error('Could not find an “Email” column. The file needs columns like Name, NI Number, Email.');
    const hdr = rows[hi].map((c) => String(c || '').toLowerCase()), col = (re) => hdr.findIndex((c) => re.test(c)), iE = col(/e-?mail/), iN = col(/^(employee )?name|full name/), iF = col(/first/), iS = col(/surname|last/), iNI = col(/\bni\b|national/);
    const items = rows.slice(hi + 1).filter((r) => r && r[iE]).map((r) => ({ name: iN >= 0 ? String(r[iN] || '') : `${r[iF] || ''} ${r[iS] || ''}`.trim(), ni: iNI >= 0 ? r[iNI] : '', email: String(r[iE]).trim() })).filter((r) => EMAIL_OK.test(r.email));
    if (!items.length) throw new Error('No valid email addresses found in that file.');
    const res = await saveContacts(items); emps = await loadEmployeesAll(); toast(`Contacts saved: ${res.updated} updated, ${res.created} new, ${res.skipped} unchanged`, 'ok'); draw();
  }
  function draw() {
    const rows = prov.filter((p) => !q || `${p.first_name} ${p.surname} ${p.department}`.toLowerCase().includes(q));
    const withEmail = prov.filter((p) => (empOf(p) || {}).email).length, sent = prov.filter((p) => sentAt((empOf(p) || {}).email)).length, pub = !!run().payslips_published_at;
    const send = h('button', { class: 'btn primary', onClick: () => sendSelected() }, icon('mail'), `Email ${sel.size} payslip${sel.size === 1 ? '' : 's'}`);
    const fileIn = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hidden', onChange: async (e) => { if (e.target.files[0]) { try { await importContacts(e.target.files[0]); } catch (er) { toast(er.message, 'err'); } } e.target.value = ''; } });
    clear(host).append(
      !prov.length ? h('div', { class: 'card empty' }, h('h3', { style: { color: '#14222b' } }, 'No provider report for this pay run yet'), h('p', null, 'Import the payroll provider (BrightPay) report on the Manual journal page first. It holds each person’s tax, NI and net pay.'), h('a', { class: 'btn primary', href: '#/journal' }, 'Go to Manual journal')) : [
      h('div', { class: 'grid kpis', style: { marginBottom: '10px' } },
        [['Payslips', prov.length, 'kc-violet', 'file'], ['With an email', withEmail, 'kc-green', 'mail'], ['No email yet', prov.length - withEmail, 'kc-red', 'alert'], ['Already emailed', sent, 'kc-blue', 'check']].map(([l, v, c, ic]) => h('div', { class: 'card kpi c ' + c }, h('div', { class: 'kic' }, icon(ic)), h('div', { class: 'l' }, l), h('div', { class: 'v' }, String(v))))),
      h('div', { class: 'card pad', style: { marginBottom: '12px' } }, h('div', { class: 'row wrap' },
        h('div', { class: 'grow' }, h('b', null, 'Employee app'), h('div', { class: 'small muted' }, pub ? `Published ${ago(run().payslips_published_at)} — employees can see their payslip in the Employee app.` : 'Not published. Employees cannot see these payslips in the Employee app yet.')),
        h('button', { class: 'btn ' + (pub ? '' : 'good'), onClick: async () => { try { await setPayslipsPublished(run().id, !pub); ctx.runs = await loadRuns(); toast(pub ? 'Unpublished' : 'Published to the Employee app', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } } }, pub ? 'Unpublish' : 'Publish to the Employee app'))),
      h('div', { class: 'toolbar' }, h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', placeholder: 'Name or department', value: q, onInput: (e) => { q = e.target.value.toLowerCase(); draw(); } })), h('div', { class: 'grow' }),
        h('button', { class: 'btn', onClick: () => fileIn.click() }, icon('upload'), 'Import emails (Excel/CSV)'), fileIn, h('button', { class: 'btn', onClick: () => testSend() }, 'Send me a test'), send),
      h('div', { class: 'tablewrap', style: { maxHeight: '52vh' } }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, h('input', { type: 'checkbox', onChange: (e) => { rows.forEach((p) => { const em = (empOf(p) || {}).email; if (e.target.checked && em) sel.add(keyOf(p)); else sel.delete(keyOf(p)); }); draw(); } })), ['Employee', 'Department', 'Gross', 'Take-home', 'Email', 'Emailed', ''].map((t, i) => h('th', { class: i === 2 || i === 3 ? 'num' : '' }, t)))),
        h('tbody', null, rows.slice(0, 400).map((p) => { const e = empOf(p) || null; const em = h('input', { type: 'email', value: (e && e.email) || '', placeholder: 'add email', style: { width: '220px' } });
          em.addEventListener('change', async () => { const v = em.value.trim(); if (v && !EMAIL_OK.test(v)) return toast('That is not a valid email', 'err'); try { if (e) await setEmployeeEmail(e.id, v); else await saveContacts([{ name: `${p.first_name} ${p.surname}`, ni: p.ni_number, email: v }]); emps = await loadEmployeesAll(); draw(); } catch (er) { toast(er.message, 'err'); } });
          return h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: sel.has(keyOf(p)), disabled: !(e && e.email), onChange: (ev) => { ev.target.checked ? sel.add(keyOf(p)) : sel.delete(keyOf(p)); send.lastChild.textContent = `Email ${sel.size} payslip${sel.size === 1 ? '' : 's'}`; } })), h('td', null, `${p.first_name} ${p.surname}`), h('td', { class: 'muted' }, p.department), h('td', { class: 'num' }, money(p.gross)), h('td', { class: 'num' }, money(p.takehome)), h('td', null, em),
            h('td', { class: 'small muted' }, (e && sentAt(e.email)) ? ago(sentAt(e.email)) : '—'), h('td', null, h('button', { class: 'btn sm', onClick: () => preview(p) }, 'Preview'))); })))),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'This is an earnings statement built from your payroll provider’s report (gross, tax, NI, pension, net). The official payslip, with tax code and year-to-date figures, still comes from your payroll software. Names and NI numbers are masked in the email.')]);
  }
  const preview = (p) => modal(`Payslip — ${p.first_name} ${p.surname}`, (close) => h('div', { class: 'stack' }, h('div', { html: html(p) }), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onClick: close }, 'Close'))), { wide: true });
  const subject = () => `Your earnings statement – ${run().label}`;
  async function testSend() { const p = prov[0]; if (!p) return; try { const r = await sendEmails('payslip', [{ to: ctx.me.email, subject: '[TEST] ' + subject(), html: html(p) }], { run_id: run().id }); toast(r.sent ? `Test sent to ${ctx.me.email}` : (r.results[0] && r.results[0].error) || 'Test failed', r.sent ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } }
  async function sendSelected() {
    const list = prov.filter((p) => sel.has(keyOf(p)) && (empOf(p) || {}).email); if (!list.length) return toast('Tick at least one person who has an email', 'err');
    const again = list.filter((p) => sentAt(empOf(p).email)).length;
    if (!(await confirmBox('Email payslips?', `${list.length} people will each receive their own pay summary${again ? ` (${again} already received one for this run — they will get it again)` : ''}. Check your sending domain and recipient list first.`, 'Send now'))) return;
    let sent = 0, failed = 0;
    try { for (let i = 0; i < list.length; i += 50) { const batch = list.slice(i, i + 50); const r = await sendEmails('payslip', batch.map((p) => ({ to: empOf(p).email, subject: subject(), html: html(p), employee_id: empOf(p).id })), { run_id: run().id, reply_to: ctx.me.email }); sent += r.sent; failed += r.failed; }
      toast(`${sent} payslips sent${failed ? `, ${failed} failed (see the email log)` : ''}`, failed ? 'err' : 'ok'); sel.clear(); log = await loadEmailLog(run().id, 'payslip').catch(() => []); draw(); } catch (e) { toast(e.message || String(e), 'err'); }
  }
  async function load() { [prov, emps, lines, log] = await Promise.all([loadProvider(run0.id).catch(() => []), loadEmployeesAll().catch(() => []), loadRunData(run0.id).then((d) => d.lines).catch(() => []), loadEmailLog(run0.id, 'payslip').catch(() => [])]); draw(); }
  await load();
  return onLive((e) => { if (e.table === 'pay_runs') draw(); });
}
