// Pay calendar. Two parts:
//  • This payroll — the reconciliation window and pay day for each pay date of the open pay run.
//  • Year pay calendar — every payroll period of the year (they change every month), kept once, imported / exported from Excel,
//    and copied into a pay run with "Apply to payroll".
import { loadPeriods, loadSummary, savePeriod, deletePeriod, onLive, loadCalendar, loadCalendarYears, saveCalendarRows, updateCalendarRow, deleteCalendarRows, applyCalendar, applyProjectWindows } from './api.js';
import { h, clear, money, dmy, toast, natCompare, icon, debounce, modal, confirmBox } from './ui.js';
import { ctx, currentRun, runPicker } from './ctx.js';
import { panel, expandAllBtn } from './panels.js';
import { importModal, exportRows, downloadTemplate } from './importer.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const weeks = (a, b) => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / 86400000 + 1) / 7 * 10) / 10 : '');
const plusYear = (d) => { if (!d) return null; const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + 1); return x.toISOString().slice(0, 10); };
// "October 2026", "Oct-26", "10/2026" → 2026-10-01
function monthOf(text, fallbackDate) {
  const s0 = String(text || '').toLowerCase().trim(); const yy = s0.match(/^(\d{2})[\s\-/]([a-z]{3})/); const s = yy ? `${yy[2]} 20${yy[1]}` : s0; let m = MONTHS.findIndex((x) => s.includes(x) || s.includes(x.slice(0, 3)));
  let y = (s.match(/(20\d{2})/) || [])[1] || ((s.match(/[\s\-/'](\d{2})\b/) || [])[1] ? '20' + s.match(/[\s\-/'](\d{2})\b/)[1] : null);
  if (m < 0) { const mm = s.match(/^(\d{1,2})[/\-.](20\d{2})$/); if (mm) { m = +mm[1] - 1; y = mm[2]; } }
  if (m >= 0 && y) return `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return fallbackDate ? String(fallbackDate).slice(0, 7) + '-01' : null;
}
const STREAM = (v) => { const s = String(v || '').toLowerCase(); if (!s) return null; if (/^m/.test(s)) return 'monthly'; if (/^f|fort|2\s*w|bi/.test(s)) return 'fortnightly'; return undefined; };
const PAYDAY = (v) => { const s = String(v || '').trim(); if (!s) return null; if (/last\s*working|^lwd$/i.test(s)) return 'LWD'; return s; };
const SPEC_COLS = [
  { key: 'project_name', label: 'Project Name', required: true, example: 'NHS Cornwall', help: 'The project. Leave empty only for a whole pay-date row.', aliases: ['project', 'site'] },
  { key: 'period', label: 'Month', required: true, example: '26-Oct', help: 'The payroll month: 26-Oct, Oct-26, October 2026 or 01/10/2026 all work.', aliases: ['payroll period', 'period', 'payroll month'], map: (v) => { if (typeof v === 'number' && v > 20000) { const d = new Date(Math.round((v - 25569) * 86400000)); return `${MONTHS[d.getUTCMonth()][0].toUpperCase()}${MONTHS[d.getUTCMonth()].slice(1)} ${d.getUTCFullYear()}`; } const m = monthOf(v); if (!m) return String(v).trim(); return `${MONTHS[+m.slice(5, 7) - 1][0].toUpperCase()}${MONTHS[+m.slice(5, 7) - 1].slice(1)} ${m.slice(0, 4)}`; } },
  { key: 'reconcile_from', label: 'Reconciled from', type: 'date', required: true, example: 'Monday 21-Sep-26', aliases: ['reconcile from', 'from', 'window from'] },
  { key: 'reconcile_to', label: 'Reconciled till', type: 'date', required: true, example: 'Sunday 18-Oct-26', aliases: ['reconcile to', 'reconciled to', 'to', 'till'] },
  { key: 'validation_date', label: 'Validation/Pay Slips Date', type: 'date', example: 'Wednesday 21-Oct-26', aliases: ['validation', 'pay slips date', 'payslips date', 'validation date'] },
  { key: 'pay_date', label: 'Disbursement /RTI Date', type: 'date', example: 'Friday 23-Oct-26', aliases: ['disbursement/rti date', 'disbursement', 'rti date', 'paid on', 'pay date'] },
  { key: 'pay_group', label: 'Actual Pay Day', required: true, map: PAYDAY, example: '25th', help: '24th, 25th, 26th, 28th, 29th, Last Working day (saved as LWD), 5th …', aliases: ['pay day', 'pay date group', 'pay group'] },
  { key: 'stream', label: 'Payroll type', map: STREAM, example: 'Monthly', help: 'Optional — Monthly if empty' },
  { key: 'notes', label: 'Notes' },
];
const calSpec = (save) => ({ title: 'Upload the pay calendar (Project Name, Month, Reconciled from … Actual Pay Day)', file: 'pay_calendar_template.xlsx', columns: SPEC_COLS, save,
  help: ['One row per project per month — the same layout as your pay calendar sheet (you can paste it straight in; the S.No column is ignored).', 'Dates can be written like “Monday 21-Sep-26”, 21/09/2026 or as Excel dates.', 'Uploading again updates the same project + month, so you can correct and re-upload.'],
  examples: [['NHS Cornwall', '26-Oct', 'Monday 28-Sep-26', 'Sunday 25-Oct-26', 'Wednesday 28-Oct-26', 'Friday 30-Oct-26', 'Last Working day', 'Monthly', ''], ['Monkseaton', '26-Oct', 'Monday 21-Sep-26', 'Sunday 18-Oct-26', 'Wednesday 21-Oct-26', 'Friday 23-Oct-26', '24th', 'Monthly', '']],
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
    modal(`Apply the pay calendar to ${run.label}`, (done) => {
      const all = cal.filter((x) => x.stream === run.stream);
      const pers = [...new Set(all.map((x) => x.period))];
      if (!pers.length) return h('div', { class: 'stack' }, h('div', { class: 'notice warn' }, `There is no ${run.stream} pay calendar yet. Import it first.`), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Close')));
      const sel = h('select', null, pers.map((p) => h('option', { value: p, selected: p === (preset || guessPeriod(run, all)) }, p)));
      const weeksBox = h('input', { type: 'checkbox', checked: true }), prev = h('div'), res = h('div');
      const show = () => { const rows = all.filter((x) => x.period === sel.value); const g = new Map(); for (const r of rows) { if (!g.has(r.pay_group)) g.set(r.pay_group, []); g.get(r.pay_group).push(r); }
        clear(prev).append(h('div', { class: 'tablewrap', style: { maxHeight: '40vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Pay day', 'Projects', 'Window (most projects)', 'Disbursement'].map((t) => h('th', null, t)))),
          h('tbody', null, [...g].sort((x, y) => natCompare(x[0], y[0])).map(([k, rs]) => h('tr', null, h('td', null, h('span', { class: 'pill grp' }, k)), h('td', { class: 'small' }, rs.map((r) => r.project_name || '(all)').join(', ')), h('td', { class: 'small nowrap' }, `${dmy(rs[0].reconcile_from)} – ${dmy(rs[0].reconcile_to)}`), h('td', { class: 'small nowrap' }, dmy(rs[0].pay_date)))))))); };
      sel.onchange = show; show();
      return h('div', { class: 'stack' }, h('label', { class: 'fld' }, 'Calendar month', sel), prev,
        h('label', { class: 'row small', style: { alignItems: 'flex-start' } }, weeksBox, h('span', null, h('b', null, 'Also set the budget weeks for every project'), ' — each line counts only the weeks inside its own project’s window (a week counts when 4+ of its days are inside). Recommended: projects in the same pay day can have different windows.')),
        res,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Close'), h('button', { class: 'btn primary', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            const rows = all.filter((x) => x.period === sel.value);
            await applyCalendar(run.id, rows);
            let out = [];
            if (weeksBox.checked) out = await applyProjectWindows(run.id, run.stream, sel.value);
            const calProjects = [...new Set(rows.filter((r) => r.project_name).map((r) => r.project_name))];
            const hit = new Set(out.map((o) => (o.project_name || '').toLowerCase()));
            clear(res).append(weeksBox.checked ? h('div', { class: 'notice ok' }, `Done. Pay day windows set; budget weeks set for ${out.reduce((a, o) => a + o.lines, 0)} lines in ${out.length} project(s).`) : h('div', { class: 'notice ok' }, 'Pay day windows set.'),
              weeksBox.checked && out.length < calProjects.length ? h('div', { class: 'small muted' }, `${calProjects.length - out.length} calendar project(s) had no lines in this payroll, or are spelt differently (add an alias in Projects & POCs): `, calProjects.filter((p) => !out.some((o) => (o.project_name || '').toLowerCase().includes(p.toLowerCase().split(' ')[0]))).slice(0, 30).join(', ')) : null);
            toast('Pay calendar applied', 'ok'); loadRun(); void hit;
          } catch (e) { toast(e.message, 'err'); } finally { ev.target.disabled = false; }
        } }, 'Apply')));
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
    const out = rows.map((r) => { r.stream = r.stream || 'monthly'; const pm = r.stream === 'monthly' ? monthOf(r.period, r.pay_date || r.reconcile_to) : (r.pay_date || r.reconcile_to ? String(r.pay_date || r.reconcile_to).slice(0, 7) + '-01' : null);
      const y = r.year || +(String(pm || r.reconcile_to || r.pay_date || '').slice(0, 4)) || year;
      return { year: y, stream: r.stream, period: String(r.period).trim(), period_month: pm, pay_group: String(r.pay_group).trim(), project_name: r.project_name ? String(r.project_name).trim() : null, reconcile_from: r.reconcile_from || null, reconcile_to: r.reconcile_to || null, validation_date: r.validation_date || null, pay_date: r.pay_date || null, cutoff_date: r.cutoff_date || null, notes: r.notes || null }; });
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
    try { await saveCalendarRows(rows.map((r) => ({ year: year + 1, stream: r.stream, period: r.period.replace(String(year), String(year + 1)).replace(new RegExp(`\\b${String(year).slice(2)}\\b`), String(year + 1).slice(2)), period_month: plusYear(r.period_month), pay_group: r.pay_group, project_name: r.project_name || null, reconcile_from: plusYear(r.reconcile_from), reconcile_to: plusYear(r.reconcile_to), validation_date: plusYear(r.validation_date), pay_date: plusYear(r.pay_date), cutoff_date: plusYear(r.cutoff_date), notes: r.notes }))); year += 1; toast('Copied — check the dates', 'ok'); await loadYear(); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function loadYear() {
    try { [cal, years] = await Promise.all([loadCalendar(), loadCalendarYears()]); }
    catch (e) { clear(yearBody).append(h('div', { class: 'notice err' }, 'Could not load the year calendar: ' + e.message + ' — run the latest schema.sql in Supabase.')); return; }
    if (!years.includes(year) && years.length) year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length - 1];
    drawYear(); if (run) loadRun();
  }
  let pq = '';
  function drawYear() {
    const rows = cal.filter((x) => x.year === year && x.stream === stream);
    const pers = [...new Set(rows.map((x) => x.period))].sort((a, b) => { const ra = rows.find((x) => x.period === a), rb = rows.find((x) => x.period === b); return String(ra.period_month || ra.pay_date || '').localeCompare(String(rb.period_month || rb.pay_date || '')) || natCompare(a, b); });
    const projects = new Set(rows.map((r) => r.project_name).filter(Boolean));
    yearSub.textContent = `· ${year} · ${pers.length} month${pers.length === 1 ? '' : 's'} · ${projects.size} projects · ${rows.length} rows`;
    const yrs = [...new Set([...years, year, new Date().getFullYear(), new Date().getFullYear() + 1])].sort();
    clear(yearActs).append(
      h('button', { class: 'btn sm', onClick: () => downloadTemplate(calSpec(null)).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Template'),
      can ? h('button', { class: 'btn sm', onClick: () => importModal(calSpec(saveRows)) }, icon('upload'), 'Import') : null,
      h('button', { class: 'btn sm', onClick: () => exportRows({ columns: [{ key: 'sno', label: 'S.No', out: (r, i) => '' }, ...SPEC_COLS.map((c) => ({ ...c, out: (r) => (c.key === 'stream' ? (r.stream === 'monthly' ? 'Monthly' : 'Fortnightly') : c.key === 'pay_group' && r.pay_group === 'LWD' ? 'Last Working day' : r[c.key]) }))] }, cal.filter((x) => x.year === year).map((r, i) => ({ ...r, sno: i + 1 })), `pay_calendar_${year}.xlsx`).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Export'));
    const today = new Date().toISOString().slice(0, 10);
    const inp = (r, key) => { const i = h('input', { type: 'date', value: r[key] || '', disabled: !can, class: 'cald' }); i.addEventListener('change', async () => { try { await updateCalendarRow(r.id, { [key]: i.value || null }); r[key] = i.value || null; toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } }); return i; };
    const curPeriod = run && run.stream === stream ? guessPeriod(run, rows) : null;
    const monthPanel = (p) => {
      const rs = rows.filter((x) => x.period === p && (!pq || (x.project_name || '').toLowerCase().includes(pq) || x.pay_group.toLowerCase().includes(pq))).sort((a, b) => natCompare(a.pay_group, b.pay_group) || natCompare(a.project_name || '', b.project_name || ''));
      const pays = [...new Set(rows.filter((x) => x.period === p).map((x) => x.pay_date).filter(Boolean))].sort();
      const sub = ` · ${rows.filter((x) => x.period === p).length} projects · pay days ${pays.length ? dmy(pays[0]).slice(0, 6) + ' – ' + dmy(pays[pays.length - 1]).slice(0, 6) : '—'}`;
      const body = h('div', null, h('div', { class: 'tablewrap', style: { maxHeight: '62vh' } }, h('table', { class: 't calt' },
        h('thead', null, h('tr', null, ['Project', 'Actual pay day', 'Reconciled from', 'Reconciled till', 'Validation / payslips', 'Disbursement / RTI', 'Weeks', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rs.map((r) => h('tr', { class: r.pay_date && r.pay_date < today ? 'past' : '' }, h('td', null, h('b', null, r.project_name || '(whole pay day)')), h('td', null, h('span', { class: 'pill grp' }, r.pay_group === 'LWD' ? 'Last working day' : r.pay_group)),
          h('td', null, inp(r, 'reconcile_from')), h('td', null, inp(r, 'reconcile_to')), h('td', null, inp(r, 'validation_date')), h('td', null, inp(r, 'pay_date')), h('td', { class: 'num small' }, weeks(r.reconcile_from, r.reconcile_to)),
          h('td', null, can ? h('button', { class: 'btn sm', title: 'Remove this row', onClick: async () => { if (await confirmBox('Remove this row?', `${r.project_name || r.pay_group} · ${p}`, 'Remove', true)) { try { await deleteCalendarRows([r.id]); loadYear(); } catch (e) { toast(e.message, 'err'); } } } }, icon('x')) : null)))))));
      return panel(h('span', null, p, curPeriod === p ? h('span', { class: 'hpill g-outcome', style: { marginLeft: '8px' } }, 'this payroll') : null), body,
        { id: `calm.${year}.${stream}.${p}`, sub, open: !!pq || curPeriod === p, actions: can && run && run.stream === stream ? h('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); applyDialog(p); } }, `Apply to ${run.label}`) : null });
    };
    clear(yearBody).append(
      h('div', { class: 'toolbar tight' },
        h('select', { class: 'fsel', onChange: (e) => { year = +e.target.value; drawYear(); } }, yrs.map((y) => h('option', { value: y, selected: y === year }, String(y)))),
        h('div', { class: 'seg big' }, [['monthly', 'Monthly'], ['fortnightly', 'Fortnightly']].map(([k, t]) => h('button', { class: stream === k ? 'on' : '', onClick: () => { stream = k; drawYear(); } }, t))),
        h('input', { type: 'search', placeholder: 'Find a project or pay day…', value: pq, style: { width: '220px' }, onInput: debounce((e) => { pq = e.target.value.toLowerCase().trim(); drawYear(); }, 250) }),
        h('div', { class: 'grow' }), can ? h('button', { class: 'btn sm', onClick: () => addProjectRow() }, icon('plus'), 'Add a row') : null, can ? h('button', { class: 'btn sm', onClick: copyToNextYear }, `Copy ${year} → ${year + 1}`) : null,
        ctx.isSuper && rows.length ? h('button', { class: 'btn sm danger', title: `Delete the whole ${year} ${stream} calendar`, onClick: async () => { if (await confirmBox(`Delete the ${year} ${stream} calendar?`, `${rows.length} rows will be deleted. Pay runs that already used them keep their dates.`, 'Delete', true)) { await deleteCalendarRows(rows.map((r) => r.id)); loadYear(); } } }, icon('trash')) : null),
      pers.length ? h('div', { class: 'hrstack' }, pers.map(monthPanel))
        : h('div', { class: 'card empty' }, h('b', null, `No ${stream} pay calendar for ${year} yet.`), h('div', { class: 'small muted', style: { margin: '6px 0 10px' } }, 'Download the template (same columns as your pay calendar sheet), paste your rows in and import it.'),
          can ? h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn', onClick: () => downloadTemplate(calSpec(null)).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Template'), h('button', { class: 'btn primary', onClick: () => importModal(calSpec(saveRows)) }, icon('upload'), 'Import the year')) : null));
  }
  function addProjectRow() {
    modal('Add a project to the pay calendar', (done) => {
      const f = {}; const dt = (k, l) => h('label', { class: 'fld' }, l, (f[k] = h('input', { type: 'date' })));
      f.project_name = h('input', { type: 'text', placeholder: 'Project name' }); f.period = h('input', { type: 'text', placeholder: 'e.g. November 2026' }); f.pay_group = h('input', { type: 'text', placeholder: '24th / 25th / LWD / 5th …' });
      return h('div', { class: 'stack' }, h('div', { class: 'form-grid g3' }, h('label', { class: 'fld' }, 'Project', f.project_name), h('label', { class: 'fld' }, 'Month', f.period), h('label', { class: 'fld' }, 'Actual pay day', f.pay_group),
          dt('reconcile_from', 'Reconciled from'), dt('reconcile_to', 'Reconciled till'), dt('validation_date', 'Validation / payslips'), dt('pay_date', 'Disbursement / RTI')),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          const r = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim() || null])); if (!r.project_name || !r.period || !r.pay_group) return toast('Project, month and pay day are needed', 'err');
          r.period = SPEC_COLS[1].map(r.period); r.pay_group = PAYDAY(r.pay_group); r.stream = stream;
          try { await saveRows([r]); done(); toast('Added', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, 'Add')));
    }, { wide: true });
  }

  await loadYear();
  return onLive(debounce((e) => { if (document.querySelector('.modal-wrap')) return; if (e.table === 'pay_periods') loadRun(); if (e.table === 'pay_calendar') loadYear(); }, 600));
}
