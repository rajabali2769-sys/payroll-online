// Week plans: a budget for every week of the year per project (term time / term break / deep clean …), the school term
// dates behind it, and the week-by-week history of what was actually worked. Upload a "Week Wise Data" workbook, check
// the preview, press Finalize — it goes into the portal and is used straight away by the budgets.
import { loadWeekPlans, saveWeekPlans, deleteWeekPlans, loadTerms, saveTerms, loadProjectHistory, loadProjectBudgets, saveProjectBudgets, loadProjects, saveEmployeeBudgets, loadStaff, setContractedWeeks } from './api.js';
import { h, clear, hrs, dmy, dm, toast, modal, icon, debounce, confirmBox, natCompare } from './ui.js';
import { ctx } from './ctx.js';
import { normKey } from './parsers.js';
import { loadXLSX, sheetRows } from './xlsx.js';
import { panel, expandAllBtn } from './panels.js';

const iso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  const d = String(v).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (d) return `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  return null;
};
const mondayOf = (s) => { const d = new Date(s + 'T00:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
const median = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const TYPE_CLS = (t) => (/break|holiday|closed/i.test(t || '') ? 'wk-break' : /deep|raised|extra/i.test(t || '') ? 'wk-deep' : /term|normal/i.test(t || '') ? 'wk-term' : '');

// ---------- read a "Week Wise Data" workbook ----------
export function parseWeekWorkbook(XLSX, wb) {
  const sites = [], status = new Map(), notes = new Map(), terms = [], staff = [];
  for (const name of wb.SheetNames) {
    const rows = sheetRows(XLSX, wb.Sheets[name]);
    // a header row: a label in column A and dates across
    let dates = null;
    for (const r of rows) {
      if (!r || !r.length) continue;
      const a = String(r[0] ?? '').trim();
      const ds = r.slice(1).map(iso);
      if (ds.filter(Boolean).length >= 4) { dates = ds.map((d) => (d ? mondayOf(d) : null)); continue; }
      if (!dates || !a) continue;
      const m = a.match(/^(.*?)\s*[–-]\s*(term status|status|period|note)s?\s*$/i);
      if (m) { const k = m[1].trim(), map = /period|note/i.test(m[2]) ? notes : status; const o = map.get(k) || new Map(); dates.forEach((d, i) => { const v = r[i + 1]; if (d && v !== null && v !== undefined && String(v).trim() !== '') o.set(d, String(v).trim()); }); map.set(k, o); continue; }
      const vals = dates.map((d, i) => (d ? num(r[i + 1]) : null));
      if (vals.filter((v) => v !== null).length >= 4) sites.push({ site: a, weeks: dates.map((d, i) => ({ week_start: d, hours: vals[i] })).filter((w) => w.week_start && w.hours !== null) });
    }
    // term dates sheet
    const hi = rows.findIndex((r) => r && /school|project|site/i.test(String(r[0] ?? '')) && r.some((c) => /from/i.test(String(c ?? ''))) && r.some((c) => /^to$/i.test(String(c ?? '').trim())));
    if (hi >= 0) { const H = rows[hi].map((c) => String(c ?? '').toLowerCase().trim()); const ci = (re) => H.findIndex((x) => re.test(x));
      const cS = 0, cT = ci(/term|holiday|period/), cF = ci(/^from/), cTo = ci(/^to$/), cSrc = ci(/source/);
      for (const r of rows.slice(hi + 1)) { if (!r || !r[cS] || !iso(r[cF]) || !iso(r[cTo])) continue; terms.push({ site: String(r[cS]).trim(), term_name: String(r[cT] ?? '').trim() || 'Term', date_from: iso(r[cF]), date_to: iso(r[cTo]), source: cSrc >= 0 && r[cSrc] ? String(r[cSrc]) : null }); } }
    // employee sheet
    const he = rows.findIndex((r) => r && /employee/i.test(String(r[0] ?? '')) && r.some((c) => /budget|hrs|hours/i.test(String(c ?? ''))));
    if (he >= 0) { const H = rows[he].map((c) => String(c ?? '').toLowerCase()); const ci = (re) => H.findIndex((x) => re.test(x));
      const cB = ci(/budget|hrs|hours/), cP = ci(/total paid|paid weeks|contracted/), cD = ci(/deep/), cA = ci(/annual|leave/), cTw = ci(/term week/);
      for (const r of rows.slice(he + 1)) { if (!r || !r[0] || num(r[cB]) === null) continue; staff.push({ name: String(r[0]).trim(), weekly: num(r[cB]), paid_weeks: cP >= 0 ? num(r[cP]) : null, deep_weeks: cD >= 0 ? num(r[cD]) : null, al_weeks: cA >= 0 ? num(r[cA]) : null, term_weeks: cTw >= 0 ? num(r[cTw]) : null }); } }
  }
  for (const s of sites) {
    const st = status.get(s.site) || new Map(), nt = notes.get(s.site) || new Map();
    const usual = median(s.weeks.filter((w) => !/break/i.test(st.get(w.week_start) || '')).map((w) => w.hours));
    s.usual = usual;
    for (const w of s.weeks) {
      const t = st.get(w.week_start) || (w.hours === 0 ? 'Term Break' : 'Term Time');
      w.raised = usual > 0 && w.hours > usual * 1.02;
      w.week_type = w.raised ? (/break/i.test(t) ? 'Deep Clean (holiday)' : 'Raised hours') : t;
      w.note = nt.get(w.week_start) || null;
    }
  }
  return { sites, terms, staff };
}

// ---------- the Budgets → Week plans tab ----------
export async function weekPlansTab(host, { onChange } = {}) {
  const can = ctx.canEdit;
  let plans = [], hist = [], budgets = [], terms = [], q = '';
  const body = h('div'), acts = h('div', { class: 'row wrap', style: { gap: '6px' } });
  clear(host).append(h('div', { class: 'notice', style: { marginBottom: '12px' } }, 'A week plan gives a project its own budget for every week — 0 in term breaks, more in deep-clean weeks. Those weeks then use the plan instead of the normal weekly budget, so planned deep cleans never show as over budget. History shows what was really worked each week.'),
    h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: 'Find a project…', style: { width: '240px' }, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) }), h('div', { class: 'grow' }), acts), body);
  clear(acts).append(can ? h('button', { class: 'btn primary', onClick: () => importFlow() }, icon('upload'), 'Upload week-wise data') : null, can ? h('button', { class: 'btn', onClick: () => rangeDlg() }, icon('plus'), 'Set weeks by hand') : null, expandAllBtn(() => body));

  function grid(key, name) {
    const P = plans.filter((p) => p.name_key === key), Hs = hist.filter((x) => x.project_key === key), T = terms.filter((t) => t.name_key === key);
    const weeks = [...new Set([...P.map((p) => p.week_start), ...Hs.map((x) => x.week_start)])].sort();
    const pb = budgets.find((b) => b.name_key === key);
    const pm = new Map(P.map((p) => [p.week_start, p])), hm = new Map(Hs.map((x) => [x.week_start, x]));
    const cell = (w) => { const p = pm.get(w), x = hm.get(w), plan = p ? +p.budget_hours : pb ? +pb.weekly_hours : null, worked = x ? +x.worked_hours : null, d = plan !== null && worked !== null ? worked - plan : null;
      const inp = can ? h('input', { type: 'number', step: 'any', value: p ? p.budget_hours : '', placeholder: pb ? String(pb.weekly_hours) : '', class: 'wkin', title: 'Planned budget hours for this week (empty = normal weekly budget)', onChange: async (e) => { try { if (e.target.value === '') await deleteWeekPlans(key, [w]); else await saveWeekPlans([{ name_key: key, project_name: name, week_start: w, budget_hours: +e.target.value, week_type: p ? p.week_type : 'Term Time', note: p ? p.note : null, source: 'manual' }]); await load(); if (onChange) onChange(); } catch (er) { toast(er.message, 'err'); } } }) : h('b', null, plan === null ? '—' : hrs(plan));
      return h('td', { class: 'wkc ' + TYPE_CLS(p && p.week_type), title: [p && p.week_type, p && p.note, x && x.payrolls].filter(Boolean).join(' · ') },
        h('div', { class: 'wkd' }, dm(w)), inp, h('div', { class: 'wkw' }, worked === null ? '' : hrs(worked)), h('div', { class: 'wkdiff ' + (d > 0.25 ? 'neg' : d < -0.25 ? 'pos' : '') }, d === null ? '' : (d > 0 ? '+' : '') + hrs(d))); };
    const raised = P.filter((p) => /deep|raised/i.test(p.week_type || '')), breaks = P.filter((p) => /break/i.test(p.week_type || ''));
    const workedTot = Hs.reduce((t, x) => t + +x.worked_hours, 0), planTot = Hs.reduce((t, x) => t + (pm.get(x.week_start) ? +pm.get(x.week_start).budget_hours : pb ? +pb.weekly_hours : 0), 0);
    return panel(h('span', null, name, h('span', { class: 'psub2' }, ` · ${P.length} planned weeks · ${breaks.length} breaks · ${raised.length} raised · history ${Hs.length} weeks${Hs.length ? ` (${hrs(workedTot)} worked vs ${hrs(planTot)} planned)` : ''}`)),
      h('div', null,
        weeks.length ? h('div', { class: 'tablewrap', style: { maxHeight: 'none' } }, h('table', { class: 't wkgrid' }, h('tbody', null, h('tr', null, h('th', { class: 'wklab' }, h('div', null, 'Week'), h('div', null, 'Plan'), h('div', null, 'Worked'), h('div', null, 'Diff')), weeks.map(cell))))) : h('div', { class: 'small muted' }, 'No weeks yet.'),
        h('div', { class: 'row wrap small', style: { gap: '10px', marginTop: '8px' } }, h('span', { class: 'wklg wk-term' }, 'Term time / normal'), h('span', { class: 'wklg wk-break' }, 'Term break'), h('span', { class: 'wklg wk-deep' }, 'Deep clean / raised hours'), h('span', { class: 'muted' }, pb ? `Normal weekly budget ${hrs(pb.weekly_hours)} h` : 'No normal weekly budget'),
          h('div', { class: 'grow' }), can && P.length ? h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmBox(`Remove the week plan for ${name}?`, `${P.length} planned weeks are removed; the normal weekly budget applies again.`, 'Remove', true)) { await deleteWeekPlans(key); await load(); if (onChange) onChange(); } } }, icon('trash'), 'Remove plan') : null),
        T.length ? h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'small' }, `Term dates (${T.length})`), h('table', { class: 't', style: { marginTop: '6px' } }, h('tbody', null, T.map((t) => h('tr', null, h('td', null, t.term_name), h('td', { class: 'small' }, `${dmy(t.date_from)} – ${dmy(t.date_to)}`), h('td', { class: 'small muted' }, t.source || '')))))) : null),
      { id: 'wp.' + key });
  }
  function draw() {
    const keys = new Map(); for (const p of plans) keys.set(p.name_key, p.project_name); for (const x of hist) if (!keys.has(x.project_key)) keys.set(x.project_key, x.project_name);
    const list = [...keys].filter(([k, n]) => !q || String(n).toLowerCase().includes(q)).sort((a, b) => (plans.some((p) => p.name_key === b[0]) - plans.some((p) => p.name_key === a[0])) || natCompare(a[1], b[1]));
    clear(body).append(list.length ? h('div', { class: 'hrstack' }, list.map(([k, n]) => grid(k, n))) : h('div', { class: 'card empty' }, 'No week plans or history yet — upload your week-wise data.'));
  }
  async function load() { [plans, hist, budgets, terms] = await Promise.all([loadWeekPlans().catch(() => []), loadProjectHistory().catch(() => []), loadProjectBudgets().catch(() => []), loadTerms().catch(() => [])]); draw(); }

  function rangeDlg() {
    modal('Set weeks by hand', (done) => {
      const pr = h('input', { type: 'text', list: 'wp-proj', placeholder: 'Project' }), dl = h('datalist', { id: 'wp-proj' }, budgets.map((b) => h('option', { value: b.project_name })));
      const f = h('input', { type: 'date' }), t = h('input', { type: 'date' }), hh = h('input', { type: 'number', step: 'any', placeholder: 'e.g. 80' });
      const ty = h('select', null, ['Deep Clean', 'Term Time', 'Term Break', 'Raised hours', 'Normal'].map((x) => h('option', null, x))), note = h('input', { type: 'text', placeholder: 'e.g. Summer deep clean' });
      return h('div', { class: 'stack' }, dl, h('div', { class: 'form-grid g3' }, h('label', { class: 'fld' }, 'Project', pr), h('label', { class: 'fld' }, 'From week', f), h('label', { class: 'fld' }, 'To week', t), h('label', { class: 'fld' }, 'Budget hours a week', hh), h('label', { class: 'fld' }, 'Week type', ty), h('label', { class: 'fld' }, 'Note', note)),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
          if (!pr.value.trim() || !f.value || hh.value === '') return toast('Project, first week and hours are needed', 'err');
          const rows = []; for (let w = mondayOf(f.value); w <= mondayOf(t.value || f.value); w = new Date(Date.parse(w) + 7 * 864e5).toISOString().slice(0, 10)) rows.push({ name_key: normKey(pr.value), project_name: pr.value.trim(), week_start: w, budget_hours: +hh.value, week_type: ty.value, note: note.value.trim() || null, source: 'manual' });
          try { await saveWeekPlans(rows); done(); toast(`${rows.length} week(s) saved`, 'ok'); await load(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Save')));
    }, { wide: true });
  }

  // ---------- upload → preview → Finalize ----------
  function importFlow() {
    const file = h('input', { type: 'file', accept: '.xlsx,.xls', class: 'hidden' });
    file.onchange = async (e) => {
      const fl = e.target.files[0]; e.target.value = ''; if (!fl) return;
      try { const XLSX = await loadXLSX(); const wb = XLSX.read(await fl.arrayBuffer(), { type: 'array' }); const r = parseWeekWorkbook(XLSX, wb); if (!r.sites.length) throw new Error('No weekly rows found. The file needs a row with "Site" and week dates across, then one row per site with the hours.'); preview(r, fl.name); }
      catch (er) { toast(er.message, 'err'); }
    };
    file.click();
  }
  async function preview(r, fileName) {
    const [projects, staffAll] = await Promise.all([loadProjects().catch(() => []), loadStaff().catch(() => [])]);
    const names = [...new Set([...projects.map((p) => p.name), ...budgets.map((b) => b.project_name)])].sort(natCompare);
    const guess = (site) => { const k = normKey(site); const exact = names.find((n) => normKey(n) === k); if (exact) return exact; const toks = k.split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !/school|primary|academy|limited|ltd/.test(t)); return names.find((n) => toks.some((t) => normKey(n).includes(t))) || site; };
    modal(`Check the week-wise data — ${fileName}`, (done) => {
      const sel = new Map(); const setNormal = h('input', { type: 'checkbox', checked: true });
      const staffProj = h('select', null, r.sites.map((s) => h('option', { value: s.site }, s.site)));
      if (r.staff.length) { const tot = r.staff.reduce((t, s) => t + (s.weekly || 0), 0); const m = r.sites.find((s) => s.weeks.some((w) => Math.abs(w.hours - tot) < 0.01)); if (m) staffProj.value = m.site; }
      const siteCards = r.sites.map((s) => {
        const inp = h('input', { type: 'text', list: 'wpi-list', value: guess(s.site), style: { minWidth: '260px' } }); sel.set(s.site, inp);
        const br = s.weeks.filter((w) => /break/i.test(w.week_type)).length, rs = s.weeks.filter((w) => w.raised);
        return h('div', { class: 'card pad', style: { marginBottom: '10px' } },
          h('div', { class: 'row wrap', style: { gap: '10px' } }, h('b', null, s.site), h('span', { class: 'muted small' }, '→ portal project'), inp, h('div', { class: 'grow' }), h('span', { class: 'small' }, `${s.weeks.length} weeks · ${dmy(s.weeks[0].week_start)} – ${dmy(s.weeks[s.weeks.length - 1].week_start)} · usual ${hrs(s.usual)} h/wk · ${br} break weeks${rs.length ? ` · ${rs.length} raised weeks (${hrs(rs[0].hours)} h)` : ''}`)),
          h('div', { class: 'tablewrap', style: { maxHeight: 'none', marginTop: '8px' } }, h('table', { class: 't wkgrid' }, h('tbody', null, h('tr', null, s.weeks.map((w) => h('td', { class: 'wkc ' + TYPE_CLS(w.week_type), title: [w.week_type, w.note].filter(Boolean).join(' · ') }, h('div', { class: 'wkd' }, dm(w.week_start)), h('b', null, hrs(w.hours)), h('div', { class: 'wkw' }, w.raised ? '▲' : ''))))))));
      });
      return h('div', { class: 'stack' }, h('datalist', { id: 'wpi-list' }, names.map((n) => h('option', { value: n }))),
        h('div', { class: 'small muted' }, 'Match each site to the project name used in the payroll (pick from the list). Weeks above the usual hours are marked ▲ — e.g. deep cleaning.'),
        ...siteCards,
        r.terms.length ? h('div', { class: 'small' }, `${r.terms.length} term / holiday periods will be saved.`) : null,
        r.staff.length ? h('div', { class: 'card pad' }, h('b', null, `${r.staff.length} employee budgets`), h('span', { class: 'small muted' }, ` (total ${hrs(r.staff.reduce((t, s) => t + (s.weekly || 0), 0))} h/wk) — they belong to: `), staffProj,
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, r.staff.map((s) => `${s.name} ${hrs(s.weekly)} h${s.paid_weeks ? ` · ${s.paid_weeks} paid wks` : ''}`).join(' · '))) : null,
        h('label', { class: 'row small' }, setNormal, 'Also set each project’s normal weekly budget to its usual term-time hours (if it has none yet)'),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
          try {
            const proj = (site) => sel.get(site).value.trim() || site;
            const W = r.sites.flatMap((s) => s.weeks.map((w) => ({ name_key: normKey(proj(s.site)), project_name: proj(s.site), week_start: w.week_start, budget_hours: w.hours, week_type: w.week_type, note: w.note, source: fileName })));
            await saveWeekPlans(W);
            if (r.terms.length) await saveTerms(r.terms.map((t) => { const p = sel.get(t.site) ? proj(t.site) : t.site; return { name_key: normKey(p), project_name: p, term_name: t.term_name, date_from: t.date_from, date_to: t.date_to, source: t.source }; }));
            if (setNormal.checked) { const have = new Set(budgets.map((x) => x.name_key)); const add = r.sites.filter((s) => !have.has(normKey(proj(s.site))) && s.usual > 0).map((s) => ({ name_key: normKey(proj(s.site)), project_name: proj(s.site), weekly_hours: s.usual })); if (add.length) await saveProjectBudgets(add); }
            let empMsg = '';
            if (r.staff.length) { const p = proj(staffProj.value); await saveEmployeeBudgets(r.staff.filter((s) => !/^vacant/i.test(s.name)).map((s) => ({ employee_name: s.name, name_key: normKey(s.name), project_name: p, project_key: normKey(p), weekly_hours: s.weekly })));
              const byName = new Map(staffAll.map((e) => [normKey(e.full_name), e])); const cw = r.staff.filter((s) => s.paid_weeks && byName.get(normKey(s.name))).map((s) => [byName.get(normKey(s.name)).id, s.paid_weeks]); if (cw.length) await setContractedWeeks(cw).catch(() => {});
              empMsg = ` · ${r.staff.length} employee budgets${cw.length ? ` (${cw.length} contracted weeks updated)` : ''}`; }
            done(); toast(`Finalized: ${W.length} weeks for ${r.sites.length} project(s)${r.terms.length ? ` · ${r.terms.length} term periods` : ''}${empMsg}`, 'ok'); await load(); if (onChange) onChange();
          } catch (e) { b.disabled = false; b.textContent = 'Finalize'; toast(e.message, 'err'); }
        } }, icon('check'), 'Finalize')));
    }, { xl: true });
  }

  await load();
}
