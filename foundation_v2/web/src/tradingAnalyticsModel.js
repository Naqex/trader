import { matchesSearch } from './searchText.js'
import { getTimezone } from './timezone.js'
import { closeTime } from './sessionPerformanceModel.js'

export const known = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value))
export const number = value => known(value) ? Number(value) : null
export const outcomeOf = value => !known(value) ? 'unknown' : Number(value) > 1e-12 ? 'win' : Number(value) < -1e-12 ? 'loss' : 'breakeven'
export const DEFAULT_EXTRA_FILTERS = { asset: 'all', tag: 'all', strategy: 'all', source: 'all', weekday: 'all', hour: 'all', timeStart: '', timeEnd: '', reportKinds: '', timezone: 'UTC', search: '', notes: '', notesPresence: '', statuses: '', assets: '', sides: '', outcomes: '', types: '', years: '', months: '', days: '', hours: '', tagInclude: '', tagExclude: '', tagIncludeMode: 'AND', tagExcludeMode: 'AND' }
export function hasTradeNotes(row) {
  if (row.has_notes === null) return null
  return typeof row.has_notes === 'boolean' ? row.has_notes : Boolean(row.notes?.trim?.() || row.note?.trim?.())
}
// JSON preserves commas in journal tags and survives the existing string URL contract.
export function filterValues(value) {
  if (Array.isArray(value)) return value.map(String)
  if (!value) return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
}
export function readAnalyticsExtraFilters(query) {
  const values = { ...DEFAULT_EXTRA_FILTERS, timezone: getTimezone() }
  for (const key of Object.keys(values)) {
    if (key === 'timezone') continue
    const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
    if (query.get(param)) values[key] = query.get(param)
  }
  for (const key of ['timeStart', 'timeEnd']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values[key])) values[key] = ''
  return values
}

export function validateTradesPayload(payload) {
  const count = payload?.metrics?.closed_trade_count
  if (payload?.schema_version !== 'dashboard-replay-performance-v1' || !Array.isArray(payload.ledger)
    || !Array.isArray(payload.sources) || !Array.isArray(payload.excluded) || !Array.isArray(payload.scope?.session_ids)
    || !['ready', 'partial'].includes(payload.status)
    || !(count === payload.ledger.length || count === null && !payload.ledger.length && payload.excluded.length)
    || payload.ledger.some(row => !row || typeof row.session_id !== 'string' || !row.session_id || typeof row.trade_id !== 'string' || !row.trade_id
      || !known(row.net_pnl) || !row.source_provenance || !Number.isSafeInteger(row.source_provenance.revision) || row.source_provenance.revision < 1
      || row.source_provenance.session_id !== row.session_id)) throw new Error('trade_ledger_read_model_invalid')
  return payload
}

export function validTradeTableRow(row) {
  if (!row || ![undefined, 'closed', 'open'].includes(row.status)) return false
  if (row.status !== 'open') return known(row.net_pnl)
  return known(row.quantity) && Number(row.quantity) > 0 && known(row.price_open) && Number(row.price_open) > 0
    && ['BUY', 'SELL'].includes(row.side?.toUpperCase())
    && ['net_pnl', 'gross_pnl', 'fees', 'realized_r', 'return_pct', 'price_close', 'report_time_utc', 'close_time_utc'].every(key => row[key] == null)
}

export function validateTradesPagePayload(payload) {
  const page = payload?.pagination
  const unknown = page?.filtered_count === null
  if (payload?.schema_version !== 'replay-trades-page-v1' || !page || !Number.isSafeInteger(page.page) || page.page < 1
    || !Number.isSafeInteger(page.page_size) || page.page_size < 1 || page.page_size > 100
    || !Array.isArray(payload.ledger) || page.returned_count !== payload.ledger.length || page.returned_count > page.page_size
    || !Array.isArray(payload.sources) || !Array.isArray(payload.excluded) || !Array.isArray(payload.scope?.session_ids)
    || !['ready', 'partial'].includes(payload.status) || typeof payload.snapshot_key !== 'string'
    || unknown && (payload.status !== 'partial' || payload.ledger.length || !payload.excluded.length || page.page_count !== null)
    || !unknown && (!Number.isSafeInteger(page.filtered_count) || page.filtered_count < page.returned_count || page.page_count !== Math.ceil(page.filtered_count / page.page_size) || page.page > Math.max(1, page.page_count))
    || payload.ledger.some(row => !row?.session_id || !row?.trade_id || !validTradeTableRow(row) || !Number.isSafeInteger(row.source_provenance?.revision) || row.source_provenance.revision < 1 || row.source_provenance.session_id !== row.session_id)
    || !payload.facets || ['assets', 'tags', 'strategies', 'years', 'types'].some(key => !Array.isArray(payload.facets[key]))) throw new Error('trade_page_read_model_invalid')
  return payload
}
export const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const calendarFormatters = new Map()

