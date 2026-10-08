// One importer for every upload: download a ready-made Excel template, fill it in, upload, check the preview, save.
import { h, toast, modal, icon, clear } from './ui.js';
import { loadXLSX } from './xlsx.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Excel dates come as numbers, dd/mm/yyyy text or yyyy-mm-dd
export function toISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(s); return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
}
export function toTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v < 1) { const mins = Math.round(v * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
}
const CONV = {
  text: (v) => (v === null || v === undefined ? null : String(v).trim() || null),
  upper: (v) => (v === null || v === undefined || v === '' ? null : String(v).replace(/\s+/g, '').toUpperCase()),
  lower: (v) => (v === null || v === undefined || v === '' ? null : String(v).trim().toLowerCase()),
  number: (v) => { if (v === null || v === undefined || v === '') return null; const n = +String(v).replace(/[£,\s]/g, ''); return Number.isNaN(n) ? undefined : n; },
  date: toISO, time: toTime,
};

// spec: { title, file, columns: [{ key, label, type, required, example, help, aliases, map(v) }], help, rowCheck(row) -> error|null, save(rows) -> message }
export async function downloadTemplate(spec) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const head = spec.columns.map((c) => c.label + (c.required ? ' *' : ''));
  const ws = XLSX.utils.aoa_to_sheet([head, ...(spec.examples || [spec.columns.map((c) => c.example ?? '')])]);
  ws['!cols'] = spec.columns.map((c) => ({ wch: Math.max(12, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const help = [['How to fill in this template'], [''], ...(spec.help || []).map((x) => [x]), [''], ['Column', 'Required', 'What to put in it'], ...spec.columns.map((c) => [c.label, c.required ? 'Yes' : '', c.help || (c.type === 'date' ? 'Date, e.g. 25/10/2026' : c.type === 'time' ? 'Time, e.g. 06:00' : c.type === 'number' ? 'Number' : '')])];
  const hs = XLSX.utils.aoa_to_sheet(help); hs['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 80 }]; XLSX.utils.book_append_sheet(wb, hs, 'Instructions');
  XLSX.writeFile(wb, spec.file || 'template.xlsx');
}
export async function exportRows(spec, rows, file) {
  const XLSX = await loadXLSX(); const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([spec.columns.map((c) => c.label), ...rows.map((r) => spec.columns.map((c) => (c.out ? c.out(r) : r[c.key]) ?? ''))]);
  ws['!cols'] = spec.columns.map((c) => ({ wch: Math.max(12, c.label.length + 4) })); XLSX.utils.book_append_sheet(wb, ws, 'Data'); XLSX.writeFile(wb, file || spec.file.replace('template', 'export'));
}

export async function readFile(spec, file) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  // find the header row: the first row that names the required columns
  const want = spec.columns.map((c) => [norm(c.label), ...(c.aliases || []).map(norm)]);
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map((x) => norm(String(x ?? '').replace('*', '')));
    const found = {}; spec.columns.forEach((c, ci) => { const j = r.findIndex((x) => x && want[ci].includes(x)); if (j >= 0) found[c.key] = j; });
    if (spec.columns.filter((c) => c.required).every((c) => found[c.key] !== undefined)) { hi = i; col = found; break; }
  }
  if (hi < 0) throw new Error(`Could not find the columns ${spec.columns.filter((c) => c.required).map((c) => '“' + c.label + '”').join(', ')}. Download the template and use its headings.`);
  const out = [], errors = [];
  rows.slice(hi + 1).forEach((r, i) => {
    if (!r || r.every((x) => x === null || x === '')) return;
    const row = {}, bad = [];
    for (const c of spec.columns) {
      if (col[c.key] === undefined) continue;
      const raw = r[col[c.key]]; let v = (CONV[c.type || 'text'] || CONV.text)(raw);
      if (v === undefined) { bad.push(`${c.label} “${raw}” is not valid`); continue; }
      if (c.map && v !== null) { v = c.map(v); if (v === undefined) { bad.push(`${c.label} “${raw}” is not recognised`); continue; } }
      if (v !== null) row[c.key] = v;
      if (c.required && (v === null || v === '')) bad.push(`${c.label} is missing`);
    }
    const extra = !bad.length && spec.rowCheck ? spec.rowCheck(row) : null; if (extra) bad.push(extra);
    if (bad.length) errors.push({ row: hi + i + 2, text: bad.join('; ') }); else out.push(row);
  });
  return { rows: out, errors };
}

// The import button: opens a small window with "download template", "choose file", preview and save
export function importModal(spec) {
  modal(spec.title, (done) => {
    const box = h('div');
    const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hidden', onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await read(f); } });
    async function read(f) {
      clear(box).append(h('div', { class: 'muted' }, 'Reading…'));
      try {
        const r = await readFile(spec, f);
        const show = r.rows.slice(0, 8), cols = spec.columns.filter((c) => show.some((x) => x[c.key] !== undefined)).slice(0, 8);
        clear(box).append(h('div', { class: 'stack' },
          h('div', null, h('b', null, `${r.rows.length} row(s) ready`), r.errors.length ? h('span', { class: 'muted' }, ` · ${r.errors.length} skipped`) : null),
          r.errors.length ? h('div', { class: 'notice warn' }, h('ul', { style: { margin: 0, paddingLeft: '18px', maxHeight: '120px', overflow: 'auto' } }, r.errors.slice(0, 30).map((e) => h('li', null, `Row ${e.row}: ${e.text}`)))) : null,
          show.length ? h('div', { class: 'tablewrap', style: { maxHeight: '240px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.label)))), h('tbody', null, show.map((x) => h('tr', null, cols.map((c) => h('td', null, String(x[c.key] ?? '')))))))) : null,
          r.rows.length > 8 ? h('div', { class: 'small muted' }, `…and ${r.rows.length - 8} more`) : null,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', disabled: !r.rows.length, onClick: async (ev) => {
            ev.target.disabled = true; ev.target.textContent = 'Saving…';
            try { const msg = await spec.save(r.rows); done(); toast(msg || 'Saved', 'ok'); } catch (er) { ev.target.disabled = false; ev.target.textContent = 'Save'; toast(er.message, 'err'); }
          } }, `Save ${r.rows.length} row(s)`))));
      } catch (er) { clear(box).append(h('div', { class: 'notice err' }, er.message)); }
    }
    return h('div', { class: 'stack' }, file,
      h('div', { class: 'imp-steps' },
        h('div', { class: 'imp-step' }, h('i', null, '1'), h('div', null, h('b', null, 'Download the template'), h('div', { class: 'small muted' }, 'It has the right headings and an Instructions sheet.')), h('button', { class: 'btn', onClick: () => downloadTemplate(spec).catch((e) => toast(e.message, 'err')) }, icon('download'), 'Template')),
        h('div', { class: 'imp-step' }, h('i', null, '2'), h('div', null, h('b', null, 'Upload the filled-in file'), h('div', { class: 'small muted' }, 'Excel or CSV. You see a preview before anything is saved.')), h('button', { class: 'btn primary', onClick: () => file.click() }, icon('upload'), 'Choose file'))),
      spec.note ? h('div', { class: 'small muted' }, spec.note) : null, box);
  }, { wide: true });
}
