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
  x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', download: 'M12 4v12M7 11l5 5 5-5M4 20h16', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
};
export const icon = (name) => h('span', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ''}"/></svg>`, style: { display: 'inline-flex' } });

export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3200);
}
export function modal(title, bodyBuilder, { wide } = {}) {
  const wrap = h('div', { class: 'modal-wrap' });
  const close = () => wrap.remove();
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  const box = h('div', { class: 'modal', style: wide ? { width: 'min(760px,100%)' } : null }, h('h2', null, title));
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
export const statusPill = (s) => h('span', { class: 'pill ' + String(s || 'within').toLowerCase() }, s === 'Over' ? 'Over budget' : s === 'Under' ? 'Under budget' : 'Within budget');
export const natCompare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
export const mondayOf = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10); };