export function calendarParts(value, timezone = getTimezone()) {
  const date = closeTime(value)
  if (!date) return null
  if (!calendarFormatters.has(timezone)) calendarFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  const parts = calendarFormatters.get(timezone).formatToParts(date)
  const at = type => parts.find(part => part.type === type)?.value
  const key = `${at('year')}-${at('month')}-${at('day')}`
  return { key, month: key.slice(0, 7), hour: Number(at('hour')), minute: Number(at('minute')), weekday: new Date(`${key}T00:00:00Z`).getUTCDay() }
}

export function filterAnalyticsRows(rows, filters = {}, classifyOutcome = outcomeOf) {
  filters = { ...DEFAULT_EXTRA_FILTERS, timezone: getTimezone(), ...filters }
  const search = filters.search
  const notes = filters.notes.trim().toLowerCase()
  const lists = Object.fromEntries(['assets', 'sides', 'outcomes', 'types', 'notesPresence', 'statuses', 'years', 'months', 'days', 'hours', 'tagInclude', 'tagExclude'].map(key => [key, filterValues(filters[key])]))
  const matches = (key, value) => !lists[key].length || value !== null && value !== undefined && lists[key].includes(String(value))
  const reportKinds = filterValues(filters.reportKinds)
  const minuteOf = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
  const start = minuteOf(filters.timeStart), end = minuteOf(filters.timeEnd)
  const inTime = time => {
    if (start === null && end === null) return true
    if (!time) return false
    const minute = time.hour * 60 + time.minute
    return start !== null && end !== null && start > end ? minute >= start || minute <= end : (start === null || minute >= start) && (end === null || minute <= end)
  }
  const tagsMatch = (values, tags, mode) => mode === 'OR' ? values.some(value => tags.includes(value)) : values.every(value => tags.includes(value))
  return rows.filter(row => {
    const time = calendarParts(Object.hasOwn(row, 'analytics_time_utc') ? row.analytics_time_utc : row.table_time_utc ?? row.report_time_utc, filters.timezone)
    const tags = [...(Array.isArray(row.tags) ? row.tags : []), ...(row.label_aliases || [])]
    return inTime(time)
      && (filters.reportKinds === '' || reportKinds.includes(row.report_kind || 'app'))
      && (filters.asset === 'all' || row.symbol === filters.asset)
      && (filters.tag === 'all' || tags.includes(filters.tag))
      && (!filters.strategy || filters.strategy === 'all' || row.playbook_id === filters.strategy)
      && (filters.source === 'all' || row.source_id === filters.source || (typeof row.source === 'string' ? row.source : row.source?.session_id) === filters.source)
      && (filters.weekday === 'all' || time?.weekday === Number(filters.weekday))
      && (filters.hour === 'all' || time?.hour === Number(filters.hour))
      && matches('assets', row.symbol)
      && matches('sides', row.side?.toLowerCase())
      && matches('outcomes', classifyOutcome(row.net_pnl))
      && matches('types', row.entry_type)
      && matches('statuses', row.status || 'closed')
      && matches('notesPresence', hasTradeNotes(row) === null ? null : hasTradeNotes(row) ? 'with' : 'without')
      && matches('years', time?.key.slice(0, 4))
      && matches('months', time ? Number(time.key.slice(5, 7)) : null)
      && matches('days', time?.weekday)
      && matches('hours', time?.hour)
      && (!notes || typeof row.notes === 'string' && row.notes.toLowerCase().includes(notes) || typeof row.note === 'string' && row.note.toLowerCase().includes(notes))
      && (!lists.tagInclude.length || tagsMatch(lists.tagInclude, tags, filters.tagIncludeMode))
      && (!lists.tagExclude.length || !tagsMatch(lists.tagExclude, tags, filters.tagExcludeMode))
      && (!search || matchesSearch([row.tradeId, row.trade_id, row.symbol, row.side, ...(row.tags || [])].join(' '), search))
  })
}

