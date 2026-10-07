// Daily attendance: drop in the day's time-in / time-out Excel, it updates the OPEN payroll straight away; see who is in and who is missing.
import { commitEntries, loadDailyForRun, loadEmployeesFull, loadRuns, onLive } from './api.js';
import { parseHoursRows } from './timesheet.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { h, clear, hrs, dmy, toast, icon, downloadCSV, debounce, statusPill } from './ui.js';
import { ctx, currentRun, openRuns, setRun } from './ctx.js';
import { normKey } from './parsers.js';

export async function render(root) {
  const opens = openRuns();
  if (!opens.length) { root.append(h('div', { class: 'card empty' }, 'There is no open payroll. Import a file or create a pay run first (Upload hours).')); return; }
  let run = opens.find((r) => r.id === currentRun()?.id) || opens[0];
  let emps = [], daily = [], date = '', parsed = null, file = null, target = run.id, onlyMissing = false, q = '';
  const host = h('div', { class: 'stack' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Daily attendance'), h('p', null, 'Upload the time in / time out Excel as often as you like — every upload updates the open payroll straight away. The board shows who is in and who is missing.')),
    h('label', { class: 'fld w2' }, 'Open payroll', h('select', { onChange: (e) => { run = opens.find((r) => r.id === e.target.value); setRun(run.id); target = run.id; load(); } }, opens.map((r) => h('option', { value: r.id, selected: r.id === run.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${r.label}`))))), host);

  const activeEmps = () => emps.filter((e) => e.active !== false);
  const bestRun = (p) => opens.find((r) => p && p.period_start && r.period_start && r.period_end && p.period_start >= String(r.period_start).slice(0, 10) && p.period_end <= String(r.period_end).slice(0, 10)) || run;

  async function readFile(f) {
    try { const XLSX = await loadXLSX(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); const name = wb.SheetNames.find((n) => /^(hours|attendance)$/i.test(n.trim())) || wb.SheetNames[0];
      parsed = parseHoursRows(sheetRows(XLSX, wb.Sheets[name])); file = f; target = bestRun(parsed).id; draw(); } catch (e) { parsed = null; draw(); toast(e.message || String(e), 'err'); }
  }
  async function downloadTemplate() {
    const XLSX = await loadXLSX(); const head = ['Employee Name', 'NI Number', 'Project', 'Site', 'Date', 'Time In', 'Time Out', 'Break (mins)', 'Ad-hoc Hours', 'Leave Type'];
    const d = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    const ws = XLSX.utils.aoa_to_sheet([head, ['Jane Smith', 'AB123456C', 'Thurston', 'Main site', d, '08:30', '16:30', 30, '', ''], ['Sam Jones', 'ZY987654D', 'Thurston', '', d, '09:00', '15:00', 0, 2, '']]); ws['!cols'] = [24, 14, 28, 16, 12, 10, 10, 12, 12, 12].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Attendance'); XLSX.writeFile(wb, 'Daily_attendance_template.xlsx');
  }
  function uploadCard() {
    const inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hidden', onChange: (e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; } });
    const drop = h('div', { class: 'drop', style: { padding: '20px' }, onClick: () => inp.click() }, h('b', null, file ? file.name : 'Drop the day’s attendance Excel here'), h('div', { class: 'muted' }, 'Columns: Employee Name, NI Number, Project, Date, Time In, Time Out (and optionally Break, Ad-hoc Hours, Leave Type)'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over')); drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    let body = null;
    if (parsed) {
      const known = new Set(activeEmps().flatMap((e) => [e.ni_number, e.name_key].filter(Boolean))), gone = new Set(emps.filter((e) => e.active === false).flatMap((e) => [e.ni_number, e.name_key].filter(Boolean)));
      const unknown = parsed.lines.filter((l) => !(known.has(l.ni) || known.has(normKey(l.employee_name))) && !(gone.has(l.ni) || gone.has(normKey(l.employee_name)))), leavers = parsed.lines.filter((l) => gone.has(l.ni) || gone.has(normKey(l.employee_name)));
      const tr = opens.find((r) => r.id === target) || run, sel = h('select', { onChange: (e) => { target = e.target.value; draw(); } }, opens.map((r) => h('option', { value: r.id, selected: r.id === target }, `${r.label}`)));
      const prog = h('div', { class: 'progress hidden' }, h('i')), btn = h('button', { class: 'btn primary', disabled: !parsed.lines.length, onClick: async () => {
        btn.disabled = true; prog.classList.remove('hidden');
        try { const res = await commitEntries(tr, parsed.lines.map((l) => ({ project: l.project, site: l.site, employee_name: l.employee_name, ni: l.ni, rate: l.rate, contract_type: l.contract_type, pay_group: l.pay_group, days: l.days, leave: l.leave, adhoc: l.adhoc })), (x) => { prog.firstChild.style.width = Math.round(x * 100) + '%'; });
          ctx.runs = await loadRuns(); toast(`Open payroll updated: ${res.days} days of hours, ${res.adhoc} ad-hoc, ${res.leave} leave days — ${res.created} new people, ${res.updated} updated`, 'ok'); parsed = null; file = null; await load(); }
        catch (e) { btn.disabled = false; toast(e.message || String(e), 'err'); } prog.classList.add('hidden'); } }, icon('upload'), `Update “${tr.label.length > 24 ? tr.label.slice(0, 23) + '…' : tr.label}”`);
      body = h('div', { style: { marginTop: '12px' } },
        h('div', { class: 'row wrap', style: { gap: '22px', marginBottom: '8px' } }, [['People', parsed.lines.length], ['Rows read', parsed.rowsRead], ['Hours', hrs(parsed.totalHours)], ['Ad-hoc hours', hrs(parsed.adhocHours || 0)], ['Dates', parsed.period_start ? `${dmy(parsed.period_start)}${parsed.period_end !== parsed.period_start ? ' – ' + dmy(parsed.period_end) : ''}` : '–']].map(([a, b]) => h('div', null, h('div', { class: 'small muted' }, a), h('b', { style: { fontSize: '18px' } }, String(b))))),
        parsed.errors.length ? h('div', { class: 'notice warn' }, `${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} will be skipped: `, parsed.errors.slice(0, 5).map((e) => `row ${e.row}${e.name ? ' (' + e.name + ')' : ''}: ${e.text}`).join(' · ')) : h('div', { class: 'notice' }, '✓ Every row was understood.'),
        unknown.length ? h('div', { class: 'notice warn', style: { marginTop: '8px' } }, `${unknown.length} ${unknown.length === 1 ? 'person is' : 'people are'} not on the active employee list (they will be added): `, unknown.slice(0, 6).map((l) => l.employee_name).join(', '), unknown.length > 6 ? '…' : '') : null,
        leavers.length ? h('div', { class: 'notice err', style: { marginTop: '8px' } }, `${leavers.length} ${leavers.length === 1 ? 'person is' : 'people are'} marked as leavers: `, leavers.slice(0, 6).map((l) => l.employee_name).join(', '), ' — check before importing.') : null,
        h('div', { class: 'toolbar', style: { marginTop: '12px' } }, h('label', { class: 'fld w2' }, 'Update this open payroll', sel), btn), prog);
    }
    return h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '1'), h('h3', { style: { margin: 0 } }, 'Add attendance'), h('div', { class: 'grow' }), h('button', { class: 'btn', onClick: downloadTemplate }, icon('download'), 'Download template')), drop, inp, body);
  }
  function boardCard() {
    const day = daily.filter((r) => String(r.work_date).slice(0, 10) === date), by = new Map();
    for (const r of day) { const k = normKey(r.employee_name); const e = by.get(k) || { hours: 0, projects: new Set() }; e.hours += +r.hours || 0; e.projects.add(r.project_name); by.set(k, e); }
    const act = activeEmps(), present = act.filter((e) => (by.get(e.name_key)?.hours || 0) > 0), missing = act.filter((e) => !(by.get(e.name_key)?.hours > 0));
    const rows = (onlyMissing ? missing : [...present, ...missing]).filter((e) => !q || [e.full_name, e.default_project].some((x) => x && x.toLowerCase().includes(q)));
    const dates = [...new Set(daily.map((r) => String(r.work_date).slice(0, 10)))].sort();
    return h('div', { class: 'card pad' }, h('div', { class: 'step-h' }, h('span', { class: 'num' }, '2'), h('h3', { style: { margin: 0 } }, 'Attendance board'), h('div', { class: 'grow' }), h('a', { class: 'btn sm', href: '#/chase' }, icon('mail'), 'Chase missing timesheets')),
      h('div', { class: 'toolbar' }, h('label', { class: 'fld' }, 'Date', h('input', { type: 'date', value: date, onChange: (e) => { date = e.target.value; draw(); } })),
        dates.slice(-6).reverse().map((d) => h('button', { class: 'chip' + (d === date ? ' on' : ''), onClick: () => { date = d; draw(); } }, dmy(d).replace(/ 20\d\d$/, ''))), h('div', { class: 'grow' }),
        h('label', { class: 'fld' }, 'Search', h('input', { type: 'search', value: q, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) })), h('label', { class: 'row small', style: { gap: '6px', alignSelf: 'flex-end', paddingBottom: '9px' } }, h('input', { type: 'checkbox', checked: onlyMissing, onChange: (e) => { onlyMissing = e.target.checked; draw(); } }), 'Missing only')),
      h('div', { class: 'chips', style: { marginBottom: '10px' } }, h('span', { class: 'cn g' }, `${present.length} in`), h('span', { class: 'cn r' }, `${missing.length} missing`), h('span', { class: 'cn b' }, `${hrs(day.reduce((s, r) => s + (+r.hours || 0), 0))} hours`), h('span', { class: 'small muted' }, `${act.length} active employees`)),
      rows.length ? h('div', { class: 'tablewrap', style: { maxHeight: '48vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'Usual project', 'Status', 'Hours', 'Worked on'].map((t, i) => h('th', { class: i === 3 ? 'num' : '' }, t)))),
        h('tbody', null, rows.slice(0, 500).map((e) => { const d = by.get(e.name_key), pres = d && d.hours > 0; return h('tr', null, h('td', null, h('b', null, e.full_name)), h('td', { class: 'muted' }, e.default_project || ''), h('td', null, pres ? h('span', { class: 'flag ok' }, 'In') : h('span', { class: 'flag bad' }, 'Missing')), h('td', { class: 'num' }, pres ? hrs(d.hours) : ''), h('td', { class: 'muted small' }, pres ? [...d.projects].join(', ') : '')); })))) : h('div', { class: 'card empty' }, emps.length ? 'Nobody to show.' : 'No employees yet — import your active employee list first (Active employees).'),
      missing.length ? h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onClick: () => downloadCSV(`missing_${date}.csv`, [['Employee', 'NI Number', 'Email', 'Usual project'], ...missing.map((e) => [e.full_name, e.ni_number || '', e.email || '', e.default_project || ''])]) }, icon('download'), 'Export the missing list')) : null);
  }
  function draw() { clear(host).append(uploadCard(), boardCard()); }
  async function load() {
    [emps, daily] = await Promise.all([loadEmployeesFull().catch(() => []), loadDailyForRun(run.id).catch(() => [])]);
    const today = new Date().toISOString().slice(0, 10), ds = [...new Set(daily.map((r) => String(r.work_date).slice(0, 10)))].sort();
    if (!date || !ds.includes(date)) date = [...ds].reverse().find((d) => d <= today) || ds[ds.length - 1] || today;
    draw();
  }
  await load();
  return onLive(debounce((e) => { if (e.table === 'daily_hours' || e.table === 'employees') load(); }, 1200));
}
