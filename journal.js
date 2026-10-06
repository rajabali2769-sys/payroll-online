// Manual journal: import the payroll provider (BP) report → reconcile to payroll → build the Xero journal → export.
import { loadProvider, replaceProvider, loadJournalExtra, addJournalExtra, deleteJournalExtra, loadJournalExports, logJournalExport, loadRunData } from './api.js';
import { parseProviderRows, buildJournal, buildEstimatedJournal, journalToRows, reconcileProvider, DEFAULT_JOURNAL, DEFAULT_ESTIMATE } from './timesheet.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { h, clear, money, hrs, ago, toast, icon, downloadCSV, modal } from './ui.js';
import { ctx, currentRun, runPicker, journalCfg } from './ctx.js';

export async function render(root) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file first.')); return; }
  const S = { provider: [], extra: [], exports: [], lines: [], candidates: null, file: null, showRec: false, source: 'provider', loaded: false };
  const host = h('div', { class: 'stack' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Manual journal'), h('p', null, 'Build the Xero manual journal for this pay run from the payroll provider’s report, check it balances, and export it.')), runPicker(() => location.reload())), host);

  async function load() {
    [S.provider, S.extra, S.exports] = await Promise.all([loadProvider(run.id).catch(() => []), loadJournalExtra(run.id).catch(() => []), loadJournalExports(run.id).catch(() => [])]);
    if (!S.lines.length) S.lines = (await loadRunData(run.id)).lines;
    if (!S.provider.length && !S.loaded) S.source = 'hours';
    S.loaded = true;
    draw();
  }
  const rows = () => S.provider.map((p) => ({ ...p, gross: +p.gross, net: +p.net, takehome: +p.takehome, tax: +p.tax, ee_nic: +p.ee_nic, er_nic: +p.er_nic, ee_pension: +p.ee_pension, er_pension: +p.er_pension, statutory: +p.statutory, student_loan: +p.student_loan, attachment: +p.attachment, expenses: +p.expenses }));
  const cfg = () => ({ ...DEFAULT_JOURNAL, ...journalCfg(), accounts: { ...DEFAULT_JOURNAL.accounts, ...(journalCfg().accounts || {}) }, labels: { ...DEFAULT_JOURNAL.labels, ...(journalCfg().labels || {}) } });

  async function readProvider(file) {
    const XLSX = await loadXLSX(); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const hidden = new Map((wb.Workbook?.Sheets || []).map((s) => [s.name, s.Hidden]));
    const found = [];
    for (const name of wb.SheetNames) { const r = parseProviderRows(sheetRows(XLSX, wb.Sheets[name])); if (r && r.length) found.push({ name, rows: r, hidden: !!hidden.get(name), gross: r.reduce((s, x) => s + x.gross, 0), use: !hidden.get(name) && /^bp/i.test(name) }); }
    if (!found.length) throw new Error('No payroll provider report found in this file. It needs columns like Department, Name, Surname, Gross pay, Net pay, Tax, Employer NICs …');
    if (!found.some((f) => f.use)) { const first = found.find((f) => !f.hidden) || found[0]; first.use = true; }
    S.candidates = found; S.file = file; draw();
  }

  function importCard() {
    const drop = h('div', { class: 'drop', style: { padding: '22px' }, onClick: () => inp.click() }, h('b', null, S.provider.length ? 'Replace the provider report' : 'Drop the payroll provider (BP) report here'), h('div', { class: 'muted' }, 'The workbook with a sheet like “BP Aug” — Department, Name, Surname, Gross pay, Net pay, Tax, NICs, pensions …'));
    const inp = h('input', { type: 'file', accept: '.xlsx,.xls', class: 'hidden', onChange: async (e) => { if (e.target.files[0]) { try { await readProvider(e.target.files[0]); } catch (er) { toast(er.message, 'err'); } } } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { try { await readProvider(e.dataTransfer.files[0]); } catch (er) { toast(er.message, 'err'); } } });
    const tot = S.provider.reduce((s, p) => s + +p.gross, 0);
    return h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '1'), h('h3', { style: { margin: 0 } }, 'Payroll provider report'), h('div', { class: 'grow' }),
      S.provider.length ? h('span', { class: 'flag ok' }, `${S.provider.length} payslips · ${money(tot)} gross`) : h('span', { class: 'flag warn' }, 'not imported yet')),
      drop, inp,
      S.candidates ? h('div', { class: 'notice', style: { marginTop: '12px' } }, h('b', null, 'Choose the sheets to use:'), S.candidates.map((c) => h('label', { class: 'row small', style: { gap: '8px', margin: '6px 0' } }, h('input', { type: 'checkbox', checked: c.use, onChange: (e) => { c.use = e.target.checked; } }), `${c.name}${c.hidden ? ' (hidden)' : ''} — ${c.rows.length} people, ${money(c.gross)} gross`)),
        h('button', { class: 'btn primary sm', onClick: async () => { const use = S.candidates.filter((c) => c.use); if (!use.length) return toast('Tick at least one sheet', 'err');
          try { await replaceProvider(run.id, use.flatMap((c) => c.rows), S.file.name); S.candidates = null; S.lines = []; toast('Provider report imported', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } } }, 'Use these sheets')) : null);
  }

  function recCard() {
    if (!S.provider.length) return null;
    const rec = reconcileProvider(rows(), S.lines), diffs = rec.filter((r) => Math.abs(r.diff) > 0.5), onlyP = rec.filter((r) => !r.inPayroll), onlyO = rec.filter((r) => r.missingFromProvider);
    const pg = rows().reduce((s, r) => s + r.gross, 0), og = S.lines.reduce((s, l) => s + (+l.gross_pay || 0), 0);
    return h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '2'), h('h3', { style: { margin: 0 } }, 'Check: provider report vs payroll'), h('div', { class: 'grow' }), h('button', { class: 'btn sm', onClick: () => { S.showRec = !S.showRec; draw(); } }, S.showRec ? 'Hide' : 'Show differences')),
      h('div', { class: 'balance' }, h('div', { class: 'bx' }, h('span', { class: 'small muted' }, 'Provider gross'), h('b', null, money(pg))), h('div', { class: 'bx' }, h('span', { class: 'small muted' }, 'Payroll Online gross'), h('b', null, money(og))),
        h('div', { class: 'bx ' + (Math.abs(og - pg) < 1 ? 'ok' : 'bad') }, h('span', { class: 'small muted' }, 'Difference'), h('b', null, money(og - pg)))),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${diffs.length} people differ by more than 50p · ${onlyP.length} are in the provider report but not in payroll · ${onlyO.length} are in payroll but not in the provider report (matched on NI number).`),
      S.showRec ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { class: 'grow' }), h('button', { class: 'btn sm', onClick: () => downloadCSV(`provider_vs_payroll_${run.label.replace(/\W+/g, '_')}.csv`, [['Name', 'NI', 'Provider gross', 'Payroll gross', 'Difference'], ...rec.map((r) => [r.name, r.ni || '', r.provider, r.payroll, r.diff])]) }, icon('download'), 'Export CSV')),
        h('div', { class: 'tablewrap auto', style: { maxHeight: '320px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Name', 'NI', 'Provider', 'Payroll', 'Difference', ''].map((t, i) => h('th', { class: i > 1 && i < 5 ? 'num' : '' }, t)))),
          h('tbody', null, diffs.slice(0, 60).map((r) => h('tr', null, h('td', null, r.name), h('td', null, r.ni || h('span', { class: 'flag warn' }, 'no NI')), h('td', { class: 'num' }, money(r.provider)), h('td', { class: 'num' }, money(r.payroll)), h('td', { class: 'num ' + (r.diff > 0 ? 'neg' : 'pos') }, money(r.diff)),
            h('td', null, !r.inPayroll ? h('span', { class: 'flag bad' }, 'not in payroll') : r.missingFromProvider ? h('span', { class: 'flag warn' }, 'not in provider report') : '')))))) ) : null);
  }

  function journalCard() {
    const est = S.source === 'hours';
    if (!est && !S.provider.length) return null;
    const c = cfg(), j = est ? buildEstimatedJournal(S.lines, run.stream, ctx.settings.estimate || {}, c, S.extra) : buildJournal(rows(), c, S.extra);
    const addLine = (d = {}) => modal('Add a journal line', (close) => {
      const desc = h('input', { type: 'text', value: d.description || '' }), acc = h('input', { type: 'text', value: d.account || c.accounts.net }), proj = h('input', { type: 'text', value: d.project || '', placeholder: 'optional' });
      const dbt = h('input', { type: 'number', step: 'any', value: d.debit || '' }), crd = h('input', { type: 'number', step: 'any', value: d.credit || '' }), tax = h('input', { type: 'text', value: c.tax_rate });
      return h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, 'Description', desc), h('label', { class: 'fld' }, 'Account code', acc), h('label', { class: 'fld' }, 'Project', proj), h('label', { class: 'fld' }, 'Tax rate', tax), h('label', { class: 'fld' }, 'Debit £', dbt), h('label', { class: 'fld' }, 'Credit £', crd)),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          if (!desc.value.trim() || !acc.value.trim() || (!+dbt.value && !+crd.value)) return toast('Add a description, an account and an amount', 'err');
          try { await addJournalExtra({ run_id: run.id, description: desc.value.trim(), account: acc.value.trim(), tax_rate: tax.value.trim() || 'No VAT', project: proj.value.trim() || null, debit: +dbt.value || 0, credit: +crd.value || 0 }); close(); await load(); } catch (e) { toast(e.message, 'err'); } } }, 'Add line')));
    });
    const exportIt = async (kind) => {
      const aoa = journalToRows(j), XLSX = kind === 'xlsx' ? await loadXLSX() : null, base = `Manual_Journal_${run.label.replace(/\W+/g, '_')}`;
      if (kind === 'xlsx') { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [34, 10, 10, 46, 8, 14, 14].map((w) => ({ wch: w })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'MJ'); XLSX.writeFile(wb, base + '.xlsx'); }
      else downloadCSV(base + '.csv', aoa);
      try { await logJournalExport({ run_id: run.id, file_name: base + '.' + kind, lines: j.lines.length, total_debit: j.debit, total_credit: j.credit, by_email: ctx.me?.email || null }); S.exports = await loadJournalExports(run.id); } catch { /* not critical */ }
      toast('Journal exported', 'ok'); draw();
    };
    return h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '3'), h('h3', { style: { margin: 0 } }, est ? 'Journal — estimated from your hours' : 'Journal — from the provider report'), h('div', { class: 'grow' }), h('button', { class: 'btn sm', onClick: () => addLine() }, icon('plus'), 'Add a line')),
      est ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, `Estimate. Wages come from the gross pay in Payroll Online. Employer NI (${(ctx.settings.estimate || DEFAULT_ESTIMATE).er_ni_rate ?? 15}% above the threshold) and employer pension (${(ctx.settings.estimate || DEFAULT_ESTIMATE).er_pension_pct ?? 3}% of qualifying earnings) are worked out per person from the rules in Customise → Pay, leave & journal. The credit side is one accrual line. Replace it with the exact journal once the payroll provider has run.`) : null,
      h('div', { class: 'balance' }, h('div', { class: 'bx' }, h('span', { class: 'small muted' }, 'Total debits'), h('b', null, money(j.debit))), h('div', { class: 'bx' }, h('span', { class: 'small muted' }, 'Total credits'), h('b', null, money(j.credit))),
        h('div', { class: 'bx ' + (j.balanced ? 'ok' : 'bad') }, h('span', { class: 'small muted' }, j.balanced ? 'Balanced ✓' : 'Out of balance'), h('b', null, money(j.credit - j.debit)))),
      !j.balanced ? h('div', { class: 'notice warn', style: { marginTop: '12px' } }, h('b', null, `The journal is ${money(Math.abs(j.difference))} ${j.difference > 0 ? 'short on the credit side' : 'short on the debit side'}.`),
        j.unexplained.length ? [' ', `${j.unexplained.length} payslip${j.unexplained.length === 1 ? ' has' : 's have'} a take-home that does not tie to net pay − pension − loans − attachments: `, j.unexplained.slice(0, 5).map((u) => `${u.name} (${u.department}, ${money(u.diff)})`).join('; '), '. That is usually a deduction (e.g. a loan or advance) the report does not itemise.'] : null,
        h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn sm warn', onClick: () => addLine({ description: 'Other deductions (take-home not itemised)', account: c.accounts.net, credit: j.difference > 0 ? Math.abs(j.difference) : 0, debit: j.difference < 0 ? Math.abs(j.difference) : 0 }) }, 'Add a balancing line'))) : null,
      h('div', { class: 'tablewrap', style: { marginTop: '12px', maxHeight: '420px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Description', 'Account', 'Tax Rate', 'Project', 'Debit GBP', 'Credit GBP', ''].map((t, i) => h('th', { class: i > 3 && i < 6 ? 'num' : '' }, t)))),
        h('tbody', null, j.lines.map((l) => h('tr', null, h('td', null, l.description, l.auto ? '' : h('span', { class: 'flag warn', style: { marginLeft: '6px' } }, 'manual')), h('td', null, l.account), h('td', null, l.tax_rate), h('td', { class: 'muted' }, l.project || ''), h('td', { class: 'num' }, l.debit ? money(l.debit) : ''), h('td', { class: 'num' }, l.credit ? money(l.credit) : ''),
          h('td', null, l.auto ? null : h('button', { class: 'btn sm danger', onClick: async () => { try { await deleteJournalExtra(l.id); await load(); } catch (e) { toast(e.message, 'err'); } } }, '×')))),
        ), h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td'), h('td'), h('td'), h('td', { class: 'num' }, money(j.debit)), h('td', { class: 'num' }, money(j.credit)), h('td'))))),
      h('div', { class: 'row wrap', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onClick: () => exportIt('xlsx') }, icon('download'), 'Download Excel (Xero layout)'), h('button', { class: 'btn', onClick: () => exportIt('csv') }, 'Download CSV'),
        h('div', { class: 'grow' }), S.exports.length ? h('span', { class: 'small muted' }, `Last exported ${ago(S.exports[0].created_at)}${S.exports[0].by_email ? ' by ' + S.exports[0].by_email.split('@')[0] : ''}`) : h('span', { class: 'small muted' }, 'Not exported yet')),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, est ? 'Wages = gross pay − SSP, per project · employer NI and pension estimated per person · one accrual credit so it balances. Accounts and wording come from Settings.' : 'Wages = gross − statutory pay, per project · Employer NI and pensions per project · credits: net wages (take-home), PAYE (tax + employee and employer NI + loans), pensions, attachment orders. Accounts and wording come from Settings.'));
  }

  function sourceBar() {
    return h('div', { class: 'card pad', style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' } }, h('b', null, 'Build the journal from'),
      h('div', { class: 'seg' }, h('button', { class: S.source === 'provider' ? 'on' : '', onClick: () => { S.source = 'provider'; draw(); } }, 'Payroll provider report (exact)'), h('button', { class: S.source === 'hours' ? 'on' : '', onClick: () => { S.source = 'hours'; draw(); } }, 'Our own hours (estimate)')),
      h('span', { class: 'small muted' }, S.source === 'hours' ? 'No provider report needed — made straight from the hours and pay in this payroll.' : 'Uses the BrightPay report for exact tax, NI and net pay.'));
  }
  function draw() { clear(host).append(sourceBar(), S.source === 'provider' ? importCard() : null, S.source === 'provider' ? recCard() : null, journalCard()); }
  await load();
}
