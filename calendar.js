// The reconciliation window for each pay date (24th, 25th ... LWD, 5th) - these change every month.
import { loadPeriods, loadSummary, savePeriod, deletePeriod, onLive } from './api.js';
import { h, clear, money, dm, dmy, toast, natCompare, icon, debounce } from './ui.js';
import { ctx, currentRun, runPicker } from './ctx.js';

export async function render(root) {
  const run = currentRun();
  if (!run) { root.append(h('div', { class: 'card empty' }, 'Import a file first.')); return; }
  const host = h('div');
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Pay calendar'), h('p', null, 'For each pay date, set which dates were reconciled and when it is paid. The Payroll and Explorer pages use these windows.')),
    runPicker(() => { location.reload(); })), host);

  async function load() {
    const [periods, summary] = await Promise.all([loadPeriods(run.id), loadSummary(run.id)]);
    const sm = new Map(summary.map((s) => [s.pay_group, s]));
    const groups = [...new Set([...periods.map((p) => p.pay_group), ...summary.map((s) => s.pay_group)])].sort(natCompare);
    const byG = new Map(periods.map((p) => [p.pay_group, p]));
    const dateInput = (p, g, key) => {
      const i = h('input', { type: 'date', value: p?.[key] || '', disabled: !ctx.canEdit, style: { width: '150px' } });
      i.addEventListener('change', async () => {
        try { await savePeriod({ run_id: run.id, pay_group: g, reconcile_from: p?.reconcile_from || null, reconcile_to: p?.reconcile_to || null, pay_date: p?.pay_date || null, [key]: i.value || null }); toast('Saved', 'ok'); await load(); }
        catch (e) { toast(e.message, 'err'); }
      });
      return i;
    };
    clear(host).append(h('div', { class: 'tablewrap auto' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, ['Pay date', 'Reconcile from', 'Reconcile to', 'Paid on', 'Weeks', 'Lines', 'Gross pay', ''].map((t, i) => h('th', { class: i > 3 && i < 7 ? 'num' : '' }, t)))),
      h('tbody', null, groups.map((g) => {
        const p = byG.get(g), s = sm.get(g);
        const wk = p?.reconcile_from && p?.reconcile_to ? Math.round(((Date.parse(p.reconcile_to) - Date.parse(p.reconcile_from)) / 86400000 + 1) / 7 * 10) / 10 : '';
        return h('tr', null, h('td', null, h('span', { class: 'pill grp' }, g)), h('td', null, dateInput(p, g, 'reconcile_from')), h('td', null, dateInput(p, g, 'reconcile_to')), h('td', null, dateInput(p, g, 'pay_date')),
          h('td', { class: 'num' }, wk), h('td', { class: 'num' }, s?.lines ?? 0), h('td', { class: 'num' }, s ? money(s.gross) : ''),
          h('td', null, h('a', { class: 'btn sm', href: '#/payroll?group=' + encodeURIComponent(g) }, 'Open payroll'), ' ',
            p && ctx.canEdit && !s ? h('button', { class: 'btn sm danger', onClick: async () => { await deletePeriod(p.id); load(); } }, icon('trash')) : null));
      })))),
      ctx.canEdit ? h('div', { class: 'row', style: { marginTop: '14px' } }, h('input', { type: 'text', id: 'newgrp', placeholder: 'Add another pay date, e.g. 27th', style: { maxWidth: '260px' } }),
        h('button', { class: 'btn', onClick: async () => { const v = host.querySelector('#newgrp').value.trim(); if (!v) return; try { await savePeriod({ run_id: run.id, pay_group: v }); load(); } catch (e) { toast(e.message, 'err'); } } }, icon('plus'), 'Add')) : null,
      h('div', { class: 'notice', style: { marginTop: '16px' } }, 'Windows were worked out from your file when you imported it (the weeks that count towards variance for most lines in each pay date). Correct any that look wrong — it only changes which weeks are highlighted and quick-picked; it never changes pay.'));
  }
  await load();
  return onLive(debounce((e) => { if (e.table === 'pay_periods') load(); }, 500));
}
