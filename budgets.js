// Budgets: weekly hours per project (and per employee). Over budget = more hours worked than the budget.
import { loadProjectBudgets, saveProjectBudget, saveProjectBudgets, deleteProjectBudget, loadProjectStatus, loadEmployeeBudgets, saveEmployeeBudgets, deleteEmployeeBudget, applyEmployeeBudgets, onLive } from './api.js';
import { parseProjectBudgetRows, parseEmployeeBudgetRows } from './timesheet.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { h, clear, hrs, money, toast, modal, icon, statusPill, downloadCSV, debounce, confirmBox } from './ui.js';
import { ctx, currentRun, runPicker, runEditable } from './ctx.js';
import { normKey } from './parsers.js';

export async function render(root) {
  const run = currentRun(), can = () => ctx.canEdit;
  let tab = 'projects', budgets = [], status = [], ebs = [], q = '';
  const host = h('div'), file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hidden' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Budgets'), h('p', null, 'Weekly hours budgeted per project (and per employee). A project is over budget when it works more hours than this — ad-hoc hours are never counted.')), run ? runPicker(() => location.reload()) : null), file, host);

  const stBy = () => new Map(status.map((s) => [s.project_key, s]));
  const openFile = (cb) => { file.onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { const XLSX = await loadXLSX(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); cb(sheetRows(XLSX, wb.Sheets[wb.SheetNames[0]])); } catch (er) { toast(er.message || String(er), 'err'); } } }; file.click(); };

  function projectsTab() {
    const sb = stBy(), shown = budgets.filter((b) => !q || b.project_name.toLowerCase().includes(q)), have = new Set(budgets.map((b) => b.name_key));
    const missing = status.filter((s) => !have.has(s.project_key));
    const numInp = (b, key, ph) => { const i = h('input', { type: 'number', step: 'any', value: b[key] ?? '', placeholder: ph || '', disabled: !can(), style: { width: '92px', textAlign: 'right' } }); i.addEventListener('change', async () => { try { const v = i.value === '' ? null : +i.value; await saveProjectBudget({ name_key: b.name_key, project_name: b.project_name, weekly_hours: key === 'weekly_hours' ? (v ?? 0) : b.weekly_hours, client_rate: key === 'client_rate' ? v : b.client_rate }); b[key] = v; toast('Saved', 'ok'); await refresh(); } catch (e) { toast(e.message, 'err'); } }); return i; };
    return h('div', null,
      h('div', { class: 'toolbar' }, h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', placeholder: 'Project…', value: q, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) })), h('div', { class: 'grow' }),
        can() ? h('button', { class: 'btn', onClick: () => openFile((rows) => { const r = parseProjectBudgetRows(rows);
          modal('Import project budgets', (close) => h('div', { class: 'stack' }, h('div', null, h('b', null, r.rows.length + ' projects'), ` read — total ${hrs(r.rows.reduce((s, x) => s + x.weekly_hours, 0))} hours a week. Existing budgets for the same projects are replaced.`), r.errors.length ? h('div', { class: 'notice warn' }, r.errors.map((e) => `Row ${e.row}: ${e.text}`).join('; ')) : null,
            h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { try { await saveProjectBudgets(r.rows.map((x) => { const o = { name_key: x.name_key, project_name: x.project_name, weekly_hours: x.weekly_hours }; if (x.client_rate !== undefined) o.client_rate = x.client_rate; return o; })); close(); toast('Budgets saved', 'ok'); await refresh(); } catch (e) { toast(e.message, 'err'); } } }, 'Save budgets')))); }) }, icon('upload'), 'Import from Excel') : null,
        h('button', { class: 'btn', onClick: () => downloadCSV('project_budgets.csv', [['Project', 'Weekly Budgeted Hours', 'Client Rate'], ...budgets.map((b) => [b.project_name, b.weekly_hours, b.client_rate ?? ''])]) }, icon('download'), 'Export'),
        can() ? h('button', { class: 'btn primary', onClick: () => addProject() }, icon('plus'), 'Add budget') : null),
      missing.length ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, `${missing.length} project${missing.length === 1 ? '' : 's'} in this payroll ${missing.length === 1 ? 'has' : 'have'} no budget saved: `, missing.slice(0, 6).map((m) => h('a', { href: '#', style: { marginRight: '10px' }, onClick: (e) => { e.preventDefault(); addProject(m.project_name, m.weeks ? Math.round((+m.budget_hours / +m.weeks) * 100) / 100 : 0); } }, m.project_name)), missing.length > 6 ? `…and ${missing.length - 6} more` : '', ' — click one to give it a budget. Until then its line budgets are used.') : null,
      h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Project', 'Weekly budget (h)', 'Client rate £/h (ad-hoc)', run ? 'In ' + run.label : 'Payroll', 'Budget h', 'Worked h', 'Difference', 'Status', ''].map((t, i) => h('th', { class: i > 3 && i < 7 ? 'num' : '' }, t)))),
        h('tbody', null, shown.map((b) => { const s = sb.get(b.name_key);
          return h('tr', null, h('td', null, h('b', null, b.project_name)), h('td', { class: 'num' }, numInp(b, 'weekly_hours')), h('td', { class: 'num' }, numInp(b, 'client_rate', 'not set')), h('td', { class: 'muted small' }, s ? `${s.weeks} week${+s.weeks === 1 ? '' : 's'}` : 'not in this payroll'),
            h('td', { class: 'num' }, s ? hrs(s.budget_hours) : ''), h('td', { class: 'num' }, s ? hrs(s.worked_hours) : ''), h('td', { class: 'num ' + (s && +s.hours_difference > 0.25 ? 'neg' : s && +s.hours_difference < -0.25 ? 'pos' : '') }, s ? (+s.hours_difference > 0 ? '+' : '') + hrs(s.hours_difference) : ''), h('td', null, s ? statusPill(s.budget_status) : ''),
            h('td', null, can() ? h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmBox('Remove this budget?', `${b.project_name} will fall back to its line budgets.`, 'Remove', true)) { try { await deleteProjectBudget(b.name_key); await refresh(); } catch (e) { toast(e.message, 'err'); } } } }, '×') : null)); })))));
  }
  function addProject(name = '', hours = '') {
    modal('Add a project budget', (close) => { const n = h('input', { type: 'text', value: name, list: 'bp-list' }), hh = h('input', { type: 'number', step: 'any', value: hours }), cr = h('input', { type: 'number', step: 'any', placeholder: 'optional' });
      return h('div', { class: 'stack' }, h('datalist', { id: 'bp-list' }, status.map((s) => h('option', { value: s.project_name }))), h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, 'Project', n), h('label', { class: 'fld' }, 'Weekly budget (hours)', hh), h('label', { class: 'fld' }, 'Client rate £/h (ad-hoc)', cr)),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { if (!n.value.trim() || hh.value === '') return toast('Add the project and its weekly hours', 'err');
          try { await saveProjectBudget({ name_key: normKey(n.value), project_name: n.value.trim(), weekly_hours: +hh.value, client_rate: cr.value === '' ? null : +cr.value }); close(); toast('Saved', 'ok'); await refresh(); } catch (e) { toast(e.message, 'err'); } } }, 'Save'))); });
  }
  function employeesTab() {
    const shown = ebs.filter((b) => !q || [b.employee_name, b.project_name, b.ni_number].some((x) => x && String(x).toLowerCase().includes(q)));
    return h('div', null, h('div', { class: 'notice', style: { marginBottom: '12px' } }, 'Optional: give each person a weekly budget on a project (columns: Employee, NI Number, Project, Weekly Hours). A person is “over budget” when they work more hours than their own budget. Apply them to a payroll to copy them onto that payroll’s lines.'),
      h('div', { class: 'toolbar' }, h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', value: q, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) })), h('div', { class: 'grow' }),
        h('button', { class: 'btn', onClick: () => downloadCSV('employee_budgets_template.csv', [['Employee', 'NI Number', 'Project', 'Weekly Hours'], ['Jane Smith', 'AB123456C', 'Thurston', 20]]) }, icon('download'), 'Template'),
        can() ? h('button', { class: 'btn', onClick: () => openFile((rows) => { const r = parseEmployeeBudgetRows(rows); modal('Import employee budgets', (close) => h('div', { class: 'stack' }, h('div', null, h('b', null, r.rows.length + ' employee budgets'), ' read.'), r.errors.length ? h('div', { class: 'notice warn' }, r.errors.slice(0, 8).map((e) => `Row ${e.row}: ${e.text}`).join('; ')) : null,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { try { await saveEmployeeBudgets(r.rows); close(); toast('Employee budgets saved', 'ok'); await refresh(); } catch (e) { toast(e.message, 'err'); } } }, 'Save')))); }) }, icon('upload'), 'Import from Excel') : null,
        run && runEditable(run.id) ? h('button', { class: 'btn warn', onClick: async () => { try { const n = await applyEmployeeBudgets(run); toast(`Applied to ${n} line${n === 1 ? '' : 's'} in ${run.label}`, 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Apply to ' + (run.label.length > 20 ? 'this payroll' : run.label)) : null),
      shown.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Employee', 'NI', 'Project', 'Weekly hours', ''].map((t, i) => h('th', { class: i === 3 ? 'num' : '' }, t)))),
        h('tbody', null, shown.slice(0, 500).map((b) => h('tr', null, h('td', null, b.employee_name), h('td', null, b.ni_number || ''), h('td', null, b.project_name), h('td', { class: 'num' }, hrs(b.weekly_hours)), h('td', null, can() ? h('button', { class: 'btn sm danger', onClick: async () => { try { await deleteEmployeeBudget(b.id); await refresh(); } catch (e) { toast(e.message, 'err'); } } }, '×') : null)))))) : h('div', { class: 'card empty' }, 'No employee budgets yet — import them from Excel when you have them.'));
  }
  function draw() { clear(host).append(h('div', { class: 'seg', style: { marginBottom: '12px' } }, h('button', { class: tab === 'projects' ? 'on' : '', onClick: () => { tab = 'projects'; q = ''; draw(); } }, `Project budgets (${budgets.length})`), h('button', { class: tab === 'employees' ? 'on' : '', onClick: () => { tab = 'employees'; q = ''; draw(); } }, `Employee budgets (${ebs.length})`)), tab === 'projects' ? projectsTab() : employeesTab()); }
  async function refresh() { [budgets, status, ebs] = await Promise.all([loadProjectBudgets(), run ? loadProjectStatus(run.id).catch(() => []) : [], loadEmployeeBudgets().catch(() => [])]); draw(); }
  await refresh();
  return onLive(debounce((e) => { if (e.table === 'project_budgets') refresh(); }, 800));
}
