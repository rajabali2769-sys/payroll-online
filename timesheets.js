// Timesheets: upload a photo / PDF / Word timesheet, see it beside an entry grid, check it, and write it into payroll.
import { loadTimesheets, saveTimesheet, deleteTimesheet, uploadTimesheetFile, timesheetUrl, commitEntries, loadRunData, onLive } from './api.js';
import { parseDayCell, parseTimesheetText, mondayOfISO, addDaysISO, DAY_NAMES } from './timesheet.js';
import { pdfText, docxText } from './xlsx.js';
import { h, clear, hrs, dmy, ago, toast, icon, confirmBox, debounce } from './ui.js';
import { ctx, currentRun, runPicker, runEditable } from './ctx.js';
import { normKey } from './parsers.js';

const KIND = { handwritten: ['camera', 'Handwritten'], digital: ['file', 'Digital'], manual: ['table', 'Keyed in'] };
const sumHours = (entries) => (entries || []).reduce((s, e) => s + (e.days || []).reduce((a, raw) => { const p = parseDayCell(raw || ''); return a + (p.hours || 0); }, 0), 0);

export async function render(root) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file or start a pay run first.')); return; }
  let list = [], lines = [];
  const editable = () => runEditable(run.id);
  const host = h('div'), chips = h('div', { class: 'chips', style: { marginBottom: '12px' } });
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/*,.pdf,.docx,.doc', class: 'hidden', onChange: (e) => handleFiles([...e.target.files]) });
  const drop = h('div', { class: 'drop', style: { padding: '22px', marginBottom: '14px' }, onClick: () => fileIn.click() },
    h('div', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>' }),
    h('b', null, 'Drop timesheets here — photos of handwritten sheets, PDFs or Word (.docx) files'), h('div', { class: 'muted' }, 'Each one is stored safely, and digital ones are read automatically. You can add several at once.'));
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Timesheets'), h('p', null, 'Handwritten or digital — attach it, key it in beside the original, and it flows into payroll. Once the run is locked nobody can change it.')),
    h('div', { class: 'row' }, runPicker(() => location.reload()), editable() ? h('button', { class: 'btn primary', onClick: () => openEditor(null) }, icon('plus'), 'Key in a timesheet') : null)),
    run.status === 'locked' ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, '🔒 This pay run is locked, so timesheets are read-only.') : editable() ? drop : null, fileIn, chips, host);

  function draw() {
    const c = (k) => list.filter((t) => t.status === k).length;
    clear(chips).append(h('span', { class: 'cn r' }, c('received') + ' received'), h('span', { class: 'cn b' }, c('keyed') + ' keyed'), h('span', { class: 'cn g' }, c('checked') + ' checked'), h('span', { class: 'small muted' }, `${list.length} timesheet${list.length === 1 ? '' : 's'}`));
    clear(host).append(list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['Week', 'Project / site', 'Source', 'People', 'Hours keyed', 'Status', 'Added', ''].map((t, i) => h('th', { class: i === 3 || i === 4 ? 'num' : '' }, t)))),
      h('tbody', null, list.map((t) => { const [ic, kl] = KIND[t.kind] || KIND.manual;
        return h('tr', { class: 'clickrow', onClick: () => openEditor(t) }, h('td', null, 'w/c ' + dmy(t.week_start)), h('td', null, h('b', null, t.project_name), t.site_name ? h('div', { class: 'small muted' }, t.site_name) : null),
          h('td', null, h('span', { class: 'row small', style: { gap: '6px' } }, icon(ic), kl, t.file_name ? h('span', { class: 'muted' }, '· ' + t.file_name.slice(0, 22)) : null)),
          h('td', { class: 'num' }, (t.entries || []).length), h('td', { class: 'num' }, hrs(sumHours(t.entries))),
          h('td', null, h('span', { class: 'cn ' + ({ received: 'r', keyed: 'b', checked: 'g' }[t.status]) }, t.status)), h('td', { class: 'muted' }, ago(t.created_at)),
          h('td', null, h('span', { class: 'btn sm' }, 'Open'), ' ', editable() ? h('button', { class: 'btn sm danger', onClick: async (e) => { e.stopPropagation(); if (await confirmBox('Delete this timesheet?', 'The stored file is removed. Hours already written into payroll stay as they are.', 'Delete', true)) { try { await deleteTimesheet(t); await load(); } catch (er) { toast(er.message, 'err'); } } } }, '×') : null)); })))) : h('div', { class: 'card empty' }, 'No timesheets yet.'));
  }
  async function load() { try { list = await loadTimesheets(run.id); } catch (e) { list = []; toast(e.message, 'err'); } draw(); }

  // ---------- reading uploaded files ----------
  const projectsInRun = () => [...new Set(lines.map((l) => l.project_name))].sort((a, b) => a.localeCompare(b));
  function guessProject(client) {
    if (!client) return null; const words = normKey(client).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !['school', 'college', 'community', 'academy', 'primary', 'limited'].includes(w));
    let best = null, score = 0; for (const p of projectsInRun()) { const k = normKey(p); const s = words.filter((w) => k.includes(w)).length + (k === normKey(client) ? 5 : 0); if (s > score) { best = p; score = s; } } return score ? best : null;
  }
  function guessEmployee(fileName, project) {
    const toks = normKey(fileName.replace(/\.[^.]+$/, '')).split(/[^a-z]+/).filter((t) => t.length >= 3); if (!toks.length) return null;
    const names = [...new Set(lines.filter((l) => !project || l.project_name === project).map((l) => l.employee_name))];
    const scored = names.map((n) => ({ n, s: normKey(n).split(/\s+/).filter((p) => p.length >= 3 && toks.some((t) => t.startsWith(p.slice(0, 4)) || p.startsWith(t.slice(0, 4)))).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.length && (scored.length === 1 || scored[0].s > scored[1].s) ? scored[0].n : null;
  }
  async function handleFiles(files) {
    if (!editable()) return;
    let first = null;
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      try {
        if (ext === 'doc') { toast(`“${f.name}” is an old Word .doc, which a browser cannot read. Save it as .docx or PDF (File → Save As) and upload again, or upload a photo of it.`, 'err'); continue; }
        if (!(f.type.startsWith('image/') || ['pdf', 'docx'].includes(ext))) { toast(`“${f.name}”: please upload a photo, PDF or .docx timesheet. For spreadsheets use Upload hours.`, 'err'); continue; }
        const path = await uploadTimesheetFile(run.id, f);
        const digital = !f.type.startsWith('image/');
        let project = null, week = mondayOfISO(run.period_start || new Date().toISOString().slice(0, 10)), entries = [], note = null;
        if (digital) {
          try {
            const p = parseTimesheetText(ext === 'pdf' ? await pdfText(f) : await docxText(f));
            project = guessProject(p.client); if (p.weekStart) week = p.weekStart;
            const cells = p.days.map((d) => (d.in && d.out ? `${d.in}-${d.out}` : '')), emp = guessEmployee(f.name, project);
            entries = [{ employee: emp || '', ni: '', rate: '', days: cells, stated: p.statedTotal ? String(p.statedTotal) : '' }];
            note = `Read from the file: ${p.client || 'client not found'} · week commencing ${p.weekStart || '?'} · ${p.statedTotal || 0} hours stated.${p.days.some((d) => d.breakMins) ? ' A break is listed on the form — hours shown are as stated on the form; check whether the break should be deducted.' : ''}`;
          } catch (er) { note = 'Could not read this file automatically (' + (er.message || er) + '). Key it in beside the original.'; }
        }
        const id = await saveTimesheet({ run_id: run.id, project_name: project || 'Unassigned', week_start: week, kind: digital ? 'digital' : 'handwritten', status: 'received', file_path: path, file_name: f.name, file_type: f.type || ext, entries, notes: note });
        if (!first) first = id;
      } catch (e) { toast(`${f.name}: ${e.message || e}`, 'err'); }
    }
    fileIn.value = ''; await load(); if (first) { const t = list.find((x) => x.id === first); if (t) openEditor(t); }
  }

  // ---------- the entry screen ----------
  async function openEditor(t) {
    const E = t ? { ...t, rows: (t.entries || []).map((e) => ({ employee: e.employee || '', ni: e.ni || '', rate: e.rate ?? '', cells: [...(e.days || [])].concat(Array(7).fill('')).slice(0, 7), orig: [...(e.days || [])].concat(Array(7).fill('')).slice(0, 7), stated: e.stated ?? '' })) }
      : { id: null, project_name: projectsInRun()[0] || '', site_name: '', week_start: mondayOfISO(run.period_start || new Date().toISOString().slice(0, 10)), supervisor: '', status: 'received', kind: 'manual', rows: [], file_path: null, notes: '' };
    const can = editable();
    const overlay = h('div', { class: 'overlay' }), panel = h('div', { class: 'drawer', style: { width: 'min(1280px, 98vw)' } });
    overlay.append(panel); const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); }; const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) close(); };
    document.addEventListener('keydown', esc); overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); }); document.body.append(overlay);

    const leaveBy = new Map(ctx.leaveTypes.filter((x) => x.active !== false).map((x) => [x.code.toUpperCase(), x]));
    const wk = () => DAY_NAMES.map((_, i) => addDaysISO(E.week_start, i));
    const linesFor = () => lines.filter((l) => l.project_name === E.project_name && (!E.site_name || !l.site_name || normKey(l.site_name) === normKey(E.site_name)));
    const match = (r) => linesFor().find((l) => normKey(l.employee_name) === normKey(r.employee)) || lines.find((l) => l.project_name === E.project_name && normKey(l.employee_name) === normKey(r.employee));
    function cell(raw, r) {
      const txt = String(raw || '').trim(); if (!txt) return { kind: 'empty', hours: 0 };
      const m = txt.match(/^([A-Za-z]{2,10})\b[\s:]*(.*)$/);
      if (m && leaveBy.has(m[1].toUpperCase())) { const lt = leaveBy.get(m[1].toUpperCase()); const rest = m[2] ? parseDayCell(m[2]).hours : null; const ln = match(r); const def = ln && +ln.budgeted_hours ? +ln.budgeted_hours / 5 : 0; return { kind: 'leave', lt, hours: lt.ssp ? 0 : (rest ?? def) }; }
      const p = parseDayCell(txt); return p.kind === 'invalid' ? { kind: 'invalid', hours: 0 } : { kind: 'work', hours: p.hours || 0, empty: p.hours === null };
    }

    const body = h('div'); const viewer = h('div', { class: 'viewer' });
    const proj = h('input', { type: 'text', value: E.project_name, list: 'tsproj', disabled: !can, onChange: (e) => { E.project_name = e.target.value.trim(); refreshAll(); } });
    const site = h('input', { type: 'text', value: E.site_name || '', disabled: !can, onChange: (e) => { E.site_name = e.target.value.trim(); refreshAll(); } });
    const week = h('input', { type: 'date', value: E.week_start, disabled: !can, onChange: (e) => { if (e.target.value) { E.week_start = mondayOfISO(e.target.value); week.value = E.week_start; drawGrid(); } } });
    const sup = h('input', { type: 'text', value: E.supervisor || '', disabled: !can, onChange: (e) => { E.supervisor = e.target.value; } });
    const status = h('select', { disabled: !can, onChange: (e) => { E.status = e.target.value; } }, ['received', 'keyed', 'checked'].map((s) => h('option', { value: s, selected: E.status === s }, s === 'received' ? 'Received — not keyed' : s === 'keyed' ? 'Keyed — to check' : 'Checked')));
    const gridHost = h('div'), summary = h('div', { class: 'small muted' });

    function drawGrid() {
      const dates = wk(), tbody = h('tbody'), emps = h('datalist', { id: 'tsemp' }, [...new Set(lines.filter((l) => l.project_name === E.project_name).map((l) => l.employee_name))].sort().map((n) => h('option', { value: n })));
      const refs = [];
      E.rows.forEach((r, ri) => {
        const ni = h('input', { type: 'text', class: 'sm', style: { width: '104px', textAlign: 'left' }, value: r.ni, placeholder: 'NI', disabled: !can, onChange: (e) => { r.ni = e.target.value.trim().toUpperCase(); } });
        const rate = h('input', { type: 'number', step: 'any', class: 'sm', value: r.rate, placeholder: '£/h', disabled: !can, onChange: (e) => { r.rate = e.target.value; recalc(); } });
        const emp = h('input', { type: 'text', class: 'nm', value: r.employee, list: 'tsemp', placeholder: 'Employee', disabled: !can, onChange: (e) => { r.employee = e.target.value.trim(); const l = match(r); if (l) { if (!r.ni) r.ni = l.ni_number || ''; r.rate = l.hourly_rate; ni.value = r.ni; rate.value = r.rate; } recalc(); } });
        const inputs = r.cells.map((val, ci) => { const i = h('input', { type: 'text', class: 'cellin', value: val, placeholder: '9.30-14.30', disabled: !can, onInput: (e) => { r.cells[ci] = e.target.value; recalc(); } }); return i; });
        const total = h('b'), stated = h('input', { type: 'number', step: 'any', class: 'sm', value: r.stated, placeholder: 'stated', disabled: !can, onInput: (e) => { r.stated = e.target.value; recalc(); } }), flag = h('span');
        refs.push({ r, inputs, total, flag });
        tbody.append(h('tr', null, h('td', { class: 'muted' }, String(ri + 1)), h('td', null, emp), h('td', null, ni), h('td', null, rate), inputs.map((i) => h('td', null, i)), h('td', { class: 'num' }, total), h('td', null, stated), h('td', null, flag),
          h('td', null, can ? h('button', { class: 'btn sm danger', onClick: () => { E.rows.splice(ri, 1); drawGrid(); } }, '×') : null)));
      });
      function recalc() {
        let all = 0, bad = 0, warn = 0;
        for (const { r, inputs, total, flag } of refs) {
          let t = 0, invalid = false, leaveDays = 0;
          r.cells.forEach((raw, ci) => { const c = cell(raw, r); inputs[ci].classList.toggle('bad', c.kind === 'invalid'); inputs[ci].classList.toggle('leave', c.kind === 'leave'); if (c.kind === 'invalid') invalid = true; if (c.kind === 'work') t += c.hours; if (c.kind === 'leave') leaveDays++; });
          total.textContent = hrs(t) + (leaveDays ? ` +${leaveDays}L` : ''); all += t;
          const stated = r.stated === '' ? null : +r.stated, ln = match(r), problems = [];
          if (!r.employee) problems.push(['bad', 'name?']); if (invalid) problems.push(['bad', 'check a cell']);
          if (r.employee && !ln && !(+r.rate > 0)) problems.push(['warn', 'new person: add £/h']);
          if (stated !== null && Math.abs(stated - t) > 0.01) problems.push(['warn', `stated ${hrs(stated)}h ≠ ${hrs(t)}h`]);
          if (r.cells.some((x) => cell(x, r).kind === 'work' && cell(x, r).hours > 16)) problems.push(['warn', 'over 16h in a day']);
          clear(flag).append(...(problems.length ? problems.map(([k, m]) => h('span', { class: 'flag ' + k, style: { marginRight: '4px' } }, m)) : [h('span', { class: 'flag ok' }, ln ? '✓ matched' : '✓')]));
          bad += problems.filter((p) => p[0] === 'bad').length; warn += problems.filter((p) => p[0] === 'warn').length;
        }
        summary.textContent = `${E.rows.length} people · ${hrs(all)} hours · ${bad ? bad + ' to fix' : 'nothing blocking'}${warn ? ' · ' + warn + ' to look at' : ''}`;
      }
      clear(gridHost).append(emps, h('div', { class: 'tablewrap auto entrygrid', style: { maxHeight: '52vh' } }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Employee'), h('th', null, 'NI'), h('th', null, '£/h'), dates.map((d, i) => h('th', { class: 'center' }, `${DAY_NAMES[i].slice(0, 3)} ${+d.slice(8)}`)), h('th', { class: 'num' }, 'Hours'), h('th', null, 'Stated'), h('th', null, 'Check'), h('th'))), tbody)));
      recalc();
    }
    const refreshAll = () => { drawGrid(); };

    // viewer (the original sheet, beside the grid)
    async function drawViewer() {
      clear(viewer);
      if (!E.file_path) { viewer.append(h('div', { class: 'vhint' }, 'No file attached — this timesheet is being keyed in directly.')); return; }
      viewer.append(h('div', { class: 'vhint' }, 'Loading the original…'));
      try {
        const url = await timesheetUrl(E.file_path), ty = E.file_type || '';
        clear(viewer);
        if (ty.startsWith('image') || /\.(jpe?g|png|webp|gif)$/i.test(E.file_name || '')) viewer.append(h('a', { href: url, target: '_blank', title: 'Open full size' }, h('img', { src: url, alt: 'Timesheet' })), h('div', { class: 'vhint' }, 'Click the picture to open it full size. Read the times beside it and type them in.'));
        else if (/pdf/i.test(ty) || /\.pdf$/i.test(E.file_name || '')) viewer.append(h('iframe', { src: url }));
        else viewer.append(h('div', { class: 'vhint' }, h('b', { style: { color: '#fff' } }, E.file_name), h('br'), 'Word file — its times were read automatically into the grid.', h('br'), h('a', { href: url, style: { color: '#9fb3ff' } }, 'Download the original')));
      } catch (e) { clear(viewer).append(h('div', { class: 'vhint' }, 'Could not open the file: ' + e.message)); }
    }

    async function save() {
      if (!E.project_name || E.project_name === 'Unassigned') return toast('Choose the project this timesheet is for', 'err');
      const rows = E.rows.filter((r) => r.employee || r.cells.some((x) => String(x).trim())); if (!rows.length) return toast('Add at least one person', 'err');
      const dates = wk(), entries = [];
      for (const r of rows) {
        if (!r.employee) return toast('Every row needs an employee name', 'err');
        const cells = r.cells.map((x) => cell(x, r)); if (cells.some((c) => c.kind === 'invalid')) return toast(`${r.employee}: a day cell is not understood — use times like 9.30-14.30, hours like 5, or a leave code like AL 5`, 'err');
        const ln = match(r); const rate = +r.rate > 0 ? +r.rate : ln ? +ln.hourly_rate : 0; if (!ln && !(rate > 0)) return toast(`${r.employee} is not in this pay run yet — add their hourly rate (£/h)`, 'err');
        entries.push({ project: ln ? ln.project_name : E.project_name, site: E.site_name || (ln ? ln.site_name : null), employee_name: ln ? ln.employee_name : r.employee, ni: r.ni || (ln && ln.ni_number) || null, rate: +r.rate > 0 ? rate : null,
          // only touch a day if it has something typed now, or had something typed when this sheet was last saved (so a Mon–Fri sheet never wipes weekend hours from elsewhere)
          days: dates.map((d, i) => ({ date: d, hours: cells[i].kind === 'work' && !cells[i].empty ? cells[i].hours : null })).filter((_, i) => cells[i].kind !== 'empty' || String((r.orig || [])[i] || '').trim()),
          clearLeaveDates: dates.filter((_, i) => cells[i].kind === 'work' && !cells[i].empty), leave: dates.map((d, i) => cells[i].kind === 'leave' ? { date: d, hours: cells[i].hours, type: cells[i].lt.code } : null).filter(Boolean) });
      }
      saveBtn.disabled = true;
      try {
        const res = await commitEntries(run, entries);
        const snap = rows.map((r) => ({ employee: r.employee, ni: r.ni, rate: r.rate, days: r.cells, stated: r.stated }));
        const id = await saveTimesheet({ id: E.id || undefined, run_id: run.id, project_name: E.project_name, site_name: E.site_name || null, week_start: E.week_start, kind: E.kind, status: E.status === 'received' ? 'keyed' : E.status, supervisor: E.supervisor || null, file_path: E.file_path, file_name: E.file_name, file_type: E.file_type, notes: E.notes, entries: snap });
        void id; toast(`Written to payroll: ${res.updated} people updated, ${res.created} new`, 'ok'); close(); await load();
      } catch (e) { toast(e.message || String(e), 'err'); } finally { saveBtn.disabled = false; }
    }
    const saveBtn = h('button', { class: 'btn primary', onClick: save }, icon('check'), 'Save to payroll');
    const staffBtn = h('button', { class: 'btn', onClick: () => { const have = new Set(E.rows.map((r) => normKey(r.employee))); const names = [...new Map(linesFor().map((l) => [normKey(l.employee_name), l])).values()].filter((l) => !have.has(normKey(l.employee_name)));
      names.forEach((l) => E.rows.push({ employee: l.employee_name, ni: l.ni_number || '', rate: l.hourly_rate, cells: Array(7).fill(''), stated: '' })); if (!names.length) toast('No more staff for this project in the pay run', 'err'); drawGrid(); } }, 'Load this project’s staff');
    const addBtn = h('button', { class: 'btn', onClick: () => { E.rows.push({ employee: '', ni: '', rate: '', cells: Array(7).fill(''), stated: '' }); drawGrid(); } }, icon('plus'), 'Add person');

    clear(panel).append(
      h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'grow' }, h('h2', null, E.id ? 'Timesheet' : 'Key in a timesheet'), h('div', { class: 'muted small' }, E.file_name ? `${KIND[E.kind]?.[1] || ''} · ${E.file_name}` : 'No file attached')), h('button', { class: 'btn ghost', onClick: close }, icon('x'))),
      E.notes ? h('div', { class: 'notice', style: { margin: '10px 0' } }, E.notes) : null,
      !can ? h('div', { class: 'notice warn', style: { margin: '10px 0' } }, '🔒 Read-only: this pay run is locked or you do not have edit rights.') : null,
      h('div', { class: 'split', style: { marginTop: '12px' } }, viewer, h('div', null,
        h('datalist', { id: 'tsproj' }, projectsInRun().map((p) => h('option', { value: p }))),
        h('div', { class: 'form-grid', style: { gridTemplateColumns: 'repeat(4,1fr)', marginBottom: '10px' } }, h('label', { class: 'fld' }, 'Project', proj), h('label', { class: 'fld' }, 'Site (optional)', site), h('label', { class: 'fld' }, 'Week commencing (Monday)', week), h('label', { class: 'fld' }, 'Supervisor on the sheet', sup)),
        h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Type the times as written: 9.30-14.30 · or just hours: 5 · or leave: AL 5, SICK 6, SSP, UNPAID 8. Leave codes come from Settings.'),
        gridHost, h('div', { class: 'row wrap', style: { marginTop: '10px' } }, can ? [addBtn, staffBtn] : null, h('div', { class: 'grow' }), summary),
        h('div', { class: 'row wrap', style: { marginTop: '14px' } }, h('label', { class: 'fld' }, 'Status', status), h('div', { class: 'grow' }), h('button', { class: 'btn', onClick: close }, 'Close'), can ? saveBtn : null))));
    drawGrid(); drawViewer();
  }

  try { lines = (await loadRunData(run.id)).lines; } catch { lines = []; }
  await load();
  return onLive(debounce((e) => { if (e.table === 'timesheets') load(); }, 600));
}
