// Employee app ("My Pay"). An employee sees ONLY their own hours, estimated earnings, pay periods and published payslips.
// Everything comes from database functions that look at who is signed in (my_days, my_periods, my_payslips ...).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { h, clear, money, hrs, dmy, dm } from './ui.js';

const root = document.getElementById('app');
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const S = { tab: 'clock', clock: [], clockProjects: [], busy: false, weekOffset: 0, profile: null, days: [], periods: [], slips: [], brand: {}, offline: false, deferred: null };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d) => d.toISOString().slice(0, 10);
const mondayOf = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
const num = (v) => +v || 0;
const cacheKey = (k) => `mypay.${k}`;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferred = e; if (S.profile) draw(); });

// ---------------- sign in ----------------
function authScreen(note) {
  let mode = 'in';
  const email = h('input', { type: 'email', placeholder: 'Your email', autocomplete: 'username', required: true }), pw = h('input', { type: 'password', placeholder: 'Password (8+ characters)', autocomplete: 'current-password', required: true });
  const msg = h('div', { class: 'notice hidden' }), btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in'), title = h('h2', { style: { margin: '0 0 4px' } }, 'My Pay'), toggle = h('a', { href: '#', class: 'small', style: { display: 'block', textAlign: 'center', marginTop: '14px', color: '#4a3fc4' } }, 'First time? Create your account');
  const set = (m) => { mode = m; btn.textContent = m === 'in' ? 'Sign in' : 'Create my account'; toggle.textContent = m === 'in' ? 'First time? Create your account' : 'I already have an account'; pw.autocomplete = m === 'in' ? 'current-password' : 'new-password'; };
  toggle.onclick = (e) => { e.preventDefault(); set(mode === 'in' ? 'up' : 'in'); };
  const forgot = h('a', { href: '#', class: 'small', style: { display: 'block', textAlign: 'center', marginTop: '8px', color: '#6a7392' }, onClick: async (e) => { e.preventDefault(); if (!email.value) return show('Type your email first.', true); const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.href.split('#')[0] }); show(error ? error.message : 'We have emailed you a link to choose a new password.', !!error); } }, 'Forgot your password?');
  const show = (t, bad) => { msg.textContent = t; msg.className = 'notice ' + (bad ? 'err' : 'ok'); };
  const form = h('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; msg.className = 'notice hidden';
    try {
      if (mode === 'in') { const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }); if (error) throw error; await boot(); }
      else { const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pw.value, options: { emailRedirectTo: location.href.split('#')[0] } }); if (error) throw error; if (data.session) await boot(); else show('Almost there — we have emailed you a link. Open it to confirm your email, then sign in here.'); }
    } catch (er) { show(er.message || String(er), true); } finally { btn.disabled = false; }
  } }, title, h('div', { class: 'muted small' }, 'Clock in and out, and see your hours, earnings, leave and payslips. Use the same email your employer has on file for you.'), note ? h('div', { class: 'notice', style: { marginTop: '12px' } }, note) : null, h('label', null, 'Email'), email, h('label', null, 'Password'), pw, h('div', { style: { marginTop: '14px' } }, btn), msg, toggle, forgot);
  clear(root).append(h('div', { class: 'auth' }, h('div', { class: 'box' }, form)));
}

// ---------------- data ----------------
async function load() {
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args || {}); if (error) throw error; return data || []; };
  try {
    const [prof, days, periods, slips, brand, lv, lvDays, clk, clkP] = await Promise.all([rpc('my_profile'), rpc('my_days', { p_days: 70 }), rpc('my_periods'), rpc('my_payslips'), sb.rpc('app_branding').then((r) => r.data || {}), rpc('my_leave').catch(() => []), rpc('my_leave_days').catch(() => []), rpc('my_clock', { p_days: 14 }).catch(() => []), rpc('my_clock_projects').catch(() => [])]);
    Object.assign(S, { profile: prof[0] || null, days, periods, slips, brand, leave: lv[0] || null, leaveDays: lvDays, clock: clk, clockProjects: clkP, offline: false });
    try { localStorage.setItem(cacheKey('data'), JSON.stringify({ profile: S.profile, days, periods, slips, brand, leave: S.leave, leaveDays: lvDays, at: Date.now() })); } catch { /* private mode */ }
  } catch (e) {
    const c = (() => { try { return JSON.parse(localStorage.getItem(cacheKey('data'))); } catch { return null; } })();
    if (!c) throw e; Object.assign(S, c, { offline: true });
  }
}
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return authScreen();
  try { await load(); } catch (e) { return authScreen('Could not load your details: ' + (e.message || e)); }
  draw();
}

