import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsQuery, analyticsViewResult, buildAnalyticsModel, dateFromValue, readAnalyticsFilters } from '../src/analyticsViewModel.js'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'
import { setTimezone } from '../src/timezone.js'

test('model preserves unknown values, original financial metrics and immutable ledger', () => {
  const source = { metrics: { starting_balance: 1000, profit_factor_after_cost: 2, expectancy_net_per_trade: 1 }, ledger: [{ trade_id: 'loss', net_pnl: -2, open_time_utc: '2026-10-01T01:00:00Z', close_time_utc: '2026-10-01T01:01:00Z' }, { trade_id: 'win', net_pnl: 4 }] }
  const snapshot = structuredClone(source)
  const model = buildAnalyticsModel(source)
  assert.equal(model.netPnl, 2)
  assert.equal(model.tradeCount, 2)
  assert.equal(model.winRate, 50)
  assert.equal(model.expectancy, 1)
  assert.equal(model.profitFactor, 2)
  assert.deepEqual(model.ledger.map(row => [row.tradeId, row.outcome]), [['loss', 'loss'], ['win', 'win']])
  assert.deepEqual(source, snapshot)
  assert.equal(buildAnalyticsModel({ ledger: [{ net_pnl: null }] }).netPnl, null)
  assert.equal(buildAnalyticsModel({ ledger: [] }).winRate, null)
  assert.equal(buildAnalyticsModel({ ...source, multi_session: true }).netPnl, null)
})

test('read projection retains scope, partial and cutoff provenance without React dependencies', () => {
  const provenance = { workspace_id: 'w', session_id: 's', revision: 8, cursor_index: 20, execution_event_sequence: 4, dataset_sha256: 'hash', status: 'partial' }
  const result = analyticsViewResult({ provenance, analytics_available: true, scope: { selected_trade_count: 0, observed_range: { first_close_utc: '2026-10-01T00:00:00Z' } }, metrics: {}, ledger: [] })
  assert.equal(result.partial, true)
  assert.equal(result.revision, 8)
  assert.equal(result.cursor_index, 20)
  assert.equal(result.execution_event_sequence, 4)
  assert.equal(result.dataset_sha256, 'hash')
  assert.equal(result.observed_range.start_utc, '2026-10-01T00:00:00Z')
  const filters = readAnalyticsFilters(new URLSearchParams({ side: 'SELL', from: '2026-10-01', to: '2026-10-17' }))
  assert.deepEqual(Object.fromEntries(analyticsQuery(filters)), { timezone: 'UTC', time_basis: 'activity', side: 'sell', from_close_utc: '2026-10-01T00:00:00.000Z', to_close_utc: '2026-10-17T23:59:59.999Z' })
})

test('Settings zone updates existing report projection and civil date request boundaries', () => {
  const source = { ledger: [{ trade_id: 'close', net_pnl: 2, close_time_utc: '2003-01-01T23:30:00Z', report_time_utc: '2026-10-01T23:30:00Z', entry_type: null }] }
  const query = new URLSearchParams('from_close_utc=2026-10-01T23%3A30%3A00Z&to_close_utc=2026-10-02T01%3A00%3A00Z')
  try {
    setTimezone('Asia/Ho_Chi_Minh')
    assert.equal(buildAnalyticsModel(source).ledger[0].closeDate, '02/10/2026 06:30:00')
    assert.equal(buildAnalyticsModel(source).ledger[0].entry_type, null)
    assert.deepEqual(readAnalyticsFilters(query), { side: 'all', outcome: 'all', from: '2026-10-02', to: '2026-10-02' })
    assert.deepEqual(Object.fromEntries(analyticsQuery({ from: '2026-10-02', to: '2026-10-02' })), {
      timezone: 'Asia/Ho_Chi_Minh', time_basis: 'activity', from_close_utc: '2026-10-01T17:00:00.000Z', to_close_utc: '2026-10-02T16:59:59.999Z',
    })
    setTimezone('America/New_York')
    assert.equal(buildAnalyticsModel(source).ledger[0].closeDate, '01/10/2026 19:30:00')
    assert.equal(readAnalyticsFilters(query).from, '2026-10-01')
    assert.equal(readAnalyticsFilters(new URLSearchParams('from=2026-10-02')).from, '2026-10-02')
    const spring = analyticsQuery({ from: '2026-03-08', to: '2026-03-08' })
    assert.equal(spring.get('from_close_utc'), '2026-03-08T05:00:00.000Z')
    assert.equal(spring.get('to_close_utc'), '2026-03-09T03:59:59.999Z')
    const autumn = analyticsQuery({ from: '2026-11-01', to: '2026-11-01' })
    assert.equal(autumn.get('from_close_utc'), '2026-11-01T04:00:00.000Z')
    assert.equal(autumn.get('to_close_utc'), '2026-11-02T04:59:59.999Z')
  } finally { setTimezone('UTC') }
})

