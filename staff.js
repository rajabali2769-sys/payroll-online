// Employees (HR): every employee by project — permanent vs temporary / cover. Fixed-height workspace made of panels:
// projects | employees | insights. Each panel folds away (−) or opens full screen (⤢), so the page never grows downwards.
import { loadStaff, addStaff, updateStaff, loadProjects, loadCases, loadRunEmployeeHours, loadAlBalances, importStaff, deleteEmployees, onLive } from './api.js';
import { h, clear, toast, modal, dmy, money, hrs, icon, debounce, donut, initials, natCompare } from './ui.js';
import { ctx, currentRun } from './ctx.js';
import { EMP_STATUS, EMP_TYPES, statusChip, typeChip, rtwChip, rtwState, shiftText, weeklyPay, isCover, activeWarning, today, alCalc } from './hrkit.js';
import { openProfile } from './profile.js';
import { newCaseModal } from './hrcase.js';
import { panel, expandAllBtn } from './panels.js';
import { waButton } from './whatsapp.js';
import { avatar } from './photos.js';
import { profileCard } from './profilecard.js';
import { importModal, exportRows } from './importer.js';
import { employeeSpec, EMPLOYEE_COLUMNS } from './specs.js';

const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);
const NOPROJ = '(No project)';
const r1 = (n) => (n === null || n === undefined || n === '' ? '—' : String(Math.round(+n * 10) / 10));

