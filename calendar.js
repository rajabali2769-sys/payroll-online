// Pay calendar. Two parts:
//  • This payroll — the reconciliation window and pay day for each pay date of the open pay run.
//  • Year pay calendar — every payroll period of the year (they change every month), kept once, imported / exported from Excel,
//    and copied into a pay run with "Apply to payroll".
import { loadPeriods, loadSummary, savePeriod, deletePeriod, onLive, loadCalendar, loadCalendarYears, saveCalendarRows, updateCalendarRow, deleteCalendarRows, applyCalendar } from './api.js';
import { h, clear, money, dmy, toast, natCompare, icon, debounce, modal, confirmBox } from './ui.js';
import { ctx, currentRun, runPicker } from './ctx.js';
import { panel, expandAllBtn } from './panels.js';
import { importModal, exportRows, downloadTemplate } from './importer.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const weeks = (a, b) => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / 86400000 + 1) / 7 * 10) / 10 : '');
const plusYear = (d) => { if (!d) return null; const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + 1); return x.toISOString().slice(0, 10); };
// "October 2026", "Oct-26", "10/2026" → 2026-10-01
function monthOf(text, fallbackDate) {
  const s = String(text || '').toLowerCase(); let m = MONTHS.findIndex((x) => s.includes(x) || s.includes(x.slice(0, 3)));
  let y = (s.match(/(20\d{2})/) || [])[1] || ((s.match(/[\s\-/'](\d{2})\b/) || [])[1] ? '20' + s.match(/[\s\-/'](\d{2})\b/)[1] : null);
  if (m < 0) { const mm = s.match(/^(\d{1,2})[/\-.](20\d{2})$/); if (mm) { m = +mm[1] - 1; y = mm[2]; } }
  if (m >= 0 && y) return `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return fallbackDate ? String(fallbackDate).slice(0, 7) + '-01' : null;
}
const STREAM = (v) => { const s = String(v || '').toLowerCase(); if (!s) return null; if (/^m/.test(s)) return 'monthly'; if (/^f|fort|2\s*w|bi/.test(s)) return 'fortnightly'; return undefined; };
const SPEC_COLS = [
  { key: 'stream', label: 'Payroll type', required: true, map: STREAM, example: 'Monthly', help: 'Monthly or Fortnightly' },
  { key: 'period', label: 'Payroll period', required: true, example: 'October 2026', help: 'The name of the payroll, e.g. October 2026 or Fortnight 21. Use the same name every row of that payroll.', aliases: ['period', 'payroll', 'month'] },
  { key: 'pay_group', label: 'Pay date group', required: true, example: '25th', help: 'The pay date group: 24th, 25th, 26th, 28th, 29th, LWD, 5th …', aliases: ['pay group', 'pay date', 'group'] },
  { key: 'reconcile_from', label: 'Reconcile from', type: 'date', example: '22/09/2026', aliases: ['from', 'window from', 'start'] },
  { key: 'reconcile_to', label: 'Reconcile to', type: 'date', example: '19/10/2026', aliases: ['to', 'window to', 'end'] },
  { key: 'pay_date', label: 'Paid on', type: 'date', example: '24/10/2026', aliases: ['payment date', 'paid', 'pay day'] },
  { key: 'cutoff_date', label: 'Timesheet cut-off', type: 'date', example: '20/10/2026', aliases: ['cut off', 'cutoff', 'deadline'] },
  { key: 'year', label: 'Year', type: 'number', help: 'Optional — worked out from the dates if empty' },
  { key: 'notes', label: 'Notes' },
];
const calSpec = (save) => ({ title: 'Upload the year pay calendar', file: 'pay_calendar_template.xlsx', columns: SPEC_COLS, save,
  help: ['One row for each pay date group in each payroll period.', 'Example: October 2026 has 24th, 25th, LWD … → one row each, all with Payroll period “October 2026”.', 'Uploading again updates rows with the same Payroll type + Payroll period + Pay date group, so you can correct and re-upload.'],
  examples: [['Monthly', 'October 2026', '24th', '21/09/2026', '18/10/2026', '24/10/2026', '19/10/2026', 2026, ''], ['Monthly', 'October 2026', '25th', '22/09/2026', '19/10/2026', '25/10/2026', '20/10/2026', 2026, ''], ['Fortnightly', 'Fortnight 21', 'FN', '28/09/2026', '11/10/2026', '16/10/2026', '12/10/2026', 2026, '']],
  rowCheck: (r) => (r.reconcile_from && r.reconcile_to && r.reconcile_to < r.reconcile_from ? 'Reconcile to is before Reconcile from' : null) });

export async function render(root) {
  const run = currentRun();
  const can = ctx.canEdit;
  let year = new Date().getFullYear(), stream = run ? run.stream : 'monthly', cal = [], years = [];
  const runBody = h('div'), yearBody = h('div'), yearActs = h('div', { class: 'row', style: { gap: '6px' } }), banner = h('div');
  const runSub = h('span', { class: 'psub2' }), yearSub = h('span', { class: 'psub2' });
  const pYear = panel(h('span', null, 'Year pay calendar ', yearSub), yearBody, { id: 'cal.year', actions: yearActs });
  const pRun = run ? panel(h('span', null, 'This payroll — windows by pay date ', runSub), runBody, { id: 'cal.run' }) : null;
  const stack = h('div', { class: 'hrstack' }, pYear, pRun);
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Pay calendar'), h('p', null, 'Keep the whole year’s pay dates and reconciliation windows here (they change every month), upload them from Excel, and apply them to each payroll.')),
    h('div', { class: 'row wrap' }, expandAllBtn(() => stack), run ? runPicker(() => { location.reload(); }) : null)), banner, stack);

  // ---------- best match between a pay run and a calendar period ----------
  function guessPeriod(r, rows) {
    const per = [...new Set(rows.filter((x) => x.stream === r.stream).map((x) => x.period))];
    const byLabel = per.find((p) => p.toLowerCase() === String(r.label || '').toLowerCase()); if (byLabel) return byLabel;
    if (r.stream === 'monthly') { const m = monthOf(r.label, r.period_end); const hit = rows.find((x) => x.stream === 'monthly' && x.period_month === m); if (hit) return hit.period; }
    if (r.period_end) { const end = Date.parse(r.period_end); const hit = rows.filter((x) => x.stream === r.stream && x.pay_date && Date.parse(x.pay_date) >= end - 3 * 864e5 && Date.parse(x.pay_date) <= end + 24 * 864e5).sort((a, b) => Date.parse(a.pay_date) - Date.parse(b.pay_date))[0]; if (hit) return hit.period; }
    return per[0] || null;
  }

  function applyDialog(preset) {
    if (!run) return toast('Open or import a payroll first', 'err');
    modal(`Apply the calendar to ${run.label}`, (done) => {
      const all = cal.filter((x) => x.stream === run.stream);
      const pers = [...new Set(all.map((x) => x.period))];
      if (!pers.length) return h('div', { class: 'stack' }, h('div', { class: 'notice warn' }, `There are no ${run.stream} periods in the ${year} calendar. Upload or add them first (change the year if needed).`), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Close')));
      const sel = h('select', null, pers.map((p) => h('option', { value: p, selected: p === (preset || guessPeriod(run, all)) }, p)));
      const prev = h('div');
      const show = () => { const rows = all.filter((x) => x.period === sel.value).sort((a, b) => natCompare(a.pay_group, b.pay_group));
        clear(prev).append(h('table', { class: 't' }, h('thead', null, h('tr', null, ['Pay date', 'From', 'To', 'Paid on'].map((t) => h('th', null, t)))), h('tbody', null, rows.map((r) => h('tr', null, h('td', null, h('span', { class: 'pill grp' }, r.pay_group)), h('td', null, dmy(r.reconcile_from)), h('td', null, dmy(r.reconcile_to)), h('td', null, dmy(r.pay_date))))))); };
      sel.onchange = show; show();
      return h('div', { class: 'stack' }, h('label', { class: 'fld' }, 'Calendar period', sel), prev,
        h('div', { class: 'small muted' }, 'Each pay date’s window in this payroll is set from the calendar. Pay dates not in the calendar are left as they are. It never changes pay — only which weeks count towards the budget.'),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { try { await applyCalendar(run.id, all.filter((x) => x.period === sel.value)); done(); toast('Calendar applied to this payroll', 'ok'); loadRun(); } catch (e) { toast(e.message, 'err'); } } }, 'Apply')));
    }, { wide: true });
  }

  // ---------- this payroll's windows ----------
  async function loadRun() {
    if (!run) return;
    const [periods, summary] = await Promise.all([loadPeriods(run.id), loadSummary(run.id)]);
    const sm = new Map(summary.map((s) => [s.pay_group, s]));
    const groups = [...new Set([...periods.map((p) => p.pay_group), ...summary.map((s) => s.pay_group)])].sort(natCompare);
    const byG = new Map(periods.map((p) => [p.pay_group, p]));
    runSub.textContent = `· ${run.label} · ${groups.length} pay dates`;
    const missing = groups.filter((g) => { const p = byG.get(g); return !p || !p.reconcile_from || !p.pay_date; }).length;
    clear(banner).append(missing && can && cal.some((x) => x.stream === run.stream) ? h('div', { class: 'notice warn row', style: { marginBottom: '12px' } }, h('span', { class: 'grow' }, `${missing} pay date(s) in ${run.label} have no window or pay day yet.`), h('button', { class: 'btn sm primary', onClick: () => applyDialog() }, 'Fill from the year calendar')) : null);
    const dateInput = (p, g, key) => {
      const i = h('input', { type: 'date', value: p?.[key] || '', disabled: !can, style: { width: '150px' } });
      i.addEventListener('change', async () => { try { await savePeriod({ run_id: run.id, pay_group: g, reconcile_from: p?.reconcile_from || null, reconcile_to: p?.reconcile_to || null, pay_date: p?.pay_date || null, [key]: i.value || null }); toast('Saved', 'ok'); await loadRun(); } catch (e) { toast(e.message, 'err'); } });
      return i;
    };
    clear(runBody).append(
      can ? h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'btn sm primary', onClick: () => applyDialog() }, icon('cal'), 'Apply the year calendar'), h('span', { class: 'small muted' }, 'or type the dates below')) : null,
      h('div', { class: 'tablewrap', style: { maxHeight: '60vh' } }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['Pay date', 'Reconcile from', 'Reconcile to', 'Paid on', 'Weeks', 'Lines', 'Gross pay', ''].map((t, i) => h('th', { class: i > 3 && i < 7 ? 'num' : '' }, t)))),
        h('tbody', null, groups.map((g) => { const p = byG.get(g), s = sm.get(g);
          return h('tr', null, h('td', null, h('span', { class: 'pill grp' }, g)), h('td', null, dateInput(p, g, 'reconcile_from')), h('td', null, dateInput(p, g, 'reconcile_to')), h('td', null, dateInput(p, g, 'pay_date')),
            h('td', { class: 'num' }, weeks(p?.reconcile_from, p?.reconcile_to)), h('td', { class: 'num' }, s?.lines ?? 0), h('td', { class: 'num' }, s ? money(s.gross) : ''),
            h('td', null, h('a', { class: 'btn sm', href: '#/payroll?group=' + encodeURIComponent(g) }, 'Open payroll'), ' ', p && can && !s ? h('button', { class: 'btn sm danger', onClick: async () => { await deletePeriod(p.id); loadRun(); } }, icon('trash')) : null)); })))),
      can ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('input', { type: 'text', id: 'newgrp', placeholder: 'Add another pay date, e.g. 27th', style: { maxWidth: '260px' } }),
        h('button', { class: 'btn', onClick: async () => { const v = runBody.querySelector('#newgrp').value.trim(); if (!v) return; try { await savePeriod({ run_id: run.id, pay_group: v }); loadRun(); } catch (e) { toast(e.message, 'err'); } } }, icon('plus'), 'Add')) : null);
  }

  // ---------- year calendar ----------
  const saveRows = async (rows) => {
    const out = rows.map((r) => { const pm = r.stream === 'monthly' ? monthOf(r.period, r.pay_date || r.reconcile_to) : (r.pay_date || r.reconcile_to ? String(r.pay_date || r.reconcile_to).slice(0, 7) + '-01' : null);
      const y = r.year || +(String(r.pay_date || r.reconcile_to || pm || '').slice(0, 4)) || year;
      return { year: y, stream: r.stream, period: String(r.period).trim(), period_month: pm, pay_group: String(r.pay_group).trim(), reconcile_from: r.reconcile_from || null, reconcile_to: r.reconcile_to || null, pay_date: r.pay_date || null, cutoff_date: r.cutoff_date || null, notes: r.notes || null }; });
    await saveCalendarRows(out); const ys = [...new Set(out.map((r) => r.year))]; if (ys.length && !ys.includes(year)) year = ys[0]; await loadYear();
    return `${out.length} calendar row(s) saved${ys.length ? ' for ' + ys.join(', ') : ''}`;
  };
  function addPeriodDialog() {
    modal('Add a payroll period', (done) => {
      const st = h('select', null, [['monthly', 'Monthly'], ['fortnightly', 'Fortnightly']].map(([v, t]) => h('option', { value: v, selected: v === stream }, t)));
      const per = h('input', { type: 'text', placeholder: 'e.g. November 2026 or Fortnight 22' });
      const groupsTxt = h('input', { type: 'text', value: [...new Set(cal.filter((x) => x.stream === stream).map((x) => x.pay_group))].sort(natCompare).join(', ') || '24th, 25th, 26th, 28th, 29th, LWD, 5th' });
      return h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, 'Payroll type', st), h('label', { class: 'fld' }, 'Payroll period', per)), h('label', { class: 'fld' }, 'Pay date groups (comma separated)', groupsTxt),
        h('div', { class: 'small muted' }, 'One row is added for each pay date group — fill in the dates in the table after.'),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          const p = per.value.trim(); const gs = groupsTxt.value.split(',').map((x) => x.trim()).filter(Boolean); if (!p || !gs.length) return toast('Add the period name and pay dates', 'err');
          try { await saveRows(gs.map((g) => ({ stream: st.value, period: p, pay_group: g, year }))); stream = st.value; done(); toast('Period added', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, 'Add')));
    });
  }
  async function copyToNextYear() {
    const rows = cal.filter((x) => x.year === year); if (!rows.length) return toast('Nothing to copy', 'err');
    if (!(await confirmBox(`Copy ${year} to ${year + 1}?`, `${rows.length} rows are copied with every date moved on one year (and the year in the period names changed). Then correct the dates that differ.`, 'Copy'))) return;
    try { await saveCalendarRows(rows.map((r) => ({ year: year + 1, stream: r.stream, period: r.period.replace(String(year), String(year + 1)).replace(new RegExp(`\\b${String(year).slice(2)}\\b`), String(year + 1).slice(2)), period_month: plusYear(r.period_month), pay_group: r.pay_group, reconcile_from: plusYear(r.reconcile_from), reconcile_to: plusYear(r.reconcile_to), pay_date: plusYear(r.pay_date), cutoff_date: plusYear(r.cutoff_date), notes: r.notes }))); year += 1; toast('Copied — check the dates', 'ok'); await loadYear(); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function loadYear() {
    try { [cal, years] = await Promise.all([loadCalendar(), loadCalendarYears()]); }
    catch (e) { clear(yearBody).append(h('div', { class: 'notice err' }, 'Could not load the year calendar: ' + e.message + ' — run the latest schema.sql in Supabase.')); return; }
    if (!years.includes(year) && years.length) year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length - 1];
    drawYear(); if (run) loadRun();
  }
  function drawYear() {
    const rows = cal.filter((x) => x.year === year && x.stream === stream);
    const pers = [...new Set(rows.map((x) => x.period))].sort((a, b) => { const ra = rows.find((x) => x.period === a), rb = rows.find((x) => x.period === b); return String(ra.period_month || ra.pay_date || '').localeCompare(String(rb.period_month || rb.pay_date || '')) || natCompare(a, b); });
    yearSub.textContent = `· ${year} · ${pers.length} ${stream} payroll${pers.length === 1 ? '' : 's'}`;
    const yrs = [...new Set([...years, year, new Date().getFullYear(), new Date().getFullYear() + 1])].sort();
    clear(yearActs).append(
      h('button', { class: 'btn sm', onClick: () => downloadTemplate(calSpec(null)).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Template'),
      can ? h('button', { class: 'btn sm', onClick: () => importModal(calSpec(saveRows)) }, icon('upload'), 'Import') : null,
      h('button', { class: 'btn sm', onClick: () => exportRows({ columns: SPEC_COLS.map((c) => ({ ...c, out: (r) => (c.key === 'stream' ? (r.stream === 'monthly' ? 'Monthly' : 'Fortnightly') : r[c.key]) })) }, cal.filter((x) => x.year === year), `pay_calendar_${year}.xlsx`).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Export'));
    const inp = (r, key) => { const i = h('input', { type: 'date', value: r[key] || '', disabled: !can, style: { width: '140px' } }); i.addEventListener('change', async () => { try { await updateCalendarRow(r.id, { [key]: i.value || null }); r[key] = i.value || null; toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } }); return i; };
    const runForPeriod = (p) => ctx.runs.find((r) => r.stream === stream && guessPeriod(r, rows) === p && String(r.label).toLowerCase() === p.toLowerCase()) || null;
    clear(yearBody).append(
      h('div', { class: 'toolbar tight' },
        h('select', { class: 'fsel', onChange: (e) => { year = +e.target.value; drawYear(); } }, yrs.map((y) => h('option', { value: y, selected: y === year }, String(y)))),
        h('div', { class: 'seg big' }, [['monthly', 'Monthly'], ['fortnightly', 'Fortnightly']].map(([k, t]) => h('button', { class: stream === k ? 'on' : '', onClick: () => { stream = k; drawYear(); } }, t, ' ', h('span', { class: 'cnt' }, String(new Set(cal.filter((x) => x.year === year && x.stream === k).map((x) => x.period)).size))))),
        h('div', { class: 'grow' }), can ? h('button', { class: 'btn sm', onClick: addPeriodDialog }, icon('plus'), 'Add period') : null, can ? h('button', { class: 'btn sm', onClick: copyToNextYear }, `Copy ${year} → ${year + 1}`) : null,
        ctx.isSuper && rows.length ? h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmBox(`Delete the ${year} ${stream} calendar?`, `${rows.length} rows will be deleted. Pay runs that already used them keep their dates.`, 'Delete', true)) { await deleteCalendarRows(rows.map((r) => r.id)); loadYear(); } } }, icon('trash')) : null),
      pers.length ? h('div', { class: 'calgrid' }, pers.map((p) => { const rs = rows.filter((x) => x.period === p).sort((a, b) => natCompare(a.pay_group, b.pay_group)); const isRun = run && run.stream === stream && guessPeriod(run, rows) === p;
        return h('div', { class: 'calper' + (isRun ? ' cur' : '') },
          h('div', { class: 'calhd' }, h('b', null, p), isRun ? h('span', { class: 'hpill g-outcome' }, 'this payroll') : null, h('div', { class: 'grow' }), can && run && run.stream === stream ? h('button', { class: 'btn sm', onClick: () => applyDialog(p) }, `Apply to ${run.label}`) : null),
          h('table', { class: 't' }, h('thead', null, h('tr', null, ['Pay date', 'Reconcile from', 'Reconcile to', 'Paid on', 'Cut-off', 'Weeks', ''].map((t) => h('th', null, t)))),
            h('tbody', null, rs.map((r) => h('tr', null, h('td', null, h('span', { class: 'pill grp' }, r.pay_group)), h('td', null, inp(r, 'reconcile_from')), h('td', null, inp(r, 'reconcile_to')), h('td', null, inp(r, 'pay_date')), h('td', null, inp(r, 'cutoff_date')), h('td', { class: 'num small' }, weeks(r.reconcile_from, r.reconcile_to)),
              h('td', null, can ? h('button', { class: 'btn sm', title: 'Remove this row', onClick: async () => { try { await deleteCalendarRows([r.id]); loadYear(); } catch (e) { toast(e.message, 'err'); } } }, icon('x')) : null)))))); void runForPeriod; }))
        : h('div', { class: 'card empty' }, h('b', null, `No ${stream} pay calendar for ${year} yet.`), h('div', { class: 'small muted', style: { margin: '6px 0 10px' } }, 'Download the template, fill in every payroll of the year (one row per pay date group), and import it. Or add periods one at a time.'),
          can ? h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn', onClick: () => downloadTemplate(calSpec(null)).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Template'), h('button', { class: 'btn primary', onClick: () => importModal(calSpec(saveRows)) }, icon('upload'), 'Import the year')) : null));
  }

  await loadYear();
  return onLive(debounce((e) => { if (document.querySelector('.modal-wrap')) return; if (e.table === 'pay_periods') loadRun(); if (e.table === 'pay_calendar') loadYear(); }, 600));
}