function stats(rows, classifyOutcome = outcomeOf) {
  const complete = rows.every(row => known(row.net_pnl))
  const pnl = complete ? rows.map(row => Number(row.net_pnl)) : []
  const wins = pnl.filter(value => classifyOutcome(value) === 'win'), losses = pnl.filter(value => classifyOutcome(value) === 'loss')
  const total = values => values.reduce((sum, value) => sum + value, 0)
  const average = values => values.length ? total(values) / values.length : null
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0
  const winRuns = [], lossRuns = []
  for (const value of pnl) {
    if (classifyOutcome(value) !== 'win' && winStreak) winRuns.push(winStreak)
    if (classifyOutcome(value) !== 'loss' && lossStreak) lossRuns.push(lossStreak)
    winStreak = classifyOutcome(value) === 'win' ? winStreak + 1 : 0
    lossStreak = classifyOutcome(value) === 'loss' ? lossStreak + 1 : 0
    maxWinStreak = Math.max(maxWinStreak, winStreak); maxLossStreak = Math.max(maxLossStreak, lossStreak)
  }
  if (winStreak) winRuns.push(winStreak)
  if (lossStreak) lossRuns.push(lossStreak)
  const duration = kind => rows.filter(row => classifyOutcome(row.net_pnl) === kind).map(row => {
    const start = closeTime(row.open_time_utc), end = closeTime(row.close_time_utc)
    return start && end && end >= start ? (end - start) / 60000 : null
  })
  const durationAverage = kind => { const values = duration(kind); return values.length && values.every(known) ? average(values) : null }
  const r = rows.map(row => known(row.realized_r) ? Number(row.realized_r)
    : known(row.planned_risk_budget) && Number(row.planned_risk_budget) > 0 && known(row.net_pnl)
      ? number(Number(row.net_pnl) / Number(row.planned_risk_budget)) : null).filter(value => value !== null)
  return { count: rows.length, complete, net: complete ? total(pnl) : null, wins: complete ? wins.length : null, losses: complete ? losses.length : null,
    breakeven: complete ? pnl.length - wins.length - losses.length : null, winRate: complete && pnl.length ? wins.length / pnl.length * 100 : null,
    expectancy: average(pnl), profitFactor: losses.length ? total(wins) / Math.abs(total(losses)) : null,
    averageWin: average(wins), averageLoss: average(losses), bestWin: wins.length ? Math.max(...wins) : null, worstLoss: losses.length ? Math.min(...losses) : null,
    maxWinStreak: complete ? maxWinStreak : null, maxLossStreak: complete ? maxLossStreak : null, winDuration: durationAverage('win'), lossDuration: durationAverage('loss'),
    averageWinStreak: complete ? average(winRuns) : null, averageLossStreak: complete ? average(lossRuns) : null,
    averageR: average(r), maxR: r.length ? Math.max(...r) : null, rCount: r.length,
  }
}

function frequencySeries(days, dayCounts) {
  if (!days.length) return { day: [], week: [], month: [] }
  const first = Date.parse(`${days[0]}T00:00:00Z`), last = Date.parse(`${days.at(-1)}T00:00:00Z`)
  const weeks = new Map(), months = new Map(), day = []
  // Iterate civil labels, not elapsed 24-hour steps in the selected timezone.
  // DST changes observation grouping without losing/repeating a calendar day.
  for (let value = first; value <= last; value += 86400000) {
    const date = new Date(value), label = date.toISOString().slice(0, 10), count = dayCounts.get(label) || 0
    day.push({ label, count })
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    const week = date.toISOString().slice(0, 10), month = label.slice(0, 7)
    weeks.set(week, (weeks.get(week) || 0) + count)
    months.set(month, (months.get(month) || 0) + count)
  }
  return { day, week: [...weeks].map(([label, count]) => ({ label, count })),
    month: [...months].map(([label, count]) => ({ label, count })) }
}

