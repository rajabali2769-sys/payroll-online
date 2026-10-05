import { loadProjects, loadAliases, updateProject, addAlias, deleteAlias, applyProjectGroup, loadPeriods } from './api.js';
import { h, clear, toast, natCompare, debounce, confirmBox } from './ui.js';
import { ctx, currentRun } from './ctx.js';
import { normKey } from './parsers.js';

export async function render(root) {
  const run = currentRun();
  let [projects, aliases, periods] = await Promise.all([loadProjects(), loadAliases(), run ? loadPeriods(run.id) : []]);
  const groups = ['', ...new Set([...periods.map((p) => p.pay_group), ...projects.map((p) => p.pay_group).filter(Boolean)])].sort(natCompare);
  let q = '';
  const host = h('div');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Projects'), h('p', null, 'Each project’s pay date and manager. Add an alias when the same project is spelled differently in different files.')),
    h('label', { class: 'fld w2' }, 'Search', h('input', { type: 'search', onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) }))), host);

  function draw() {
    const rows = projects.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.manager || '').toLowerCase().includes(q));
    const al = new Map(); for (const a of aliases) { if (!al.has(a.project_id)) al.set(a.project_id, []); al.get(a.project_id).push(a); }
    clear(host).append(h('div', { class: 'tablewrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['Project', 'Pay date', 'Manager', 'Also known as', ''].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((p) => h('tr', null,
        h('td', null, p.name),
        h('td', null, (() => { const s = h('select', { disabled: !ctx.canEdit, style: { width: '110px' } }, groups.map((g) => h('option', { value: g, selected: (p.pay_group || '') === g }, g || '—')));
          s.onchange = async () => { try { await updateProject(p.id, { pay_group: s.value || null }); p.pay_group = s.value || null; toast('Saved', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } }; return s; })()),
        h('td', null, (() => { const i = h('input', { type: 'text', value: p.manager || '', disabled: !ctx.canEdit, style: { width: '150px' } });
          i.onchange = async () => { try { await updateProject(p.id, { manager: i.value.trim() || null }); p.manager = i.value.trim() || null; toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } }; return i; })()),
        h('td', null, h('div', { class: 'chips' }, (al.get(p.id) || []).map((a) => h('span', { class: 'pill grp', title: ctx.canEdit ? 'Click to remove' : '', style: { cursor: ctx.canEdit ? 'pointer' : 'default' }, onClick: async () => { if (!ctx.canEdit) return; await deleteAlias(a.alias_key); aliases = aliases.filter((x) => x.alias_key !== a.alias_key); draw(); } }, a.alias_key + (ctx.canEdit ? ' ×' : ''))),
          ctx.canEdit ? h('button', { class: 'chip', onClick: async () => { const v = prompt(`Another spelling of “${p.name}”:`); if (!v || !v.trim()) return; try { await addAlias(v, p.id); aliases = [...aliases, { alias_key: normKey(v), project_id: p.id }]; draw(); } catch (e) { toast(e.message, 'err'); } } }, '+ alias') : null)),
        h('td', null, ctx.canEdit && run && p.pay_group ? h('button', { class: 'btn sm', title: 'Set this pay date on every line of this project in the selected pay run', onClick: async () => {
          if (!(await confirmBox('Apply pay date?', `Set ${p.pay_group} on all “${p.name}” lines in ${run.label}?`, 'Apply'))) return;
          try { await applyProjectGroup(run.id, p.id, p.pay_group); toast('Applied to ' + run.label, 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Apply to this run') : null)))))));
  }
  draw();
}
