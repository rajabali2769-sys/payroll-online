import { configured, auth, loadRuns, startLive, onLive, loadSettings, loadLeaveTypes } from './api.js';
import { h, clear, icon, toast, debounce } from './ui.js';
import { ctx } from './ctx.js';

const PAGES = {
  dashboard:  { title: 'Dashboard',      icon: 'home',   group: 'Overview', load: () => import('./dashboard.js') },
  payroll:    { title: 'Payroll',        icon: 'table',  group: 'Payroll',  load: () => import('./payroll.js') },
  timesheets: { title: 'Timesheets',     icon: 'file',   group: 'Payroll',  load: () => import('./timesheets.js'), edit: true },
  leave:      { title: 'Leave & SSP',    icon: 'sun',    group: 'Payroll',  load: () => import('./leave.js') },
  explorer:   { title: 'Hours explorer', icon: 'search', group: 'Reports',  load: () => import('./explorer.js') },
  journal:    { title: 'Manual journal', icon: 'book',   group: 'Reports',  load: () => import('./journal.js'), edit: true },
  hours:      { title: 'Upload hours',   icon: 'upload', group: 'Setup',    load: () => import('./hours.js'), edit: true },
  import:     { title: 'Import Excel',   icon: 'upload', group: 'Setup',    load: () => import('./imports.js'), edit: true },
  calendar:   { title: 'Pay calendar',   icon: 'cal',    group: 'Setup',    load: () => import('./calendar.js') },
  projects:   { title: 'Projects & POCs', icon: 'folder', group: 'Setup',   load: () => import('./projects.js') },
  settings:   { title: 'Settings',       icon: 'gear',   group: 'Setup',    load: () => import('./settings.js') },
  history:    { title: 'History',        icon: 'clock',  group: 'Admin',    load: () => import('./history.js'), edit: true },
  users:      { title: 'Users',          icon: 'users',  group: 'Admin',    load: () => import('./users.js'), admin: true },
};
const root = document.getElementById('app');
const inviteFlow = /type=(invite|recovery)/.test(location.hash);   // read before Supabase cleans the URL
let stopLive = null, cleanup = null, mainEl = null, liveEl = null, booted = false;

// ---------------- auth screens ----------------
const brand = (dark) => h('div', { class: 'brand', style: dark ? null : { color: '#0f2238' } },
  h('div', { class: 'logo' }, h('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-7 4 3 7-9"/></svg>' })),
  h('div', null, 'Payroll Online', h('small', null, 'Crystal FM')));

function authScreen(inner) { clear(root).append(h('div', { class: 'auth' }, h('div', { class: 'box' }, brand(false), inner))); }

function setupScreen() {
  authScreen(h('div', { class: 'stack' }, h('h1', null, 'One last step'),
    h('p', { class: 'muted', style: { margin: 0 } }, 'The app is running but is not connected to a database yet. Open ', h('b', null, 'js/config.js'),
      ' and paste your Supabase Project URL and anon key. The README walks through it in about five minutes.')));
}
function loginScreen(msg) {
  const email = h('input', { type: 'email', placeholder: 'you@crystalfm.co.uk', required: true, autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: 'Password', required: true, autocomplete: 'current-password' });
  const err = h('div', { class: 'notice err hidden' });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: { justifyContent: 'center' } }, 'Sign in');
  const form = h('form', { class: 'stack', onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.classList.add('hidden');
    try { await auth.signIn(email.value.trim(), pw.value); } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; }
  } },
    h('h1', null, 'Sign in'), msg ? h('div', { class: 'notice' }, msg) : null,
    h('label', { class: 'fld' }, 'Email', email), h('label', { class: 'fld' }, 'Password', pw), err, btn,
    h('a', { href: '#', class: 'small center', onClick: async (e) => { e.preventDefault(); if (!email.value) return toast('Type your email first', 'err');
      try { await auth.reset(email.value.trim()); toast('Password reset email sent', 'ok'); } catch (ex) { toast(ex.message, 'err'); } } }, 'Forgot password?'));
  authScreen(form);
}
function setPasswordScreen() {
  const pw = h('input', { type: 'password', minlength: 8, required: true, placeholder: 'At least 8 characters', autocomplete: 'new-password' });
  authScreen(h('form', { class: 'stack', onSubmit: async (e) => {
    e.preventDefault();
    try { await auth.setPassword(pw.value); toast('Password saved', 'ok'); history.replaceState(null, '', location.pathname + '#/dashboard'); boot(); } catch (ex) { toast(ex.message, 'err'); }
  } }, h('h1', null, 'Choose a password'), h('p', { class: 'muted', style: { margin: 0 } }, 'You will use it to sign in from now on.'),
    h('label', { class: 'fld' }, 'New password', pw), h('button', { class: 'btn primary', style: { justifyContent: 'center' } }, 'Save and continue')));
}

