// Shared app state (who is logged in, which pay run is selected).
import { h } from './ui.js';
import { dmy } from './ui.js';

export const ctx = {
  me: null,            // profile row {id,email,role}
  runs: [],
  runId: (() => { try { return localStorage.getItem('payroll.runId'); } catch { return null; } })(),
  get canEdit() { return !!this.me && (this.me.role === 'admin' || this.me.role === 'editor'); },
  get isAdmin() { return !!this.me && this.me.role === 'admin'; },
};
export const currentRun = () => ctx.runs.find((r) => r.id === ctx.runId) || ctx.runs[0] || null;
export function setRun(id) { ctx.runId = id; try { localStorage.setItem('payroll.runId', id); } catch { /* private mode */ } }
export const runLabel = (r) => `${r.label}${r.period_start ? ` · ${dmy(r.period_start)} – ${dmy(r.period_end)}` : ''}`;

const statusTag = (r) => (r.status === 'locked' ? ' · 🔒 locked' : r.status === 'approved' ? ' · ✓ approved' : '');
// Can this person edit this pay run right now? (editor/admin role AND the run is not locked)
export const runEditable = (runId) => ctx.canEdit && (ctx.runs.find((r) => r.id === runId) || {}).status !== 'locked';

export function runPicker(onChange) {
  const cur = currentRun();
  const sel = h('select', { onChange: (e) => { setRun(e.target.value); onChange(e.target.value); } },
    ctx.runs.map((r) => h('option', { value: r.id, selected: cur && r.id === cur.id }, `${r.stream === 'monthly' ? 'Monthly' : 'Fortnightly'} · ${runLabel(r)}${statusTag(r)}`)));
  return h('label', { class: 'fld w2' }, 'Pay run', sel);
}
