// Employees (HR): every employee by project, split into permanent and temporary / cover staff.
// Fixed-height workspace — projects on the left, the people in the middle, insights on the right — so the page never grows downwards.
import { loadStaff, addStaff, updateStaff, loadProjects, loadCases, loadRunEmployeeHours, onLive } from './api.js';
import { h, clear, toast, modal, dmy, money, hrs, icon, debounce, downloadCSV, donut, initials, natCompare } from './ui.js';
import { ctx, currentRun } from './ctx.js';
import { EMP_STATUS, EMP_TYPES, statusChip, typeChip, rtwChip, rtwState, shiftText, weeklyPay, isCover, activeWarning, today } from './hrkit.js';
import { openProfile } from './profile.js';
import { newCaseModal } from './hrcase.js';

const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);
const NOPROJ = '(No project)';

export async function render(root, params) {
  const canHR = ctx.can('manage_hr'), seeCases = ctx.can('page:hrcases'), run = ctx.can('page:payroll') ? currentRun() : null;
  let staff = [], projects = [], cases = [], runEmp = new Map();
  let showSide = window.innerWidth >= 1600; let proj = (params && params.project) || '', kind = 'perm', st = 'active', q = '', pq = '', quick = '';
  const kpiHost = h('div'), rail = h('div', { class: 'hr-rail' }), mid = h('div', { class: 'hr-main' }), side = h('div', { class: 'hr-side' });
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Employees'), h('p', null, 'Every employee by project — permanent staff and temporary / cover staff kept apart. Click anyone to open their profile and HR cases.')),
    h('div', { class: 'row wrap' }, canHR ? h('button', { class: 'btn', onClick: () => newCaseModal(null, { onCreated: load }) }, icon('alert'), 'New HR case') : null,
      h('button', { class: 'btn', onClick: exportCsv }, icon('download'), 'Export'), canHR ? h('button', { class: 'btn primary', onClick: addPerson }, icon('plus'), 'Add employee') : null)),
  kpiHost, h('div', { class: 'hrws' + (showSide ? '' : ' noside') }, rail, mid, side));

  const projOf = (e) => e.default_project || NOPROJ;
  const casesBy = () => { const m = new Map(); for (const c of cases) { if (!m.has(c.employee_id)) m.set(c.employee_id, []); m.get(c.employee_id).push(c); } return m; };

  function kpis() {
    const act = staff.filter((e) => e.emp_status !== 'terminated');
    const rtwBad = act.filter((e) => ['expired', 'd30'].includes(rtwState(e.rtw_expiry))).length;
    const tiles = [
      ['kc-teal', 'Active', staff.filter((e) => e.emp_status === 'active').length, 'users', () => { st = 'active'; quick = ''; }],
      ['kc-blue', 'Permanent', act.filter((e) => !isCover(e)).length, 'users', () => { kind = 'perm'; quick = ''; }],
      ['kc-violet', 'Temp & cover', act.filter(isCover).length, 'users', () => { kind = 'cover'; quick = ''; }],
      ['kc-amber', 'Suspended', staff.filter((e) => e.emp_status === 'suspended').length, 'lock', () => { st = 'suspended'; quick = ''; }],
      ['kc-slate', 'Terminated', staff.filter((e) => e.emp_status === 'terminated').length, 'x', () => { st = 'terminated'; quick = ''; }],
      ['kc-red', 'RTW expired / ≤30 days', rtwBad, 'alert', () => { quick = 'rtw'; st = 'all'; }],
      seeCases ? ['kc-pink', 'Open HR cases', cases.filter((c) => c.stage !== 'closed').length, 'file', () => { location.hash = '#/hrcases'; }] : null,
      ['kc-green', 'Waiting for payroll', staff.filter((e) => e.payroll_state === 'pending').length, 'clock', () => { location.hash = '#/recruit'; }],
    ].filter(Boolean);
    clear(kpiHost).append(h('div', { class: 'kstrip' }, tiles.map(([c, l, v, ic, go]) => h('button', { class: 'ktile ' + c + (quick === 'rtw' && l.startsWith('RTW') ? ' on' : ''), onClick: () => { go(); draw(); } }, h('span', { class: 'kic' }, icon(ic)), h('span', { class: 'kv' }, String(v)), h('span', { class: 'kl' }, l)))));
  }

  function drawRail() {
    const by = new Map();
    for (const e of staff) { if (st !== 'all' && e.emp_status !== st && quick !== 'rtw') continue; const k = projOf(e); if (!by.has(k)) by.set(k, { perm: 0, cover: 0, warn: 0 }); const o = by.get(k); isCover(e) ? o.cover++ : o.perm++; if (e.emp_status !== 'terminated' && ['expired', 'd30'].includes(rtwState(e.rtw_expiry))) o.warn++; }
    const list = [...by.entries()].filter(([k]) => !pq || k.toLowerCase().includes(pq)).sort((a, b) => (a[0] === NOPROJ) - (b[0] === NOPROJ) || natCompare(a[0], b[0]));
    const max = Math.max(1, ...list.map(([, o]) => o.perm + o.cover));
    const total = list.reduce((s, [, o]) => ({ perm: s.perm + o.perm, cover: s.cover + o.cover }), { perm: 0, cover: 0 });
    const item = (key, label, o) => h('button', { class: 'pitem' + (proj === key ? ' on' : ''), onClick: () => { proj = key; draw(); } },
      h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'pname' }, label), o.warn ? h('span', { class: 'dot red', title: `${o.warn} right-to-work issue(s)` }) : null, h('div', { class: 'grow' }), h('span', { class: 'pcount' }, String(o.perm + o.cover))),
      h('div', { class: 'pbar' }, h('i', { class: 'b-perm', style: { width: (o.perm / max * 100) + '%' } }), h('i', { class: 'b-cover', style: { width: (o.cover / max * 100) + '%' } })),
      h('div', { class: 'psub' }, `${o.perm} permanent · ${o.cover} temp/cover`));
    clear(rail).append(h('div', { class: 'rail-head' }, h('input', { type: 'search', placeholder: 'Find a project…', value: pq, onInput: debounce((ev) => { pq = ev.target.value.toLowerCase(); drawRail(); }, 120) })),
      h('div', { class: 'rail-list' }, item('', 'All projects', total), list.map(([k, o]) => item(k, k, o))),
      h('div', { class: 'rail-legend small' }, h('i', { class: 'b-perm' }), 'Permanent ', h('i', { class: 'b-cover' }), 'Temp / cover'));
  }

  function rows(forKind) {
    return staff.filter((e) => (!proj || projOf(e) === proj) && (forKind === 'cover' ? isCover(e) : !isCover(e))
      && (quick === 'rtw' ? e.emp_status !== 'terminated' && ['expired', 'd30'].includes(rtwState(e.rtw_expiry)) : (st === 'all' || e.emp_status === st))
      && (!q || [e.full_name, e.email, e.ni_number, e.default_project, e.job_title].some((x) => x && String(x).toLowerCase().includes(q))));
  }

  function statusCell(e) {
    if (!canHR) return statusChip(e.emp_status);
    const s = h('select', { class: 'stsel s-' + e.emp_status, onClick: (ev) => ev.stopPropagation() }, EMP_STATUS.map(([v, t]) => h('option', { value: v, selected: e.emp_status === v }, t)));
    s.addEventListener('change', () => {
      const target = s.value; s.value = e.emp_status;
      modal(target === 'terminated' ? `Terminate ${e.full_name}` : target === 'suspended' ? `Suspend ${e.full_name}` : `Make ${e.full_name} active`, (done) => {
        const d = h('input', { type: 'date', value: today() }), why = h('input', { type: 'text', placeholder: 'Reason' });
        return h('div', { class: 'stack' }, target !== 'active' ? h('div', { class: 'form-grid' }, fld(target === 'terminated' ? 'Termination date' : 'Suspended from', d), fld('Reason', why)) : h('p', { style: { margin: 0 } }, 'They will show as active again.'),
          target === 'suspended' ? h('div', { class: 'small muted' }, 'Suspended staff stay on the payroll (normally full pay). Open an HR case to record the reason and send the suspension letter.') : null,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn ' + (target === 'terminated' ? 'danger' : 'primary'), onClick: async () => {
            const p = { emp_status: target }; if (target === 'terminated') { p.termination_date = d.value || today(); p.termination_reason = why.value.trim() || null; } if (target === 'suspended') p.suspended_from = d.value || today();
            try { const n = await updateStaff(e.id, p); Object.assign(e, n); done(); toast('Status updated', 'ok'); draw(); if (target === 'suspended' && seeCases && await confirmCase()) newCaseModal(n, { onCreated: load }); } catch (er) { toast(er.message, 'err'); }
          } }, 'Confirm')));
      });
    });
    return s;
  }
  const confirmCase = () => new Promise((res) => modal('Open an HR case?', (done) => h('div', { class: 'stack' }, h('p', { style: { margin: 0 } }, 'Open an HR case for this suspension, so the reason, letters and outcome are recorded?'), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: () => { done(); res(false); } }, 'Not now'), h('button', { class: 'btn primary', onClick: () => { done(); res(true); } }, 'Open a case')))));

  function drawMain() {
    const cb = casesBy(), permN = rows('perm').length, covN = rows('cover').length, list = rows(kind);
    const p = proj && projects.find((x) => x.name === proj);
    const totH = list.reduce((s, e) => s + (+e.weekly_hours || 0), 0), totP = list.reduce((s, e) => s + weeklyPay(e), 0);
    const tbl = h('table', { class: 't hr-t' },
      h('thead', null, h('tr', null, ['Employee', 'Email', 'Project', '£/h', 'Status', 'Contr. weeks', 'Shift timings', 'Weekly hrs', 'Weekly pay', 'RTW expiry', 'Hire date', 'Termination'].map((t, i) => h('th', { class: [3, 5, 7, 8].includes(i) ? 'num' : '' }, t)))),
      h('tbody', null, list.slice(0, 800).map((e) => {
        const mine = cb.get(e.id) || [], open = mine.filter((c) => c.stage !== 'closed').length, w = activeWarning(mine);
        return h('tr', { class: 'click r-' + e.emp_status, onClick: () => openProfile(e.id, { onChange: (n) => { if (n) { Object.assign(e, n); draw(); } else load(); } }) },
          h('td', null, h('div', { class: 'who' }, h('span', { class: 'avatar sm' }, initials(e.full_name)), h('div', null, h('b', null, e.full_name), h('div', { class: 'small muted' }, e.job_title || (e.ni_number || ''))),
            open ? h('span', { class: 'hpill g-investigation', title: `${open} open HR case(s)` }, `${open} case${open > 1 ? 's' : ''}`) : null, w ? h('span', { class: 'hpill v-high', title: `${w.warning_level} until ${dmy(w.warning_expiry)}` }, 'Warning') : null,
            e.payroll_state === 'pending' ? h('span', { class: 'hpill r-d30', title: 'Waiting for the payroll team' }, 'New') : null)),
          h('td', { class: 'small' }, e.email || h('span', { class: 'muted' }, '—')), h('td', { class: 'small' }, e.default_project || '—'),
          h('td', { class: 'num' }, e.default_rate != null ? money(e.default_rate) : '—'), h('td', null, statusCell(e)), h('td', { class: 'num' }, e.contracted_weeks ?? '—'),
          h('td', { class: 'small nowrap' }, shiftText(e) || '—'), h('td', { class: 'num' }, e.weekly_hours != null ? hrs(e.weekly_hours) : '—'), h('td', { class: 'num' }, e.weekly_hours != null && e.default_rate != null ? money(weeklyPay(e)) : '—'),
          h('td', null, rtwChip(e.rtw_expiry)), h('td', { class: 'small nowrap' }, dmy(e.hire_date) || '—'), h('td', { class: 'small nowrap' }, e.termination_date ? dmy(e.termination_date) : '—'));
      })),
      list.length ? h('tfoot', null, h('tr', null, h('td', { colspan: 7 }, h('b', null, `${list.length} ${kind === 'cover' ? 'temporary / cover' : 'permanent'} employee${list.length === 1 ? '' : 's'}`)), h('td', { class: 'num' }, h('b', null, hrs(totH))), h('td', { class: 'num' }, h('b', null, money(totP))), h('td', { colspan: 3 }))) : null);
    clear(mid).append(
      h('div', { class: 'main-head' },
        h('div', null, h('div', { class: 'eyebrow' }, proj ? 'Project' : 'All projects'), h('h2', null, proj || 'Every project'),
          p && (p.manager || p.manager_email) ? h('div', { class: 'small muted' }, 'Area manager: ', p.manager || '', p.manager_email ? ` · ${p.manager_email}` : '') : null),
        h('div', { class: 'grow' }),
        h('div', { class: 'mstat' }, h('span', null, 'Weekly hours'), h('b', null, hrs(totH))), h('div', { class: 'mstat' }, h('span', null, 'Weekly pay'), h('b', null, money(totP))),
        h('button', { class: 'btn sm' + (showSide ? ' on' : ''), title: 'Show or hide the charts panel', onClick: () => { showSide = !showSide; mid.parentElement.classList.toggle('noside', !showSide); drawMain(); } }, icon('trend'), showSide ? 'Hide insights' : 'Insights')),
      h('div', { class: 'toolbar tight' },
        h('div', { class: 'seg big' }, h('button', { class: kind === 'perm' ? 'on' : '', onClick: () => { kind = 'perm'; draw(); } }, 'Permanent ', h('span', { class: 'cnt' }, String(permN))), h('button', { class: kind === 'cover' ? 'on' : '', onClick: () => { kind = 'cover'; draw(); } }, 'Temporary & cover ', h('span', { class: 'cnt' }, String(covN)))),
        h('div', { class: 'seg' }, [['active', 'Active'], ['suspended', 'Suspended'], ['terminated', 'Terminated'], ['all', 'All']].map(([k, t]) => h('button', { class: st === k && quick !== 'rtw' ? 'on' : '', onClick: () => { st = k; quick = ''; draw(); } }, t))),
        quick === 'rtw' ? h('button', { class: 'btn sm', onClick: () => { quick = ''; st = 'active'; draw(); } }, icon('x'), 'RTW filter') : null,
        h('div', { class: 'grow' }), h('input', { type: 'search', placeholder: 'Search name, email, NI…', value: q, style: { width: '220px' }, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); drawMain(); }, 150) })),
      list.length ? h('div', { class: 'tablewrap hr-tw' }, tbl) : h('div', { class: 'card empty grow-empty' }, staff.length ? 'Nobody matches these filters.' : 'No employees yet.'));
  }

  function drawSide() {
    const base = staff.filter((e) => !proj || projOf(e) === proj), act = base.filter((e) => e.emp_status !== 'terminated');
    const sA = base.filter((e) => e.emp_status === 'active').length, sS = base.filter((e) => e.emp_status === 'suspended').length, sT = base.filter((e) => e.emp_status === 'terminated').length;
    const perm = act.filter((e) => !isCover(e)).length, cov = act.length - perm;
    const rtw = act.filter((e) => ['expired', 'd30', 'd90'].includes(rtwState(e.rtw_expiry))).sort((a, b) => String(a.rtw_expiry).localeCompare(String(b.rtw_expiry)));
    const missing = act.filter((e) => !e.rtw_expiry).length;
    const payAlerts = run ? base.filter((e) => e.emp_status !== 'active' && (runEmp.get(e.id) || 0) > 0) : [];
    const legend = (items) => h('div', { class: 'leg' }, items.map(([c, l, v]) => h('div', null, h('i', { style: { background: c } }), l, h('b', null, String(v)))));
    const card = (title, ...kids) => h('div', { class: 'card pad side-card' }, h('h3', null, title), ...kids);
    clear(side).append(
      card('Status', h('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } }, donut([{ label: 'Active', value: sA, color: '#10b981' }, { label: 'Suspended', value: sS, color: '#f59e0b' }, { label: 'Terminated', value: sT, color: '#94a3b8' }], { size: 104, thick: 15, center: String(base.length), sub: 'people' }),
        legend([['#10b981', 'Active', sA], ['#f59e0b', 'Suspended', sS], ['#94a3b8', 'Terminated', sT]]))),
      card('Workforce mix', h('div', { class: 'mixbar' }, h('i', { class: 'b-perm', style: { flex: perm || 0.0001 } }, perm ? String(perm) : ''), h('i', { class: 'b-cover', style: { flex: cov || 0.0001 } }, cov ? String(cov) : '')),
        h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${act.length ? Math.round(cov / act.length * 100) : 0}% of current staff are temporary or cover`)),
      card('Right to work', h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `${rtw.filter((e) => rtwState(e.rtw_expiry) === 'expired').length} expired · ${rtw.filter((e) => rtwState(e.rtw_expiry) === 'd30').length} within 30 days · ${missing} with no date`),
        rtw.length ? h('div', { class: 'mini-list' }, rtw.slice(0, 30).map((e) => h('button', { class: 'mini', onClick: () => openProfile(e.id, { onChange: load }) }, h('span', { class: 'grow' }, e.full_name, h('span', { class: 'small muted' }, ' · ' + (e.default_project || ''))), rtwChip(e.rtw_expiry)))) : h('div', { class: 'small muted' }, 'Nothing due in the next 90 days.')),
      run ? card('Payroll alerts', h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `Suspended or terminated staff with hours in ${run.label}`),
        payAlerts.length ? h('div', { class: 'mini-list' }, payAlerts.map((e) => h('button', { class: 'mini', onClick: () => openProfile(e.id, { onChange: load }) }, h('span', { class: 'grow' }, e.full_name), statusChip(e.emp_status), h('span', { class: 'small' }, hrs(runEmp.get(e.id)) + 'h')))) : h('div', { class: 'small muted' }, 'None — all clear.')) : null);
  }

  function draw() { kpis(); drawRail(); drawMain(); drawSide(); }

  function addPerson() {
    modal('Add an employee', (done) => {
      const f = {};
      const inp = (k, label, a = {}) => fld(label, (f[k] = h('input', { type: a.type || 'text', step: 'any', placeholder: a.ph || '', list: a.list, value: a.value || '' })), a.cls);
      const dl = h('datalist', { id: 'add-proj' }, projects.map((p) => h('option', { value: p.name })));
      f.employment_type = h('select', null, EMP_TYPES.map(([v, t]) => h('option', { value: v, selected: v === (kind === 'cover' ? 'cover' : 'permanent') }, t)));
      const queue = h('input', { type: 'checkbox', checked: true });
      const err = h('div', { class: 'notice err hidden' });
      return h('div', { class: 'stack' }, dl,
        h('div', { class: 'form-grid g3' }, inp('full_name', 'Full name *'), inp('email', 'Email', { type: 'email' }), inp('phone', 'Phone'), inp('ni_number', 'NI number'), fld('Employment type', f.employment_type), inp('job_title', 'Job title', { ph: 'Cleaning Operative' }),
          inp('default_project', 'Project *', { list: 'add-proj', value: proj }), inp('default_rate', 'Hourly rate £ *', { type: 'number' }), inp('weekly_hours', 'Weekly budgeted hours', { type: 'number' }),
          inp('contracted_weeks', 'Contracted weeks', { type: 'number', ph: '52' }), inp('shift_days', 'Shift days', { ph: 'Mon–Fri' }), h('div', { class: 'row', style: { gap: '8px' } }, inp('shift_start', 'Start', { type: 'time' }), inp('shift_end', 'Finish', { type: 'time' })),
          inp('rtw_type', 'RTW document', { ph: 'Passport / Share code' }), inp('rtw_expiry', 'RTW expiry', { type: 'date' }), inp('hire_date', 'Hire date', { type: 'date', value: today() })),
        h('label', { class: 'row small' }, queue, 'Send to the payroll team as a new starter (they add them to the current payroll)'), err,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
          const row = {}; for (const [k, el] of Object.entries(f)) { const v = el.value.trim(); row[k] = v === '' ? null : ['default_rate', 'weekly_hours', 'contracted_weeks'].includes(k) ? +v : k === 'ni_number' ? v.toUpperCase().replace(/\s+/g, '') : k === 'email' ? v.toLowerCase() : v; }
          if (!row.full_name || !row.default_project || row.default_rate == null) { err.textContent = 'Name, project and hourly rate are required.'; err.classList.remove('hidden'); return; }
          if (row.ni_number && staff.some((e) => e.ni_number === row.ni_number)) { err.textContent = 'Someone with this NI number already exists.'; err.classList.remove('hidden'); return; }
          row.emp_status = 'active'; row.payroll_state = queue.checked ? 'pending' : 'in_payroll'; row.default_contract = row.employment_type === 'permanent' ? 'Hourly' : 'Cover';
          ev.target.disabled = true;
          try { const id = await addStaff(row); done(); toast('Employee added', 'ok'); await load(); openProfile(id, { onChange: load }); } catch (er) { ev.target.disabled = false; err.textContent = er.message; err.classList.remove('hidden'); }
        } }, 'Add employee')));
    }, { wide: true });
  }

  function exportCsv() {
    const H = ['Employee Name', 'Email', 'Phone', 'NI Number', 'Type', 'Project', 'Hourly Rate', 'Status', 'Contracted Weeks', 'Shift', 'Weekly Budgeted Hours', 'Weekly Pay', 'RTW Document', 'RTW Expiry', 'Hire Date', 'Termination Date', 'Termination Reason'];
    downloadCSV(`employees_${(proj || 'all').replace(/\W+/g, '_')}.csv`, [H, ...staff.filter((e) => !proj || projOf(e) === proj).map((e) => [e.full_name, e.email || '', e.phone || '', e.ni_number || '', e.employment_type, e.default_project || '', e.default_rate ?? '', e.emp_status, e.contracted_weeks ?? '', shiftText(e), e.weekly_hours ?? '', weeklyPay(e), e.rtw_type || '', e.rtw_expiry || '', e.hire_date || '', e.termination_date || '', e.termination_reason || ''])]);
  }

  async function load() {
    [staff, projects, cases] = await Promise.all([loadStaff(), loadProjects().catch(() => []), seeCases ? loadCases().catch(() => []) : []]);
    if (run) { try { const m = new Map(); for (const l of await loadRunEmployeeHours(run.id)) if (l.employee_id) m.set(l.employee_id, (m.get(l.employee_id) || 0) + (+l.actual_hours || 0)); runEmp = m; } catch { runEmp = new Map(); } }
    draw();
  }
  await load();
  return onLive(debounce((e) => { if (document.querySelector('.modal-wrap, .overlay')) return; if (e.table === 'employees' || e.table === 'hr_cases') load(); }, 900));
}