test('rounding residue uses the same breakeven tolerance in ledger, summary and report', () => {
  const model = buildAnalyticsModel({ ledger: [1e-13, -1e-13, 40, -20].map((net_pnl, index) => ({ trade_id: `close-${index}`, net_pnl })) })
  assert.deepEqual(model.ledger.map(row => row.outcome), ['breakeven', 'breakeven', 'win', 'loss'])
  assert.deepEqual([model.wins, model.losses, model.breakeven, model.winRate], [1, 1, 2, 25])
  const report = advancedAnalytics(model)
  assert.deepEqual([report.wins, report.losses, report.breakeven, report.winRate], [1, 1, 2, 25])
  assert.equal(model.netPnl, 20)
})

test('malformed numeric data remains unknown instead of turning into zero or one', () => {
  for (const invalid of [true, false, [], [12], {}, ' ', '\t']) {
    const model = buildAnalyticsModel({ metrics: { net_pnl: invalid, starting_balance: invalid }, ledger: [{ net_pnl: invalid }] })
    assert.equal(model.netPnl, null)
    assert.equal(model.startBalance, undefined)
    assert.equal(model.ledger[0].pnl, null)
    assert.equal(model.ledger[0].outcome, 'unknown')
    assert.equal(model.winRate, null)
  }
  assert.equal(dateFromValue(true), null)
  assert.equal(dateFromValue('  '), null)
  assert.equal(buildAnalyticsModel({ ledger: [{ net_pnl: '0' }] }).ledger[0].pnl, 0)
})

test('report date/range never fall back to historical market or entry/update timestamps', () => {
  const ledger = [
    { trade_id: 'known', net_pnl: 10, open_time_utc: '2003-01-01T00:00:00Z', close_time_utc: '2003-01-02T00:00:00Z', report_time_utc: '2026-10-31T23:30:00Z' },
    { trade_id: 'unknown', net_pnl: -3, close_time_utc: '2003-02-01T00:00:00Z', report_time_utc: null, recorded_at_utc: '2026-10-01T00:00:00Z', updated_at_utc: '2026-10-02T00:00:00Z' },
  ]
  const source = { ledger, observed_range: { start_utc: '2003-01-01', end_utc: '2003-02-01' } }
  const model = buildAnalyticsModel(source, 'app', 'Asia/Ho_Chi_Minh')
  assert.equal(model.netPnl, 7)
  assert.equal(model.ledger[0].closeDate, '01/11/2026 06:30:00')
  assert.equal(model.ledger[1].closeDate, '-')
  assert.equal(model.ledger[0].close_time_utc, ledger[0].close_time_utc)
  assert.deepEqual(model.observed, { start: '01/11/2026', end: '01/11/2026' })
  assert.equal(model.activityIncomplete, true)
  const missing = buildAnalyticsModel({ ledger: [ledger[1]], observed_range: source.observed_range })
  assert.deepEqual(missing.observed, { start: '-', end: '-' })
  const equity_curve = { points: [{ time_utc: '2026-10-31T23:30:00Z', equity: 1010, balance: 1000, segment: 0 }] }
  assert.deepEqual(analyticsViewResult({ equity_curve }).equity_curve, equity_curve)
})


test('explicit market session scope uses backtest dates while preserving real timestamps', () => {
 const trade = { net_pnl: 3, close_time_utc: '2003-01-05T23:30:00Z', report_time_utc: '2026-10-25T10:00:00Z' }
 const model = buildAnalyticsModel({ scope: { time_basis: 'market' }, ledger: [trade] }, 'app', 'Asia/Ho_Chi_Minh')
 assert.equal(model.ledger[0].closeDate, '06/01/2003 06:30:00')
 assert.equal(model.ledger[0].report_time_utc, trade.report_time_utc)
 assert.deepEqual(model.observed, { start: '06/01/2003', end: '06/01/2003' })
})
