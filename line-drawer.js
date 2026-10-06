// Side panel for one payroll line: weekly figures, day-by-day hours, notes, history.
import { loadLine, loadLineWeeks, loadDays, updateLine, upsertWeek, upsertDay, deleteLine, loadAudit } from './api.js';
import { h, clear, money, hrs, dm, dmy, addDays, mondayOf, DOW, toast, confirmBox, statusPill, ago, icon } from './ui.js';
import { ctx, runEditable } from './ctx.js';

export async function openLineDrawer(lineId, { onChange, onDelete } = {}) {
  const overlay = h('div', { class: 'overlay' });
  const panel = h('div', { class: 'drawer' }, h('div', { class: 'muted' }, 'Loading…'));
  overlay.append(panel);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) close(); };
  document.addEventListener('keydown', esc);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);

  let line, weeks, days, audit = [];
  let edit = ctx.canEdit;
  const refresh = async () => {
    [line, weeks, days] = await Promise.all([loadLine(lineId), loadLineWeeks(lineId), loadDays(lineId)]);
    edit = !!line && runEditable(line.run_id);
    if (ctx.canEdit) { try { audit = await loadAudit({ lineId, limit: 12 }); } catch { audit = []; } }
    draw(); onChange && onChange(line);
  };
  const guard = async (fn) => { try { await fn(); await refresh(); } catch (e) { toast(e.message || String(e), 'err'); await refresh(); } };

  function draw() {
    if (!line) { clear(panel).append(h('div', { class: 'notice err' }, 'This line no longer exists.'), h('button', { class: 'btn', onClick: close }, 'Close')); return; }
    const num = (v, onSave, { allowNull = false, w = 78 } = {}) => {
      const i = h('input', { type: 'number', step: 'any', value: v ?? '', disabled: !edit, style: { width: w + 'px', textAlign: 'right', padding: '4px 6px' } });
      i.addEventListener('change', () => { const raw = i.value.trim(); onSave(raw === '' ? (allowNull ? null : 0) : +raw); });
      return i;
    };
    const dayDates = new Set(days.map((d) => mondayOf(d.work_date)));
    const wkStarts = [...new Set([...weeks.map((w) => w.week_start), ...dayDates])].sort();
    const wmap = new Map(weeks.map((w) => [w.week_start, w]));
    const dmap = new Map(days.map((d) => [String(d.work_date).slice(0, 10), d]));

    clear(panel).append(
      ctx.canEdit && !edit ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, '🔒 This pay run is locked, so this line is read-only. An admin can unlock it on the Dashboard.') : null,
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'grow' }, h('h2', null, line.employee_name), h('div', { class: 'muted' }, [line.project_name, line.site_name].filter(Boolean).join(' · '),
          ' ', h('span', { class: 'pill grp' }, line.pay_group || 'No pay date'), ' ', line.contract_type ? h('span', { class: 'pill grp' }, line.contract_type) : h('span', { class: 'pill flag' }, 'no contract type'))),
        h('button', { class: 'btn ghost', onClick: close, title: 'Close (Esc)' }, icon('x'))),
      h('div', { class: 'grid kpis', style: { margin: '14px 0 0', gridTemplateColumns: 'repeat(4, 1fr)' } },
        mini('Gross pay', money(line.gross_pay)), mini('Budgeted', money(line.budgeted_pay)),
        mini('Difference', money(line.difference), +line.difference > 0.5 ? 'neg' : +line.difference < -0.5 ? 'pos' : ''), h('div', { class: 'card kpi' }, h('div', { class: 'l' }, 'Status'), h('div', { style: { marginTop: '6px' } }, statusPill(line.budget_status)))),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Hours ${hrs(line.actual_hours)} · leave ${hrs(line.leave_hours)} · over ${hrs(line.over_hours)} · under ${hrs(line.less_hours)} · rate ${money(line.hourly_rate)}`),

      h('h4', null, 'Weekly figures'),
      h('div', { class: 'tablewrap auto' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['Week starting', 'Hours worked', 'Leave hours', 'Budget hours', 'Counts to variance', 'Variance'].map((t, i) => h('th', { class: i > 0 && i !== 4 ? 'num' : '' }, t)))),
        h('tbody', null, wkStarts.map((ws) => {
          const w = wmap.get(ws) || { line_id: lineId, week_start: ws, delivered: 0, leave: 0, budget: +line.budgeted_hours || 0, in_window: true, variance_override: null };
          const save = (patch) => guard(() => upsertWeek({ line_id: lineId, week_start: ws, delivered: w.delivered, leave: w.leave, budget: w.budget, in_window: w.in_window, variance_override: w.variance_override, ...patch }));
          const calc = w.variance_override !== null && w.variance_override !== undefined ? +w.variance_override : +w.delivered + +w.leave - +w.budget;
          return h('tr', null, h('td', null, `${dm(ws)} – ${dm(addDays(ws, 6))}`),
            h('td', { class: 'num' }, num(w.delivered, (v) => save({ delivered: v }))), h('td', { class: 'num' }, num(w.leave, (v) => save({ leave: v }))), h('td', { class: 'num' }, num(w.budget, (v) => save({ budget: v }))),
            h('td', null, h('input', { type: 'checkbox', checked: w.in_window, disabled: !edit, onChange: (e) => save({ in_window: e.target.checked }) })),
            h('td', { class: 'num' }, w.in_window ? hrs(calc) : h('span', { class: 'muted' }, '—'), w.variance_override !== null && w.variance_override !== undefined ?
              h('span', { class: 'overr', title: 'Typed by hand in the old Excel. Click to remove the override and calculate it instead.', onClick: () => edit && save({ variance_override: null }) }, ' ⚑') : null));
        })))),
      h('div', { class: 'small muted' }, '⚑ = a variance that was typed over by hand in Excel. Everything else is calculated: delivered + leave − budget.'),

      h('h4', null, 'Day by day'),
      !wkStarts.length ? h('div', { class: 'muted' }, 'No daily hours were imported for this line.') :
      wkStarts.map((ws) => {
        const cells = DOW.map((nm, i) => {
          const date = addDays(ws, i), d = dmap.get(date);
          const val = d ? (d.hours !== null && d.hours !== undefined ? String(+d.hours) + (d.note && !/^[-\d.]+$/.test(d.note) ? ' ' + d.note : '') : d.note || '') : '';
          const inp = h('input', { type: 'text', value: val, disabled: !edit, placeholder: '–', title: d?.note || '' });
          inp.addEventListener('change', () => {
            const raw = inp.value.trim();
            if (!raw) return guard(() => upsertDay(lineId, date, null, null));
            const m = raw.match(/^(-?\d+(\.\d+)?)\s*(.*)$/);
            guard(() => upsertDay(lineId, date, m ? +m[1] : null, m ? m[3] || null : raw));
          });
          return h('div', { class: 'd' + (d && d.note ? ' note' : '') }, h('span', null, `${nm} ${+date.slice(8)}`), inp);
        });
        const sumDays = cells.length && days.filter((d) => mondayOf(d.work_date) === ws).reduce((s, d) => s + (+d.hours || 0), 0);
        return h('div', { style: { marginBottom: '10px' } },
          h('div', { class: 'row small muted', style: { marginBottom: '4px' } }, h('b', null, `Week of ${dmy(ws)}`), h('span', null, `· days add up to ${hrs(sumDays)} h`),
            edit ? h('a', { href: '#', onClick: (e) => { e.preventDefault(); const w = wmap.get(ws); guard(() => upsertWeek({ line_id: lineId, week_start: ws, delivered: sumDays, leave: w?.leave ?? 0, budget: w?.budget ?? (+line.budgeted_hours || 0), in_window: w?.in_window ?? true, variance_override: w?.variance_override ?? null })); } }, 'use as week total') : null),
          h('div', { class: 'daygrid' }, cells));
      }),

      h('h4', null, 'Pay inputs & notes'),
      h('div', { class: 'form-grid' },
        fld('Fixed pay (£)', num(line.fixed_pay, (v) => guard(() => updateLine(lineId, { fixed_pay: v })), { allowNull: true, w: 120 })),
        fld('Leave pay (£)', num(line.leave_pay, (v) => guard(() => updateLine(lineId, { leave_pay: v })), { w: 120 })),
        fld('Addition (£)', num(line.addition, (v) => guard(() => updateLine(lineId, { addition: v })), { w: 120 })),
        fld('Deduction (£)', num(line.deduction, (v) => guard(() => updateLine(lineId, { deduction: v })), { w: 120 })),
        fld('Weeks reconciled', num(line.weeks_reconciled, (v) => guard(() => updateLine(lineId, { weeks_reconciled: v })), { allowNull: true, w: 120 })),
        fld('Hourly rate (£)', num(line.hourly_rate, (v) => guard(() => updateLine(lineId, { hourly_rate: v })), { w: 120 }))),
      h('div', { class: 'form-grid', style: { marginTop: '10px' } },
        fld('Remarks', textarea(line.remarks, (v) => guard(() => updateLine(lineId, { remarks: v || null })))),
        fld('Comments', textarea(line.comments, (v) => guard(() => updateLine(lineId, { comments: v || null }))))),
      line.extra && Object.values(line.extra).some(Boolean) ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'From the spreadsheet: ',
        Object.entries(line.extra).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')) : null,

      ctx.canEdit && audit.length ? [h('h4', null, 'Recent changes to this line'), h('div', { class: 'stack', style: { gap: '6px' } }, audit.map((a) => h('div', { class: 'small' },
        h('b', null, (a.user_email || 'someone').split('@')[0]), ' · ', ago(a.at), ' · ', a.table_name.replace('_', ' '), ' ', a.action.toLowerCase(), ': ',
        h('span', { class: 'muted' }, summarise(a)))))] : null,
      edit ? h('div', { style: { marginTop: '26px' } }, h('button', { class: 'btn danger sm', onClick: async () => {
        if (await confirmBox('Delete this line?', `${line.employee_name} · ${line.project_name} will be removed from this pay run for everyone.`, 'Delete line', true)) {
          try { await deleteLine(lineId); close(); onDelete && onDelete(lineId); toast('Line deleted', 'ok'); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash'), 'Delete line')) : null,
    );
  }
  const mini = (l, v, c) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v ' + (c || ''), style: { fontSize: '19px' } }, v));
  const fld = (label, input) => h('label', { class: 'fld' }, label, input);
  const textarea = (v, onSave) => { const t = h('textarea', { rows: 2, disabled: !edit }, v || ''); t.addEventListener('change', () => onSave(t.value.trim())); return t; };
  const summarise = (a) => { const n = a.new_data || {}, o = a.old_data || {}; const keys = Object.keys(n).filter((k) => k !== 'extra').slice(0, 4); return keys.length ? keys.map((k) => `${k} ${o[k] ?? '∅'} → ${n[k] ?? '∅'}`).join(', ') : ''; };

  await refresh();
  return close;
}
