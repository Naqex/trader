// The report's persisted replay cursor owns the challenge's historical scope.
export function propReplayQuery(report, source = new URLSearchParams()) {
  const binding = report?.provenance?.replay_binding, cursor = report?.provenance?.replay_cursor
  if (report?.schema_version !== 'prop-attempt-report-v1' || report.mode !== 'simulation' || report.broker_execution_capability !== false || !binding?.replay_session_id || !Number.isSafeInteger(cursor?.bar_index) || cursor.bar_index < 0) return null
  const query = new URLSearchParams(source)
  for (const key of ['session', 'replay_session', 'job', 'job_id', 'cursor', 'cursor_index', 'cutoff', 'decision_cutoff', 'trade', 'trade_id', 'dataset']) query.delete(key)
  query.set('session', binding.replay_session_id)
  query.set('cursor', String(cursor.bar_index))
  if (!Number.isSafeInteger(binding.last_replay_event_sequence) || binding.last_replay_event_sequence < 0) return null
  query.set('event_sequence', String(binding.last_replay_event_sequence))
  if (binding.dataset_id) query.set('dataset', binding.dataset_id)
  return query
}
import { closeTime } from './sessionPerformanceModel.js'
import { known, number } from './tradingAnalyticsModel.js'

// Evaluator snapshots may still belong to the previous phase after a transition.
export function propObjectiveRows(report) {
  const phase = report?.phase || {}, objectives = report?.objectives
  const ready = Number.isSafeInteger(phase.phase_index) && phase.phase_index > 0 && objectives?.schema === 'prop-objectives-v1' && objectives.phase_index === phase.phase_index && objectives.technical_status === 'ready' && phase.evaluation_quality === 'full_for_declared_model'
  const money = ready ? objectives.money : null, calendar = ready ? objectives.calendar : null
  const start = closeTime(report?.attempt?.virtual_start_utc), end = closeTime(phase.virtual_time_utc)
  const minutes = start && end && end >= start ? Math.floor((end - start) / 60000) : null
  const rows = [{ key:'time', label:'Tổng thời gian kiểm thử', minutes, state:minutes === null ? 'unknown' : report?.outcome?.terminal === true ? 'finished' : 'pending', start, end }]
  for (const [key,label] of [['daily_loss','Daily loss'],['overall_drawdown','Overall drawdown'],['profit_target','Profit target']]) {
    const value = money?.[key], target = key === 'profit_target'
    const reference = number(target ? phase.initial_balance : value?.reference), current = number(value?.current), boundary = number(target ? value?.target : value?.floor)
    const delta = current !== null && reference !== null ? current - reference : null
    const limit = boundary !== null && reference !== null ? boundary - reference : null
    const percent = reference > 0 && delta !== null ? delta / reference * 100 : null
    const flag = target ? value?.hit : value?.breached
    const valid = Number.isFinite(delta) && Number.isFinite(limit) && Number.isFinite(percent) && reference > 0 && typeof flag === 'boolean'
    rows.push({ key, label, reference, current, boundary, value:valid ? delta : null, limit:reference > 0 && Number.isFinite(limit) ? limit : null, percent:valid ? percent : null,
      state:!valid ? 'unknown' : target ? flag ? 'passed' : 'pending' : flag ? 'breached' : 'within', target })
  }
  if (objectives?.calendar != null || phase.qualifying_days != null) rows.push({ key:'days', label:'Ngày đủ điều kiện', days:Number.isSafeInteger(calendar?.qualifying_days) && calendar.qualifying_days >= 0 ? calendar.qualifying_days : null,
    state:!Number.isSafeInteger(calendar?.qualifying_days) || calendar.qualifying_days < 0 ? 'unknown' : calendar.expired === true ? 'expired' : calendar.min_qualifying_days_satisfied === true ? 'passed' : calendar.min_qualifying_days_satisfied === false ? 'pending' : 'unknown' })
  return rows
}


export function buildPropAnalyticsView(view, report) {
  const binding = report.provenance.replay_binding, provenance = view.provenance || {}
  if (provenance.session_id !== binding.replay_session_id || provenance.dataset_id !== binding.dataset_id || provenance.dataset_sha256 !== binding.dataset_sha256 || provenance.branch_id !== binding.branch_id || provenance.execution_event_sequence !== binding.last_replay_event_sequence || provenance.phase_index !== report.phase.phase_index || (report.phase.currency && provenance.account_currency !== report.phase.currency)) throw new Error('prop_replay_scope_mismatch')
  if (!view.analytics_available) return view
  const start = closeTime(report.attempt.virtual_start_utc)
  if (!start || !known(report.phase.initial_balance) || Number(report.phase.initial_balance) <= 0 || view.ledger.some(row => !Number.isInteger(row.close_phase_index))) throw new Error('prop_phase_scope_unavailable')
  const rows = view.ledger.filter(row => row.close_phase_index === report.phase.phase_index && closeTime(row.close_time_utc) >= start)
  const complete = rows.every(row => known(row.net_pnl))
  let balance = Number(report.phase.initial_balance), peak = balance
  const curve = complete ? [{ closed_trade_balance: balance }] : [], dd = []
  for (const row of complete ? rows : []) {
    balance += Number(row.net_pnl); peak = Math.max(peak, balance)
    curve.push({ closed_trade_balance: balance, trade_id: row.trade_id })
    dd.push({ drawdown: peak - balance, drawdown_pct: peak > 0 ? (peak - balance) / peak * 100 : null })
  }
  return { ...view, ledger: rows, metrics: { starting_balance: Number(report.phase.initial_balance), closed_trade_count: rows.length, net_pnl: complete ? rows.reduce((sum, row) => sum + Number(row.net_pnl), 0) : null, ending_closed_trade_balance: complete ? balance : null, closed_trade_balance_curve: curve, closed_trade_balance_drawdown_curve: dd }, scope: { ...view.scope, selected_trade_count: rows.length, active_filters: true, prop_phase: report.phase.phase_index, balance_curve_scope: 'selected closed trades in report phase and attempt interval replayed from phase initial capital; not account equity; carried positions assigned by close phase' } }
}
