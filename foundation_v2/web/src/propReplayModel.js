const TERMINAL_PROP_STATUSES = new Set(['completed_pass', 'failed_breach', 'expired', 'abandoned'])

function number(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function thresholdValue(rule, initial) {
  const amount = number(rule?.threshold?.amount)
  if (amount !== null) return amount
  const percent = number(rule?.threshold?.percent)
  return percent === null || initial === null ? null : initial * percent / 100
}

function currentByBasis(phase, rule) {
  if (rule?.basis === 'balance') return number(phase?.balance)
  return number(phase?.equity)
}

export function isPropTerminal(status) {
  return TERMINAL_PROP_STATUSES.has(status)
}

export function propPriceMarkEvents(events, afterSequence = 0) {
  return Array.isArray(events) ? events.filter(event => event?.kind === 'price_mark' && Number.isSafeInteger(Number(event.sequence)) && Number(event.sequence) > afterSequence).sort((a,b) => Number(a.sequence)-Number(b.sequence)) : []
}

export function propReplayRuleView(propState) {
  const phase = propState?.phase
  const session = propState?.session
  if (!phase || !session) return null
  const profilePhase = session.profile?.phases?.find(item => item.phase_index === phase.phase_index) || session.profile?.phases?.[0]
  if (!profilePhase) return null

  const initial = number(phase.initial_balance)
  const balance = number(phase.balance)
  const equity = number(phase.equity)
  const profitTarget = thresholdValue(profilePhase.profit_target, initial)
  const dailyLimit = thresholdValue(profilePhase.daily_loss, initial)
  const overallLimit = thresholdValue(profilePhase.overall_drawdown, initial)
  const dailyCurrent = currentByBasis(phase, profilePhase.daily_loss)
  const overallCurrent = currentByBasis(phase, profilePhase.overall_drawdown)
  const dailyAnchor = number(phase.daily_anchor) ?? initial
  const overallReference = profilePhase.overall_drawdown?.kind === 'trailing'
    ? number(phase.high_water_mark) ?? initial
    : initial
  const targetAccount = currentByBasis(phase, profilePhase.profit_target)
  const targetCurrent = initial !== null && targetAccount !== null ? targetAccount - initial : null
  const dailyUsed = dailyCurrent === null ? null : Math.max(0, dailyAnchor - dailyCurrent)
  const overallUsed = overallCurrent === null ? null : Math.max(0, overallReference - overallCurrent)
  const objectives = propState.objectives?.money
  const calendar = propState.objectives?.calendar
  return {
    status: propState.attempt?.status || 'unknown',
    phaseIndex: phase.phase_index,
    currency: profilePhase.currency || 'USD',
    initialBalance: initial,
    dailyReset: { time: profilePhase.reset_local_time, timezone: profilePhase.reset_timezone },
    positionPolicy: profilePhase.position_policy,
    balance,
    equity,
    profitTarget: { current: objectives?.profit_target?.current != null && initial != null ? Number(objectives.profit_target.current) - initial : targetCurrent, target: objectives?.profit_target?.target != null && initial != null ? Number(objectives.profit_target.target) - initial : profitTarget, hit: objectives?.profit_target?.hit === true },
    dailyLoss: { used: objectives?.daily_loss?.current != null ? Math.max(0, Number(objectives.daily_loss.reference) - Number(objectives.daily_loss.current)) : dailyUsed, limit: objectives?.daily_loss?.floor != null ? Number(objectives.daily_loss.reference) - Number(objectives.daily_loss.floor) : dailyLimit, breached: objectives?.daily_loss?.breached === true },
    overallDrawdown: { used: objectives?.overall_drawdown?.current != null ? Math.max(0, Number(objectives.overall_drawdown.reference) - Number(objectives.overall_drawdown.current)) : overallUsed, limit: objectives?.overall_drawdown?.floor != null ? Number(objectives.overall_drawdown.reference) - Number(objectives.overall_drawdown.floor) : overallLimit, breached: objectives?.overall_drawdown?.breached === true, kind: profilePhase.overall_drawdown?.kind || 'static' },
    qualifyingDays: calendar?.qualifying_days ?? number(phase.qualifying_days) ?? 0,
    minimumDays: profilePhase.min_qualifying_days ?? 0,
    elapsedDays: calendar?.elapsed_calendar_days ?? null,
    maxDays: profilePhase.max_calendar_days ?? null,
    terminal: isPropTerminal(propState.attempt?.status),
  }
}
