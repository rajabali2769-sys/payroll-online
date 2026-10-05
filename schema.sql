-- =====================================================================================
--  Payroll Online  ·  database schema for Supabase (Postgres 15+)
--  Run this whole file once in:  Supabase dashboard → SQL Editor → New query → Run
--  Safe to re-run: every statement is idempotent.
-- =====================================================================================

-- ---------- 1. Users & roles ----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'viewer' check (role in ('admin','editor','viewer')),
  created_at  timestamptz not null default now()
);

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.app_role() in ('admin','editor'), false) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.app_role() = 'admin', false) $$;

-- Every new login gets a profile. The very first person to sign in becomes the admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when exists (select 1 from public.profiles) then 'viewer' else 'admin' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. Reference data --------------------------------------------------------
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  name_key        text not null unique,          -- lower-case, single-spaced name used for matching
  pay_group       text,                          -- 24th / 25th / 26th / 28th / 29th / 5th / LWD
  manager         text,
  collection_type text,
  start_date      date,
  end_date        date,
  created_at      timestamptz not null default now()
);

-- Alternative spellings that should land on the same project (e.g. "Loreto" -> "Loretto College")
create table if not exists public.project_aliases (
  alias_key   text primary key,
  project_id  uuid not null references public.projects(id) on delete cascade
);

create table if not exists public.employees (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  name_key     text not null,
  ni_number    text,
  phone        text,
  pension      text,
  employee_pct numeric,
  employer_pct numeric,
  agreements   text,
  notes        text,
  created_at   timestamptz not null default now()
);
create unique index if not exists employees_ni_uniq on public.employees (ni_number) where ni_number is not null;
create index if not exists employees_name_key_idx on public.employees (name_key);

-- ---------- 3. Payroll data ----------------------------------------------------------
-- One pay run = one imported file (a month of the monthly payroll, or one fortnight).
create table if not exists public.pay_runs (
  id           uuid primary key default gen_random_uuid(),
  stream       text not null check (stream in ('monthly','fortnightly')),
  label        text not null,
  period_start date,
  period_end   date,
  source_file  text,
  status       text not null default 'ready' check (status in ('importing','ready')),
  notes        text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (stream, label)
);

-- The reconciliation window for each pay-date group inside a run (these change every month).
create table if not exists public.pay_periods (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.pay_runs(id) on delete cascade,
  pay_group      text not null,
  reconcile_from date,
  reconcile_to   date,
  pay_date       date,
  notes          text,
  unique (run_id, pay_group)
);

