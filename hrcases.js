// HR cases: every investigation, disciplinary, warning, grievance and suspension — as a board across the stages, or as a list.
import { loadCases, onLive } from './api.js';
import { h, clear, dmy, icon, debounce, downloadCSV, initials, natCompare } from './ui.js';
import { ctx } from './ctx.js';
import { STAGES, CASE_TYPES, stageChip, sevChip, today, daysTo } from './hrkit.js';
import { openCase, newCaseModal } from './hrcase.js';

export async function render(root) {
  const canHR = ctx.can('manage_hr');
  let cases = [], view = 'board', q = '', type = '', proj = '', showClosed = false;
  const kpiHost = h('div'), bar = h('div'), host = h('div', { class: 'cases-host' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'HR cases'), h('p', null, 'Investigations, disciplinaries, warnings, suspensions and grievances. Open a case to send letters, escalate to the area manager and record the outcome.')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onClick: exportCsv }, icon('download'), 'Export'), canHR ? h('button', { class: 'btn primary', onClick: () => newCaseModal(null, { onCreated: load }) }, icon('plus'), 'New case') : null)),
  kpiHost, bar, host);

  const filtered = () => cases.filter((c) => (!type || c.case_type === type) && (!proj || c.project_name === proj) && (!q || [c.employee_name, c.case_ref, c.summary, c.project_name, c.investigator].some((x) => x && x.toLowerCase().includes(q))));
  const overdue = (c) => c.stage !== 'closed' && c.due_date && c.due_date < today();

  function kpis() {
    const open = cases.filter((c) => c.stage !== 'closed'), live = cases.filter((c) => c.warning_level && c.warning_expiry >= today());
    const month = today().slice(0, 7);
    const t = [['kc-violet', 'Open cases', open.length, 'file'], ['kc-blue', 'Investigations', open.filter((c) => c.stage === 'investigation').length, 'search'], ['kc-amber', 'Hearings / meetings', open.filter((c) => c.stage === 'hearing').length, 'users'],
      ['kc-red', 'Overdue', open.filter(overdue).length, 'alert'], ['kc-pink', 'Live warnings', live.length, 'book'], ['kc-green', 'Closed this month', cases.filter((c) => c.closed_on && c.closed_on.slice(0, 7) === month).length, 'check']];
    clear(kpiHost).append(h('div', { class: 'kstrip' }, t.map(([c, l, v, ic]) => h('div', { class: 'ktile ' + c }, h('span', { class: 'kic' }, icon(ic)), h('span', { class: 'kv' }, String(v)), h('span', { class: 'kl' }, l)))));
  }
  function toolbar() {
    const projects = [...new Set(cases.map((c) => c.project_name).filter(Boolean))].sort(natCompare);
    clear(bar).append(h('div', { class: 'toolbar tight' },
      h('div', { class: 'seg big' }, [['board', 'Board'], ['list', 'List']].map(([k, t]) => h('button', { class: view === k ? 'on' : '', onClick: () => { view = k; toolbar(); draw(); } }, t))),
      h('select', { onChange: (e) => { type = e.target.value; draw(); } }, h('option', { value: '' }, 'All case types'), CASE_TYPES.map((t) => h('option', { value: t, selected: t === type }, t))),
      h('select', { onChange: (e) => { proj = e.target.value; draw(); } }, h('option', { value: '' }, 'All projects'), projects.map((p) => h('option', { value: p, selected: p === proj }, p))),
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: showClosed, onChange: (e) => { showClosed = e.target.checked; draw(); } }), 'Show closed'),
      h('div', { class: 'grow' }), h('input', { type: 'search', placeholder: 'Search name, case ref, project…', value: q, style: { width: '240px' }, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) })));
  }
  const card = (c) => h('div', { class: 'casecard' + (overdue(c) ? ' late' : ''), onClick: () => openCase(c.id, { onChange: load }) },
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'avatar sm' }, initials(c.employee_name)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ell' }, c.employee_name), h('div', { class: 'small muted ell' }, c.project_name || '—')), sevChip(c.severity)),
    h('div', { class: 'csum' }, c.summary),
    h('div', { class: 'row wrap', style: { gap: '5px' } }, h('span', { class: 'hpill grp' }, c.case_type), c.outcome ? h('span', { class: 'hpill g-outcome' }, c.outcome) : null),
    h('div', { class: 'row small muted' }, h('span', null, c.case_ref), h('div', { class: 'grow' }), c.stage === 'closed' ? h('span', null, 'Closed ' + dmy(c.closed_on)) : c.due_date ? h('span', { class: overdue(c) ? 'late-t' : '' }, overdue(c) ? `${-daysTo(c.due_date)}d overdue` : 'Due ' + dmy(c.due_date)) : h('span', null, 'Opened ' + dmy(c.opened_on))));

  function draw() {
    kpis();
    const list = filtered();
    if (view === 'board') {
      const cols = STAGES.filter(([k]) => showClosed || k !== 'closed');
      clear(host).append(h('div', { class: 'board' }, cols.map(([k, t]) => { const items = list.filter((c) => c.stage === k); return h('div', { class: 'bcol g-' + k }, h('div', { class: 'bhead' }, stageChip(k), h('div', { class: 'grow' }), h('b', null, String(items.length))), h('div', { class: 'bbody' }, items.length ? items.map(card) : h('div', { class: 'small muted center', style: { padding: '18px 0' } }, 'Nothing here'))); })));
    } else {
      const rows = list.filter((c) => showClosed || c.stage !== 'closed');
      clear(host).append(rows.length ? h('div', { class: 'tablewrap hr-tw' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Case', 'Employee', 'Project', 'Type', 'Severity', 'Stage', 'Opened', 'Target', 'Outcome', 'Warning until'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((c) => h('tr', { class: 'click' + (overdue(c) ? ' late' : ''), onClick: () => openCase(c.id, { onChange: load }) }, h('td', { class: 'small' }, c.case_ref), h('td', null, h('b', null, c.employee_name), h('div', { class: 'small muted' }, c.summary)), h('td', { class: 'small' }, c.project_name || ''),
          h('td', { class: 'small' }, c.case_type), h('td', null, sevChip(c.severity)), h('td', null, stageChip(c.stage)), h('td', { class: 'small nowrap' }, dmy(c.opened_on)), h('td', { class: 'small nowrap' }, dmy(c.due_date)), h('td', { class: 'small' }, c.outcome || ''), h('td', { class: 'small nowrap' }, dmy(c.warning_expiry)))))))
        : h('div', { class: 'card empty' }, cases.length ? 'No cases match.' : 'No HR cases yet.'));
    }
  }
  function exportCsv() {
    downloadCSV('hr_cases.csv', [['Case ref', 'Employee', 'Project', 'Type', 'Category', 'Severity', 'Stage', 'Opened', 'Incident date', 'Target date', 'Closed', 'Outcome', 'Warning', 'Warning until', 'Investigator', 'Area manager', 'Summary'],
      ...filtered().map((c) => [c.case_ref, c.employee_name, c.project_name || '', c.case_type, c.category || '', c.severity, c.stage, c.opened_on, c.incident_date || '', c.due_date || '', c.closed_on || '', c.outcome || '', c.warning_level || '', c.warning_expiry || '', c.investigator || '', c.manager_name || '', c.summary])]);
  }
  async function load() { cases = await loadCases(); toolbar(); draw(); }
  await load();
  return onLive(debounce((e) => { if (e.table === 'hr_cases' && !document.querySelector('.modal-wrap')) load(); }, 800));
}
