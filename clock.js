// Clock in / out: what employees record in the My Pay app, seen by the office. Fix missed clock-outs, check locations, send hours to payroll.
import { loadShifts, loadOpenClockIns, addClockShift, addClockEvent, updateClockEvent, deleteClockEvent, syncClockShifts, loadStaff, loadProjects, saveProjectLocation, onLive } from './api.js';
import { h, clear, toast, modal, icon, dmy, dm, hrs, debounce, initials, addDays, mondayOf, natCompare, confirmBox } from './ui.js';
import { ctx, openRuns, currentRuns } from './ctx.js';
import { panel, expandAllBtn } from './panels.js';
import { exportRows } from './importer.js';
import { waButton } from './whatsapp.js';
import { today, empLabel } from './hrkit.js';

const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
const fld = (label, el, cls) => h('label', { class: 'fld' + (cls ? ' ' + cls : '') }, label, el);
const localDT = (iso) => { if (!iso) return ''; const d = new Date(iso); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };

export async function render(root) {
  const canFix = ctx.can('manage_clock') || ctx.canEdit, canSend = ctx.canEdit;
  let from = mondayOf(today()), to = addDays(mondayOf(today()), 6), q = '', shifts = [], open = [], staff = [], projects = [];
  const kpi = h('div'), nowBody = h('div'), shBody = h('div'), sendBody = h('div'), locBody = h('div');
  const nowSub = h('span', { class: 'psub2' }), shSub = h('span', { class: 'psub2' }), sendSub = h('span', { class: 'psub2' });
  const fromI = h('input', { type: 'date', value: from, onChange: (e) => { from = e.target.value; load(); } }), toI = h('input', { type: 'date', value: to, onChange: (e) => { to = e.target.value; load(); } });
  const stack = h('div', { class: 'hrstack' },
    panel(h('span', null, 'On site now ', nowSub), nowBody, { id: 'clk.now' }),
    panel(h('span', null, 'Shifts ', shSub), shBody, { id: 'clk.shifts', actions: h('div', { class: 'row', style: { gap: '6px' } }, canFix ? h('button', { class: 'btn sm', onClick: () => shiftModal() }, icon('plus'), 'Add shift') : null, h('button', { class: 'btn sm', onClick: doExport }, icon('download'), 'Export')) }),
    canSend ? panel(h('span', null, 'Send to payroll ', sendSub), sendBody, { id: 'clk.send' }) : null,
    panel('Site locations', locBody, { id: 'clk.loc', sub: ' · optional: check that people clock in on site' }),
    panel('How employees clock in', h('div', { class: 'small', style: { lineHeight: 1.7 } },
      h('p', { style: { marginTop: 0 } }, 'Employees use the ', h('b', null, 'My Pay'), ' app: ', h('a', { href: new URL('employee.html', location.href).href, target: '_blank' }, new URL('employee.html', location.href).href), '. They sign up with the same email you hold for them, open the ', h('b', null, 'Clock'), ' tab and press Clock in / Clock out. On a phone they can add it to the home screen like an app.'),
      h('p', null, 'The time is taken from the server, not the phone, so it cannot be changed. If they allow location, the app records how far they were from the site (set the site location below). Missed clock-outs show here so you can fix them; changes are kept in History.')), { id: 'clk.help' }));
  root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Clock in / out'), h('p', null, 'Clock-ins from the employee app, live. Fix missed clock-outs and send the hours into the payroll.')),
    h('div', { class: 'row wrap' }, fld('From', fromI), fld('To', toI), h('button', { class: 'btn sm', style: { alignSelf: 'end' }, onClick: () => { from = mondayOf(today()); to = addDays(from, 6); fromI.value = from; toI.value = to; load(); } }, 'This week'), h('div', { style: { alignSelf: 'end' } }, expandAllBtn(() => stack)))),
  kpi, stack);

  const empOf = (id) => staff.find((e) => e.id === id);
  function draw() {
    const done = shifts.filter((s) => s.clock_out), tdy = shifts.filter((s) => String(s.work_date) === today());
    const late = open.filter((s) => Date.now() - Date.parse(s.clock_in) > 12 * 3600000);
    const unsent = done.filter((s) => !s.synced_at);
    const tiles = [['kc-green', 'On site now', open.length, 'users'], ['kc-blue', 'Shifts today', tdy.length, 'clock'], ['kc-violet', 'Hours in range', hrs(done.reduce((s, x) => s + +x.hours, 0)), 'trend'],
      ['kc-red', 'Clocked away from site', shifts.filter((s) => s.in_area_in === false || s.in_area_out === false).length, 'alert'], ['kc-amber', 'No clock-out (12h+)', late.length, 'lock'], ['kc-pink', 'Not in payroll yet', unsent.length, 'pound']];
    clear(kpi).append(h('div', { class: 'kstrip' }, tiles.map(([c, l, v, ic]) => h('div', { class: 'ktile ' + c }, h('span', { class: 'kic' }, icon(ic)), h('span', { class: 'kv' }, String(v)), h('span', { class: 'kl' }, l)))));
    // on site now
    nowSub.textContent = `· ${open.length}`;
    clear(nowBody).append(open.length ? h('div', { class: 'nowgrid' }, open.map((s) => { const e = empOf(s.employee_id) || {}; const mins = Math.round((Date.now() - Date.parse(s.clock_in)) / 60000);
      return h('div', { class: 'nowcard' + (mins > 720 ? ' late' : '') }, h('span', { class: 'avatar sm' }, initials(s.employee_name)), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ell' }, s.employee_name), h('div', { class: 'small muted ell' }, `${s.employee_code || ''} · ${s.project_name || ''}`), h('div', { class: 'small' }, `In ${tm(s.clock_in)} · ${Math.floor(mins / 60)}h ${mins % 60}m`, s.in_area_in === false ? h('span', { class: 'hpill r-expired', style: { marginLeft: '4px' } }, 'away from site') : null)),
        waButton(e), canFix ? h('button', { class: 'btn sm', title: 'Clock them out', onClick: () => shiftModal(s) }, 'Clock out') : null); })) : h('div', { class: 'small muted' }, 'Nobody is clocked in right now.'));
    // shifts table
    const list = shifts.filter((s) => !q || [s.employee_name, s.employee_code, s.project_name].some((x) => x && x.toLowerCase().includes(q)));
    shSub.textContent = `· ${dmy(from)} – ${dmy(to)} · ${list.length} shifts · ${hrs(list.reduce((a, s) => a + (+s.hours || 0), 0))} h`;
    const flag = (v) => (v === true ? h('span', { class: 'hpill r-ok' }, 'on site') : v === false ? h('span', { class: 'hpill r-expired' }, 'away') : h('span', { class: 'muted small' }, '—'));
    clear(shBody).append(h('div', { class: 'toolbar tight' }, h('input', { type: 'search', placeholder: 'Search name, ID, project…', value: q, style: { width: '240px' }, onInput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) })),
      list.length ? h('div', { class: 'tablewrap', style: { maxHeight: '60vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Date', 'Employee', 'Project', 'In', 'Out', 'Hours', 'Clock-in place', 'Clock-out place', 'Payroll', ''].map((t, i) => h('th', { class: i === 5 ? 'num' : '' }, t)))),
        h('tbody', null, list.slice().reverse().map((s) => h('tr', { class: !s.clock_out ? 'r-suspended' : '' }, h('td', { class: 'nowrap small' }, dmy(s.work_date)), h('td', null, h('b', null, s.employee_name), h('div', { class: 'small muted mono' }, s.employee_code || '')), h('td', { class: 'small' }, s.project_name || ''),
          h('td', null, tm(s.clock_in)), h('td', null, s.clock_out ? tm(s.clock_out) : h('span', { class: 'hpill r-d30' }, 'missing')), h('td', { class: 'num' }, s.hours != null ? hrs(s.hours) : '—'), h('td', null, flag(s.in_area_in), s.distance_in != null ? h('span', { class: 'small muted' }, ` ${s.distance_in} m`) : null), h('td', null, flag(s.in_area_out)),
          h('td', { class: 'small' }, s.synced_at ? h('span', { class: 'hpill r-ok' }, 'sent') : s.clock_out ? 'not yet' : ''), h('td', { class: 'nowrap' }, s.source === 'manual' ? h('span', { class: 'small muted', title: 'Added or changed by the office' }, '✎ ') : null,
            canFix && !s.synced_at ? h('button', { class: 'btn sm', onClick: () => shiftModal(s) }, 'Edit') : null))))))
        : h('div', { class: 'small muted' }, 'No clock-ins in this date range.'));
    // send to payroll
    if (canSend) {
      const by = new Map(); for (const s of unsent) { if (!by.has(s.employee_id)) by.set(s.employee_id, []); by.get(s.employee_id).push(s); }
      sendSub.textContent = `· ${unsent.length} shifts waiting`;
      const runs = openRuns(), cr = currentRuns()[0], runSel = h('select', null, runs.map((r) => h('option', { value: r.id, selected: cr && r.id === cr.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${r.label}`)));
      const send = async (ids, btn) => { const r = runs.find((x) => x.id === runSel.value); if (!r) return toast('No open payroll', 'err'); btn.disabled = true; let n = 0, later = 0;
        try { for (const id of ids) { const e = empOf(id); if (!e) continue; const all = by.get(id), ok = all.filter((s) => !r.period_end || String(s.work_date) <= r.period_end); later += all.length - ok.length; if (!ok.length) continue; await syncClockShifts(r, e, ok); n += ok.length; } toast(`${n} shift(s) sent to ${r.label}${later ? ` · ${later} after the payroll end date wait` : ''}`, 'ok'); await load(); }
        catch (er) { btn.disabled = false; toast(er.message, 'err'); } };
      clear(sendBody).append(h('div', { class: 'stack' }, runs.length ? fld('Payroll', runSel) : h('div', { class: 'notice warn' }, 'No open payroll.'),
        by.size ? h('div', { class: 'mini-list', style: { maxHeight: '50vh' } }, [...by].map(([id, xs]) => h('div', { class: 'mini' }, h('span', { class: 'grow' }, h('b', null, xs[0].employee_name), h('div', { class: 'small muted' }, `${xs[0].employee_code || ''} · ${xs.length} shift(s) · ${dm(xs[0].work_date)}–${dm(xs[xs.length - 1].work_date)}`)), h('b', null, hrs(xs.reduce((a, s) => a + +s.hours, 0)) + 'h'), h('button', { class: 'btn sm', onClick: (ev) => send([id], ev.currentTarget) }, 'Send')))) : h('div', { class: 'small muted' }, 'All finished shifts in this date range are in a payroll.'),
        by.size > 1 && runs.length ? h('button', { class: 'btn primary', onClick: (ev) => send([...by.keys()], ev.currentTarget) }, `Send all (${unsent.length} shifts)`) : null,
        h('div', { class: 'small muted' }, 'Hours go onto each person’s line for the project they clocked in at (created if needed). Shifts without a clock-out are not sent until they are fixed.')));
    }
    // locations
    const canLoc = ctx.canEdit;
    clear(locBody).append(h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Put in the site’s latitude and longitude (from Google Maps: right-click the site → the numbers at the top), or stand on site and press “Here”. Radius is how far away still counts as on site.'),
      h('div', { class: 'tablewrap', style: { maxHeight: '50vh' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Project', 'Latitude', 'Longitude', 'Radius (m)', ''].map((t) => h('th', null, t)))),
        h('tbody', null, projects.slice().sort((a, b) => natCompare(a.name, b.name)).map((p) => { const la = h('input', { type: 'number', step: 'any', value: p.lat ?? '', disabled: !canLoc, style: { width: '120px' } }), lo = h('input', { type: 'number', step: 'any', value: p.lng ?? '', disabled: !canLoc, style: { width: '120px' } }), ra = h('input', { type: 'number', value: p.geofence_m ?? 300, disabled: !canLoc, style: { width: '90px' } });
          return h('tr', null, h('td', null, h('b', null, p.name)), h('td', null, la), h('td', null, lo), h('td', null, ra), h('td', { class: 'nowrap' }, canLoc ? [h('button', { class: 'btn sm', title: 'Use where I am now', onClick: () => navigator.geolocation.getCurrentPosition((pos) => { la.value = pos.coords.latitude.toFixed(6); lo.value = pos.coords.longitude.toFixed(6); }, (er) => toast(er.message, 'err'), { enableHighAccuracy: true }) }, 'Here'),
            h('button', { class: 'btn sm primary', onClick: async () => { try { await saveProjectLocation(p.id, { lat: la.value === '' ? null : +la.value, lng: lo.value === '' ? null : +lo.value, geofence_m: +ra.value || 300 }); toast('Location saved', 'ok'); } catch (er) { toast(er.message, 'err'); } } }, 'Save')] : null)); })))));
  }

  function shiftModal(s) {
    const isNew = !s;
    modal(isNew ? 'Add a shift' : s.clock_out ? `Edit shift — ${s.employee_name}` : `Clock out ${s.employee_name}`, (done) => {
      const dl = h('datalist', { id: 'clk-emps' }, staff.filter((e) => e.emp_status !== 'terminated').map((e) => h('option', { value: empLabel(e) })));
      const who = h('input', { type: 'text', list: 'clk-emps', placeholder: 'Employee ID or name' });
      const proj = h('input', { type: 'text', list: 'clk-proj', value: s ? s.project_name || '' : '' }), dlp = h('datalist', { id: 'clk-proj' }, projects.map((p) => h('option', { value: p.name })));
      const tin = h('input', { type: 'datetime-local', value: s ? localDT(s.clock_in) : '' }), tout = h('input', { type: 'datetime-local', value: s && s.clock_out ? localDT(s.clock_out) : localDT(new Date().toISOString()) });
      const note = h('input', { type: 'text', placeholder: 'Why it was added or changed (kept in History)' });
      who.addEventListener('change', () => { const e = staff.find((x) => empLabel(x) === who.value); if (e && !proj.value) proj.value = e.default_project || ''; });
      return h('div', { class: 'stack' }, dl, dlp, isNew ? fld('Employee', who) : h('div', { class: 'row' }, h('b', null, s.employee_name), h('span', { class: 'mono small' }, s.employee_code || '')),
        h('div', { class: 'form-grid g3' }, fld('Project', proj), fld('Clock in', tin), fld('Clock out', tout)), fld('Note', note),
        h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          !isNew ? h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Delete this shift?', 'The clock-in and clock-out are removed.', 'Delete', true)) { try { await deleteClockEvent(s.in_id); if (s.out_id) await deleteClockEvent(s.out_id); done(); toast('Deleted', 'ok'); load(); } catch (er) { toast(er.message, 'err'); } } } }, icon('trash')) : h('span'),
          h('div', { class: 'row' }, h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
            const ti = tin.value ? new Date(tin.value).toISOString() : null, to2 = tout.value ? new Date(tout.value).toISOString() : null;
            if (!ti) return toast('Add the clock-in time', 'err'); if (to2 && to2 <= ti) return toast('Clock-out must be after clock-in', 'err'); if (to2 && Date.parse(to2) - Date.parse(ti) > 18 * 3600000) return toast('A shift cannot be longer than 18 hours', 'err');
            try {
              if (isNew) { const e = staff.find((x) => empLabel(x) === who.value) || staff.find((x) => x.employee_code && x.employee_code.toLowerCase() === who.value.trim().toLowerCase()); if (!e) return toast('Pick the employee from the list', 'err'); await addClockShift({ employee_id: e.id, project_name: proj.value.trim() || e.default_project, clock_in: ti, clock_out: to2, note: note.value.trim() }); }
              else {
                await updateClockEvent(s.in_id, { at: ti, project_name: proj.value.trim() || null, note: note.value.trim() || null });
                if (s.out_id) { if (to2) await updateClockEvent(s.out_id, { at: to2, project_name: proj.value.trim() || null, note: note.value.trim() || null }); else await deleteClockEvent(s.out_id); }
                else if (to2) await addClockEvent({ employee_id: s.employee_id, kind: 'out', at: to2, project_name: proj.value.trim() || s.project_name, note: note.value.trim() || null, source: 'manual' });
              }
              done(); toast('Saved', 'ok'); load();
            } catch (er) { toast(er.message, 'err'); }
          } }, 'Save'))));
    }, { wide: true });
  }

  function doExport() {
    exportRows({ columns: [['work_date', 'Date'], ['employee_code', 'Employee ID'], ['employee_name', 'Employee'], ['project_name', 'Project'], ['clock_in', 'Clock in', (s) => tm(s.clock_in)], ['clock_out', 'Clock out', (s) => tm(s.clock_out)], ['hours', 'Hours'], ['in_area_in', 'On site at clock-in', (s) => (s.in_area_in == null ? '' : s.in_area_in ? 'Yes' : 'No')], ['distance_in', 'Distance (m)'], ['source', 'Source'], ['synced_at', 'Sent to payroll', (s) => (s.synced_at ? 'Yes' : 'No')]].map(([key, label, out]) => ({ key, label, out })) }, shifts, `clock_${from}_${to}.xlsx`).catch((e) => toast(e.message, 'err'));
  }

  async function load() {
    try { [shifts, open, staff, projects] = await Promise.all([loadShifts(from, to), loadOpenClockIns(), staff.length ? staff : loadStaff(), projects.length ? projects : loadProjects().catch(() => [])]); }
    catch (e) { clear(kpi).append(h('div', { class: 'notice err' }, 'Could not load clock-ins: ' + e.message + ' — run the latest schema.sql.')); return; }
    draw();
  }
  await load();
  return onLive(debounce((e) => { if (e.table === 'clock_events' && !document.querySelector('.modal-wrap')) load(); }, 800));
}
