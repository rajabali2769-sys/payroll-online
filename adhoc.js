// Ad-hoc & billing: extra hours charged to the client on top of the budget. Paid to the employee, never counted against the budget.
import { loadAdhoc, loadProjectStatus, saveProjectBudget, loadRunData, addAdhoc, deleteAdhocDay, onLive } from './api.js';
import { h, clear, hrs, money, dmy, toast, modal, icon, downloadCSV, debounce, natCompare } from './ui.js';
import { ctx, currentRun, runPicker, runEditable } from './ctx.js';
import { normKey } from './parsers.js';

export async function render(root) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file first.')); return; }
  let rows = [], status = [], lines = [], open = new Set();
  const host = h('div'), can = () => runEditable(run.id);
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Ad-hoc & billing'), h('p', null, 'Extra hours charged to the client. They are paid to the employee but never count against the project’s budget. Add them from an employee line, a timesheet (type AH 3), the attendance upload, or here.')),
    h('div', { class: 'row' }, runPicker(() => location.reload()), can() ? h('button', { class: 'btn primary', onClick: () => addEntry() }, icon('plus'), 'Add ad-hoc hours') : null)), host);

  function addEntry() {
    modal('Add ad-hoc hours', (close) => {
      const who = h('input', { type: 'text', list: 'ah-lines', placeholder: 'Start typing an employee or project…' }), date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }), hh = h('input', { type: 'number', step: 'any', placeholder: 'hours' }), note = h('input', { type: 'text', placeholder: 'what was it for? (optional)' });
      const opts = lines.filter((l) => !l.is_adhoc_line).slice(0, 4000).map((l) => ({ id: l.id, label: `${l.employee_name} · ${l.project_name}${l.site_name ? ' · ' + l.site_name : ''}` }));
      return h('div', { class: 'stack' }, h('datalist', { id: 'ah-lines' }, opts.map((o) => h('option', { value: o.label }))), h('label', { class: 'fld' }, 'Employee and project', who), h('div', { class: 'form-grid' }, h('label', { class: 'fld' }, 'Date', date), h('label', { class: 'fld' }, 'Ad-hoc hours', hh)), h('label', { class: 'fld' }, 'Note', note),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { const o = opts.find((x) => x.label === who.value); if (!o || !date.value || !(+hh.value > 0)) return toast('Choose a person from the list, a date and the hours', 'err');
          try { await addAdhoc(o.id, [{ date: date.value, hours: +hh.value, note: note.value.trim() }]); close(); toast('Ad-hoc hours added', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } } }, 'Add')));
    });
  }
  function draw() {
    const byProj = new Map(); for (const r of rows) { const k = normKey(r.project_name); const p = byProj.get(k) || { key: k, name: r.project_name, hours: 0, cost: 0, charge: 0, rate: r.client_rate, rows: [] }; p.hours += +r.hours || 0; p.cost += +r.cost || 0; p.charge += +r.charge || 0; p.rate = r.client_rate; p.rows.push(r); byProj.set(k, p); }
    const list = [...byProj.values()].sort((a, b) => b.charge - a.charge || b.hours - a.hours), tot = list.reduce((s, p) => ({ h: s.h + p.hours, c: s.c + p.cost, ch: s.ch + p.charge }), { h: 0, c: 0, ch: 0 }), noRate = list.filter((p) => p.hours > 0 && !(+p.rate > 0));
    const rateInput = (p) => { const i = h('input', { type: 'number', step: 'any', value: p.rate ?? '', placeholder: 'set rate', disabled: !can(), style: { width: '90px', textAlign: 'right' } });
      i.addEventListener('change', async () => { try { const st = status.find((s) => s.project_key === p.key); await saveProjectBudget({ name_key: p.key, project_name: p.name, weekly_hours: st ? (st.weekly_budget != null ? +st.weekly_budget : (+st.weeks ? Math.round((+st.budget_hours / +st.weeks) * 100) / 100 : 0)) : 0, client_rate: i.value === '' ? null : +i.value }); toast('Client rate saved', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); } }); return i; };
    clear(host).append(
      h('div', { class: 'grid kpis' }, [['kc-violet', 'pound', 'Ad-hoc hours', hrs(tot.h) + ' h', `${list.length} project${list.length === 1 ? '' : 's'}`], ['kc-amber', 'users', 'Cost to us (pay)', money(tot.c), 'paid to employees'], ['kc-green', 'trend', 'To charge clients', money(tot.ch), noRate.length ? `${noRate.length} project(s) have no client rate` : 'at each client’s ad-hoc rate'], ['kc-blue', 'check', 'Margin', money(tot.ch - tot.c), 'charge − pay']].map(([c, ic, l, v, s]) => h('div', { class: 'card kpi c ' + c }, h('div', { class: 'kic' }, icon(ic)), h('div', { class: 'l' }, l), h('div', { class: 'v' }, v), h('div', { class: 's' }, s)))),
      noRate.length ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, `Set a client rate (£ per hour) for: ${noRate.map((p) => p.name).join(', ')} — otherwise nothing is charged for their ad-hoc hours.`) : null,
      h('div', { class: 'row', style: { marginBottom: '8px' } }, h('div', { class: 'grow' }), h('button', { class: 'btn', onClick: () => downloadCSV(`adhoc_billing_${run.label.replace(/\W+/g, '_')}.csv`, [['Client / project', 'Date', 'Employee', 'Site', 'Ad-hoc hours', 'Client rate £/h', 'Amount to charge £', 'Our pay cost £', 'Note'], ...list.flatMap((p) => p.rows.map((r) => [p.name, String(r.work_date).slice(0, 10), r.employee_name, r.site_name || '', r.hours, r.client_rate ?? '', Math.round((+r.charge || 0) * 100) / 100, Math.round((+r.cost || 0) * 100) / 100, r.note || '']))]) }, icon('download'), 'Export for invoicing')),
      list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Project / client', 'Ad-hoc hours', 'Our pay cost', 'Client rate £/h', 'To charge', ''].map((t, i) => h('th', { class: i > 0 && i < 5 ? 'num' : '' }, t)))),
        h('tbody', null, list.flatMap((p) => [h('tr', { class: 'clickrow', onClick: () => { open.has(p.key) ? open.delete(p.key) : open.add(p.key); draw(); } }, h('td', null, h('b', null, p.name)), h('td', { class: 'num' }, hrs(p.hours)), h('td', { class: 'num' }, money(p.cost)), h('td', { class: 'num', onClick: (e) => e.stopPropagation() }, rateInput(p)), h('td', { class: 'num' }, h('b', null, money(p.charge))), h('td', { class: 'muted small' }, open.has(p.key) ? '▲ hide' : '▼ lines')),
          ...(open.has(p.key) ? p.rows.map((r) => h('tr', null, h('td', { class: 'muted small', style: { paddingLeft: '26px' } }, `${dmy(r.work_date)} · ${r.employee_name}${r.site_name ? ' · ' + r.site_name : ''}`, r.note ? ` · ${r.note}` : ''), h('td', { class: 'num small' }, hrs(r.hours)), h('td', { class: 'num small' }, money(r.cost)), h('td'), h('td', { class: 'num small' }, money(r.charge)),
            h('td', null, can() && r.source === 'itemised' ? h('button', { class: 'btn sm danger', onClick: async () => { try { await deleteAdhocDay(r.line_id, String(r.work_date).slice(0, 10)); await load(); } catch (e) { toast(e.message, 'err'); } } }, '×') : h('span', { class: 'small muted' }, r.source)))) : [])])))) : h('div', { class: 'card empty' }, 'No ad-hoc hours in this payroll yet.'));
  }
  async function load() { [rows, status] = await Promise.all([loadAdhoc(run.id).catch(() => []), loadProjectStatus(run.id).catch(() => [])]); if (!lines.length) lines = (await loadRunData(run.id).catch(() => ({ lines: [] }))).lines; draw(); }
  await load();
  return onLive(debounce((e) => { if (e.table === 'adhoc_hours' || e.table === 'daily_hours') load(); }, 1000));
}