function drawdownRecovery(drawdown, rows) {
  const byId = new Map(rows.map(row => [row.tradeId, row]))
  let peakTime = null, episode = null
  const episodes = []
  for (const [index, point] of drawdown.entries()) {
    const value = number(point.drawdown)
    if (value === null) return { recoveryDays: null, longestRecoveryDays: null, recoveryDaysKnownCount: 0, recoveryEpisodes: [] }
    const row = point.tradeId ? byId.get(point.tradeId) : rows[Number.isSafeInteger(point.index) ? point.index - 1 : index]
    const at = closeTime(row && Object.hasOwn(row, 'analytics_time_utc') ? row.analytics_time_utc : row?.report_time_utc)
    if (value > 1e-12) {
      if (!episode) episode = { peakTimeUtc: peakTime?.toISOString() ?? null, firstUnderwaterTimeUtc: at?.toISOString() ?? null }
    } else {
      if (episode) {
        const start = closeTime(episode.peakTimeUtc)
        const days = start && at && at >= start ? (at - start) / 86400000 : null
        episodes.push({ ...episode, recoveryTimeUtc: at?.toISOString() ?? null, recovered: true, elapsedDays: days })
        episode = null
      }
      peakTime = at
    }
  }
  if (episode) episodes.push({ ...episode, recoveryTimeUtc: null, recovered: false, elapsedDays: null })
  const recovered = episodes.filter(item => item.recovered), knownDays = recovered.map(item => item.elapsedDays).filter(known)
  const complete = recovered.length > 0 && knownDays.length === recovered.length
  return { recoveryDays: complete ? knownDays.reduce((sum, value) => sum + value, 0) / knownDays.length : null,
    longestRecoveryDays: complete ? Math.max(...knownDays) : null, recoveryDaysKnownCount: knownDays.length, recoveryEpisodes: episodes }
}

export function accountEquityDrawdown(source, { filtered = false } = {}) {
  const unavailable = reason => ({ available: false, reason, points: [], maxDrawdown: null, averageDrawdown: null,
    maxDrawdownPct: null, averageDrawdownPct: null, recoveryDays: null, longestRecoveryDays: null, episodes: null, recoveryEpisodes: [] })
  if (!source || source.value_basis !== 'account_equity_including_floating_pnl' || source.scope !== 'account'
    || !['market', 'activity'].includes(source.time_basis) || !Array.isArray(source.points)) return unavailable('account_equity_unavailable')
  if (filtered && source.trade_filters_apply !== true) return unavailable('trade_filtered_equity_scope')
  let segment = null, peak = null, peakTime = null, previousTime = null, episode = null, broken = false
  const points = [], episodes = []
  const endEpisode = (at, reason) => {
    if (!episode) return
    const recovered = reason === 'recovered'
    episodes.push({ ...episode, recovered, endReason: reason, recoveryTimeUtc: recovered ? at?.toISOString() ?? null : null,
      elapsedDays: recovered && peakTime && at && at >= peakTime ? (at - peakTime) / 86400000 : null })
    episode = null
  }
  for (const [index, point] of source.points.entries()) {
    const at = closeTime(point?.time_utc), equity = number(point?.equity)
    const valid = at && equity !== null && Number.isSafeInteger(point?.segment) && point.segment >= 0
    if (!valid || previousTime && at < previousTime) {
      endEpisode(null, 'unknown_gap'); peak = null; peakTime = null; segment = null; previousTime = null; broken = true
      points.push({ index, timeUtc: at?.toISOString() ?? null, segment: point?.segment ?? null, value: null, equity: null, drawdown: null, drawdownPct: null })
      continue
    }
    if (segment !== point.segment) {
      endEpisode(null, 'segment_boundary'); peak = null; peakTime = null
      if (points.length) points.push({ index: `${index}-gap`, timeUtc: at.toISOString(), segment: point.segment, value: null, equity: null, drawdown: null, drawdownPct: null })
      segment = point.segment
    }
    if (peak === null || equity >= peak) {
      endEpisode(at, 'recovered'); peak = equity; peakTime = at
    }
    const magnitude = Math.max(0, peak - equity), pct = peak > 0 ? magnitude / peak * 100 : null
    if (magnitude > 1e-12 && !episode) episode = { segment, peakTimeUtc: peakTime?.toISOString() ?? null, firstUnderwaterTimeUtc: at.toISOString() }
    points.push({ index, timeUtc: at.toISOString(), segment, value: -magnitude || 0, equity,
      drawdown: -magnitude || 0, drawdownPct: pct === null ? null : -pct || 0 })
    previousTime = at
  }
  endEpisode(null, 'unrecovered')
  const observed = points.filter(point => point.equity !== null)
  if (!observed.length) return unavailable('account_equity_no_observations')
  const positive = observed.map(point => -point.drawdown).filter(value => value > 1e-12)
  const percentages = observed.map(point => point.drawdownPct === null ? null : -point.drawdownPct).filter(known)
  const positivePct = percentages.filter(value => value > 1e-12)
  const recoveries = episodes.filter(item => item.recovered), days = recoveries.map(item => item.elapsedDays).filter(known)
  return { available: true, reason: null, valueBasis: source.value_basis, timeBasis: source.time_basis, scope: source.scope,
    metricsBasis: 'observed_points', partial: source.partial === true || source.sampled === true || Number(source.unknown_event_count) > 0 || broken,
    sampled: source.sampled === true, unknownEventCount: number(source.unknown_event_count), totalPoints: number(source.total_points),
    points, maxDrawdown: Math.max(0, ...positive), averageDrawdown: positive.length ? positive.reduce((sum, value) => sum + value, 0) / positive.length : 0,
    maxDrawdownPct: percentages.length ? Math.max(...percentages) : null,
    averageDrawdownPct: positivePct.length ? positivePct.reduce((sum, value) => sum + value, 0) / positivePct.length : percentages.length ? 0 : null,
    episodes: episodes.length, recoveryEpisodes: episodes, recoveryDays: days.length && days.length === recoveries.length ? days.reduce((sum, value) => sum + value, 0) / days.length : null,
    longestRecoveryDays: days.length && days.length === recoveries.length ? Math.max(...days) : null }
}

