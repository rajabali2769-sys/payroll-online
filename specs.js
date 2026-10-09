// Upload templates used across the HR screens (employees, new starters / covers, cover assignments, cover hours).
import { normKey } from './parsers.js';

const TYPE = (v) => { const s = String(v).toLowerCase(); if (!s) return null; if (/perm/.test(s)) return 'permanent'; if (/cover|temp|agency|relief/.test(s)) return 'cover'; return undefined; };
const STATUS = (v) => { const s = String(v).toLowerCase(); if (!s) return null; if (/^(active|current|yes|live)/.test(s)) return 'active'; if (/susp/.test(s)) return 'suspended'; if (/term|leaver|left|inactive|dismiss|resign/.test(s)) return 'terminated'; return undefined; };
const NI_RE = /^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]?$/;

export const EMPLOYEE_COLUMNS = [
  { key: 'employee_code', label: 'Employee ID', type: 'upper', help: 'Leave empty for new people — the system creates a unique ID (CFM00001…). Fill it in to update someone who is already in the system.', aliases: ['emp id', 'employee no', 'staff id'] },
  { key: 'full_name', label: 'Employee name', required: true, example: 'Jane Smith', aliases: ['name', 'full name', 'employee'] },
  { key: 'employment_type', label: 'Employment type', map: TYPE, example: 'Permanent', help: 'Permanent or Cover (temporary and cover are the same type)', aliases: ['type', 'contract'] },
  { key: 'emp_status', label: 'Status', map: STATUS, example: 'Active', help: 'Active, Suspended or Terminated' },
  { key: 'default_project', label: 'Project', required: true, example: 'NHS Cornwall' },
  { key: 'pay_group', label: 'Pay date', example: '25th', help: 'Pay date group, e.g. 24th, 25th, 26th, 28th, 29th, LWD, 5th', aliases: ['pay group', 'paydate'] },
  { key: 'default_site', label: 'Site' },
  { key: 'area_manager', label: 'Area manager', help: 'Leave empty to use the project POC' },
  { key: 'area_manager_email', label: 'Area manager email', type: 'lower' },
  { key: 'default_rate', label: 'Hourly rate', type: 'number', example: 12.21, aliases: ['rate', 'hourly rate £', 'rate per hour'] },
  { key: 'weekly_hours', label: 'Weekly budgeted hours', type: 'number', example: 15, aliases: ['weekly hours', 'budgeted hours', 'contracted hours'] },
  { key: 'contracted_weeks', label: 'Contracted weeks', type: 'number', example: 52 },
  { key: 'shift_days', label: 'Shift days', example: 'Mon-Fri' },
  { key: 'shift_start', label: 'Shift start', type: 'time', example: '06:00' },
  { key: 'shift_end', label: 'Shift end', type: 'time', example: '09:00', aliases: ['shift finish'] },
  { key: 'email', label: 'Email', type: 'lower', example: 'jane.smith@email.com' },
  { key: 'phone', label: 'Phone' },
  { key: 'ni_number', label: 'NI number', type: 'upper', example: 'AB123456C', aliases: ['ni', 'national insurance'] },
  { key: 'job_title', label: 'Job title', example: 'Cleaning Operative' },
  { key: 'rtw_type', label: 'RTW document', example: 'Passport', aliases: ['right to work'] },
  { key: 'rtw_expiry', label: 'RTW expiry date', type: 'date', example: '31/12/2027', aliases: ['rtw expiry'] },
  { key: 'hire_date', label: 'Hire date', type: 'date', example: '01/06/2026', aliases: ['start date'] },
  { key: 'termination_date', label: 'Termination date', type: 'date' },
  { key: 'al_entitlement', label: 'AL days per year', type: 'number', example: 20, help: 'Annual leave days for a full leave year (20 if empty)' },
  { key: 'al_carry', label: 'AL carried over (days)', type: 'number' },
  { key: 'al_taken_before', label: 'AL already taken this year (days)', type: 'number', help: 'Days taken this leave year before using this system' },
];
export const employeeSpec = (save, title = 'Upload employees') => ({
  title, file: 'employees_template.xlsx', columns: EMPLOYEE_COLUMNS, save,
  help: ['One row per employee. Columns marked * are required.', 'New people get a unique Employee ID automatically.', 'Existing people are matched on Employee ID, then NI number, then name — only the cells you fill in are changed.'],
  note: 'Tip: export the current list, change it in Excel and upload it again to update many people at once.',
  rowCheck: (r) => (r.ni_number && !NI_RE.test(r.ni_number) ? `NI number “${r.ni_number}” does not look right` : r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) ? `“${r.email}” is not an email` : null),
});
export const coverStarterSpec = (save) => ({ ...employeeSpec(save, 'Upload covers / temporary staff'), file: 'covers_template.xlsx', columns: EMPLOYEE_COLUMNS.filter((c) => !['emp_status', 'termination_date', 'al_carry', 'al_taken_before', 'employee_code'].includes(c.key)).map((c) => (c.key === 'hire_date' ? { ...c, required: true, label: 'Start date' } : c.key === 'default_rate' ? { ...c, required: true } : c)) });

export const assignmentSpec = (save) => ({
  title: 'Upload cover assignments', file: 'cover_assignments_template.xlsx', save,
  help: ['One row for each person a cover is replacing. A cover replacing three people = three rows.', 'Use Employee IDs where you can — names also work.'],
  columns: [
    { key: 'cover', label: 'Cover employee ID or name', required: true, example: 'CFM00123' },
    { key: 'absent', label: 'Covering for (employee ID or name)', required: true, example: 'CFM00045' },
    { key: 'reason', label: 'Reason', example: 'Annual leave', help: 'Annual leave, Sickness, Vacancy, Suspension, Training, Other' },
    { key: 'date_from', label: 'From', type: 'date', required: true, example: '06/10/2026' },
    { key: 'date_to', label: 'To', type: 'date', example: '17/10/2026' },
    { key: 'expected_hours', label: 'Expected hours per week', type: 'number', example: 15 },
    { key: 'notes', label: 'Notes' },
  ],
});
export const hoursSpec = (save) => ({
  title: 'Upload cover hours', file: 'cover_hours_template.xlsx', save,
  help: ['One row per cover per day worked.', 'Covering for is optional — fill it in when the cover replaces more than one person, so the hours go against the right absence.'],
  columns: [
    { key: 'cover', label: 'Cover employee ID or name', required: true, example: 'CFM00123' },
    { key: 'work_date', label: 'Date', type: 'date', required: true, example: '06/10/2026' },
    { key: 'hours', label: 'Hours', type: 'number', required: true, example: 3 },
    { key: 'absent', label: 'Covering for (employee ID or name)', example: 'CFM00045' },
    { key: 'note', label: 'Note' },
  ],
});
// find an employee from an ID or a name
export const finder = (staff) => { const byCode = new Map(staff.filter((e) => e.employee_code).map((e) => [e.employee_code.toUpperCase(), e])), byName = new Map(staff.map((e) => [normKey(e.full_name), e])); return (v) => (v ? byCode.get(String(v).trim().toUpperCase()) || byName.get(normKey(String(v))) || null : null); };
