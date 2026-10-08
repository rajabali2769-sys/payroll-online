// Quick search (Ctrl+K): find anyone by Employee ID, name, NI number, email or project and open their profile.
import { loadStaff } from './api.js';
import { h, clear, modal, initials, debounce } from './ui.js';
import { statusChip, typeChip } from './hrkit.js';
import { openProfile } from './profile.js';

let cache = null, at = 0;
export async function quickSearch(start = '') {
  if (!cache || Date.now() - at > 60000) { cache = await loadStaff(); at = Date.now(); }
  modal('Find an employee', (done) => {
    const box = h('div', { class: 'qs-list' });
    let hits = [], cur = 0;
    const inp = h('input', { type: 'search', class: 'qs-input', placeholder: 'Employee ID (CFM00012), name, NI number, email or project…', value: start, autofocus: true });
    const go = (e) => { done(); openProfile(e.id); };
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      hits = !q ? [] : cache.map((e) => { const code = (e.employee_code || '').toLowerCase(); const score = code === q ? 0 : code.startsWith(q) ? 1 : e.full_name.toLowerCase().startsWith(q) ? 2 : [e.full_name, e.ni_number, e.email, e.default_project, code].some((x) => x && String(x).toLowerCase().includes(q)) ? 3 : 9; return { e, score }; })
        .filter((x) => x.score < 9).sort((a, b) => a.score - b.score || a.e.full_name.localeCompare(b.e.full_name)).slice(0, 40).map((x) => x.e);
      cur = Math.min(cur, Math.max(0, hits.length - 1));
      clear(box).append(!q ? h('div', { class: 'small muted' }, `${cache.length} employees. Start typing — Enter opens the first match.`) : hits.length ? hits.map((e, i) => h('button', { class: 'qs-hit' + (i === cur ? ' on' : ''), onClick: () => go(e) },
        h('span', { class: 'avatar sm' }, initials(e.full_name)), h('span', { class: 'mono qs-code' }, e.employee_code || ''), h('span', { class: 'grow' }, h('b', null, e.full_name), h('span', { class: 'small muted' }, ` · ${e.default_project || 'no project'}${e.ni_number ? ' · ' + e.ni_number : ''}`)), typeChip(e.employment_type), statusChip(e.emp_status)))
        : h('div', { class: 'small muted' }, 'No match.'));
    };
    inp.addEventListener('input', debounce(() => { cur = 0; draw(); }, 80));
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && hits[cur]) go(hits[cur]); if (ev.key === 'ArrowDown') { cur = Math.min(hits.length - 1, cur + 1); draw(); ev.preventDefault(); } if (ev.key === 'ArrowUp') { cur = Math.max(0, cur - 1); draw(); ev.preventDefault(); } });
    setTimeout(() => { inp.focus(); draw(); }, 30);
    return h('div', { class: 'stack' }, inp, box);
  }, { wide: true });
}