-- One row per employee per project/site per run.  INPUTS ONLY - every calculated figure
-- (actual hours, gross pay, budget, difference ...) is derived in the view v_payroll_lines,
-- so changing any input instantly changes the answer for everybody.
create table if not exists public.payroll_lines (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.pay_runs(id) on delete cascade,
  employee_id     uuid references public.employees(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  project_name    text not null,
  site_name       text,
  employee_name   text not null,
  ni_number       text,
  blip_site       text,
  status          text,
  contract_type   text,                 -- Hourly / Cover / Fixed (blank = not paid by the hour)
  hourly_rate     numeric not null default 0,
  budgeted_hours  numeric not null default 0,   -- weekly budget (monthly stream)
  fixed_pay       numeric,                      -- when set, this is the fixed wage and the budget
  leave_pay       numeric not null default 0,
  addition        numeric not null default 0,
  deduction       numeric not null default 0,
  weeks_reconciled numeric,
  remarks         text,
  comments        text,
  pay_group       text,
  extra           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
create index if not exists payroll_lines_run_idx       on public.payroll_lines (run_id);
create index if not exists payroll_lines_run_group_idx on public.payroll_lines (run_id, pay_group);
create index if not exists payroll_lines_employee_idx  on public.payroll_lines (employee_id);
create index if not exists payroll_lines_project_idx   on public.payroll_lines (project_id);

-- Weekly figures (Mon-Sun weeks).  variance_override keeps any hand-typed variance from the old Excel.
create table if not exists public.line_weeks (
  line_id           uuid not null references public.payroll_lines(id) on delete cascade,
  week_start        date not null,
  delivered         numeric not null default 0,   -- hours worked ("Total wc" / "Original Hours")
  leave             numeric not null default 0,   -- leave / holiday hours
  budget            numeric not null default 0,   -- budgeted hours for that week
  in_window         boolean not null default true,-- week counts towards over/under hours
  variance_override numeric,
  primary key (line_id, week_start)
);
create index if not exists line_weeks_week_idx on public.line_weeks (week_start);

-- Day-by-day hours (kept as long rows so any date range / week can be asked for).
create table if not exists public.daily_hours (
  line_id    uuid not null references public.payroll_lines(id) on delete cascade,
  work_date  date not null,
  hours      numeric,
  note       text,                                  -- 'BH', 'off', 'Public holiday Approved', '⚠' ...
  primary key (line_id, work_date)
);
create index if not exists daily_hours_date_idx on public.daily_hours (work_date);

-- ---------- 4. Audit trail -----------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  table_name  text not null,
  row_id      text,
  action      text not null,
  run_id      uuid,
  context     text,            -- "Employee · Project" for line level changes
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists audit_log_at_idx  on public.audit_log (at desc);
create index if not exists audit_log_run_idx on public.audit_log (run_id);

create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists payroll_lines_touch on public.payroll_lines;
create trigger payroll_lines_touch before update on public.payroll_lines
  for each row execute function public.touch_row();

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  st text; rid text; rrun uuid; ctx text; o jsonb := '{}'; n jsonb := '{}'; k text; v jsonb; lid uuid;
begin
  if current_setting('app.bulk', true) = '1' then return coalesce(new, old); end if;

  if tg_table_name = 'payroll_lines' then
    lid := coalesce(new.id, old.id);
    rid := lid::text; rrun := coalesce(new.run_id, old.run_id);
    ctx := coalesce(new.employee_name, old.employee_name) || ' · ' || coalesce(new.project_name, old.project_name);
    select status into st from public.pay_runs where id = rrun;
  elsif tg_table_name in ('line_weeks','daily_hours') then
    lid := coalesce(new.line_id, old.line_id);
    select l.run_id, l.employee_name || ' · ' || l.project_name, r.status into rrun, ctx, st
      from public.payroll_lines l join public.pay_runs r on r.id = l.run_id where l.id = lid;
    if rrun is null then return coalesce(new, old); end if;      -- parent already deleted (cascade)
    rid := lid::text || '/' || coalesce((to_jsonb(new)->>'week_start'), (to_jsonb(old)->>'week_start'),
                                        (to_jsonb(new)->>'work_date'), (to_jsonb(old)->>'work_date'));
  elsif tg_table_name = 'pay_runs' then
    rid := coalesce(new.id, old.id)::text; rrun := coalesce(new.id, old.id);
    ctx := coalesce(new.label, old.label); st := null;
  elsif tg_table_name = 'pay_periods' then
    rid := coalesce(new.id, old.id)::text; rrun := coalesce(new.run_id, old.run_id);
    ctx := coalesce(new.pay_group, old.pay_group) || ' pay window'; st := null;
  else
    rid := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id');
    ctx := coalesce(to_jsonb(new)->>'name', to_jsonb(new)->>'full_name', to_jsonb(old)->>'name', to_jsonb(old)->>'full_name');
  end if;

  if st = 'importing' then return coalesce(new, old); end if;        -- the import itself is logged once
  if tg_table_name = 'pay_runs' then                                   -- import bookkeeping; the IMPORT row covers it
    if tg_op = 'INSERT' then
      if new.status = 'importing' then return new; end if;
    elsif tg_op = 'UPDATE' then
      if old.status = 'importing' then return new; end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    for k, v in select * from jsonb_each(to_jsonb(new)) loop
      if k in ('updated_at','updated_by') then continue; end if;
      if to_jsonb(old)->k is distinct from v then
        o := o || jsonb_build_object(k, to_jsonb(old)->k);
        n := n || jsonb_build_object(k, v);
      end if;
    end loop;
    if n = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then n := to_jsonb(new);
  else o := to_jsonb(old);
  end if;

  insert into public.audit_log (user_id, user_email, table_name, row_id, action, run_id, context, old_data, new_data)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), tg_table_name, rid, tg_op, rrun, ctx,
          nullif(o,'{}'::jsonb), nullif(n,'{}'::jsonb));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['payroll_lines','line_weeks','daily_hours','pay_runs','pay_periods','employees','projects'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------- 5. The pay maths (single source of truth) --------------------------------
-- Reproduces the old Excel exactly (verified against your September files):
--   Actual hours  = sum of weekly delivered hours          Leave hours = sum of weekly leave hours
--   Over / Less   = sum of positive / negative weekly variances (delivered + leave - budget), weeks "in window" only
--   Hourly pay    = (actual + leave) x rate   for Hourly and Cover contracts, otherwise 0
--   Gross pay     = fixed pay + hourly pay + leave pay + addition - deduction
--   Budgeted pay  = fixed pay if set, otherwise budget hours x rate
--                   (monthly: weekly budget x weeks reconciled · fortnightly: sum of the two weekly budgets)
--   Difference    = gross - budgeted
create or replace view public.v_payroll_lines with (security_invoker = true) as
with w as (
  select line_id,
         sum(delivered)                                                                            as actual_hours,
         sum(leave)                                                                                as leave_hours,
         sum(budget)                                                                               as week_budget_sum,
         sum(case when in_window then greatest(coalesce(variance_override, delivered + leave - budget), 0) else 0 end) as over_hours,
         sum(case when in_window then least(coalesce(variance_override, delivered + leave - budget), 0) else 0 end)    as less_hours
  from public.line_weeks group by line_id
), s1 as (
  select l.*, r.stream, r.label as run_label,
         coalesce(w.actual_hours, 0) as actual_hours, coalesce(w.leave_hours, 0) as leave_hours,
         coalesce(w.over_hours, 0)   as over_hours,   coalesce(w.less_hours, 0)  as less_hours,
         case when r.stream = 'monthly' then coalesce(l.budgeted_hours * l.weeks_reconciled, 0)
              else coalesce(w.week_budget_sum, 0) end as budget_hours_total
  from public.payroll_lines l
  join public.pay_runs r on r.id = l.run_id
  left join w on w.line_id = l.id
), s2 as (
  select s1.*,
         case when lower(coalesce(contract_type,'')) in ('hourly','cover')
              then (actual_hours + leave_hours) * hourly_rate else 0 end as hourly_pay
  from s1
), s3 as (
  select s2.*,
         coalesce(fixed_pay, 0) + hourly_pay + addition + leave_pay - deduction as gross_pay,
         coalesce(fixed_pay, budget_hours_total * hourly_rate)                  as budgeted_pay
  from s2
)
select s3.*, gross_pay - budgeted_pay as difference,
       case when gross_pay - budgeted_pay >  0.5 then 'Over'
            when gross_pay - budgeted_pay < -0.5 then 'Under'
            else 'Within' end as budget_status
from s3;

create or replace view public.v_line_weeks with (security_invoker = true) as
select w.*, l.run_id
from public.line_weeks w join public.payroll_lines l on l.id = w.line_id;

create or replace view public.v_daily with (security_invoker = true) as
select d.line_id, d.work_date, (date_trunc('week', d.work_date))::date as week_start, d.hours, d.note,
       l.run_id, l.project_name, l.site_name, l.employee_name, l.employee_id, l.pay_group,
       l.contract_type, l.hourly_rate, r.stream
from public.daily_hours d
join public.payroll_lines l on l.id = d.line_id
join public.pay_runs r on r.id = l.run_id;

create or replace view public.v_run_summary with (security_invoker = true) as
select run_id, coalesce(pay_group, 'Unassigned') as pay_group,
       count(*)                                                       as lines,
       count(distinct coalesce(employee_id::text, employee_name))     as employees,
       sum(actual_hours)                                              as actual_hours,
       sum(gross_pay)                                                 as gross,
       sum(budgeted_pay)                                              as budgeted,
       sum(difference)                                                as difference,
       count(*) filter (where budget_status = 'Over')                 as over_lines,
       count(*) filter (where budget_status = 'Under')                as under_lines
from public.v_payroll_lines
group by run_id, coalesce(pay_group, 'Unassigned');

-- Hours & estimated pay for ANY date range, grouped however you like.
create or replace function public.explore_hours(
  p_from date, p_to date, p_by text default 'employee',
  p_stream text default null, p_run uuid default null, p_group text default null,
  p_project text default null, p_search text default null)
returns table (grp text, hours numeric, est_pay numeric, employees bigint, line_count bigint)
language sql stable security invoker set search_path = public as $$
  select case p_by
           when 'project'   then v.project_name
           when 'site'      then coalesce(v.site_name, '—')
           when 'week'      then to_char(v.week_start, 'YYYY-MM-DD')
           when 'day'       then to_char(v.work_date, 'YYYY-MM-DD')
           when 'pay_group' then coalesce(v.pay_group, 'Unassigned')
           else v.employee_name end                                              as grp,
         coalesce(sum(v.hours), 0)                                               as hours,
         coalesce(sum(case when lower(coalesce(v.contract_type,'')) in ('hourly','cover')
                           then v.hours * v.hourly_rate else 0 end), 0)          as est_pay,
         count(distinct coalesce(v.employee_id::text, v.employee_name))          as employees,
         count(distinct v.line_id)                                               as line_count
  from public.v_daily v
  where v.work_date between p_from and p_to
    and (p_stream  is null or v.stream = p_stream)
    and (p_run     is null or v.run_id = p_run)
    and (p_group   is null or v.pay_group = p_group)
    and (p_project is null or v.project_name = p_project)
    and (p_search  is null or v.employee_name ilike '%' || p_search || '%')
  group by 1
  order by 1;
$$;

-- Bulk helpers (skip the per-row audit; log one summary row instead)
create or replace function public.clear_run(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit() then raise exception 'You do not have permission to change payroll data'; end if;
  perform set_config('app.bulk', '1', true);
  delete from public.payroll_lines where run_id = p_run;
  insert into public.audit_log (user_id, user_email, table_name, row_id, action, run_id, context)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), 'pay_runs', p_run::text, 'IMPORT-REPLACE', p_run,
          'All lines replaced by a new import');