export async function render(root, params) {
  const canHR = ctx.can('manage_hr'), seeCases = ctx.can('page:hrcases'), run = ctx.can('page:payroll') ? currentRun() : null, isSuper = ctx.isSuper;
  let staff = [], projects = [], cases = [], runEmp = new Map(), al = new Map(), sel = new Set();
  let selId = null; let proj = (params && params.project) || '', am = '', kind = 'perm', st = 'active', q = (params && params.q) || '', pq = '', quick = '';
  const kpiHost = h('div'), railBody = h('div', { class: 'rail-in' }), mainBody = h('div', { class: 'main-in' }), sideBody = h('div', { class: 'side-in' });
  const mainTitle = h('span'), mainActs = h('div', { class: 'row', style: { gap: '6px' } });
  const railSub = h('span', { class: 'psub2' }), sideSub = h('span', { class: 'psub2' });
  const pMain = panel(mainTitle, mainBody, { id: 'staff.main', cls: 'p-main', actions: mainActs });
  const pRail = panel(h('span', null, 'Projects overview ', railSub), railBody, { id: 'staff.rail', cls: 'p-rail' });
  const pSide = panel(h('span', null, 'Insights ', sideSub), sideBody, { id: 'staff.side', cls: 'p-side' });
  const stack = h('div', { class: 'hrstack' }, pMain, pRail, pSide);
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Employees'), h('p', null, 'Every employee by project — permanent and temporary / cover kept apart. Click a person to see their card, double-click (or “Full profile”) to open everything.')),
    h('div', { class: 'row wrap' }, expandAllBtn(() => stack), canHR && seeCases ? h('button', { class: 'btn', onClick: () => newCaseModal(null, { onCreated: load }) }, icon('alert'), 'New HR case') : null,
      canHR ? h('button', { class: 'btn', onClick: () => importModal(employeeSpec(async (rows) => { const r = await importStaff(rows); await load(); return `${r.created} added (each with a new Employee ID), ${r.updated} updated`; })) }, icon('upload'), 'Upload employees') : null,
      h('button', { class: 'btn', onClick: exportXlsx }, icon('download'), 'Export'), canHR ? h('button', { class: 'btn primary', onClick: addPerson }, icon('plus'), 'Add employee') : null)),
  kpiHost, stack);

  const projOf = (e) => e.default_project || NOPROJ;
  const casesBy = () => { const m = new Map(); for (const c of cases) { if (!m.has(c.employee_id)) m.set(c.employee_id, []); m.get(c.employee_id).push(c); } return m; };
  const alOf = (e) => { const b = al.get(e.id); if (b) return b; const c = alCalc(e); return { ...c, taken: +e.al_taken_before || 0, booked: 0, available: c.accrued - (+e.al_taken_before || 0), remaining: c.entitlement - (+e.al_taken_before || 0) }; };

  function kpis() {
    const act = staff.filter((e) => e.emp_status !== 'terminated');
    const rtwBad = act.filter((e) => ['expired', 'd30'].includes(rtwState(e.rtw_expiry))).length;
    const tiles = [
      ['kc-teal', 'Active', staff.filter((e) => e.emp_status === 'active').length, 'users', () => { st = 'active'; quick = ''; }],
      ['kc-blue', 'Permanent', act.filter((e) => !isCover(e)).length, 'users', () => { kind = 'perm'; quick = ''; }],
      ['kc-violet', 'Temp / cover', act.filter(isCover).length, 'users', () => { kind = 'cover'; quick = ''; }],
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
    const item = (key, label, o) => h('button', { class: 'pitem' + (proj === key ? ' on' : ''), onClick: () => { proj = key; sel.clear(); draw(); pMain.setOpen(true); pMain.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'pname' }, label), o.warn ? h('span', { class: 'dot red', title: `${o.warn} right-to-work issue(s)` }) : null, h('div', { class: 'grow' }), h('span', { class: 'pcount' }, String(o.perm + o.cover))),
      h('div', { class: 'pbar' }, h('i', { class: 'b-perm', style: { width: (o.perm / max * 100) + '%' } }), h('i', { class: 'b-cover', style: { width: (o.cover / max * 100) + '%' } })),
      h('div', { class: 'psub' }, `${o.perm} permanent · ${o.cover} temp/cover`));
    railSub.textContent = `${list.length} project${list.length === 1 ? '' : 's'}`;
    clear(railBody).append(h('div', { class: 'toolbar tight' }, h('input', { type: 'search', placeholder: 'Find a project…', value: pq, style: { width: '220px' }, onInput: debounce((ev) => { pq = ev.target.value.toLowerCase(); drawRail(); }, 120) }), h('div', { class: 'grow' }), h('span', { class: 'rail-legend small' }, h('i', { class: 'b-perm' }), 'Permanent ', h('i', { class: 'b-cover' }), 'Temp / cover')),
      h('div', { class: 'projgrid' }, item('', 'All projects', total), list.map(([k, o]) => item(k, k, o))));
  }

  const rows = (forKind) => staff.filter((e) => (!proj || projOf(e) === proj) && (!am || (e.area_manager || '(none)') === am) && (forKind === 'cover' ? isCover(e) : !isCover(e))
    && (quick === 'rtw' ? e.emp_status !== 'terminated' && ['expired', 'd30'].includes(rtwState(e.rtw_expiry)) : (st === 'all' || e.emp_status === st))
    && (!q || [e.employee_code, e.full_name, e.email, e.ni_number, e.default_project, e.job_title, e.pay_group, e.area_manager, e.phone].some((x) => x && String(x).toLowerCase().includes(q))));

  function statusCell(e) {
    if (!canHR) return statusChip(e.emp_status);
    const s = h('select', { class: 'stsel s-' + e.emp_status, onClick: (ev) => ev.stopPropagation() }, EMP_STATUS.map(([v, t]) => h('option', { value: v, selected: e.emp_status === v }, t)));
    s.addEventListener('change', () => {
      const target = s.value; s.value = e.emp_status;
      modal(target === 'terminated' ? `Terminate ${e.full_name}` : target === 'suspended' ? `Suspend ${e.full_name}` : `Make ${e.full_name} active`, (done) => {
        const d = h('input', { type: 'date', value: today() }), why = h('input', { type: 'text', placeholder: 'Reason' });
        return h('div', { class: 'stack' }, target !== 'active' ? h('div', { class: 'form-grid' }, fld(target === 'terminated' ? 'Termination date' : 'Suspended from', d), fld('Reason', why)) : h('p', { style: { margin: 0 } }, 'They will show as active again.'),
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn ' + (target === 'terminated' ? 'danger' : 'primary'), onClick: async () => {
            const p = { emp_status: target }; if (target === 'terminated') { p.termination_date = d.value || today(); p.termination_reason = why.value.trim() || null; } if (target === 'suspended') p.suspended_from = d.value || today();
            try { const n = await updateStaff(e.id, p); Object.assign(e, n); done(); toast('Status updated', 'ok'); draw(); } catch (er) { toast(er.message, 'err'); }
          } }, 'Confirm')));
      });
    });
    return s;
  }

  async function removeMany(list, label) {
    modal(`Delete ${label}`, (done) => {
      const conf = h('input', { type: 'text', placeholder: 'Type DELETE' });
      return h('div', { class: 'stack' },
        h('div', { class: 'notice err' }, `${list.length} employee(s) will be deleted permanently, with their HR cases, cover records and HR files. Their past payroll lines are kept (unlinked) so payroll history still adds up.`),
        list.length <= 12 ? h('div', { class: 'small' }, list.map((e) => `${e.employee_code || ''} ${e.full_name}`).join(', ')) : null,
        h('div', { class: 'small muted' }, 'Usually you should mark people as Terminated instead — they then stay on record.'),
        fld('Type DELETE to confirm', conf),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn danger', onClick: async (ev) => {
          if (conf.value.trim().toUpperCase() !== 'DELETE') return toast('Type DELETE to confirm', 'err');
          ev.target.disabled = true; try { const n = await deleteEmployees(list.map((e) => e.id)); done(); sel.clear(); toast(`${n} employee(s) deleted`, 'ok'); await load(); } catch (er) { ev.target.disabled = false; toast(er.message, 'err'); }
        } }, icon('trash'), `Delete ${list.length}`)));
    });
  }

  function drawMain() {
    const cb = casesBy(), permN = rows('perm').length, covN = rows('cover').length, list = rows(kind);
    const p = proj && projects.find((x) => x.name === proj);
    const totH = list.reduce((s, e) => s + (+e.weekly_hours || 0), 0), totP = list.reduce((s, e) => s + weeklyPay(e), 0);
    for (const id of [...sel]) if (!list.some((e) => e.id === id)) sel.delete(id);
    clear(mainTitle).append('Employees', h('span', { class: 'psub2' }, ` · ${proj || 'all projects'}${am ? ' · ' + am : ''} · ${permN} permanent, ${covN} temp/cover`), p && (p.manager || p.manager_email) ? h('span', { class: 'psub2' }, ` · Area manager: ${p.manager || ''}`) : null);
    clear(mainActs).append(h('span', { class: 'mstat sm' }, 'Weekly hrs ', h('b', null, hrs(totH))), h('span', { class: 'mstat sm' }, 'Weekly pay ', h('b', null, money(totP))),
      isSuper && list.length ? h('button', { class: 'btn sm danger', title: 'Super admin only', onClick: () => removeMany(sel.size ? list.filter((e) => sel.has(e.id)) : list, sel.size ? `${sel.size} selected` : `all ${list.length} shown`) }, icon('trash'), sel.size ? `Delete ${sel.size} selected` : 'Delete all shown') : null);
    const allOn = list.length && list.slice(0, 800).every((e) => sel.has(e.id));
    const tbl = h('table', { class: 't hr-t' },
      h('thead', null, h('tr', null, isSuper ? h('th', null, h('input', { type: 'checkbox', checked: allOn, onChange: (ev) => { list.slice(0, 800).forEach((e) => (ev.target.checked ? sel.add(e.id) : sel.delete(e.id))); drawMain(); } })) : null,
        ['Employee ID', 'Employee', 'Email', 'Project', 'Area manager', 'Pay date', '£/h', 'Status', 'Contr. weeks', 'Shift timings', 'Weekly hrs', 'Weekly pay', 'AL accrued', 'AL left', 'RTW expiry', 'Hire date', 'Termination'].map((t, i) => h('th', { class: [6, 8, 10, 11, 12, 13].includes(i) ? 'num' : '' }, t)))),
      h('tbody', null, list.slice(0, 800).map((e) => {
        const mine = cb.get(e.id) || [], open = mine.filter((c) => c.stage !== 'closed').length, w = activeWarning(mine), b = alOf(e);
        return h('tr', { class: 'click r-' + e.emp_status + (sel.has(e.id) ? ' selrow' : '') + (selId === e.id ? ' cur' : ''), 'data-id': e.id, onClick: (ev) => { if (ev.target.closest('input,select,button')) return; selId = e.id; mainBody.querySelectorAll('tr.cur').forEach((r) => r.classList.remove('cur')); ev.currentTarget.classList.add('cur'); drawCard(); }, onDblclick: (ev) => { if (ev.target.closest('input,select,button')) return; openFull(e); } },
          isSuper ? h('td', null, h('input', { type: 'checkbox', checked: sel.has(e.id), onChange: (ev) => { ev.target.checked ? sel.add(e.id) : sel.delete(e.id); drawMain(); } })) : null,
          h('td', { class: 'mono small' }, h('b', null, e.employee_code || '—')),
          h('td', null, h('div', { class: 'who' }, avatar(e, 'sm'), h('div', null, h('b', null, e.full_name), h('div', { class: 'small muted' }, e.job_title || (e.ni_number || ''))),
            open ? h('span', { class: 'hpill g-investigation', title: `${open} open HR case(s)` }, `${open} case${open > 1 ? 's' : ''}`) : null, w ? h('span', { class: 'hpill v-high', title: `${w.warning_level} until ${dmy(w.warning_expiry)}` }, 'Warning') : null,
            e.payroll_state === 'pending' ? h('span', { class: 'hpill r-d30', title: 'Waiting for the payroll team' }, 'New') : null, waButton(e))),
          h('td', { class: 'small' }, e.email || h('span', { class: 'muted' }, '—')), h('td', { class: 'small' }, e.default_project || '—'), h('td', { class: 'small' }, e.area_manager || h('span', { class: 'muted' }, '—')), h('td', { class: 'small' }, e.pay_group ? h('span', { class: 'hpill grp' }, e.pay_group) : '—'),
          h('td', { class: 'num' }, e.default_rate != null ? money(e.default_rate) : '—'), h('td', null, statusCell(e)), h('td', { class: 'num' }, e.contracted_weeks ?? '—'),
          h('td', { class: 'small nowrap' }, shiftText(e) || '—'), h('td', { class: 'num' }, e.weekly_hours != null ? hrs(e.weekly_hours) : '—'), h('td', { class: 'num' }, e.weekly_hours != null && e.default_rate != null ? money(weeklyPay(e)) : '—'),
          h('td', { class: 'num', title: `${r1(b.per_month)} days a month · ${r1(b.entitlement)} for this leave year` }, r1(b.accrued)), h('td', { class: 'num' + (+b.remaining < 0 ? ' neg' : '') }, r1(b.remaining)),
          h('td', null, rtwChip(e.rtw_expiry)), h('td', { class: 'small nowrap' }, dmy(e.hire_date) || '—'), h('td', { class: 'small nowrap' }, e.termination_date ? dmy(e.termination_date) : '—'));
      })),
      list.length ? h('tfoot', null, h('tr', null, isSuper ? h('td') : null, h('td', { colspan: 10 }, h('b', null, `${list.length} ${kind === 'cover' ? 'temporary / cover' : 'permanent'} employee${list.length === 1 ? '' : 's'}${sel.size ? ` · ${sel.size} selected` : ''}`)), h('td', { class: 'num' }, h('b', null, hrs(totH))), h('td', { class: 'num' }, h('b', null, money(totP))), h('td', { colspan: 5 }))) : null);
    clear(mainBody).append(
      h('div', { class: 'toolbar tight' },
        h('div', { class: 'seg big' }, h('button', { class: kind === 'perm' ? 'on' : '', onClick: () => { kind = 'perm'; sel.clear(); draw(); } }, 'Permanent ', h('span', { class: 'cnt' }, String(permN))), h('button', { class: kind === 'cover' ? 'on' : '', onClick: () => { kind = 'cover'; sel.clear(); draw(); } }, 'Temporary / cover ', h('span', { class: 'cnt' }, String(covN)))),
        h('div', { class: 'seg' }, [['active', 'Active'], ['suspended', 'Suspended'], ['terminated', 'Terminated'], ['all', 'All']].map(([k, t]) => h('button', { class: st === k && quick !== 'rtw' ? 'on' : '', onClick: () => { st = k; quick = ''; draw(); } }, t))),
        quick === 'rtw' ? h('button', { class: 'btn sm', onClick: () => { quick = ''; st = 'active'; draw(); } }, icon('x'), 'RTW filter') : null,
        h('select', { class: 'fsel', onChange: (ev) => { proj = ev.target.value; sel.clear(); draw(); } }, h('option', { value: '' }, 'All projects'), [...new Set(staff.map(projOf))].sort(natCompare).map((x) => h('option', { value: x, selected: x === proj }, x))),
        h('select', { class: 'fsel', onChange: (ev) => { am = ev.target.value; sel.clear(); draw(); } }, h('option', { value: '' }, 'All area managers'), [...new Set(staff.map((e) => e.area_manager || '(none)'))].sort(natCompare).map((x) => h('option', { value: x, selected: x === am }, x))),
        h('div', { class: 'grow' }), h('input', { type: 'search', class: 'qsearch', placeholder: 'Search ID, name, email, NI…', value: q, onInput: debounce((ev) => { q = ev.target.value.toLowerCase(); drawMain(); }, 150) })),
      (setTimeout(drawCard), null),
      list.length ? h('div', { class: 'emp-split' }, h('div', { class: 'tablewrap hr-tw' }, tbl), cardHost) : h('div', { class: 'card empty grow-empty' }, staff.length ? 'Nobody matches these filters.' : 'No employees yet — use “Upload employees” or “Add employee”.'));
  }

  const cardHost = h('div', { class: 'emp-card' });
  const openFull = (e) => openProfile(e.id, { onChange: (n) => { if (n) { Object.assign(e, n); draw(); } else load(); } });
  function drawCard() {
    const list = rows(kind); if (!selId || !list.some((e) => e.id === selId)) selId = list[0] ? list[0].id : null;
    const e = staff.find((x) => x.id === selId);
    clear(cardHost).append(profileCard(e, { onOpen: e ? () => openFull(e) : null, onHistory: e && ctx.can('page:payroll') ? () => openProfile(e.id, { tab: 'pay' }) : null, onPhoto: () => { drawMain(); } }));
  }
  function drawSide() {
    const base = staff.filter((e) => !proj || projOf(e) === proj), act = base.filter((e) => e.emp_status !== 'terminated');
    sideSub.textContent = `· ${proj || 'all projects'}`;
    const sA = base.filter((e) => e.emp_status === 'active').length, sS = base.filter((e) => e.emp_status === 'suspended').length, sT = base.filter((e) => e.emp_status === 'terminated').length;
    const perm = act.filter((e) => !isCover(e)).length, cov = act.length - perm;
    const rtw = act.filter((e) => ['expired', 'd30', 'd90'].includes(rtwState(e.rtw_expiry))).sort((a, b) => String(a.rtw_expiry).localeCompare(String(b.rtw_expiry)));
    const missing = act.filter((e) => !e.rtw_expiry).length;
    const payAlerts = run ? base.filter((e) => e.emp_status !== 'active' && (runEmp.get(e.id) || 0) > 0) : [];
    const alLow = act.filter((e) => +alOf(e).remaining < 0);
    const legend = (items) => h('div', { class: 'leg' }, items.map(([c, l, v]) => h('div', null, h('i', { style: { background: c } }), l, h('b', null, String(v)))));
    const card = (title, ...kids) => h('div', { class: 'card pad side-card' }, h('h3', null, title), ...kids);
    clear(sideBody).append(
      card('Status', h('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } }, donut([{ label: 'Active', value: sA, color: '#10b981' }, { label: 'Suspended', value: sS, color: '#f59e0b' }, { label: 'Terminated', value: sT, color: '#94a3b8' }], { size: 104, thick: 15, center: String(base.length), sub: 'people' }),
        legend([['#10b981', 'Active', sA], ['#f59e0b', 'Suspended', sS], ['#94a3b8', 'Terminated', sT]]))),
      card('Workforce mix', h('div', { class: 'mixbar' }, h('i', { class: 'b-perm', style: { flex: perm || 0.0001 } }, perm ? String(perm) : ''), h('i', { class: 'b-cover', style: { flex: cov || 0.0001 } }, cov ? String(cov) : '')),
        h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${act.length ? Math.round(cov / act.length * 100) : 0}% of current staff are temporary or cover`)),
      card('Right to work', h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `${rtw.filter((e) => rtwState(e.rtw_expiry) === 'expired').length} expired · ${rtw.filter((e) => rtwState(e.rtw_expiry) === 'd30').length} within 30 days · ${missing} with no date`),
        rtw.length ? h('div', { class: 'mini-list' }, rtw.slice(0, 30).map((e) => h('button', { class: 'mini', onClick: () => openProfile(e.id, { onChange: load }) }, h('span', { class: 'grow' }, e.full_name, h('span', { class: 'small muted' }, ' · ' + (e.default_project || ''))), rtwChip(e.rtw_expiry)))) : h('div', { class: 'small muted' }, 'Nothing due in the next 90 days.')),
      card('Annual leave', h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `${alLow.length} over their entitlement this leave year`),
        alLow.length ? h('div', { class: 'mini-list' }, alLow.slice(0, 20).map((e) => h('button', { class: 'mini', onClick: () => openProfile(e.id, { onChange: load, tab: 'leave' }) }, h('span', { class: 'grow' }, e.full_name), h('b', { class: 'neg' }, r1(alOf(e).remaining) + ' d')))) : null),
      run ? card('Payroll alerts', h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `Suspended or terminated staff with hours in ${run.label}`),
        payAlerts.length ? h('div', { class: 'mini-list' }, payAlerts.map((e) => h('button', { class: 'mini', onClick: () => openProfile(e.id, { onChange: load }) }, h('span', { class: 'grow' }, e.full_name), statusChip(e.emp_status), h('span', { class: 'small' }, hrs(runEmp.get(e.id)) + 'h')))) : h('div', { class: 'small muted' }, 'None — all clear.')) : null);
  }

  function draw() { kpis(); drawRail(); drawMain(); drawSide(); }

  function addPerson() {
    modal('Add an employee', (done) => {
      const f = {};
      const inp = (k, label, a = {}) => fld(label, (f[k] = h('input', { type: a.type || 'text', step: 'any', placeholder: a.ph || '', list: a.list, value: a.value ?? '' })), a.cls);
      const groups = [...new Set(projects.map((p) => p.pay_group).filter(Boolean))].sort(natCompare);
      const dl = h('datalist', { id: 'add-proj' }, projects.map((p) => h('option', { value: p.name }))), dg = h('datalist', { id: 'add-grp' }, groups.map((g) => h('option', { value: g })));
      f.employment_type = h('select', null, EMP_TYPES.map(([v, t]) => h('option', { value: v, selected: v === (kind === 'cover' ? 'cover' : 'permanent') }, t)));
      const queue = h('input', { type: 'checkbox', checked: true }), err = h('div', { class: 'notice err hidden' });
      const sec = (t, ...k) => h('div', { class: 'msec' }, h('h4', null, t), h('div', { class: 'form-grid' }, ...k));
      setTimeout(() => f.default_project.addEventListener('change', () => { const p = projects.find((x) => x.name === f.default_project.value); if (p && p.pay_group && !f.pay_group.value) f.pay_group.value = p.pay_group; }));
      return h('div', { class: 'stack' }, dl, dg,
        h('div', { class: 'msecs' },
          sec('Personal', inp('full_name', 'Full name *', { cls: 's2' }), inp('email', 'Email', { type: 'email' }), inp('phone', 'Phone'), inp('ni_number', 'NI number'), inp('job_title', 'Job title', { ph: 'Cleaning Operative' })),
          sec('Job & pay', fld('Employment type', f.employment_type), inp('default_project', 'Project *', { list: 'add-proj', value: proj }), inp('pay_group', 'Pay date', { list: 'add-grp', ph: '25th' }), inp('area_manager', 'Area manager', { ph: 'From the project if empty' }), inp('default_rate', 'Hourly rate £ *', { type: 'number' }), inp('weekly_hours', 'Weekly budgeted hours', { type: 'number' }), inp('contracted_weeks', 'Contracted weeks', { type: 'number', ph: '52' })),
          sec('Shift, RTW & leave', inp('shift_days', 'Shift days', { ph: 'Mon–Fri' }), h('div', { class: 'row s2', style: { gap: '8px' } }, inp('shift_start', 'Start', { type: 'time' }), inp('shift_end', 'Finish', { type: 'time' })), inp('rtw_type', 'RTW document', { ph: 'Passport / Share code' }), inp('rtw_expiry', 'RTW expiry', { type: 'date' }), inp('hire_date', 'Hire date', { type: 'date', value: today() }), inp('al_entitlement', 'AL days / year', { type: 'number', value: 20 }))),
        h('div', { class: 'small muted' }, 'A unique Employee ID is created automatically when you save.'),
        h('label', { class: 'row small' }, queue, 'Send to the payroll team as a new starter (they add them to the current payroll)'), err,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async (ev) => {
          const row = {}; for (const [k, el] of Object.entries(f)) { const v = el.value.trim(); row[k] = v === '' ? null : ['default_rate', 'weekly_hours', 'contracted_weeks', 'al_entitlement'].includes(k) ? +v : k === 'ni_number' ? v.toUpperCase().replace(/\s+/g, '') : k === 'email' ? v.toLowerCase() : v; }
          if (!row.full_name || !row.default_project || row.default_rate == null) { err.textContent = 'Name, project and hourly rate are required.'; err.classList.remove('hidden'); return; }
          if (row.ni_number && staff.some((e) => e.ni_number === row.ni_number)) { err.textContent = 'Someone with this NI number already exists.'; err.classList.remove('hidden'); return; }
          if (row.al_entitlement == null) row.al_entitlement = 20;
          row.emp_status = 'active'; row.payroll_state = queue.checked ? 'pending' : 'in_payroll'; row.default_contract = row.employment_type === 'permanent' ? 'Hourly' : 'Cover';
          ev.target.disabled = true;
          try { const id = await addStaff(row); done(); await load(); const n = staff.find((x) => x.id === id); toast(`Employee added${n && n.employee_code ? ' — ID ' + n.employee_code : ''}`, 'ok'); openProfile(id, { onChange: load }); } catch (er) { ev.target.disabled = false; err.textContent = er.message; err.classList.remove('hidden'); }
        } }, 'Add employee')));
    }, { wide: true, xl: true });
  }

  function exportXlsx() {
    const list = staff.filter((e) => !proj || projOf(e) === proj);
    const cols = [...EMPLOYEE_COLUMNS, { key: 'weekly_pay', label: 'Weekly pay', out: (e) => weeklyPay(e) }, { key: 'al_acc', label: 'AL accrued (days)', out: (e) => +(+alOf(e).accrued).toFixed(2) }, { key: 'al_left', label: 'AL remaining (days)', out: (e) => +(+alOf(e).remaining).toFixed(2) }];
    exportRows({ columns: cols.map((c) => (c.key === 'employment_type' ? { ...c, out: (e) => (isCover(e) ? 'Cover' : 'Permanent') } : c.key === 'emp_status' ? { ...c, out: (e) => e.emp_status[0].toUpperCase() + e.emp_status.slice(1) } : c)), file: 'employees.xlsx' }, list, `employees_${(proj || 'all').replace(/\W+/g, '_')}.xlsx`).catch((e) => toast(e.message, 'err'));
  }

  async function load() {
    [staff, projects, cases] = await Promise.all([loadStaff(), loadProjects().catch(() => []), seeCases ? loadCases().catch(() => []) : []]);
    try { al = new Map((await loadAlBalances()).map((b) => [b.employee_id, b])); } catch { al = new Map(); }
    if (run) { try { const m = new Map(); for (const l of await loadRunEmployeeHours(run.id)) if (l.employee_id) m.set(l.employee_id, (m.get(l.employee_id) || 0) + (+l.actual_hours || 0)); runEmp = m; } catch { runEmp = new Map(); } }
    draw();
  }
  await load();
  return onLive(debounce((e) => { if (document.querySelector('.modal-wrap, .overlay, .panel.max')) return; if (e.table === 'employees' || e.table === 'hr_cases') load(); }, 900));
}
