import { loadProfiles, setRole } from './api.js';
import { h, clear, toast, dmy } from './ui.js';
import { ctx } from './ctx.js';

export async function render(root) {
  const host = h('div');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Users'), h('p', null, 'Decide who can see and who can change payroll data.'))), host,
    h('div', { class: 'notice', style: { marginTop: '16px' } }, h('b', null, 'To add someone: '), 'Supabase dashboard → Authentication → Users → ', h('b', null, 'Invite user'), '. They get an email, choose a password, and appear here as a ', h('b', null, 'viewer'), ' — then set their role below.'),
    h('div', { class: 'small muted', style: { marginTop: '10px' } }, h('b', null, 'Viewer'), ' can look at everything. ', h('b', null, 'Editor'), ' can also edit payroll data, import files and read the history. ', h('b', null, 'Admin'), ' can also manage users and delete a pay run.'));
  const profiles = await loadProfiles();
  clear(host).append(h('div', { class: 'tablewrap auto' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, ['Name', 'Email', 'Joined', 'Role'].map((t) => h('th', null, t)))),
    h('tbody', null, profiles.map((p) => h('tr', null, h('td', null, p.full_name || '—'), h('td', null, p.email), h('td', null, dmy(p.created_at)),
      h('td', null, (() => { const s = h('select', { disabled: p.id === ctx.me.id, style: { width: '120px' }, title: p.id === ctx.me.id ? 'You cannot change your own role' : '' },
        ['viewer', 'editor', 'admin'].map((r) => h('option', { value: r, selected: p.role === r }, r[0].toUpperCase() + r.slice(1))));
        s.onchange = async () => { try { await setRole(p.id, s.value); toast('Role updated', 'ok'); } catch (e) { toast(e.message, 'err'); s.value = p.role; } }; return s; })())))))));
}
