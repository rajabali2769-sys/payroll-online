// Active employees: the list the payroll is run for. Mark leavers, keep contact details, import the list from Excel.
import { loadEmployeesFull, setEmployeeFields, saveEmployeesList, loadRunData, onLive } from './api.js';
import { parseEmployeeRows } from './timesheet.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { h, clear, hrs, dmy, toast, modal, icon, downloadCSV, debounce } from './ui.js';
import { ctx, currentRun } from './ctx.js';
import { normKey } from './parsers.js';

export async function render(root) {
  const run = currentRun(), can = () => ctx.canEdit;
  let emps = [], lines = [], flt = 'active', q = '';
  const host = h('div'), file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hidden', onChange: async (e) => { if (e.target.files[0]) await readList(e.target.files[0]); e.target.value = ''; } });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Active employees'), h('p', null, 'Everyone the payroll is run for. Mark leavers, keep contact details up to date, or import the whole list from Excel.')),
    h('div', { class: 'row wrap' }, can() ? h('button', { class: 'btn', onClick: () => file.click() }, icon('upload'), 'Import list (Excel)') : null, can() ? h('button', { class: 'btn primary', onClick: () => addPerson() }, icon('plus'), 'Add employee') : null)), file, host);

  const hoursBy = () => { const m = new Map(); for (const l of lines) { const k = l.employee_id || normKey(l.employee_name); m.set(k, (m.get(k) || 0) + (+l.actual_hours || 0)); } return m; };
  async function readList(f) {
    try { const XLSX = await loadXLSX(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); const r = parseEmployeeRows(sheetRows(XLSX, wb.Sheets[wb.SheetNames[0]]));
      modal('Import the employee list', (close) => h('div', { class: 'stack' }, h('div', null, h('b', null, `${r.rows.length} people`), ` read (${r.rows.filter((x) => x.active).length} active, ${r.rows.filter((x) => !x.active).length} leavers). People already in the system are updated; new people are added.`),
        r.errors.length ? h('div', { class: 'notice warn' }, `${r.errors.length} row(s) skipped:`, h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, r.errors.slice(0, 8).map((e) => h('li', null, `Row ${e.row}: ${e.text}`)))) : null,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { try { const s = await saveEmployeesList(r.rows); close(); toast(`${s.created} added, ${s.updated} updated`, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } } }, 'Save the list'))));
    } catch (e) { toast(e.message || String(e), 'err'); }
  }
  function addPerson() {
    modal('Add an employee', (close) => { const f = {}; const inp = (k, label, a = {}) => h('label', { class: 'fld' }, label, (f[k] = h('input', { type: 'text', ...a })));
      return h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, inp('name', 'Full name *'), inp('ni', 'NI number'), inp('email', 'Email', { type: 'email' }), inp('phone', 'Phone'), inp('project', 'Usual project'), inp('rate', 'Hourly rate £', { type: 'number', step: 'any' })),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          if (!f.name.value.trim()) return toast('Add a name', 'err');
          try { await saveEmployeesList([{ full_name: f.name.value.trim(), name_key: normKey(f.name.value), ni_number: f.ni.value.trim().toUpperCase() || null, email: f.email.value.trim().toLowerCase() || null, phone: f.phone.value.trim() || null, default_project: f.project.value.trim() || null, default_rate: f.rate.value === '' ? null : +f.rate.value, default_site: null, default_contract: null, active: true }]); close(); toast('Employee added', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } } }, 'Add'))); });
  }
  function draw() {
    const act = emps.filter((e) => e.active !== false), inact = emps.length - act.length, hb = hoursBy();
    const shown = emps.filter((e) => (flt === 'all' || (flt === 'active') === (e.active !== false)) && (!q || [e.full_name, e.ni_number, e.email, e.default_project].some((x) => x && String(x).toLowerCase().includes(q))));
    const inp = (e, key, type = 'text', w = 150) => { const i = h('input', { type, value: e[key] ?? '', step: 'any', disabled: !can(), style: { width: w + 'px' } }); i.addEventListener('change', async () => { try { const v = i.value.trim(); await setEmployeeFields(e.id, { [key]: v === '' ? null : (type === 'number' ? +v : (key === 'ni_number' ? v.toUpperCase() : v)) }); e[key] = v === '' ? null : v; toast('Saved', 'ok'); } catch (er) { toast(er.message, 'err'); } }); return i; };
    clear(host).append(
      h('div', { class: 'grid kpis' }, [['kc-teal', 'Active employees', act.length], ['kc-slate', 'Leavers / inactive', inact], ['kc-green', 'With an email', act.filter((e) => e.email).length], ['kc-amber', 'Missing an NI number', act.filter((e) => !e.ni_number).length]].map(([c, l, v]) => h('div', { class: 'card kpi c ' + c }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, String(v))))),
      h('div', { class: 'toolbar' }, h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', placeholder: 'Name, NI, email, project…', value: q, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); draw(); }, 150) })),
        h('div', { class: 'seg' }, [['active', 'Active'], ['inactive', 'Leavers'], ['all', 'All']].map(([k, t]) => h('button', { class: flt === k ? 'on' : '', onClick: () => { flt = k; draw(); } }, t))), h('div', { class: 'grow' }),
        h('button', { class: 'btn', onClick: () => downloadCSV('active_employees.csv', [['Employee Name', 'NI Number', 'Email', 'Phone', 'Project', 'Hourly Rate', 'Status'], ...emps.map((e) => [e.full_name, e.ni_number || '', e.email || '', e.phone || '', e.default_project || '', e.default_rate ?? '', e.active === false ? 'Leaver' : 'Active'])]) }, icon('download'), 'Export')),
      shown.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'NI number', 'Email', 'Phone', 'Usual project', '£/h', run ? 'Hours in ' + (run.label.length > 18 ? run.label.slice(0, 17) + '…' : run.label) : 'Hours', 'Status'].map((t, i) => h('th', { class: i === 5 || i === 6 ? 'num' : '' }, t)))),
        h('tbody', null, shown.slice(0, 600).map((e) => h('tr', { style: e.active === false ? { opacity: .6 } : null }, h('td', null, h('b', null, e.full_name)), h('td', null, inp(e, 'ni_number', 'text', 110)), h('td', null, inp(e, 'email', 'email', 200)), h('td', null, inp(e, 'phone', 'text', 120)), h('td', null, inp(e, 'default_project', 'text', 200)),
          h('td', { class: 'num' }, inp(e, 'default_rate', 'number', 64)), h('td', { class: 'num' }, hrs(hb.get(e.id) ?? hb.get(e.name_key) ?? 0)),
          h('td', null, (() => { const s = h('select', { disabled: !can() }, h('option', { value: '1', selected: e.active !== false }, 'Active'), h('option', { value: '0', selected: e.active === false }, 'Leaver')); s.addEventListener('change', async () => { try { const on = s.value === '1'; await setEmployeeFields(e.id, { active: on, leaver_date: on ? null : new Date().toISOString().slice(0, 10) }); e.active = on; toast(on ? 'Marked active' : 'Marked as a leaver (kept for history)', 'ok'); draw(); } catch (er) { toast(er.message, 'err'); } }); return s; })())))))) : h('div', { class: 'card empty' }, 'No employees match.'),
      shown.length > 600 ? h('div', { class: 'small muted' }, `Showing the first 600 of ${shown.length} — search to narrow down.`) : null);
  }
  async function load() { [emps, lines] = await Promise.all([loadEmployeesFull(), run ? loadRunData(run.id).then((d) => d.lines).catch(() => []) : []]); draw(); }
  await load();
  return onLive(debounce((e) => { if (e.table === 'employees') load(); }, 800));
}
