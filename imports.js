import { importPayload, loadRuns } from './api.js';
import { parseWorkbook, detectFileKind } from './parsers.js';
import { calcLine } from './calc.js';
import { h, clear, money, hrs, dm, dmy, toast, icon, natCompare } from './ui.js';
import { ctx, setRun } from './ctx.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Could not load the Excel reader. Check your internet connection.')); document.head.append(s); });
}
const NEEDED = {
  monthly: ['Detailed', 'Projects'],
  fortnightly: ['Fortnightly TimeSheet Details', 'Projects', 'Account List', 'Col Type'],
};
async function readFile(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames;
  const kind = detectFileKind(XLSX, { SheetNames: names });
  if (!kind) throw new Error('This does not look like a monthly ("Detailed" sheet) or fortnightly ("Fortnightly TimeSheet Details" sheet) payroll file.');
  const want = names.filter((n) => NEEDED[kind].some((w) => w.toLowerCase() === n.trim().toLowerCase()));
  const wb = XLSX.read(buf, { type: 'array', sheets: want, cellFormula: false, cellStyles: false, cellNF: false, cellHTML: false });
  return parseWorkbook(XLSX, wb, file.name);
}

export async function render(root) {
  const list = h('div');
  const input = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls', multiple: true, class: 'hidden', onChange: (e) => handle([...e.target.files]) });
  const drop = h('div', { class: 'drop', onClick: () => input.click() },
    h('div', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>' }),
    h('div', null, h('b', null, 'Drop your payroll Excel files here'), h('div', { class: 'muted' }, 'or click to choose · monthly (.xlsm/.xlsx) and fortnightly files · you can add several at once')));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle([...e.dataTransfer.files]));
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Import files'), h('p', null, 'Add a month, a fortnight or a corrected file whenever you like. Nothing is stored until you press Import.'))), drop, input, list);

  async function handle(files) {
    for (const f of files) {
      const card = h('div', { class: 'card file-card' }, h('b', null, f.name), h('div', { class: 'muted' }, 'Reading the workbook…'));
      list.prepend(card);
      try { await showPreview(card, f, await readFile(f)); }
      catch (e) { console.error(e); clear(card).append(h('b', null, f.name), h('div', { class: 'notice err', style: { marginTop: '8px' } }, e.message || String(e))); }
    }
    input.value = '';
  }

  async function showPreview(card, file, p) {
    const calc = p.lines.map((l) => ({ l, r: calcLine(l, p.stream) }));
    const gross = calc.reduce((s, x) => s + x.r.gross, 0), xl = p.lines.reduce((s, l) => s + (l.check.gross ?? 0), 0);
    const grossDiffs = calc.filter(({ l, r }) => l.check.gross != null && Math.abs(r.gross - l.check.gross) > 0.011);
    const budgetDiffs = calc.filter(({ l, r }) => l.check.budgeted != null && Math.abs(r.budgeted - l.check.budgeted) > 0.011);
    const diffs = [...new Map([...grossDiffs, ...budgetDiffs].map((x) => [x.l.source_row, x])).values()];
    const groups = {}; p.lines.forEach((l) => { const g = l.pay_group || 'Unassigned'; groups[g] = (groups[g] || 0) + 1; });
    const people = new Set(p.lines.map((l) => l.ni || l.employee_name.toLowerCase())).size;
    const noType = p.lines.filter((l) => !l.contract_type).length;
    const defLabel = p.stream === 'monthly' ? file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim() : `Fortnight ${dm(p.period_start)} – ${dmy(p.period_end)}`;
    const existing = ctx.runs.filter((r) => r.stream === p.stream);
    const label = h('input', { type: 'text', value: defLabel, list: 'labels-' + p.stream });
    const dl = h('datalist', { id: 'labels-' + p.stream }, existing.map((r) => h('option', { value: r.label })));
    const modeSel = h('select', null, h('option', { value: 'replace' }, 'Replace everything in that run (re-import)'), h('option', { value: 'merge' }, 'Add only rows that are not there yet'));
    const modeFld = h('label', { class: 'fld w2' }, 'That run already exists — what should happen?', modeSel);
    const syncMode = () => modeFld.classList.toggle('hidden', !existing.some((r) => r.label === label.value.trim()));
    label.addEventListener('input', syncMode); syncMode();
    const bar = h('i'), status = h('div', { class: 'small muted' });
    const btn = h('button', { class: 'btn primary', onClick: async () => {
      const name = label.value.trim();
      if (!name) return toast('Give this run a name', 'err');
      btn.disabled = true; card.querySelector('.progress').classList.remove('hidden');
      try {
        const exists = existing.some((r) => r.label === name);
        const res = await importPayload(p, { label: name, mode: exists ? modeSel.value : 'new', onProgress: (x, t) => { bar.style.width = Math.round(x * 100) + '%'; status.textContent = t; } });
        ctx.runs = await loadRuns(); setRun(res.run.id);
        clear(card).append(h('b', null, file.name), h('div', { class: 'notice', style: { marginTop: '10px' } }, `Imported ${res.lines.toLocaleString()} lines into “${name}”.${res.skipped ? ` ${res.skipped} already existed and were skipped.` : ''} Everyone can see it now.`),
          h('div', { class: 'row', style: { marginTop: '10px' } }, h('a', { class: 'btn primary', href: '#/payroll' }, 'Open payroll'), h('a', { class: 'btn', href: '#/calendar' }, 'Check pay windows'), h('a', { class: 'btn', href: '#/dashboard' }, 'Dashboard')));
      } catch (e) { console.error(e); btn.disabled = false; status.textContent = ''; toast(e.message || String(e), 'err'); bar.style.width = '0'; }
    } }, icon('upload'), 'Import');

    clear(card).append(
      h('div', { class: 'row' }, h('b', null, file.name), h('span', { class: 'pill grp' }, p.stream === 'monthly' ? 'Monthly' : 'Fortnightly')),
      h('div', { class: 'meta' },
        meta('Lines', p.lines.length.toLocaleString()), meta('People', people.toLocaleString()), meta('Period', `${dm(p.period_start)} – ${dmy(p.period_end)}`), meta('Weeks', String(p.weeks.length)),
        meta('Gross pay', money(gross)), meta('Daily entries', p.lines.reduce((s, l) => s + l.days.length, 0).toLocaleString())),
      h('div', { class: 'chips', style: { marginBottom: '10px' } }, Object.entries(groups).sort((a, b) => natCompare(a[0], b[0])).map(([g, n]) => h('span', { class: 'pill grp' }, `${g} · ${n}`))),
      diffs.length === 0 ? h('div', { class: 'notice' }, `✓ Matches your Excel: gross pay ${money(gross)} and budgets agree on all ${p.lines.length.toLocaleString()} lines.`)
        : h('div', { class: 'notice warn' },
          grossDiffs.length === 0 ? `✓ Gross pay matches your Excel exactly (${money(gross)}). ` : `Gross pay here is ${money(gross)} vs ${money(xl)} in Excel — ${grossDiffs.length} line${grossDiffs.length === 1 ? '' : 's'} differ. `,
          budgetDiffs.length ? `${budgetDiffs.length} line${budgetDiffs.length === 1 ? '' : 's'} ${budgetDiffs.length === 1 ? 'has' : 'have'} a different budget than the Excel shows — usually a number typed over a formula in the sheet.` : '',
          h('details', { class: 'diff', style: { marginTop: '6px' } }, h('summary', null, 'Show them'), h('table', { class: 't' }, h('tbody', null, diffs.slice(0, 40).map(({ l, r }) => h('tr', null,
            h('td', null, `row ${l.source_row}`), h('td', null, l.employee_name), h('td', { class: 'num' }, 'gross ' + money(r.gross) + (l.check.gross != null ? ' (Excel ' + money(l.check.gross) + ')' : '')), h('td', { class: 'num' }, 'budget ' + money(r.budgeted) + (l.check.budgeted != null ? ' (Excel ' + money(l.check.budgeted) + ')' : '')))))))),
      noType ? h('div', { class: 'notice warn', style: { marginTop: '8px' } }, `${noType} lines have no contract type, so they are not paid by the hour (same as in Excel). Set one on the Payroll page if that is a mistake.`) : null,
      h('div', { class: 'toolbar', style: { marginTop: '14px' } }, h('label', { class: 'fld w2' }, 'Name this pay run', label), dl, modeFld, btn),
      h('div', { class: 'progress hidden' }, bar), status);
  }
  const meta = (l, v) => h('div', null, h('span', { class: 'small muted' }, l), h('b', null, v));
}
