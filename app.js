import { configured, auth, loadRuns, startLive, onLive } from './api.js';
import { h, clear, icon, toast, debounce } from './ui.js';
import { ctx } from './ctx.js';

const PAGES = {
  dashboard: { title: 'Dashboard', icon: 'home', load: () => import('./dashboard.js') },
  payroll:   { title: 'Payroll', icon: 'table', load: () => import('./payroll.js') },
  explorer:  { title: 'Hours explorer', icon: 'search', load: () => import('./explorer.js') },
  calendar:  { title: 'Pay calendar', icon: 'cal', load: () => import('./calendar.js') },
  import:    { title: 'Import files', icon: 'upload', load: () => import('./imports.js'), edit: true },
  projects:  { title: 'Projects', icon: 'folder', load: () => import('./projects.js') },
  history:   { title: 'History', icon: 'clock', load: () => import('./history.js'), edit: true },
  users:     { title: 'Users', icon: 'users', load: () => import('./users.js'), admin: true },
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
    cleanup = (await mod.render(mainEl, params, ctx)) || null;
  } catch (e) {
    console.error(e);
    clear(mainEl).append(h('div', { class: 'notice err' }, 'Something went wrong: ' + (e.message || e)));
  }
}

function shell() {
  liveEl = h('span', { class: 'live' }, h('i'), h('span', null, 'Connecting…'));
  mainEl = h('main', { class: 'main' });
  const nav = h('nav', { class: 'nav' }, Object.entries(PAGES).filter(([, d]) => (!d.admin || ctx.isAdmin) && (!d.edit || ctx.canEdit)).map(([k, d]) =>
    h('a', { href: '#/' + k, 'data-page': k }, icon(d.icon), d.title)));
  clear(root).append(h('div', { class: 'shell' },
    h('aside', { class: 'side' }, brand(true), nav,
      h('div', { class: 'me' }, liveEl, h('div', { style: { marginTop: '10px' } }, h('b', null, ctx.me.email), ctx.me.role[0].toUpperCase() + ctx.me.role.slice(1)),
        h('button', { class: 'btn sm', onClick: () => auth.signOut() }, 'Sign out'))),
    mainEl));
}
const setLive = (on) => { if (!liveEl) return; liveEl.classList.toggle('on', on); liveEl.lastChild.textContent = on ? 'Live · synced' : 'Offline'; };

async function boot() {
  const session = await auth.session();
  if (!session) { booted = false; return loginScreen(); }
  const me = await auth.myProfile(session.user.id);
  if (!me) { return authScreen(h('div', { class: 'stack' }, h('h1', null, 'No access yet'), h('p', { class: 'muted' }, 'Your account exists but has no role. Ask an admin to set one.'), h('button', { class: 'btn', onClick: () => auth.signOut() }, 'Sign out'))); }
  ctx.me = me;
  ctx.runs = await loadRuns();
  shell();
  booted = true;
  if (stopLive) stopLive();
  stopLive = startLive(setLive);
  onLive.__bound || (onLive.__bound = true, onLive(debounce(async (e) => {
    if (e.table === 'pay_runs') { ctx.runs = await loadRuns(); }
  }, 400)));
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