end $$;

create or replace function public.delete_run(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare lbl text;
begin
  if not public.is_admin() then raise exception 'Only an admin can delete a pay run'; end if;
  perform set_config('app.bulk', '1', true);
  select label into lbl from public.pay_runs where id = p_run;
  delete from public.pay_runs where id = p_run;
  insert into public.audit_log (user_id, user_email, table_name, row_id, action, context)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), 'pay_runs', p_run::text, 'DELETE', 'Run deleted: ' || coalesce(lbl, ''));
end $$;

create or replace function public.log_import(p_run uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit() then raise exception 'You do not have permission to change payroll data'; end if;
  insert into public.audit_log (user_id, user_email, table_name, row_id, action, run_id, context)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), 'pay_runs', p_run::text, 'IMPORT', p_run, p_text);
end $$;

-- ---------- 6. Security (Row Level Security) -----------------------------------------
-- viewer  : can read everything
-- editor  : can read + change payroll data and import files
-- admin   : editor + manage users + delete pay runs
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.project_aliases enable row level security;
alter table public.employees      enable row level security;
alter table public.pay_runs       enable row level security;
alter table public.pay_periods    enable row level security;
alter table public.payroll_lines  enable row level security;
alter table public.line_weeks     enable row level security;
alter table public.daily_hours    enable row level security;
alter table public.audit_log      enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['projects','project_aliases','employees','pay_runs','pay_periods','payroll_lines','line_weeks','daily_hours'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read',   t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() is not null)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_edit())', t || '_delete', t);
  end loop;
end $$;

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.can_edit());

-- ---------- 7. Live sync to every open browser ---------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['payroll_lines','line_weeks','daily_hours','pay_runs','pay_periods','employees','projects'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
