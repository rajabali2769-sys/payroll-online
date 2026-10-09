// The profile card shown beside lists (dashboard and Employees): photo, name, key details, quick links.
import { h, money, hrs, dmy, icon } from './ui.js';
import { avatar, pickPhoto, canPhoto } from './photos.js';
import { statusChip, typeChip, weeklyPay } from './hrkit.js';
import { waButton } from './whatsapp.js';

export function profileCard(e, { line = null, payDate = null, onOpen, onHistory, onPhoto } = {}) {
  if (!e && !line) return h('div', { class: 'pcard empty' }, h('div', { class: 'small muted' }, 'Pick someone from the list to see their details here.'));
  const p = e || { full_name: line.employee_name };
  const ph = avatar(p, 'xl');
  const row = (l, v, cls) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'pc-row' }, h('span', null, l), h('b', { class: cls || '' }, v)));
  return h('div', { class: 'pcard' },
    h('div', { class: 'pc-band' }),
    h('div', { class: 'pc-photo' + (e && canPhoto(e) ? ' editable' : ''), title: e && canPhoto(e) ? 'Add or change photo' : '', onClick: () => e && pickPhoto(e, onPhoto) }, ph, e && canPhoto(e) ? h('span', { class: 'pc-cam' }, '📷') : null),
    h('div', { class: 'pc-name' }, p.full_name), h('div', { class: 'pc-role' }, (e && e.job_title) || (e ? 'Cleaning Operative' : 'Payroll line')),
    e ? h('div', { class: 'row', style: { justifyContent: 'center', gap: '6px', margin: '6px 0 4px' } }, statusChip(e.emp_status), typeChip(e.employment_type)) : null,
    h('div', { class: 'pc-rows' },
      row('Employee ID', e && e.employee_code), row('Project', (line && line.project_name) || (e && e.default_project)), row('Area manager', e && e.area_manager),
      row('Pay date', [line ? line.pay_group : e && e.pay_group, payDate ? dmy(payDate) : null].filter(Boolean).join(' · ')),
      row('Hourly rate', (line ? line.hourly_rate : e && e.default_rate) != null ? money(line ? line.hourly_rate : e.default_rate) : null),
      line ? row('Hours worked', hrs(line.actual_hours)) : row('Weekly hours', e && e.weekly_hours != null ? hrs(e.weekly_hours) : null),
      line ? row('Budget hours (window)', line.window_budget_hours != null ? hrs(line.window_budget_hours) : null) : row('Weekly pay', e && e.weekly_hours != null ? money(weeklyPay(e)) : null),
      line ? row('Gross pay', money(line.gross_pay), 'pc-net') : null,
      line && line.hours_difference != null ? row('Hours vs budget', `${+line.hours_difference > 0 ? '+' : ''}${hrs(line.hours_difference)} h`, +line.hours_difference > 0 ? 'neg' : 'pos') : null),
    h('div', { class: 'pc-links' },
      onOpen ? h('button', { class: 'pc-link', onClick: onOpen }, icon('users'), h('span', { class: 'grow' }, 'Full profile'), '›') : null,
      onHistory ? h('button', { class: 'pc-link', onClick: onHistory }, icon('pound'), h('span', { class: 'grow' }, 'Payroll history'), '›') : null,
      e ? h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '6px' } }, waButton(e, { label: 'WhatsApp' })) : null));
}
