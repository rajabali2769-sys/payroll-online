// The floating "Ask Payroll AI" assistant. It can only READ data; it runs as the signed-in person so permissions apply.
import { aiChat } from './api.js';
import { h, clear, icon } from './ui.js';
import { ctx, currentRun, brand } from './ctx.js';

const SUGGESTIONS = ['Which projects are most over budget in the current payroll?', 'Headcount by project — permanent vs cover', 'Whose right to work expires in the next 30 days?', 'Which leave requests are waiting for approval?', 'Tell me everything about CFM00002', 'Who is covering for whom this week?', 'Open HR cases and live warnings', 'When is NHS Cornwall paid this month and what is its window?', 'Who is clocked in right now?', 'How much SSP are we paying this period?'];
export function mount() {
  if (document.getElementById('chatfab')) return;
  const hist = []; let open = false, busy = false;
  const body = h('div', { class: 'cbody' }), input = h('input', { type: 'text', placeholder: 'Ask about payroll, staff, leave, covers, HR cases…', onKeydown: (e) => { if (e.key === 'Enter') send(); } });
  const sendBtn = h('button', { class: 'btn primary sm', onClick: () => send() }, 'Send');
  const panel = h('div', { id: 'chatpanel', class: 'hidden' }, h('div', { class: 'chead' }, h('span', { html: '✨' }), h('b', null, `Ask ${brand().app_name} AI`), h('button', { class: 'btn sm ghost', style: { color: '#fff' }, onClick: () => toggle(false) }, icon('x'))), body, h('div', { class: 'cfoot' }, input, sendBtn));
  const fab = h('button', { id: 'chatfab', title: 'Ask the assistant', onClick: () => toggle() }, '✨');
  document.body.append(panel, fab);
  const intro = () => { clear(body).append(h('div', { class: 'bubble bot' }, 'Hi! Ask me anything in the system — payroll, hours and budgets, employees and IDs, right to work, HR cases and warnings, annual leave and leave requests, new starters, covers, clock-ins, the pay calendar, projects and area managers. I only read the data (with your own access); I can’t change anything.'), h('div', { class: 'sug' }, SUGGESTIONS.map((s) => h('button', { onClick: () => { input.value = s; send(); } }, s)))); };
  intro();
  function toggle(v) { open = v === undefined ? !open : v; panel.classList.toggle('hidden', !open); if (open) input.focus(); }
  const add = (cls, text, trace) => { const b = h('div', { class: 'bubble ' + cls }, text, trace && trace.length ? h('div', { class: 'trace' }, 'Looked at: ' + [...new Set(trace.map((t) => t.tool.replace(/_/g, ' ')))].join(', ')) : null); body.append(b); body.scrollTop = body.scrollHeight; return b; };
  async function send() {
    const q = input.value.trim(); if (!q || busy) return; input.value = ''; if (!hist.length) clear(body);
    add('me', q); hist.push({ role: 'user', content: q }); busy = true; sendBtn.disabled = true;
    const wait = add('bot', 'Thinking…');
    try { const run = currentRun(); const r = await aiChat(hist.slice(-10), run ? { id: run.id, label: run.label, stream: run.stream, status: run.status } : null); wait.remove(); add('bot', r.answer, r.trace); hist.push({ role: 'assistant', content: r.answer }); }
    catch (e) { wait.remove(); add('bot', '⚠ ' + (e.message || e)); hist.pop(); }
    busy = false; sendBtn.disabled = false; input.focus();
  }
}