// ---------------- screens ----------------
const firstName = () => String((S.profile && S.profile.full_name) || '').split(/\s+/)[0] || 'there';
function weekView() {
  const base = mondayOf(new Date()); base.setUTCDate(base.getUTCDate() + S.weekOffset * 7);
  const days = DOW.map((nm, i) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + i); return { nm, date: iso(d), n: d.getUTCDate() }; });
  const byDate = new Map(); for (const r of S.days) { const k = String(r.work_date).slice(0, 10), a = byDate.get(k) || []; a.push(r); byDate.set(k, a); }
  const totalH = days.reduce((s, d) => s + (byDate.get(d.date) || []).reduce((a, r) => a + num(r.hours), 0), 0), totalP = days.reduce((s, d) => s + (byDate.get(d.date) || []).reduce((a, r) => a + num(r.hours) * num(r.hourly_rate), 0), 0);
  const max = Math.max(8, ...days.map((d) => (byDate.get(d.date) || []).reduce((a, r) => a + num(r.hours), 0)));
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onClick: () => { S.weekOffset--; draw(); } }, '‹'), h('div', { class: 'grow right', style: { textAlign: 'center' } }, h('b', null, S.weekOffset === 0 ? 'This week' : S.weekOffset === -1 ? 'Last week' : `w/c ${dmy(days[0].date)}`), h('div', { class: 'small muted' }, `${dm(days[0].date)} – ${dmy(days[6].date)}`)), h('button', { class: 'btn ghost sm', disabled: S.weekOffset >= 0, onClick: () => { S.weekOffset++; draw(); } }, '›')),
      h('div', { class: 'row', style: { marginTop: '14px', alignItems: 'flex-end' } }, h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Hours'), h('div', { class: 'big' }, hrs(totalH))), h('div', { class: 'grow right' }, h('div', { class: 'small muted' }, 'Estimated earnings'), h('div', { class: 'big', style: { fontSize: '26px' } }, money(totalP)))),
      h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'Estimated at your hourly rate before tax and deductions. Your final pay is confirmed when payroll is approved.')),
    h('div', { class: 'card' }, days.map((d) => { const rows = byDate.get(d.date) || [], h1 = rows.reduce((a, r) => a + num(r.hours), 0);
      return h('div', { class: 'day' }, h('div', { class: 'd' }, h('b', null, String(d.n)), h('span', null, d.nm)), h('div', { class: 'grow' }, h1 ? [h('div', null, h('b', null, hrs(h1) + ' h'), h('span', { class: 'muted small' }, ' · ' + rows.map((r) => r.project_name).filter((x, i, a) => a.indexOf(x) === i).join(', '))), h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: Math.min(100, (h1 / max) * 100) + '%' } }))] : h('div', { class: 'muted' }, 'No hours')), h1 ? h('div', { class: 'right small' }, money(rows.reduce((a, r) => a + num(r.hours) * num(r.hourly_rate), 0))) : null); }))];
}
function periodsView() {
  if (!S.periods.length) return h('div', { class: 'card muted' }, 'No pay periods to show yet.');
  const byRun = new Map(); for (const p of S.periods) { const a = byRun.get(p.run_id) || { ...p, gross: 0, hours: 0, leave: 0, ssp: 0 }; a.gross += num(p.gross_pay); a.hours += num(p.actual_hours); a.leave += num(p.leave_hours); a.ssp += num(p.ssp_pay); byRun.set(p.run_id, a); }
  return [...byRun.values()].map((p) => { const final = p.run_status === 'approved' || p.run_status === 'locked';
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, p.run_label), h('span', { class: 'pill ' + (final ? 'ok' : 'est') }, final ? 'Confirmed' : 'Estimate')), h('div', { class: 'small muted' }, p.period_start ? `${dmy(p.period_start)} – ${dmy(p.period_end)}` : ''),
      h('div', { class: 'big', style: { margin: '8px 0 2px' } }, money(p.gross)), h('div', { class: 'small muted' }, 'gross pay before tax and deductions'),
      h('div', { class: 'row small', style: { marginTop: '10px', gap: '18px' } }, h('div', null, h('b', null, hrs(p.hours)), ' hours'), p.leave ? h('div', null, h('b', null, hrs(p.leave)), ' paid leave h') : null, p.ssp ? h('div', null, h('b', null, money(p.ssp)), ' SSP') : null)); });
}
// ---------------- clock in / out ----------------
const tm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
function pairShifts(evs) {
  const asc = evs.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))), out = [];
  for (let i = 0; i < asc.length; i++) { const e = asc[i]; if (e.kind !== 'in') continue; const n = asc[i + 1]; const o = n && n.kind === 'out' && Date.parse(n.at) - Date.parse(e.at) <= 18 * 3600000 ? n : null; out.push({ in: e, out: o, hours: o ? (Date.parse(o.at) - Date.parse(e.at)) / 3600000 : null }); if (o) i++; }
  return out.reverse();
}
let tick = null;
function clockView() {
  const last = S.clock[0], isIn = last && last.kind === 'in' && Date.now() - Date.parse(last.at) < 16 * 3600000;
  const projSel = h('select', { style: { width: '100%', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px', font: 'inherit', background: '#fff' } }, (S.clockProjects.length ? S.clockProjects : [{ name: '', is_default: true }]).map((p) => h('option', { value: p.name || '' }, p.name || 'My site')));
  const note = h('input', { type: 'text', placeholder: 'Note (optional)' });
  const msg = h('div', { class: 'notice hidden' });
  const timer = h('div', { class: 'big', style: { fontSize: '40px', textAlign: 'center' } });
  if (tick) clearInterval(tick);
  if (isIn) { const upd = () => { const m = Math.floor((Date.now() - Date.parse(last.at)) / 60000); timer.textContent = `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; }; upd(); tick = setInterval(upd, 30000); }
  const punch = async (kind, btn) => {
    if (S.busy) return; S.busy = true; btn.disabled = true; btn.textContent = 'Getting your location…'; msg.className = 'notice hidden';
    const pos = await new Promise((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }); });
    btn.textContent = 'Saving…';
    try {
      const { data, error } = await sb.rpc('clock_punch', { p_kind: kind, p_project: projSel.value || null, p_lat: pos ? pos.latitude : null, p_lng: pos ? pos.longitude : null, p_accuracy: pos ? pos.accuracy : null, p_note: note.value.trim() || null });
      if (error) throw error;
      const ev = Array.isArray(data) ? data[0] : data;
      S.clock = (await sb.rpc('my_clock', { p_days: 14 })).data || S.clock;
      if (navigator.vibrate) navigator.vibrate(60);
      draw();
      const m2 = document.querySelector('#clockmsg'); if (m2) { m2.textContent = `${kind === 'in' ? 'Clocked in' : 'Clocked out'} at ${tm(ev.at)}${ev.in_area === false ? ' — note: you seem to be away from the site' : ''}${!pos ? ' (location not shared)' : ''}`; m2.className = 'notice ' + (ev.in_area === false ? '' : 'ok'); }
    } catch (e) { msg.textContent = e.message || String(e); msg.className = 'notice err'; btn.disabled = false; btn.textContent = kind === 'in' ? 'Clock in' : 'Clock out'; }
    finally { S.busy = false; }
  };
  const btn = h('button', { class: 'btn', style: { padding: '20px', fontSize: '19px', background: isIn ? 'linear-gradient(135deg,#e11d48,#f97316)' : 'linear-gradient(135deg,#059669,#14b8a6)' }, onClick: (e) => punch(isIn ? 'out' : 'in', e.currentTarget) }, isIn ? 'Clock out' : 'Clock in');
  const shifts = pairShifts(S.clock), wk = mondayOf(new Date()).getTime();
  const weekH = shifts.filter((x) => x.hours && Date.parse(x.in.at) >= wk).reduce((s, x) => s + x.hours, 0);
  return [h('div', { class: 'card', style: { textAlign: 'center' } },
      h('div', { class: 'small muted' }, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
      isIn ? [h('div', { style: { margin: '8px 0 2px', fontWeight: 700, color: '#047857' } }, `You are clocked in at ${last.project_name || 'your site'} since ${tm(last.at)}`), timer] : h('div', { style: { margin: '10px 0', fontWeight: 700 } }, 'You are not clocked in'),
      h('div', { id: 'clockmsg', class: 'notice hidden' }), msg,
      !isIn ? h('div', { style: { textAlign: 'left' } }, h('label', null, 'Where are you working?'), projSel) : null,
      h('div', { style: { textAlign: 'left' } }, h('label', null, 'Note'), note),
      h('div', { style: { marginTop: '14px' } }, btn),
      h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Your phone may ask to share your location — this lets your manager see you clocked in on site. The time comes from our system.')),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Your recent shifts'), h('span', { class: 'pill' }, `This week ${hrs(weekH)} h`)),
      shifts.length ? shifts.slice(0, 20).map((x) => h('div', { class: 'day' }, h('div', { class: 'd' }, h('b', null, String(new Date(x.in.at).getDate())), h('span', null, DOW[(new Date(x.in.at).getDay() + 6) % 7])), h('div', { class: 'grow' }, h('b', null, `${tm(x.in.at)} – ${x.out ? tm(x.out.at) : 'still in'}`), h('div', { class: 'small muted' }, x.in.project_name || '')), h('div', { class: 'right' }, x.hours != null ? h('b', null, hrs(x.hours) + ' h') : h('span', { class: 'pill est' }, 'open')))) : h('div', { class: 'muted small', style: { marginTop: '8px' } }, 'No clock-ins yet.'))];
}
function leaveView() {
  const L = S.leave, r = (n) => String(Math.round(num(n) * 100) / 100);
  if (!L) return h('div', { class: 'card muted' }, 'Your leave record is not available yet. Please ask HR.');
  const pct = Math.max(0, Math.min(100, (num(L.taken) + num(L.booked)) / Math.max(num(L.entitlement), 0.01) * 100));
  const tile = (l, v, sub) => h('div', { style: { flex: '1', background: '#f6f7fd', borderRadius: '12px', padding: '10px' } }, h('div', { class: 'small muted' }, l), h('div', { style: { fontSize: '22px', fontWeight: 800 } }, v), sub ? h('div', { class: 'small muted' }, sub) : null);
  const byType = new Map(); for (const d of S.leaveDays || []) { const k = d.type_name; byType.set(k, (byType.get(k) || 0) + 1); }
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Annual leave'), h('span', { class: 'pill' }, `${dmy(L.year_start)} – ${dmy(L.year_end)}`)),
      h('div', { class: 'row', style: { marginTop: '12px', alignItems: 'flex-end' } }, h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Available now'), h('div', { class: 'big' }, r(L.available) + ' days')), h('div', { class: 'right' }, h('div', { class: 'small muted' }, 'Left this year'), h('div', { style: { fontSize: '22px', fontWeight: 800 } }, r(L.remaining)))),
      h('div', { class: 'bar', style: { margin: '12px 0 6px' } }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, tile('This year', r(L.entitlement)), tile('Built up', r(L.accrued), `${r(L.per_month)} a month`), tile('Taken', r(L.taken), num(L.booked) ? `+${r(L.booked)} booked` : null)),
      h('div', { class: 'small muted', style: { marginTop: '10px' } }, `Leave builds up every month you work${L.hire_date ? ', from ' + dmy(L.hire_date) : ''}. Ask your manager or HR to book leave.${L.employee_code ? ' Your employee ID: ' + L.employee_code : ''}`)),
    byType.size ? h('div', { class: 'card' }, h('b', null, 'Your leave this past year'), h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, [...byType].map(([k, n]) => `${k}: ${n} day${n > 1 ? 's' : ''}`).join(' · ')),
      (S.leaveDays || []).slice(0, 60).map((d) => h('div', { class: 'day' }, h('div', { class: 'd' }, h('b', null, String(+String(d.leave_date).slice(8, 10))), h('span', null, dmy(d.leave_date).split(' ')[1])), h('div', { class: 'grow' }, h('b', null, d.type_name), h('div', { class: 'small muted' }, d.project_name || '')), h('div', { class: 'right small' }, d.hours ? hrs(d.hours) + ' h' : '')))) : h('div', { class: 'card muted' }, 'No leave recorded in the past year.')];
}
function slipsView() {
  if (!S.slips.length) return h('div', { class: 'card muted' }, 'No payslips are available yet. They appear here when your employer publishes them.');
  return S.slips.map((p) => { const row = (a, b, cls) => h('tr', { class: cls || '' }, h('td', null, a), h('td', null, b)), other = Math.round((num(p.net) - num(p.ee_pension) - num(p.student_loan) - num(p.attachment) + num(p.expenses) - num(p.takehome)) * 100) / 100;
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, p.run_label), h('button', { class: 'btn ghost sm noprint', onClick: () => window.print() }, 'Print / save')), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, p.period_start ? `${dmy(p.period_start)} – ${dmy(p.period_end)}` : ''),
      h('table', { class: 'p' }, h('tbody', null, row('Gross pay', money(p.gross)), num(p.tax) ? row('Income tax', '-' + money(p.tax)) : null, num(p.ee_nic) ? row('National Insurance', '-' + money(p.ee_nic)) : null, num(p.ee_pension) ? row('Pension', '-' + money(p.ee_pension)) : null, num(p.student_loan) ? row('Student loan', '-' + money(p.student_loan)) : null, num(p.attachment) ? row('Attachment of earnings', '-' + money(p.attachment)) : null, Math.abs(other) >= 0.01 ? row('Other deductions', '-' + money(other)) : null, row('Take-home pay', money(p.takehome), 't'))),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'A summary of your pay. Your official payslip with tax code and year-to-date figures comes from payroll.')); });
}
function draw() {
  const B = S.brand || {}, name = B.app_name || 'Payroll Online';
  const body = !S.profile ? h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'We cannot find your details yet'), h('p', { class: 'muted' }, 'Your sign-in email has to match the email your employer holds for you. Please ask the payroll team to add it, then open this app again.'))
    : S.tab === 'clock' ? clockView() : S.tab === 'week' ? weekView() : S.tab === 'periods' ? periodsView() : S.tab === 'leave' ? leaveView() : slipsView();
  const tabs = [['clock', '⏱️', 'Clock'], ['week', '📅', 'Hours'], ['periods', '💷', 'Earnings'], ['leave', '🌴', 'Leave'], ['slips', '🧾', 'Payslips']];
  clear(root).append(
    h('div', { class: 'top noprint' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, `Hi ${firstName()} 👋`), h('div', { class: 'sub' }, `${name}${B.company ? ' · ' + B.company : ''}`)), h('button', { class: 'btn sm ghost', style: { background: 'rgba(255,255,255,.2)', color: '#fff' }, onClick: async () => { await sb.auth.signOut(); localStorage.removeItem(cacheKey('data')); authScreen(); } }, 'Sign out'))),
    h('div', { class: 'wrap' }, S.offline ? h('div', { class: 'notice' }, 'You are offline — showing the last information saved on this phone.') : null,
      S.deferred ? h('div', { class: 'card noprint row' }, h('div', { class: 'grow' }, h('b', null, 'Install this app'), h('div', { class: 'small muted' }, 'Add it to your home screen for one-tap access.')), h('button', { class: 'btn sm', onClick: async () => { S.deferred.prompt(); await S.deferred.userChoice; S.deferred = null; draw(); } }, 'Install')) : /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone ? h('div', { class: 'notice noprint' }, 'To install on iPhone: tap the Share button, then “Add to Home Screen”.') : null,
      body, h('div', { class: 'small muted', style: { textAlign: 'center', margin: '14px 0' } }, `Designed by ${B.owner_name || 'Rajab Ali'}`)),
    h('nav', { class: 'tabs noprint' }, tabs.map(([k, ic, t]) => h('button', { class: S.tab === k ? 'on' : '', onClick: () => { S.tab = k; draw(); } }, h('div', { style: { fontSize: '20px' } }, ic), t))));
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') { const pw = prompt('Choose a new password (8+ characters)'); if (pw) sb.auth.updateUser({ password: pw }).then(() => boot()); } });
boot();
