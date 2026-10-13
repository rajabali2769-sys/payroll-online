// Open a new payroll straight in the portal — no Excel needed. Start it empty, copy last payroll's people, or fill it from the employee list.
import { createRunManual, loadStaff, loadCalendarPeriod, applyCalendar, applyProjectWindows, loadRuns } from './api.js';
import { h, toast, modal, dmy, natCompare } from './ui.js';
import { ctx, setRun } from './ctx.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (d) => d.toISOString().slice(0, 10);
const fld = (l, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, l, el);

export function newRunModal() {
  if (!ctx.canEdit) return toast('Only the payroll team can open a payroll', 'err');
  const runs = ctx.runs.slice().sort((a, b) => String(b.period_end || '').localeCompare(String(a.period_end || '')));
  const lastOf = (st) => runs.find((r) => r.stream === st);
  const suggest = (st) => {
    const last = lastOf(st);
    if (st === 'monthly') { const base = last && last.period_end ? new Date(last.period_end + 'T00:00:00Z') : new Date(); const m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + (last ? 1 : 0), 1)); const st = last && last.period_end ? new Date(Date.parse(last.period_end) + 864e5) : null; return { label: `${MONTHS[m.getUTCMonth()]} ${m.getUTCFullYear()}`, start: st ? iso(st) : '', end: st ? iso(new Date(st.getTime() + 27 * 864e5)) : '' }; }
    const n = last ? (+(String(last.label).match(/(\d+)/) || [])[1] || 0) + 1 : 1; const s = last && last.period_end ? new Date(Date.parse(last.period_end) + 864e5) : null;
    return { label: `Fortnight ${n}`, start: s ? iso(s) : '', end: s ? iso(new Date(s.getTime() + 13 * 864e5)) : '' };
  };
  modal('Open a new payroll', (done) => {
    const stream = h('select', null, [['monthly', 'Monthly'], ['fortnightly', 'Fortnightly']].map(([v, t]) => h('option', { value: v }, t)));
    const label = h('input', { type: 'text' }), start = h('input', { type: 'date' }), end = h('input', { type: 'date' });
    const calInfo = h('div', { class: 'small muted' });
    const mode = h('div', { class: 'stack' });
    const prevSel = h('select');
    const cal = { rows: [] };
    const fill = async () => {
      const s = suggest(stream.value); label.value = s.label; start.value = s.start; end.value = s.end;
      prevSel.innerHTML = ''; runs.filter((r) => r.stream === stream.value).forEach((r) => prevSel.append(h('option', { value: r.id }, r.label)));
      await lookCal();
    };
    const lookCal = async () => {
      cal.rows = await loadCalendarPeriod(stream.value, label.value.trim()).catch(() => []);
      if (cal.rows.length) {
        const f = cal.rows.map((r) => r.reconcile_from).filter(Boolean).sort()[0], t = cal.rows.map((r) => r.reconcile_to).filter(Boolean).sort().pop();
        if (f) start.value = f; if (t) end.value = t;
        calInfo.textContent = `Found “${label.value.trim()}” in the pay calendar (${cal.rows.length} projects): dates set from ${dmy(f)} to ${dmy(t)} — the earliest and latest project windows.`;
      } else calInfo.textContent = 'No pay calendar month with this name — type the dates yourself (or name it like the calendar, e.g. November 2026).';
    };
    stream.onchange = fill; label.addEventListener('change', lookCal);
    const radio = (v, t, d, extra) => h('label', { class: 'nr-opt' }, h('input', { type: 'radio', name: 'nrmode', value: v, checked: v === 'copy' }), h('div', { class: 'grow' }, h('b', null, t), h('div', { class: 'small muted' }, d), extra || null));
    mode.append(
      radio('copy', 'Copy the people from a previous payroll', 'Same employees, projects, rates, budgets and pay dates — no hours. The quickest start.', h('div', { style: { marginTop: '6px' } }, prevSel)),
      radio('staff', 'Fill it from the employee list', 'Everyone active and on the payroll, using each person’s project, rate, weekly hours and pay date.'),
      radio('empty', 'Start empty', 'Add lines by hand, upload hours or timesheets, or add new starters.'));
    const applyCal = h('input', { type: 'checkbox', checked: true });
    setTimeout(fill);
    return h('div', { class: 'stack' },
      h('div', { class: 'form-grid g3' }, fld('Payroll type', stream), fld('Name', label), h('div'), fld('First day', start), fld('Last day', end)), calInfo,
      h('h4', { style: { margin: '6px 0 0' } }, 'Start with'), mode,
      h('label', { class: 'row small' }, applyCal, 'Apply the pay calendar (pay day windows and each project’s budget weeks) when it is found'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
        const name = label.value.trim(); if (!name) return toast('Give the payroll a name', 'err'); if (!start.value || !end.value || end.value < start.value) return toast('Check the first and last day', 'err');
        if (ctx.runs.some((r) => r.stream === stream.value && r.label.toLowerCase() === name.toLowerCase())) return toast('A payroll with this name already exists', 'err');
        const m = (mode.querySelector('input[name=nrmode]:checked') || {}).value || 'empty';
        const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Creating…';
        try {
          const staffRows = m === 'staff' ? (await loadStaff()).filter((e) => e.emp_status !== 'terminated' && e.payroll_state !== 'pending' && e.default_project).sort((a, b) => natCompare(a.full_name, b.full_name)) : [];
          const { run, lines } = await createRunManual({ stream: stream.value, label: name, period_start: start.value, period_end: end.value, mode: m, fromRunId: prevSel.value || null, staffRows, onProgress: (f) => { btn.textContent = `Creating… ${Math.round(f * 100)}%`; } });
          let extra = '';
          if (applyCal.checked && cal.rows.length) { await applyCalendar(run.id, cal.rows); if (lines) await applyProjectWindows(run.id, stream.value, name).catch(() => {}); extra = ' · pay calendar applied'; }
          ctx.runs = await loadRuns(); setRun(run.id); done(); toast(`${name} opened with ${lines} line(s)${extra}`, 'ok'); location.hash = '#/payroll'; setTimeout(() => location.reload(), 300);
        } catch (e) { btn.disabled = false; btn.textContent = 'Open payroll'; toast(e.message, 'err'); }
      } }, 'Open payroll')));
  }, { wide: true });
}
export const newRunButton = (cls = 'btn primary') => (ctx.canEdit ? h('button', { class: cls, onClick: newRunModal }, '+ New payroll') : null);