// ---------------- shell ----------------
const parseHash = () => {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'dashboard';
  const [path, qs] = raw.split('?');
  return { page: PAGES[path] ? path : 'dashboard', params: Object.fromEntries(new URLSearchParams(qs || '')) };
};
export const go = (page, params) => { location.hash = '#/' + page + (params ? '?' + new URLSearchParams(params) : ''); };

async function route() {
  if (!booted) return;
  const { page, params } = parseHash();
  const def = PAGES[page];
  if ((def.admin && !ctx.isAdmin) || (def.edit && !ctx.canEdit)) { go('dashboard'); return; }
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  clear(mainEl).append(h('div', { class: 'empty' }, 'Loading…'));
  try {
    const mod = await def.load();
    clear(mainEl);
    if (ctx.schemaOutdated) mainEl.append(h('div', { class: 'notice warn', style: { marginBottom: '14px' } }, 'Your database is missing the latest update. In Supabase open SQL Editor and run the new schema.sql once, then refresh. Until then the new features (leave types, timesheets, journal) will not work.'));
    cleanup = (await mod.render(mainEl, params, ctx)) || null;
  } catch (e) {
    console.error(e);
    clear(mainEl).append(h('div', { class: 'notice err' }, 'Something went wrong: ' + (e.message || e)));
  }
}

function shell() {
  liveEl = h('span', { class: 'live' }, h('i'), h('span', null, 'Connecting…'));
  mainEl = h('main', { class: 'main' });
  const navItems = []; let lastGroup = null;
  for (const [k, d] of Object.entries(PAGES)) {
    if ((d.admin && !ctx.isAdmin) || (d.edit && !ctx.canEdit)) continue;
    if (d.group !== lastGroup) { navItems.push(h('div', { class: 'grp' }, d.group)); lastGroup = d.group; }
    navItems.push(h('a', { href: '#/' + k, 'data-page': k }, icon(d.icon), d.title));
  }
  const nav = h('nav', { class: 'nav' }, navItems);
  clear(root).append(h('div', { class: 'shell' },
    h('aside', { class: 'side' }, brand(true), nav,
      h('div', { class: 'me' }, liveEl, h('div', { style: { marginTop: '10px' } }, h('b', null, ctx.me.email), ctx.me.role[0].toUpperCase() + ctx.me.role.slice(1)),
        h('button', { class: 'btn sm', onClick: () => auth.signOut() }, 'Sign out'))),
    mainEl));
}
const setLive = (on) => { if (!liveEl) return; liveEl.classList.toggle('on', on); liveEl.lastChild.textContent = on ? 'Live · synced' : 'Offline'; };

async function refreshSettings() {
  try { [ctx.settings, ctx.leaveTypes] = await Promise.all([loadSettings(), loadLeaveTypes()]); ctx.schemaOutdated = false; }
  catch (e) { console.warn('settings not available yet', e); ctx.schemaOutdated = true; ctx.settings = ctx.settings || {}; ctx.leaveTypes = ctx.leaveTypes || []; }
}

async function boot() {
  const session = await auth.session();
  if (!session) { booted = false; return loginScreen(); }
  const me = await auth.myProfile(session.user.id);
  if (!me) { return authScreen(h('div', { class: 'stack' }, h('h1', null, 'No access yet'), h('p', { class: 'muted' }, 'Your account exists but has no role. Ask an admin to set one.'), h('button', { class: 'btn', onClick: () => auth.signOut() }, 'Sign out'))); }
  ctx.me = me;
  ctx.runs = await loadRuns();
  await refreshSettings();
  shell();
  booted = true;
  if (stopLive) stopLive();
  stopLive = startLive(setLive);
  // Refresh the list of pay runs (status, approved/locked by ...) whenever any run changes.
  // Only pay_runs events are debounced, so a burst of line edits can never swallow a status change.
  const refreshRuns = debounce(async () => { try { ctx.runs = await loadRuns(); } catch (e) { console.error(e); } }, 300);
  const refreshSet = debounce(refreshSettings, 300);
  onLive.__bound || (onLive.__bound = true, onLive((e) => { if (e.table === 'pay_runs') refreshRuns(); if (e.table === 'app_settings' || e.table === 'leave_types') refreshSet(); }));
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', location.pathname + '#/dashboard');
  route();
}

window.addEventListener('hashchange', route);
(async function start() {
  if (!configured) return setupScreen();
  auth.onChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') return setPasswordScreen();
    if (event === 'SIGNED_OUT') { booted = false; if (stopLive) stopLive(); stopLive = null; ctx.me = null; return loginScreen(); }
    if (event === 'SIGNED_IN' && !booted) { if (inviteFlow) return setPasswordScreen(); return boot(); }
  });
  const s = await auth.session();
  if (s && inviteFlow) setPasswordScreen(); else boot();
})();
