// Upload hours from scratch: name + NI number + project + date + hours (and leave). Creates a new pay run or adds to an open one.
import { createRun, commitEntries, loadRuns } from './api.js';
import { parseHoursRows, HOURS_TEMPLATE_HEADERS } from './timesheet.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { h, clear, hrs, dmy, toast, icon } from './ui.js';
import { ctx, setRun } from './ctx.js';

export async function render(root) {
  const open = ctx.runs.filter((r) => r.status !== 'locked');
  const S = { target: open.length ? 'new' : 'new', runId: open[0]?.id || '', stream: 'monthly', label: '', parsed: null, file: null };
  const host = h('div', { class: 'stack' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Upload hours'), h('p', null, 'Start a pay run from a simple spreadsheet — hours against name, NI number and project — without needing the old Excel.'))), host);

  async function downloadTemplate() {
    const XLSX = await loadXLSX();
    const ex = [['Jane Smith', 'AB123456C', 'Thurston Community College', 'Main site', '17/08/2026', 5, '', 13, 'Hourly', '26th'], ['Jane Smith', 'AB123456C', 'Thurston Community College', 'Main site', '18/08/2026', 5, '', '', '', ''],
      ['Jane Smith', 'AB123456C', 'Thurston Community College', 'Main site', '19/08/2026', 5, 'AL', '', '', ''], ['Sam Jones', 'ZY987654D', 'Thurston Community College', '', '17/08/2026', 6, '', 13, 'Cover', '']];
    const ws = XLSX.utils.aoa_to_sheet([HOURS_TEMPLATE_HEADERS, ...ex]); ws['!cols'] = [24, 14, 30, 18, 12, 10, 10, 12, 8, 12, 12, 12, 14, 10].map((w) => ({ wch: w }));
    const help = [['How to fill this in'], [''], ['One row per person per day. Leave blank any column marked optional.'], ['Employee Name', 'Required'], ['NI Number', 'Optional but recommended (matches people across projects and the payroll provider report)'], ['Project', 'Required — as it appears in Payroll Online'], ['Site', 'Optional'],
      ['Date', 'Required — dd/mm/yyyy'], ['Time In / Time Out', 'Either fill these in (e.g. 08:30 and 16:30) and the hours are worked out for you…'], ['Break (mins)', 'Optional — unpaid break taken off the hours'], ['Hours', '…or type the hours worked that day (0 to 24)'], ['Ad-hoc Hours', 'Optional — extra hours charged to the client. Paid, but never counted against the budget'], ['Leave Type', 'Optional — put a leave code here and the Hours column becomes the leave hours. Codes below.'], ['Hourly Rate', 'Optional — needed for new people'], ['Contract Type', 'Optional — Hourly, Cover or Fixed'], ['Pay Date', 'Optional — 24th, 25th, 26th, 28th, 29th, 5th or LWD'], [''], ['Leave codes'], ...ctx.leaveTypes.map((t) => [t.code, `${t.name}${t.ssp ? ' (SSP, paid per day)' : t.paid ? ' (paid)' : ' (unpaid)'}`])];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Hours'); const w2 = XLSX.utils.aoa_to_sheet(help); w2['!cols'] = [{ wch: 18 }, { wch: 90 }]; XLSX.utils.book_append_sheet(wb, w2, 'How to fill');
    XLSX.writeFile(wb, 'Payroll_Online_hours_template.xlsx');
  }

  async function readFile(file) {
    const XLSX = await loadXLSX(); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const name = wb.SheetNames.find((n) => /^hours$/i.test(n.trim())) || wb.SheetNames[0];
    const p = parseHoursRows(sheetRows(XLSX, wb.Sheets[name]));
    const codes = new Map(ctx.leaveTypes.flatMap((t) => [[t.code.toLowerCase(), t.code], [t.name.toLowerCase(), t.code]]));
    for (const l of p.lines) l.leave = l.leave.filter((v) => { const c = codes.get(v.type.toLowerCase()); if (!c) { p.errors.push({ row: 0, name: l.employee_name, text: `leave type "${v.type}" is not one of your leave types — skipped` }); return false; } v.type = c; return true; });
    S.parsed = p; S.file = file; draw();
  }

  function draw() {
    const p = S.parsed, newRun = S.target === 'new';
    const drop = h('div', { class: 'drop', onClick: () => inp.click() }, h('div', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>' }), h('b', null, S.file ? S.file.name : 'Drop your filled-in hours file here'), h('div', { class: 'muted' }, 'Excel or CSV'));
    const inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hidden', onChange: async (e) => { if (e.target.files[0]) { try { await readFile(e.target.files[0]); } catch (er) { S.parsed = null; draw(); toast(er.message, 'err'); } } } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { try { await readFile(e.dataTransfer.files[0]); } catch (er) { toast(er.message, 'err'); } } });
    const label = h('input', { type: 'text', value: S.label || `Hours upload ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, onInput: (e) => { S.label = e.target.value; } });
    const prog = h('div', { class: 'progress hidden' }, h('i')), status = h('div', { class: 'small muted' });
    const go = h('button', { class: 'btn primary', disabled: !p || !p.lines.length, onClick: async () => {
      go.disabled = true; prog.classList.remove('hidden');
      try {
        let run;
        if (newRun) { const name = (S.label || label.value).trim() || label.value.trim(); if (!name) throw new Error('Name the new pay run'); run = await createRun({ stream: S.stream, label: name, period_start: p.period_start, period_end: p.period_end }); }
        else run = ctx.runs.find((r) => r.id === S.runId);
        if (!run) throw new Error('Choose a pay run');
        const entries = p.lines.map((l) => ({ project: l.project, site: l.site, employee_name: l.employee_name, ni: l.ni, rate: l.rate, contract_type: l.contract_type, pay_group: l.pay_group, days: l.days, leave: l.leave, adhoc: l.adhoc }));
        const res = await commitEntries(run, entries, (x, t) => { prog.firstChild.style.width = Math.round(x * 100) + '%'; status.textContent = t; });
        ctx.runs = await loadRuns(); setRun(run.id);
        clear(host).append(h('div', { class: 'card pad' }, h('div', { class: 'notice' }, `Done. ${res.created} new people added and ${res.updated} updated in “${run.label}” — ${res.days} days of hours ${res.adhoc ? ', ' + res.adhoc + ' ad-hoc days' : ''} and ${res.leave} leave days written.`), h('div', { class: 'row', style: { marginTop: '12px' } }, h('a', { class: 'btn primary', href: '#/payroll' }, 'Open payroll →'), h('a', { class: 'btn', href: '#/dashboard' }, 'Dashboard'))));
      } catch (e) { go.disabled = false; prog.classList.add('hidden'); toast(e.message || String(e), 'err'); }
    } }, icon('upload'), 'Import into payroll');

    clear(host).append(
      h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '1'), h('h3', { style: { margin: 0 } }, 'Where should the hours go?')),
        h('div', { class: 'row wrap', style: { alignItems: 'flex-end' } },
          h('div', { class: 'seg' }, h('button', { class: newRun ? 'on' : '', onClick: () => { S.target = 'new'; draw(); } }, 'A new pay run'), h('button', { class: !newRun ? 'on' : '', disabled: !open.length, onClick: () => { S.target = 'existing'; draw(); } }, 'An open pay run')),
          newRun ? [h('label', { class: 'fld' }, 'Type', h('select', { onChange: (e) => { S.stream = e.target.value; } }, h('option', { value: 'monthly', selected: S.stream === 'monthly' }, 'Monthly'), h('option', { value: 'fortnightly', selected: S.stream === 'fortnightly' }, 'Fortnightly'))), h('label', { class: 'fld w2' }, 'Name', label)]
            : h('label', { class: 'fld w2' }, 'Pay run', h('select', { onChange: (e) => { S.runId = e.target.value; } }, open.map((r) => h('option', { value: r.id, selected: r.id === S.runId }, `${r.label}${r.status === 'approved' ? ' (approved — importing withdraws the approval)' : ''}`)))))),
      h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '2'), h('h3', { style: { margin: 0 } }, 'Get the template'), h('div', { class: 'grow' }), h('button', { class: 'btn', onClick: downloadTemplate }, icon('download'), 'Download template')),
        h('div', { class: 'small muted' }, `Columns: ${HOURS_TEMPLATE_HEADERS.join(' · ')}. One row per person per day. Put a leave code in “Leave Type” for leave days.`)),
      h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '3'), h('h3', { style: { margin: 0 } }, 'Upload your file')), drop, inp,
        p ? h('div', { style: { marginTop: '14px' } },
          h('div', { class: 'row wrap', style: { gap: '22px', marginBottom: '8px' } }, [['People / lines', p.lines.length], ['Rows read', p.rowsRead], ['Hours', hrs(p.totalHours)], ['Ad-hoc hours', hrs(p.adhocHours || 0)], ['Leave days', p.lines.reduce((s, l) => s + l.leave.length, 0)], ['Dates', p.period_start ? `${dmy(p.period_start)} – ${dmy(p.period_end)}` : '–']].map(([a, b]) => h('div', null, h('div', { class: 'small muted' }, a), h('b', { style: { fontSize: '18px' } }, String(b))))),
          p.errors.length ? h('div', { class: 'notice warn' }, `${p.errors.length} row${p.errors.length === 1 ? '' : 's'} will be skipped:`, h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, p.errors.slice(0, 15).map((e) => h('li', null, e.row ? `Row ${e.row}: ` : '', e.name ? e.name + ' — ' : '', e.text)))) : h('div', { class: 'notice' }, '✓ Every row was understood.'),
          p.lines.length ? h('div', { class: 'tablewrap auto', style: { marginTop: '10px', maxHeight: '260px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'NI', 'Project', 'Site', 'Days', 'Hours', 'Leave'].map((t, i) => h('th', { class: i > 3 ? 'num' : '' }, t)))),
            h('tbody', null, p.lines.slice(0, 40).map((l) => h('tr', null, h('td', null, l.employee_name), h('td', null, l.ni || h('span', { class: 'flag warn' }, 'no NI')), h('td', null, l.project), h('td', null, l.site || ''), h('td', { class: 'num' }, l.days.length), h('td', { class: 'num' }, hrs(l.days.reduce((s, d) => s + d.hours, 0))), h('td', { class: 'num' }, l.leave.length || '')))))) : null) : null),
      h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '4'), h('h3', { style: { margin: 0 } }, 'Import'), h('div', { class: 'grow' }), go), prog, status));
  }
  draw();
}
