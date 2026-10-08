// Tiny DOM helpers (no framework) + formatting + toasts + modals.

// DOM append() stringifies arrays and null. Make it behave like h(): flatten arrays, skip null/false.
const _append = Element.prototype.append;
Element.prototype.append = function (...kids) {
  return _append.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
};

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled' || k === 'selected' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });
export const money = (n) => (n === null || n === undefined || n === '' || Number.isNaN(+n) ? '' : gbp.format(+n));
export const hrs = (n) => (n === null || n === undefined || n === '' || Number.isNaN(+n) ? '' : String(Math.round(+n * 100) / 100));
export const num = (n) => (n === null || n === undefined ? 0 : +n || 0);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
export const dm = (iso) => { if (!iso) return ''; const [, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]}`; };
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return dmy(iso); };
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  folder: 'M3 6h6l2 2h10v11H3z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  users: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 20c0-3.3 3.6-5 8-5s8 1.7 8 5',
  file: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M8 13h8M8 17h5',
  sun: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13M9 7h6',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  check: 'M5 12l5 5 9-10',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  pound: 'M16 6a4 4 0 00-8 1v4H6m2 0v5c0 2-1 3-2 3h12M8 11h6',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  trend: 'M3 17l6-6 4 4 7-8M15 7h5v5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', download: 'M12 4v12M7 11l5 5 5-5M4 20h16', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
};
export const icon = (name) => h('span', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ''}"/></svg>`, style: { display: 'inline-flex' } });

export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3200);
}
export function modal(title, bodyBuilder, { wide, xl } = {}) {
  const wrap = h('div', { class: 'modal-wrap' });
  const close = () => wrap.remove();
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  const box = h('div', { class: 'modal', style: xl ? { width: 'min(1120px,100%)' } : wide ? { width: 'min(760px,100%)' } : null }, h('h2', null, title));
  box.append(bodyBuilder(close));
  wrap.append(box);
  document.body.append(wrap);
  return close;
}
export function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const close = modal(title, (c) => h('div', { class: 'stack' },
      h('p', { style: { margin: 0 } }, text),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onClick: () => { c(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => { c(); resolve(true); } }, okLabel))));
    void close;
  });
}
export function downloadCSV(filename, rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })), download: filename });
  document.body.append(a); a.click(); a.remove();
}
export const statusPill = (s) => h('span', { class: 'pill ' + String(s || 'within').toLowerCase() }, s === 'Over' ? 'Over budget' : s === 'Under' ? 'Under budget' : s === 'NoBudget' ? 'No budget set' : s === 'AdHoc' ? 'Ad-hoc (not budgeted)' : 'Within budget');
export const natCompare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
export const mondayOf = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10); };

// ---------- colours + charts ----------
export const PALETTE = ['#12a3a1', '#6c5ce7', '#f39c12', '#e84393', '#1f7ae0', '#00b894', '#e17055', '#636e72'];
// Donut chart: parts = [{label, value, color}]; center = big text in the middle, sub = small text under it
export function donut(parts, { size = 170, thick = 24, center = '', sub = '' } = {}) {
  const total = parts.reduce((s, p) => s + Math.max(0, +p.value || 0), 0), r = (size - thick) / 2, C = 2 * Math.PI * r;
  let off = 0;
  const arcs = total > 0 ? parts.filter((p) => +p.value > 0).map((p) => { const len = (p.value / total) * C; const a = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${thick}" stroke-dasharray="${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${p.label}</title></circle>`; off += len; return a; }).join('')
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e6ecec" stroke-width="${thick}"/>`;
  return h('div', { class: 'donut', style: { width: size + 'px', height: size + 'px' }, html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef2f3" stroke-width="${thick}"/>${arcs}</svg><div class="dc"><b>${center}</b><span>${sub}</span></div>` });
}
// Progress ring (0-100+) used for "budget used"
export function ring(pct, { size = 112, thick = 12, color = '#12a3a1', label = '', sub = '' } = {}) {
  const r = (size - thick) / 2, C = 2 * Math.PI * r, p = Math.max(0, Math.min(pct, 100)) / 100;
  return h('div', { class: 'donut ring', style: { width: size + 'px', height: size + 'px' }, html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="${thick}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${thick}" stroke-linecap="round" stroke-dasharray="${p * C} ${C}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><div class="dc"><b>${label}</b><span>${sub}</span></div>` });
}
export const initials = (s) => String(s || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
