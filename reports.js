// Custom reports: pick any data in the system, choose columns, filter, group and total, chart it, export it, save it.
import { loadDataset, loadSavedReports, saveReport, deleteReport } from './api.js';
import { h, clear, toast, modal, icon, dmy, money, debounce, natCompare, confirmBox } from './ui.js';
import { ctx, currentRuns } from './ctx.js';
import { panel, expandAllBtn } from './panels.js';
import { exportRows } from './importer.js';

const SOURCES = [
  ['employees', 'Employees (incl. annual leave)', false, false], ['payroll_lines', 'Payroll lines (hours, pay, budget)', true, false], ['daily_hours', 'Daily hours', true, true],
  ['leave', 'Leave & SSP records', true, false], ['project_status', 'Project budget status', true, false], ['run_summary', 'Pay run totals by pay date', true, false],
  ['timesheets', 'Timesheets received', true, false], ['hr_cases', 'HR cases', false, false], ['cover_assignments', 'Cover assignments', false, false],
  ['cover_hours', 'Cover hours', false, true], ['clock_shifts', 'Clock in / out shifts', false, true], ['projects', 'Projects & POCs', false, false], ['email_log', 'Emails sent', false, false],
];
const STARTERS = [
  { name: 'Employees by area manager', def: { source: 'employees', groupBy: ['area_manager'], measures: [['count', ''], ['sum', 'weekly_hours'], ['sum', 'weekly_pay']], filters: [['emp_status', '=', 'active']] } },
  { name: 'Headcount by project and type', def: { source: 'employees', groupBy: ['default_project', 'employment_type'], measures: [['count', '']], filters: [['emp_status', '≠', 'terminated']] } },
  { name: 'Annual leave left by project', def: { source: 'employees', groupBy: ['default_project'], measures: [['sum', 'al_accrued'], ['sum', 'al_taken'], ['sum', 'al_remaining']], filters: [['emp_status', '=', 'active']] } },
  { name: 'Gross pay vs budget by project (current payroll)', def: { source: 'payroll_lines', current: true, groupBy: ['project_name'], measures: [['sum', 'actual_hours'], ['sum', 'gross_pay'], ['sum', 'budgeted_pay'], ['sum', 'difference']], sort: ['sum_difference', 'desc'] } },
  { name: 'Hours by pay date (current payroll)', def: { source: 'payroll_lines', current: true, groupBy: ['pay_group'], measures: [['count', ''], ['sum', 'actual_hours'], ['sum', 'gross_pay']] } },
  { name: 'Open HR cases by project', def: { source: 'hr_cases', groupBy: ['project_name', 'case_type'], measures: [['count', '']], filters: [['stage', '≠', 'closed']] } },
  { name: 'Cover hours by cover', def: { source: 'cover_hours', groupBy: ['cover_name'], measures: [['count', ''], ['sum', 'hours']] } },
  { name: 'Clocked hours by employee (last 7 days)', def: { source: 'clock_shifts', days: 7, groupBy: ['employee_name'], measures: [['count', ''], ['sum', 'hours']] } },
  { name: 'Leave days by type (current payroll)', def: { source: 'leave', current: true, groupBy: ['type_name'], measures: [['count', ''], ['sum', 'hours']] } },
];
const OPS = ['=', '≠', 'contains', '>', '≥', '<', '≤', 'is empty', 'not empty'];
const AGG = [['sum', 'Sum'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max'], ['count', 'Count']];
const nice = (k) => String(k).replace(/_/g, ' ').replace(/\b(id|ni|al|rtw|ssp|poc)\b/gi, (m) => m.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
const isNum = (v) => v !== null && v !== '' && typeof v !== 'boolean' && !Number.isNaN(+v) && !/^\d{4}-\d{2}-\d{2}/.test(String(v)) && !/^0\d/.test(String(v));
const r2 = (n) => Math.round(n * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);

export async function render(root) {
  let def = { source: 'employees', runIds: [], from: null, to: null, columns: [], filters: [], groupBy: [], measures: [], sort: null, limit: 0 };
  let rows = [], fields = [], numeric = new Set(), result = null, saved = [], current = null;
  const runs = ctx.runs.slice().sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)));
  const srcSel = h('select', { class: 'fsel' }, SOURCES.map(([k, t]) => h('option', { value: k }, t)));
  const runSel = h('select', { multiple: true, size: 1, class: 'fsel runsel', title: 'Hold Ctrl to pick several payrolls' }, runs.map((r) => h('option', { value: r.id }, `${r.stream === 'monthly' ? 'M' : 'F'} · ${r.label}`)));
  const from = h('input', { type: 'date' }), to = h('input', { type: 'date' });
  const savedSel = h('select', { class: 'fsel' });
  const status = h('span', { class: 'small muted' });
  const colsBody = h('div'), filtBody = h('div'), grpBody = h('div'), resBody = h('div'), chartBody = h('div');
  const pCols = panel('Columns', colsBody, { id: 'rep.cols', sub: ' · choose what to show' });
  const pFilt = panel('Filters', filtBody, { id: 'rep.filt' });
  const pGrp = panel('Group & totals', grpBody, { id: 'rep.grp', sub: ' · e.g. hours by project' });
  const resSub = h('span', { class: 'psub2' });
  const pRes = panel(h('span', null, 'Result ', resSub), resBody, { id: 'rep.res', actions: h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn sm', onClick: () => doExport('xlsx') }, icon('download'), 'Excel'), h('button', { class: 'btn sm', onClick: () => doExport('csv') }, 'CSV'), h('button', { class: 'btn sm', onClick: () => window.print() }, 'Print')) });
  const pChart = panel('Chart', chartBody, { id: 'rep.chart' });
  const stack = h('div', { class: 'hrstack' }, h('div', { class: 'pgrid2', style: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 0 } }, pCols, pFilt, pGrp), pRes, pChart);

  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Custom reports'), h('p', null, 'Report on anything in the system: pick the data, the columns, filters and totals. Export to Excel, or save it for next time.')),
    h('div', { class: 'row wrap' }, expandAllBtn(() => stack))),
  h('div', { class: 'card pad repbar' },
    h('label', { class: 'fld' }, 'Saved & ready-made reports', savedSel),
    h('label', { class: 'fld' }, 'Data', srcSel), h('label', { class: 'fld runwrap' }, 'Payroll(s)', runSel), h('label', { class: 'fld datewrap' }, 'From', from), h('label', { class: 'fld datewrap' }, 'To', to),
    h('div', { class: 'row', style: { alignSelf: 'end', gap: '6px' } }, h('button', { class: 'btn primary', onClick: () => load() }, icon('search'), 'Run report'), h('button', { class: 'btn', onClick: saveDlg }, 'Save'), status)),
  stack);

  const showInputs = () => { const s = SOURCES.find((x) => x[0] === srcSel.value); root.querySelector('.runwrap').classList.toggle('hidden', !s[2]); root.querySelectorAll('.datewrap').forEach((el) => el.classList.toggle('hidden', !s[3])); };
  srcSel.onchange = () => { def = { ...def, source: srcSel.value, columns: [], filters: [], groupBy: [], measures: [], sort: null }; current = null; showInputs(); load(); };
  const cur = () => { const ids = currentRuns().map((r) => r.id); return ids.length ? ids : runs.slice(0, 1).map((r) => r.id); };

  async function fillSaved() {
    try { saved = await loadSavedReports(); } catch { saved = []; }
    clear(savedSel).append(h('option', { value: '' }, '— pick a report —'), h('optgroup', { label: 'Ready-made' }, STARTERS.map((s, i) => h('option', { value: 'st:' + i }, s.name))),
      saved.length ? h('optgroup', { label: 'Saved' }, saved.map((s) => h('option', { value: 'sv:' + s.id }, s.name + (s.shared ? '' : ' (only me)')))) : null);
  }
  savedSel.onchange = () => {
    const v = savedSel.value; if (!v) return;
    let d;
    if (v.startsWith('st:')) { d = JSON.parse(JSON.stringify(STARTERS[+v.slice(3)].def)); current = null; }
    else { const r = saved.find((x) => x.id === v.slice(3)); d = r.definition; current = r; }
    if (d.current) d.runIds = cur();
    if (d.days) { d.to = iso(new Date()); d.from = iso(new Date(Date.now() - d.days * 864e5)); }
    def = { columns: [], filters: [], groupBy: [], measures: [], sort: null, limit: 0, runIds: [], ...d };
    srcSel.value = def.source; [...runSel.options].forEach((o) => { o.selected = (def.runIds || []).includes(o.value); }); from.value = def.from || ''; to.value = def.to || ''; showInputs();
    load(true);
  };

  async function load(keep) {
    const s = SOURCES.find((x) => x[0] === srcSel.value);
    def.runIds = s[2] ? ([...runSel.selectedOptions].map((o) => o.value).length ? [...runSel.selectedOptions].map((o) => o.value) : cur()) : [];
    if (s[2] && !runSel.selectedOptions.length) [...runSel.options].forEach((o) => { o.selected = def.runIds.includes(o.value); });
    if (s[3] && !from.value) { from.value = iso(new Date(Date.now() - 30 * 864e5)); to.value = iso(new Date()); }
    def.from = s[3] ? from.value || null : null; def.to = s[3] ? to.value || null : null;
    status.textContent = 'Loading…';
    try { rows = await loadDataset(def.source, def); } catch (e) { status.textContent = ''; return toast(e.message, 'err'); }
    const keys = new Set(); for (const r of rows.slice(0, 500)) Object.keys(r).forEach((k) => keys.add(k));
    fields = [...keys].filter((k) => !/^(id|line_id|run_id|in_id|out_id|case_id|project_id|updated_by|created_by)$/.test(k) && rows.some((r) => r[k] !== null && r[k] !== undefined && typeof r[k] !== 'object'));
    numeric = new Set(fields.filter((k) => { const v = rows.map((r) => r[k]).filter((x) => x !== null && x !== undefined && x !== ''); return v.length && v.slice(0, 200).every(isNum) && !/(_code|ni_number|phone|pay_group)$/.test(k); }));
    if (!keep || !def.columns.length) def.columns = fields.filter((k) => !/_id$/.test(k)).slice(0, 12);
    def.columns = def.columns.filter((c) => fields.includes(c) || /^(count|sum_|avg_|min_|max_)/.test(c));
    status.textContent = `${rows.length.toLocaleString('en-GB')} rows`;
    drawBuilder(); compute();
  }

  function drawBuilder() {
    // columns
    clear(colsBody).append(h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } }, h('button', { class: 'btn sm', onClick: () => { def.columns = [...fields]; drawBuilder(); compute(); } }, 'All'), h('button', { class: 'btn sm', onClick: () => { def.columns = []; drawBuilder(); compute(); } }, 'None'), h('span', { class: 'small muted' }, `${def.columns.length} of ${fields.length} chosen`)),
      h('div', { class: 'colpick' }, fields.map((k) => h('label', { class: 'chip' + (def.columns.includes(k) ? ' on' : '') }, h('input', { type: 'checkbox', checked: def.columns.includes(k), onChange: (e) => { def.columns = e.target.checked ? [...def.columns, k] : def.columns.filter((x) => x !== k); drawBuilder(); compute(); } }), nice(k), numeric.has(k) ? h('span', { class: 'small muted' }, ' #') : null))));
    // filters
    const fieldSel = (v, on) => h('select', { onChange: on }, fields.map((k) => h('option', { value: k, selected: k === v }, nice(k))));
    clear(filtBody).append(h('div', { class: 'stack' }, def.filters.map((f, i) => h('div', { class: 'frow' },
        fieldSel(f[0], (e) => { f[0] = e.target.value; compute(); }), h('select', { onChange: (e) => { f[1] = e.target.value; drawBuilder(); compute(); } }, OPS.map((o) => h('option', { selected: o === f[1] }, o))),
        /empty/.test(f[1]) ? h('span') : h('input', { type: 'text', value: f[2] ?? '', list: 'rep-vals-' + i, placeholder: 'value', onInput: debounce((e) => { f[2] = e.target.value; compute(); }, 250) }),
        h('datalist', { id: 'rep-vals-' + i }, [...new Set(rows.map((r) => r[f[0]]).filter((x) => x !== null && x !== undefined && x !== ''))].slice(0, 200).map((x) => h('option', { value: String(x) }))),
        h('button', { class: 'btn sm', onClick: () => { def.filters.splice(i, 1); drawBuilder(); compute(); } }, icon('x')))),
      h('button', { class: 'btn sm', onClick: () => { def.filters.push([fields[0], '=', '']); drawBuilder(); } }, icon('plus'), 'Add filter')));
    // group + measures
    const numF = fields.filter((k) => numeric.has(k));
    clear(grpBody).append(h('div', { class: 'stack' },
      h('label', { class: 'fld' }, 'Group by', h('div', { class: 'row', style: { gap: '6px' } }, [0, 1].map((i) => h('select', { onChange: (e) => { def.groupBy[i] = e.target.value; def.groupBy = def.groupBy.filter(Boolean); drawBuilder(); compute(); } }, h('option', { value: '' }, i ? '(then by…)' : '(no grouping)'), fields.filter((k) => !numeric.has(k) || /year|week|month/.test(k)).map((k) => h('option', { value: k, selected: def.groupBy[i] === k }, nice(k))))))),
      def.groupBy.length ? h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Totals for each group'), def.measures.map((m, i) => h('div', { class: 'mrow' },
          h('select', { onChange: (e) => { m[0] = e.target.value; drawBuilder(); compute(); } }, AGG.map(([k, t]) => h('option', { value: k, selected: k === m[0] }, t))),
          m[0] === 'count' ? h('span', { class: 'small muted' }, 'rows') : h('select', { onChange: (e) => { m[1] = e.target.value; compute(); } }, (numF.includes(m[1]) || !m[1] ? numF : [m[1], ...numF]).map((k) => h('option', { value: k, selected: k === m[1] }, nice(k)))),
          h('button', { class: 'btn sm', onClick: () => { def.measures.splice(i, 1); drawBuilder(); compute(); } }, icon('x')))),
        h('button', { class: 'btn sm', onClick: () => { def.measures.push(numF.length ? ['sum', numF[0]] : ['count', '']); drawBuilder(); compute(); } }, icon('plus'), 'Add total')) : null));
  }

  const passes = (r) => def.filters.every(([k, op, v]) => {
    const x = r[k], s = String(x ?? '').toLowerCase(), t = String(v ?? '').toLowerCase().trim();
    if (op === 'is empty') return x === null || x === undefined || x === ''; if (op === 'not empty') return !(x === null || x === undefined || x === '');
    if (op === 'contains') return s.includes(t);
    const both = isNum(x) && isNum(v); const a = both ? +x : s, b = both ? +v : t;
    return op === '=' ? a === b : op === '≠' ? a !== b : op === '>' ? a > b : op === '≥' ? a >= b : op === '<' ? a < b : a <= b;
  });

  function compute() {
    const data = rows.filter(passes);
    let cols, out;
    if (def.groupBy.length) {
      const ms = def.measures.length ? def.measures : [['count', '']];
      const mk = (m) => (m[0] === 'count' ? 'count' : `${m[0]}_${m[1]}`);
      const g = new Map();
      for (const r of data) { const key = def.groupBy.map((k) => r[k] ?? '(blank)').join('\u0001'); if (!g.has(key)) g.set(key, { vals: def.groupBy.map((k) => r[k] ?? '(blank)'), rows: [] }); g.get(key).rows.push(r); }
      out = [...g.values()].map(({ vals, rows: rs }) => { const o = {}; def.groupBy.forEach((k, i) => { o[k] = vals[i]; });
        for (const m of ms) { const nums = rs.map((r) => +r[m[1]]).filter((n) => !Number.isNaN(n)); o[mk(m)] = m[0] === 'count' ? rs.length : !nums.length ? null : m[0] === 'sum' ? r2(nums.reduce((s, n) => s + n, 0)) : m[0] === 'avg' ? r2(nums.reduce((s, n) => s + n, 0) / nums.length) : m[0] === 'min' ? Math.min(...nums) : Math.max(...nums); }
        return o; });
      cols = [...def.groupBy, ...ms.map(mk)];
    } else { out = data; cols = def.columns.length ? def.columns : fields.slice(0, 12); }
    const sk = def.sort && cols.includes(def.sort[0]) ? def.sort : def.groupBy.length ? [cols[cols.length - 1], 'desc'] : null;
    if (sk) out = out.slice().sort((a, b) => { const x = a[sk[0]], y = b[sk[0]]; const c = isNum(x) && isNum(y) ? +x - +y : natCompare(String(x ?? ''), String(y ?? '')); return sk[1] === 'desc' ? -c : c; });
    result = { cols, rows: out, total: data.length };
    drawResult(sk);
  }
  const label = (c) => (c === 'count' ? 'Count' : /^(sum|avg|min|max)_/.test(c) ? `${{ sum: 'Total', avg: 'Average', min: 'Min', max: 'Max' }[c.split('_')[0]]} ${nice(c.split('_').slice(1).join('_')).toLowerCase()}` : nice(c));
  const moneyish = (c) => /(pay|gross|budget|difference|amount|rate|charge|net|tax|pension|salary)/.test(c) && !/hours|count|status/.test(c);
  const fmt = (c, v) => (v === null || v === undefined || v === '' ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? dmy(v) : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : isNum(v) && (numeric.has(c) || /^(count|sum_|avg_|min_|max_)/.test(c)) ? (moneyish(c) ? money(+v) : (+v).toLocaleString('en-GB', { maximumFractionDigits: 2 })) : String(v));

  function drawResult(sk) {
    const { cols, rows: out, total } = result;
    resSub.textContent = def.groupBy.length ? `· ${out.length} groups from ${total} rows` : `· ${out.length} rows`;
    const numCols = cols.filter((c) => out.some((r) => isNum(r[c])) && (numeric.has(c) || /^(count|sum_|avg_|min_|max_)/.test(c)));
    const sums = Object.fromEntries(numCols.filter((c) => !/^(avg|min|max)_/.test(c) && !/rate|_code|year/.test(c)).map((c) => [c, r2(out.reduce((s, r) => s + (+r[c] || 0), 0))]));
    const show = out.slice(0, 2000);
    clear(resBody).append(out.length ? h('div', { class: 'tablewrap', style: { maxHeight: '62vh' } }, h('table', { class: 't' },
      h('thead', null, h('tr', null, cols.map((c) => h('th', { class: 'click' + (numCols.includes(c) ? ' num' : ''), title: 'Sort', onClick: () => { def.sort = [c, sk && sk[0] === c && sk[1] === 'desc' ? 'asc' : 'desc']; compute(); } }, label(c), sk && sk[0] === c ? (sk[1] === 'desc' ? ' ▼' : ' ▲') : '')))),
      h('tbody', null, show.map((r) => h('tr', null, cols.map((c) => h('td', { class: numCols.includes(c) ? 'num' : '' }, fmt(c, r[c])))))),
      Object.keys(sums).length ? h('tfoot', null, h('tr', null, cols.map((c, i) => h('td', { class: numCols.includes(c) ? 'num' : '' }, h('b', null, i === 0 && !(c in sums) ? 'Total' : c in sums ? fmt(c, sums[c]) : ''))))) : null)) : h('div', { class: 'small muted' }, rows.length ? 'No rows match the filters.' : 'Pick the data and press Run report.'),
      out.length > 2000 ? h('div', { class: 'small muted' }, `Showing the first 2,000 of ${out.length} rows — export to see them all.`) : null);
    // chart: first group column against the first total
    const m = def.groupBy.length ? cols.find((c) => /^(count|sum_|avg_|min_|max_)/.test(c)) : null;
    if (!m) { clear(chartBody).append(h('div', { class: 'small muted' }, 'Group the data (in “Group & totals”) to see a chart.')); return; }
    const top = out.slice(0, 30), max = Math.max(1, ...top.map((r) => Math.abs(+r[m] || 0)));
    clear(chartBody).append(h('div', { class: 'small muted', style: { marginBottom: '8px' } }, `${label(m)} by ${def.groupBy.map(nice).join(' / ').toLowerCase()}${out.length > 30 ? ' (top 30)' : ''}`),
      h('div', { class: 'cmp' }, top.map((r) => h('div', { class: 'cmprow' }, h('div', { class: 'lab', title: def.groupBy.map((k) => r[k]).join(' / ') }, def.groupBy.map((k) => fmt(k, r[k])).join(' / ')), h('div', { class: 'cmpbar' }, h('i', { style: { width: (Math.abs(+r[m] || 0) / max * 100) + '%', background: +r[m] < 0 ? '#ef4444' : 'linear-gradient(90deg,#6c5ce7,#2563eb)' } }), h('span', null, fmt(m, r[m])))))));
  }

  function doExport(kind) {
    if (!result || !result.rows.length) return toast('Run a report first', 'err');
    const name = (current ? current.name : SOURCES.find((x) => x[0] === def.source)[1]).replace(/[^\w]+/g, '_').toLowerCase();
    if (kind === 'csv') { const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; const blob = new Blob(['\ufeff' + [result.cols.map(label), ...result.rows.map((r) => result.cols.map((c) => r[c]))].map((x) => x.map(esc).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.csv'; a.click(); return; }
    exportRows({ columns: result.cols.map((c) => ({ key: c, label: label(c), out: (r) => (isNum(r[c]) && (numeric.has(c) || /^(count|sum_|avg_|min_|max_)/.test(c)) ? +r[c] : r[c]) })) }, result.rows, name + '.xlsx').catch((e) => toast(e.message, 'err'));
  }

  function saveDlg() {
    modal(current ? `Save “${current.name}”` : 'Save this report', (done) => {
      const nm = h('input', { type: 'text', value: current ? current.name : '' }), sh = h('input', { type: 'checkbox', checked: current ? current.shared : true });
      const kc = h('input', { type: 'checkbox', checked: true });
      return h('div', { class: 'stack' }, h('label', { class: 'fld' }, 'Report name', nm), h('label', { class: 'row small' }, sh, 'Everyone with access to reports can use it'),
        SOURCES.find((x) => x[0] === def.source)[2] ? h('label', { class: 'row small' }, kc, 'Always use the current payroll when it is opened (instead of the payrolls picked now)') : null,
        h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          current && (ctx.isSuper || current.owner_email === (ctx.me && ctx.me.email)) ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Delete report?', `Delete “${current.name}”?`, 'Delete', true)) { await deleteReport(current.id); current = null; done(); fillSaved(); toast('Deleted', 'ok'); } } }, icon('trash')) : h('span'),
          h('div', { class: 'row' }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
            if (!nm.value.trim()) return toast('Give it a name', 'err');
            const d = { ...def, current: kc.checked && SOURCES.find((x) => x[0] === def.source)[2] }; if (d.current) delete d.runIds;
            try { current = await saveReport({ id: current && current.name === nm.value.trim() ? current.id : null, name: nm.value.trim(), shared: sh.checked, definition: d }); done(); await fillSaved(); savedSel.value = 'sv:' + current.id; toast('Report saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
          } }, 'Save'))));
    });
  }

  showInputs(); await fillSaved(); await load();
}
