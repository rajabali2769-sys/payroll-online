import {
  loadRuns,
  loadSummary,
  loadPeriods,
  sb,
  onLive,
  deleteRun
} from './api.js';

import {
  h,
  clear,
  money,
  hrs,
  dm,
  dmy,
  debounce,
  natCompare,
  confirmBox,
  toast
} from './ui.js';

import {
  ctx,
  currentRun,
  runPicker
} from './ctx.js';

import { go } from './app.js';


export async function render(root) {

  if (!ctx.runs.length) {
    root.append(
      h('div', { class: 'card empty' },
        h('h2', null, 'No payroll data yet'),
        h(
          'p',
          null,
          ctx.canEdit
            ? 'Import your monthly or fortnightly Excel file to get started.'
            : 'An editor needs to import the first payroll file.'
        ),
        ctx.canEdit
          ? h('a', { class: 'btn primary', href: '#/import' }, 'Import payroll')
          : null
      )
    );
    return;
  }


  const body = h('div');

  const head = h(
    'div',
    { class: 'page-head' },

    h(
      'div',
      null,
      h('h1', null, 'Payroll Dashboard'),
      h(
        'p',
        { class: 'muted' },
        'Payroll performance, budget control and approval status.'
      )
    ),

    runPicker(() => load())
  );

  root.append(head, body);


  async function approve(run) {

    if (!await confirmBox(
      'Approve payroll?',
      `Approve "${run.label}" for payroll processing?`,
      'Approve'
    )) return;

    try {

      const { error } = await sb.rpc(
        'approve_pay_run',
        { p_run: run.id }
      );

      if (error) throw error;

      toast('Payroll approved', 'ok');

      ctx.runs = await loadRuns();

      await load();

    } catch (e) {

      toast(e.message || 'Could not approve payroll', 'err');

    }
  }


  async function lock(run) {

    if (!await confirmBox(
      'Lock payroll?',
      `Lock "${run.label}"? Payroll figures will no longer be editable.`,
      'Lock payroll'
    )) return;

    try {

      const { error } = await sb.rpc(
        'lock_pay_run',
        { p_run: run.id }
      );

      if (error) throw error;

      toast('Payroll locked', 'ok');

      ctx.runs = await loadRuns();

      await load();

    } catch (e) {

      toast(e.message || 'Could not lock payroll', 'err');

    }
  }


  async function unlock(run) {

    if (!await confirmBox(
      'Unlock payroll?',
      `Unlock "${run.label}" for further review?`,
      'Unlock'
    )) return;

    try {

      const { error } = await sb.rpc(
        'unlock_pay_run',
        { p_run: run.id }
      );

      if (error) throw error;

      toast('Payroll unlocked', 'ok');

      ctx.runs = await loadRuns();

      await load();

    } catch (e) {

      toast(e.message || 'Could not unlock payroll', 'err');

    }
  }


  async function load() {

    const selected = currentRun();

    const run = ctx.runs.find(x => x.id === selected.id) || selected;

    const [
      summary,
      periods,
      worst,
      best,
      linesResult
    ] = await Promise.all([

      loadSummary(run.id),

      loadPeriods(run.id),

      sb
        .from('v_payroll_lines')
        .select(
          'id,employee_id,employee_name,project_name,site_name,pay_group,gross_pay,budgeted_pay,difference'
        )
        .eq('run_id', run.id)
        .order('difference', { ascending: false })
        .limit(10),

      sb
        .from('v_payroll_lines')
        .select(
          'id,employee_name,project_name,site_name,pay_group,gross_pay,budgeted_pay,difference'
        )
        .eq('run_id', run.id)
        .order('difference', { ascending: true })
        .limit(10),

      sb
        .from('v_payroll_lines')
        .select(
          'employee_id,employee_name,project_name,site_name,gross_pay,budgeted_pay,difference'
        )
        .eq('run_id', run.id)

    ]);


    const lines = linesResult.data || [];


    const sum = key =>
      summary.reduce(
        (total, row) => total + (+row[key] || 0),
        0
      );


    const gross = sum('gross');
    const budget = sum('budgeted');
    const difference = sum('difference');

    const variancePct =
      budget
        ? (difference / budget) * 100
        : 0;


    const employees = new Set(
      lines.map(
        x => x.employee_id || x.employee_name
      )
    ).size;


    const projects = new Set(
      lines
        .map(x => x.project_name)
        .filter(Boolean)
    ).size;


    const sites = new Set(
      lines
        .map(x => x.site_name)
        .filter(Boolean)
    ).size;


    const windowByGroup = new Map(
      periods.map(
        p => [p.pay_group, p]
      )
    );


    const maxGross = Math.max(
      1,
      ...summary.map(
        r => +r.gross || 0
      )
    );


    const status = run.status || 'ready';


    const statusLabel =
      status === 'locked'
        ? 'LOCKED'
        : status === 'approved'
          ? 'APPROVED'
          : status === 'importing'
            ? 'IMPORTING'
            : 'READY FOR REVIEW';


    const statusClass =
      status === 'locked'
        ? 'status-locked'
        : status === 'approved'
          ? 'status-approved'
          : status === 'importing'
            ? 'status-importing'
            : 'status-ready';


    const statusIcon =
      status === 'locked'
        ? '🔒'
        : status === 'approved'
          ? '✓'
          : status === 'importing'
            ? '↻'
            : '●';


    const statusActions = h(
      'div',
      {
        style: {
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap'
        }
      },

      ctx.isAdmin && status === 'ready'
        ? h(
            'button',
            {
              class: 'btn primary',
              onClick: () => approve(run)
            },
            '✓ Approve Payroll'
          )
        : null,

      ctx.isAdmin && status === 'approved'
        ? h(
            'button',
            {
              class: 'btn primary',
              onClick: () => lock(run)
            },
            '🔒 Lock Payroll'
          )
        : null,

      ctx.isAdmin && status === 'locked'
        ? h(
            'button',
            {
              class: 'btn',
              onClick: () => unlock(run)
            },
            '🔓 Unlock Payroll'
          )
        : null
    );


    const search = h(
      'input',
      {
        class: 'input',
        type: 'search',
        placeholder: 'Search employees, projects or sites...',
        style: {
          width: '100%',
          fontSize: '15px'
        }
      }
    );


    search.addEventListener(
      'input',
      debounce(() => {

        const value =
          search.value.trim();

        if (!value) return;

      }, 300)
    );


    clear(body).append(


      h(
        'div',
        {
          class: 'card pad',
          style: {
            marginBottom: '16px'
          }
        },

        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap'
            }
          },

          h(
            'div',
            null,

            h(
              'div',
              {
                class: `payroll-status ${statusClass}`
              },
              `${statusIcon} ${statusLabel}`
            ),

            h(
              'h2',
              {
                style: {
                  margin: '10px 0 4px'
                }
              },
              run.label
            ),

            h(
              'div',
              { class: 'muted' },

              [
                run.stream
                  ? run.stream[0].toUpperCase() +
                    run.stream.slice(1)
                  : '',

                run.period_start && run.period_end
                  ? `${dmy(run.period_start)} – ${dmy(run.period_end)}`
                  : ''
              ]
                .filter(Boolean)
                .join(' · ')
            )
          ),

          statusActions
        ),

        status === 'locked'
          ? h(
              'div',
              {
                class: 'locked-notice',
                style: {
                  marginTop: '14px'
                }
              },
              '🔒 This payroll is locked. Payroll editing is disabled by the database.'
            )
          : null
      ),


      h(
        'div',
        {
          class: 'grid kpis dashboard-kpis'
        },

        kpi(
          'Gross Pay',
          money(gross),
          `${sum('lines').toLocaleString()} payroll lines`
        ),

        kpi(
          'Budget',
          money(budget),
          'planned payroll'
        ),

        kpi(
          'Variance',
          money(difference),
          `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(2)}% ${
            difference > 0.5
              ? 'over budget'
              : difference < -0.5
                ? 'under budget'
                : 'on budget'
          }`,
          difference > 0.5
            ? 'neg'
            : difference < -0.5
              ? 'pos'
              : ''
        ),

        kpi(
          'Employees',
          employees.toLocaleString(),
          'in this pay run'
        ),

        kpi(
          'Hours Worked',
          hrs(sum('actual_hours')),
          'delivered, excluding leave'
        ),

        kpi(
          'Needs Review',
          (
            sum('over_lines') +
            sum('under_lines')
          ).toLocaleString(),
          `${sum('over_lines')} over · ${sum('under_lines')} under`,
          sum('over_lines') ||
          sum('under_lines')
            ? 'neg'
            : ''
        )
      ),


      h(
        'div',
        {
          class: 'grid',
          style: {
            gridTemplateColumns:
              'repeat(auto-fit,minmax(180px,1fr))',
            marginBottom: '16px'
          }
        },

        miniStat(
          'Projects',
          projects
        ),

        miniStat(
          'Sites',
          sites
        ),

        miniStat(
          'Pay groups',
          summary.length
        ),

        miniStat(
          'Average per employee',
          employees
            ? money(gross / employees)
            : money(0)
        )
      ),


      h(
        'div',
        {
          class: 'card pad',
          style: {
            marginBottom: '16px'
          }
        },

        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '12px'
            }
          },

          h(
            'div',
            null,
            h('h3', { style: { margin: 0 } }, 'Payroll Search'),
            h(
              'div',
              { class: 'small muted' },
              'Find an employee, project or site.'
            )
          )
        ),

        search,

        h(
          'div',
          {
            style: {
              marginTop: '10px'
            }
          },

          h(
            'a',
            {
              class: 'btn sm',
              href: '#/payroll',
              onClick: () => {
                const q = search.value.trim();

                if (q) {
                  location.hash =
                    '#/payroll?q=' +
                    encodeURIComponent(q);
                }
              }
            },
            'Search Payroll'
          )
        )
      ),


      h(
        'div',
        {
          class: 'card pad',
          style: {
            marginBottom: '16px'
          }
        },

        h(
          'div',
          {
            class: 'section-title'
          },

          h(
            'div',
            null,

            h(
              'h3',
              { style: { margin: 0 } },
              'Budget vs Actual'
      
