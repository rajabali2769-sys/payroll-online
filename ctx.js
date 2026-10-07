// Shared app state (who is logged in, which pay run is selected).
import { h } from './ui.js';
import { dmy } from './ui.js';

export const ctx = {
  me: null,            // profile row {id,email,role}
  runs: [],
  settings: {},        // app_settings rows by key
  perms: {},           // what this person's role may do / see (role_permissions)
  prefs: {},           // this person's own preferences (user_prefs)
  leaveTypes: [],
  schemaOutdated: false,
  runId: (() => { try { return localStorage.getItem('payroll.runId'); } catch { return null; } })(),
  can(p) { return !!this.me && (this.me.role === 'super_admin' || !!this.perms[p]); },
  get canEdit() { return this.can('edit_payroll'); },
  get isAdmin() { return this.can('manage_settings'); },
  get isSuper() { return !!this.me && this.me.role === 'super_admin'; },
};
export const isOpen = (r) => r.status !== 'locked';
export const openRuns = () => ctx.runs.filter(isOpen);
export const previousRuns = () => ctx.runs.filter((r) => !isOpen(r));
// the "current" payroll of each kind = the open one with the latest period
export const currentRuns = () => ['monthly', 'fortnightly'].map((s) => openRuns().filter((r) => r.stream === s).sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)))[0]).filter(Boolean);
export const currentRun = () => ctx.runs.find((r) => r.id === ctx.runId) || currentRuns()[0] || ctx.runs[0] || null;
export const BRAND_DEFAULTS = { app_name: 'Payroll Online', company: 'Crystal FM', owner_name: 'Rajab Ali', owner_title: 'Payroll Manager', popup: true, popup_text: '', accent1: '#6c5ce7', accent2: '#2563eb' };
export const brand = () => ({ ...BRAND_DEFAULTS, ...(ctx.settings.branding || {}) });
export function setRun(id) { ctx.runId = id; try { localStorage.setItem('payroll.runId', id); } catch { /* private mode */ } }
export const runLabel = (r) => `${r.label}${r.period_start ? ` · ${dmy(r.period_start)} – ${dmy(r.period_end)}` : ''}`;

const statusTag = (r) => (r.status === 'locked' ? ' · 🔒 locked' : r.status === 'approved' ? ' · ✓ approved' : '');
// Can this person edit this pay run right now? (editor/admin role AND the run is not locked)
export const runEditable = (runId) => ctx.canEdit && (ctx.runs.find((r) => r.id === runId) || {}).status !== 'locked';

export function runPicker(onChange) {
  const cur = currentRun();
  const opt = (r) => h('option', { value: r.id, selected: cur && r.id === cur.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${runLabel(r)}${statusTag(r)}`);
  const sel = h('select', { onChange: (e) => { setRun(e.target.value); onChange(e.target.value); } },
    openRuns().length ? h('optgroup', { label: 'Open payrolls' }, openRuns().map(opt)) : null,
    previousRuns().length ? h('optgroup', { label: 'Previous payrolls (locked)' }, previousRuns().map(opt)) : null);
  return h('label', { class: 'fld w2' }, 'Pay run', sel);
}

// Settings with safe defaults (so the app still works before anyone has opened the Settings page)
export const payRules = () => ({ ssp_weekly_rate: 123.25, ssp_days: 5, ...(ctx.settings.pay_rules || {}) });
export const escalationCfg = () => ({ default_email: '', cc: '', threshold_gbp: 250, threshold_hours: 8, threshold_pct: 5, ...(ctx.settings.escalation || {}) });
export const journalCfg = () => ctx.settings.journal || {};
export const leaveType = (code) => ctx.leaveTypes.find((t) => t.code === code);
