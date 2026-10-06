// Hours & estimated pay for ANY date range, grouped by employee / project / site / week / day / pay date.
import { explore, loadPeriods, loadRunData } from './api.js';
import { h, clear, money, hrs, dm, dmy, addDays, mondayOf, toast, downloadCSV, natCompare, modal, icon } from './ui.js';
import { sendEmails } from './api.js';
import { reportHtml, csvText, toBase64, parseEmails, EMAIL_OK, textToHtml } from './mail.js';
import { ctx, currentRun, runPicker } from './ctx.js';

export async function render(root, params) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file first.')); return; }
  const periods = await loadPeriods(run.id);
  const s = { from: params.from || run.period_start, to: params.to || run.period_end, by: params.by || 'employee', scope: 'run', group: '', project: '', search: '' };
  let rows = [];
  const out = h('div');
  const weeks = []; for (let d = mondayOf(run.period_start); d <= run.period_end; d = addDays(d, 7)) weeks.push(d);

  const fromI = h('input', { type: 'date', value: s.from, onChange: (e) => { s.from = e.target.value; go(); } });
  const toI = h('input', { type: 'date', value: s.to, onChange: (e) => { s.to = e.target.value; go(); } });
  const setRange = (a, b) => { s.from = a; s.to = b; fromI.value = a; toI.value = b; go(); };
  const selects = {};
  const sel = (label, key, opts) => h('label', { class: 'fld' }, label, (selects[key] = h('select', { onChange: (e) => { s[key] = e.target.value; go(); } }, opts.map(([v, t]) => h('option', { value: v, selected: s[key] === v }, t)))));
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Hours explorer'), h('p', null, 'Pick any dates — a day, a week, a pay window or something in between — and see who worked how much.')), runPicker(() => { location.hash = '#/explorer'; location.reload(); })),
    h('div', { class: 'card pad', style: { marginBottom: '14px' } },
      h('div', { class: 'toolbar', style: { marginBottom: '8px' } }, h('label', { class: 'fld' }, 'From', fromI), h('label', { class: 'fld' }, 'To', toI),
        sel('Group by', 'by', [['employee', 'Employee'], ['project', 'Project'], ['site', 'Site'], ['week', 'Week'], ['day', 'Day'], ['pay_group', 'Pay date']]),
        sel('Search within', 'scope', [['run', 'This pay run only'], ['all', 'All imported runs']]),
        sel('Pay date', 'group', [['', 'All'], ...[...new Set(periods.map((p) => p.pay_group))].sort(natCompare).map((g) => [g, g])]),
        h('label', { class: 'fld w2' }, 'Project', h('input', { type: 'text', placeholder: 'exact project name (optional)', onChange: (e) => { s.project = e.target.value.trim(); go(); } })),
        h('label', { class: 'fld w2' }, 'Employee', h('input', { type: 'search', placeholder: 'part of a name', onChange: (e) => { s.search = e.target.value.trim(); go(); } }))),
      h('div', { class: 'chips' }, h('span', { class: 'small muted', style: { alignSelf: 'center' } }, 'Quick pick:'),
        periods.filter((p) => p.reconcile_from).sort((a, b) => natCompare(a.pay_group, b.pay_group)).map((p) => h('button', { class: 'chip', title: `${dmy(p.reconcile_from)} – ${dmy(p.reconcile_to)}`, onClick: () => { s.group = p.pay_group; selects.group.value = p.pay_group; setRange(p.reconcile_from, p.reconcile_to); } }, `${p.pay_group} window`)),
        weeks.map((w) => h('button', { class: 'chip', onClick: () => setRange(w, addDays(w, 6)) }, `w/c ${dm(w)}`)),
        h('button', { class: 'chip', onClick: () => { s.group = ''; selects.group.value = ''; setRange(run.period_start, run.period_end); } }, 'Whole run'))),
    out);

  function emailReport(label) {
    const title = `Hours report ${dmy(s.from)} – ${dmy(s.to)}`, scope = s.scope === 'run' ? run.label : 'all payrolls', by = label.toLowerCase();
    const head = [label, 'Hours', 'Estimated pay', 'Employees', 'Lines'], body = rows.map((r) => [r.grp, hrs(r.hours), money(r.est_pay), r.employees, r.line_count]);
    modal('Email this hours report', (close) => {
      const to = h('input', { type: 'text', placeholder: 'name@company.com, other@company.com' }), subj = h('input', { type: 'text', value: `${title} (by ${by})` }), msg = h('textarea', { rows: 4 }, `Hi,\n\nPlease find the hours report for ${dmy(s.from)} – ${dmy(s.to)} (${scope}) below, with a CSV attached.\n\nThanks`);
      const err = h('div', { class: 'notice err hidden' }), btn = h('button', { class: 'btn primary', onClick: async () => {
        const list = parseEmails(to.value); if (!list.length || list.some((x) => !EMAIL_OK.test(x))) { err.textContent = 'Type one or more valid email addresses, separated by commas.'; err.classList.remove('hidden'); return; }
        btn.disabled = true;
        try { const tot = rows.reduce((a, r) => ({ h: a.h + +r.hours, p: a.p + +r.est_pay }), { h: 0, p: 0 });
          const html = textToHtml(msg.value) + '<br>' + reportHtml({ title, subtitle: `${scope} · grouped by ${by}`, headers: head, rows: body.slice(0, 300), totals: ['Total', hrs(tot.h), money(tot.p), '', ''], note: body.length > 300 ? `Showing the first 300 of ${body.length} rows — the CSV has them all.` : 'Estimated pay = hours × hourly rate for Hourly and Cover contracts (excludes leave pay, additions, deductions and fixed pay).' });
          const r = await sendEmails('hours_report', list.map((x) => ({ to: x, subject: subj.value, html })), { run_id: s.scope === 'run' ? run.id : null, reply_to: ctx.me && ctx.me.email, attachments: [{ filename: `hours_${s.from}_${s.to}_by_${s.by}.csv`, content: toBase64(csvText([head, ...body])) }] });
          toast(`${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'err' : 'ok'); if (!r.failed) close(); } catch (er) { err.textContent = er.message || String(er); err.classList.remove('hidden'); } finally { btn.disabled = false; } } }, icon('mail'), 'Send');
      return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `${dmy(s.from)} – ${dmy(s.to)} · ${scope} · by ${by} · ${rows.length} rows (+ CSV attached)`), h('label', { class: 'fld' }, 'To', to), h('label', { class: 'fld' }, 'Subject', subj), h('label', { class: 'fld' }, 'Message', msg), err, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: close }, 'Cancel'), btn));
    });
  }
  async function go() {
    if (!s.from || !s.to || s.from > s.to) { clear(out).append(h('div', { class: 'notice warn' }, 'Choose a valid date range (From must be on or before To).')); return; }
    clear(out).append(h('div', { class: 'muted' }, 'Calculating…'));
    try {
      rows = await explore({ from: s.from, to: s.to, by: s.by, run: s.scope === 'run' ? run.id : null, group: s.group, project: s.project, search: s.search });
    } catch (e) { clear(out).append(h('div', { class: 'notice err' }, e.message)); return; }
    const tot = rows.reduce((a, r) => ({ hours: a.hours + +r.hours, pay: a.pay + +r.est_pay }), { hours: 0, pay: 0 });
    const max = Math.max(1, ...rows.map((r) => +r.hours));
    const label = { employee: 'Employee', project: 'Project', site: 'Site', week: 'Week starting', day: 'Day', pay_group: 'Pay date' }[s.by];
    clear(out).append(
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        h('div', { class: 'muted' }, `${dmy(s.from)} – ${dmy(s.to)} · `, h('b', { style: { color: '#14222b' } }, `${hrs(tot.hours)} hours`), ` · est. pay ${money(tot.pay)}`, ' · ', `${rows.length} ${label.toLowerCase()}${rows.length === 1 ? '' : 's'}`),
        h('div', { class: 'grow' }), ctx.can('send_emails') ? h('button', { class: 'btn warn', onClick: () => emailReport(label) }, icon('mail'), 'Email this report') : null, h('button', { class: 'btn', onClick: () => downloadCSV(`hours_${s.from}_${s.to}_by_${s.by}.csv`, [[label, 'Hours', 'Estimated pay', 'Employees', 'Lines'], ...rows.map((r) => [r.grp, r.hours, r.est_pay, r.employees, r.line_count])]) }, 'Export CSV')),
      rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, [label, 'Hours', '', 'Est. pay', 'Employees', 'Lines'].map((t, i) => h('th', { class: i > 0 && i !== 2 ? 'num' : '' }, t)))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.grp), h('td', { class: 'num' }, hrs(r.hours)), h('td', { style: { width: '160px' } }, h('div', { class: 'bar' }, h('i', { style: { width: 100 * +r.hours / max + '%' } }))),
          h('td', { class: 'num' }, money(r.est_pay)), h('td', { class: 'num' }, r.employees), h('td', { class: 'num' }, r.line_count)))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'num' }, hrs(tot.hours)), h('td'), h('td', { class: 'num' }, money(tot.pay)), h('td'), h('td'))))) :
      h('div', { class: 'card empty' }, 'No hours recorded for these dates.'),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Estimated pay = day-by-day hours × hourly rate for Hourly and Cover contracts. It excludes leave pay, additions, deductions and fixed pay — use the Payroll page for exact gross pay.'));
  }
  await go();
}
