// WhatsApp: open a chat with an employee straight from the system (wa.me link, nothing is stored or sent by us).
import { h, toast, modal } from './ui.js';
import { ctx, brand } from './ctx.js';

// UK numbers: 07… → 447…, +44 / 0044 kept; other international numbers need a + or 00 in front
export function waNumber(phone) {
  let s = String(phone || '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1); else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) s = '44' + s.slice(1);
  else if (s.length === 10 && s.startsWith('7')) s = '44' + s;
  return /^\d{10,15}$/.test(s) ? s : null;
}
export const waUrl = (phone, text) => { const n = waNumber(phone); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : null; };
const ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>';
export const waIcon = () => h('span', { html: ICON, style: { display: 'inline-flex' } });

const TEMPLATES = [
  ['Custom message', ''],
  ['Missing hours / timesheet', 'Hi {first}, this is {sender} from {company}. We have not received your hours/timesheet for this week at {project}. Please send it today so we can pay you on time. Thank you.'],
  ['Shift reminder', 'Hi {first}, a reminder about your shift at {project}{shift}. Please let us know if you cannot attend. Thank you, {sender}.'],
  ['Cover request', 'Hi {first}, are you available to cover a shift at {project}? Please reply with the days you can do. Thanks, {sender} ({company}).'],
  ['Right to work documents', 'Hi {first}, our records show your right to work documents need updating. Please send a copy of your updated documents or share code to HR as soon as possible. Thank you, {sender}.'],
  ['Payslip available', 'Hi {first}, your payslip is now available in the My Pay app. If anything looks wrong please let us know. {sender}, {company}.'],
  ['Please call HR', 'Hi {first}, could you please call the HR team when you get a moment? Thank you, {sender} ({company}).'],
];

// one-click: if a message is not needed, call openWhatsApp(e) with quick=true
export function whatsappModal(e) {
  if (!waNumber(e.phone)) return toast(`${e.full_name} has no valid mobile number on file. Add one on their profile.`, 'err');
  const vars = { first: String(e.full_name || '').split(/\s+/)[0], project: e.default_project || 'your site', shift: e.shift_days ? ` (${e.shift_days}${e.shift_start ? ' ' + String(e.shift_start).slice(0, 5) : ''})` : '', sender: (ctx.settings.hr && ctx.settings.hr.sender) || (ctx.me && ctx.me.email ? ctx.me.email.split('@')[0] : 'HR'), company: brand().company || 'Crystal FM' };
  const fill = (t) => t.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  modal(`WhatsApp ${e.full_name}`, (done) => {
    const sel = h('select', null, TEMPLATES.map(([n], i) => h('option', { value: i }, n)));
    const txt = h('textarea', { rows: 6, placeholder: 'Type a message (optional) — WhatsApp opens with it ready to send' });
    sel.onchange = () => { txt.value = fill(TEMPLATES[+sel.value][1]); };
    return h('div', { class: 'stack' },
      h('div', { class: 'row small' }, waIcon(), h('b', null, '+' + waNumber(e.phone)), h('span', { class: 'muted' }, e.employee_code || '')),
      h('label', { class: 'fld' }, 'Message', sel), txt,
      h('div', { class: 'small muted' }, 'WhatsApp (app or web) opens in a new tab with the message ready. You press send there — nothing is sent from this system.'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: done }, 'Cancel'),
        h('button', { class: 'btn wa', onClick: () => { window.open(waUrl(e.phone, txt.value.trim()), '_blank', 'noopener'); done(); } }, waIcon(), 'Open WhatsApp')));
  });
}
export const waButton = (e, { label } = {}) => (e && e.phone && waNumber(e.phone) && ctx.can('message_whatsapp') ? h('button', { class: 'btn sm wa' + (label ? '' : ' icon-only'), title: `WhatsApp ${e.full_name}`, onClick: (ev) => { ev.stopPropagation(); whatsappModal(e); } }, waIcon(), label || null) : null);