export function advancedAnalytics(model, filters = {}, options = {}) {
  filters = { ...DEFAULT_EXTRA_FILTERS, timezone: getTimezone(), ...filters }
  if (model.result?.paged) throw new Error('paged_ledger_cannot_compute_full_analytics')
  const breakevenThreshold = known(options.breakevenThreshold) ? Math.max(0, Number(options.breakevenThreshold)) : 0
  const classifyOutcome = value => !known(value) ? 'unknown' : Math.abs(Number(value)) <= Math.max(1e-12, breakevenThreshold) ? 'breakeven' : Number(value) > 0 ? 'win' : 'loss'
  const timeBasis = model.result?.scope?.time_basis === 'market' ? 'market' : 'activity'
  const timedRows = model.ledger.map(row => ({ ...row, analytics_time_utc: timeBasis === 'market' ? row.close_time_utc ?? null : row.report_time_utc ?? null }))
  const rows = filterAnalyticsRows(timedRows, filters, classifyOutcome).map(row => ({ ...row, outcome: classifyOutcome(row.net_pnl) }))
  const summary = stats(rows, classifyOutcome)
  const localFiltered = Object.keys(DEFAULT_EXTRA_FILTERS).filter(key => key !== 'timezone').some(key => (filters[key] ?? DEFAULT_EXTRA_FILTERS[key]) !== DEFAULT_EXTRA_FILTERS[key])
  // A filtered balance is a hypothetical sequence from the original starting capital.
  let balance = number(model.startBalance), peak = balance, drawdown = [], curve = []
  if (balance !== null && summary.complete) {
    curve = [{ index: 0, value: balance }]
    for (const [index, row] of rows.entries()) {
      balance += Number(row.net_pnl); peak = Math.max(peak, balance)
      curve.push({ index: index + 1, value: balance, tradeId: row.tradeId })
      drawdown.push({ index: index + 1, drawdown: peak - balance, drawdownPct: peak > 0 ? (peak - balance) / peak * 100 : null })
    }
  }
  if (!localFiltered) { curve = model.curve; drawdown = model.drawdown; balance = model.endingBalance }
  const dd = drawdown.map(point => number(point.drawdown)).filter(value => value !== null)
  const positiveDD = dd.filter(value => value > 1e-12)
  let episodes = 0, current = 0, longest = 0, recoverySum = 0, recovered = 0
  for (const value of dd) {
    if (value > 1e-12) { if (!current) episodes++; current++; longest = Math.max(longest, current) }
    else if (current) { recoverySum += current; recovered++; current = 0 }
  }
  const timeParts = new Map(rows.map(row => [row, calendarParts(row.analytics_time_utc, filters.timezone)]))
  const parts = row => timeParts.get(row)
  // Unknown observation times still count financially, but cannot enter a date bucket.
  const datedRows = rows.filter(row => parts(row) && known(row.net_pnl))
  const datesComplete = rows.length > 0 && datedRows.length === rows.length
  const hasDates = datedRows.length > 0
  const group = (keys, keyOf) => keys.map(label => ({ label, ...stats(datedRows.filter(row => keyOf(row) === label), classifyOutcome) }))
  const months = [...new Set(datedRows.map(row => parts(row).month))].sort()
  const days = [...new Set(datedRows.map(row => parts(row).key))].sort()
  const side = ['BUY', 'SELL'].map(label => ({ label, ...stats(rows.filter(row => String(row.side).toUpperCase() === label), classifyOutcome) }))
  const unknownSide = rows.filter(row => !['BUY', 'SELL'].includes(String(row.side).toUpperCase())).length
  const hours = hasDates ? group(Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')), row => String(parts(row).hour).padStart(2, '0')) : []
  const weekdays = hasDates ? group(['1', '2', '3', '4', '5', '6', '0'], row => String(parts(row).weekday)).map(item => ({ ...item, label: WEEKDAYS[Number(item.label)] })) : []
  const calendar = group(days, row => parts(row).key)
  const monthGroups = group(months, row => parts(row).month)
  const sessions = hasDates ? group(['00–08', '08–13', '13–21', '21–24'], row => { const h = parts(row).hour; return h < 8 ? '00–08' : h < 13 ? '08–13' : h < 21 ? '13–21' : '21–24' }) : []
  const frequencyGroups = hasDates ? [
    { label: 'Ngày', count: datedRows.length / (Math.round((new Date(days.at(-1)) - new Date(days[0])) / 86400000) + 1) },
    { label: 'Tuần', count: (() => { const weeks = datedRows.map(row => { const date = new Date(`${parts(row).key}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); return date.getTime() }); return datedRows.length / (Math.round((Math.max(...weeks) - Math.min(...weeks)) / 604800000) + 1) })() },
    { label: 'Tháng', count: (() => { const index = key => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)); return datedRows.length / (index(months.at(-1)) - index(months[0]) + 1) })() },
  ] : []
  const frequencies = frequencySeries(days, new Map(calendar.map(item => [item.label, item.count])))
  const recovery = drawdownRecovery(drawdown, rows)
  return { ...summary, rows, curve, drawdown, endingBalance: balance, localFiltered, maxDrawdown: dd.length ? Math.max(...dd) : null,
    maxDrawdownPct: drawdown.some(point => known(point.drawdownPct)) ? Math.max(...drawdown.map(point => number(point.drawdownPct) ?? 0)) : null,
    averageDrawdown: positiveDD.length ? positiveDD.reduce((sum, value) => sum + value, 0) / positiveDD.length : dd.length ? 0 : null,
    episodes: dd.length ? episodes : null, recoveryTrades: recovered ? recoverySum / recovered : null, unrecovered: current, longest,
    side, unknownSide, hours, weekdays, months: monthGroups, calendar, sessions, frequency: frequencyGroups, datesComplete, incomplete: datedRows.length !== rows.length,
    frequencySeries: frequencies, ...recovery,
    equityDrawdown: accountEquityDrawdown(model.result?.equity_curve, { filtered: localFiltered || model.result?.scope?.active_filters === true }),
    riskReward: { average: summary.averageR, max: summary.maxR, knownCount: summary.rCount, totalCount: rows.length,
      basis: 'net_realized_r', idealAverage: null, idealMax: null },
    excursion: { maeHistogram: [], winningAdverseR: null, knownCount: 0, basis: 'unavailable' },
    sessionGrouping: { basis: 'fixed_close_hour_bands', timezone: filters.timezone, timeField: timeBasis === 'market' ? 'close_time_utc' : 'report_time_utc' },
    recoveryBasis: 'closed_trade_balance_peak_close_to_recovery_close_elapsed_24h_days',
    classification: { breakevenThreshold, winRateBasis: 'wins_over_all_closed_trades_including_breakeven' },
  }
}

export function tradesCsv(rows, currency, metadata = {}) {
  const safe = value => { const text = String(value ?? ''); const numeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)); const formula = /^[\t\r\n]/.test(text) || /^\s*[=+@-]/.test(text) && !numeric; return `"${(formula ? `'${text}` : text).replaceAll('"', '""')}"` }
  const columns = ['trade_id', 'session_id', 'symbol', 'side', 'report_time_utc', 'close_recorded_at_utc', 'open_time_utc', 'close_time_utc', 'price_open', 'price_close', 'quantity', 'net_pnl', 'gross_pnl', 'fees', 'realized_r', 'tags']
  if (rows.some(row => row.source_provenance)) columns.push('origin_session_id', 'source_provenance')
  const metaKeys = Object.keys(metadata).map(key => `report_${key}`)
  return '\uFEFF' + [...[columns.concat('account_currency', metaKeys).map(safe).join(',')], ...rows.map(row => columns.map(key => safe(key === 'tags' ? (row.tags || []).join('|') : key === 'source_provenance' ? JSON.stringify(row[key]) : row[key])).concat(safe(row.account_currency ?? currency), Object.values(metadata).map(safe)).join(','))].join('\r\n')
}
