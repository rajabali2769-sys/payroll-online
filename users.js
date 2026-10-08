import { loadProfiles, setRole } from './api.js';
import { h, clear, toast, dmy } from './ui.js';
import { ctx } from './ctx.js';

export async function render(root) {
  const host = h('div');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Users'), h('p', null, 'Decide who can see and who can change payroll data.'))), host,
    h('div', { class: 'notice', style: { marginTop: '16px' } }, h('b', null, 'To add someone: '), 'Supabase dashboard → Authentication → Users → ', h('b', null, 'Invite user'), '. They get an email, choose a password, and appear here as an ', h('b', null, 'employee'), ' (no access to payroll data) — then give them their role below.'),
    h('div', { class: 'small muted', style: { marginTop: '10px' } }, h('b', null, 'Viewer'), ' can look at everything. ', h('b', null, 'Editor'), ' can also edit payroll data, import files and read the history. ', h('b', null, 'Admin'), ' can also manage users and delete a pay run. ', h('b', null, 'HR team'), ' manages employee records and HR cases. ', h('b', null, 'Recruitment'), ' can only add temporary and cover staff on the New starters page.'));
  const profiles = await loadProfiles();
  clear(host).append(h('div', { class: 'tablewrap auto' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, ['Name', 'Email', 'Joined', 'Role'].map((t) => h('th', null, t)))),
    h('tbody', null, profiles.map((p) => h('tr', null, h('td', null, p.full_name || '—'), h('td', null, p.email), h('td', null, dmy(p.created_at)),
      h('td', null, (() => { const s = h('select', { disabled: p.id === ctx.me.id || !ctx.isSuper, style: { width: '210px' }, title: p.id === ctx.me.id ? 'You cannot change your own role' : !ctx.isSuper ? 'Only the super admin can change roles' : '' },
        [['super_admin', 'Super admin'], ['admin', 'Admin (team)'], ['editor', 'Editor'], ['viewer', 'Viewer'], ['hr', 'HR team'], ['recruitment', 'Recruitment'], ['employee', 'Employee (no staff access)']].map(([r, t]) => h('option', { value: r, selected: p.role === r }, t)));
        s.onchange = async () => { try { await setRole(p.id, s.value); toast('Role updated', 'ok'); } catch (e) { toast(e.message, 'err'); s.value = p.role; } }; return s; })())))))));
}
