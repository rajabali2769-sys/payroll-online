// Section panels: each part of a screen is its own panel that can be folded away (−) or opened full screen (⤢).
// Panels sit side by side in a grid, so screens grow across rather than downwards.
import { h, icon } from './ui.js';

const KEY = (id) => 'panel.' + id;
const isOpen = (id, def) => { if (!id) return def; try { const v = localStorage.getItem(KEY(id)); return v === null ? def : v === '1'; } catch { return def; } };
const remember = (id, on) => { if (id) try { localStorage.setItem(KEY(id), on ? '1' : '0'); } catch { /* private mode */ } };
const chevron = () => h('span', { class: 'pchev', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' });
const maxIcon = () => h('span', { html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', style: { display: 'inline-flex' } });

// panel('Title', body, { id, sub, actions, open, expand, cls, span })
export function panel(title, body, o = {}) {
  const { id, sub, actions, open = true, expand = true, cls = '', span, fill } = o;
  let on = isOpen(id, open);
  const el = h('section', { class: 'panel' + (on ? '' : ' closed') + (fill ? ' fill' : '') + (cls ? ' ' + cls : ''), style: span ? { gridColumn: 'span ' + span } : null });
  const bodyEl = h('div', { class: 'pbody' }, body);
  const toggle = () => { on = !on; el.classList.toggle('closed', !on); remember(id, on); };
  let ph = null;
  const maxBtn = expand ? h('button', { class: 'picon', title: 'Open full screen', onClick: (e) => { e.stopPropagation(); maximise(); } }, maxIcon()) : null;
  function maximise() {
    if (el.classList.contains('max')) { el.classList.remove('max'); if (ph) { ph.replaceWith(el); ph = null; } document.removeEventListener('keydown', escMax); return; }
    if (!on) toggle();
    ph = h('div', { class: 'panel-ph' }); el.replaceWith(ph); document.body.append(el); el.classList.add('max'); document.addEventListener('keydown', escMax);
  }
  const escMax = (e) => { if (e.key === 'Escape' && el.classList.contains('max') && !document.querySelector('.modal-wrap')) maximise(); };
  el.append(h('header', { class: 'phd', onClick: (e) => { if (!e.target.closest('button, input, select, a, label')) toggle(); } },
    h('button', { class: 'picon fold', title: 'Fold / unfold', onClick: (e) => { e.stopPropagation(); toggle(); } }, chevron()),
    h('div', { class: 'ptitle' }, h('b', null, title), sub ? h('span', { class: 'psub2' }, sub) : null),
    h('div', { class: 'pact' }, actions || null), maxBtn), bodyEl);
  el.maximise = maximise;
  return el;
}
// a row of panels laid out side by side
export const panelGrid = (cols, ...panels) => h('div', { class: 'pgrid2', style: { gridTemplateColumns: typeof cols === 'number' ? `repeat(${cols}, minmax(0, 1fr))` : cols } }, ...panels);
void icon;
