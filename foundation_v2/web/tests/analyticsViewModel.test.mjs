import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsQuery, analyticsViewResult, buildAnalyticsModel, readAnalyticsFilters } from '../src/analyticsViewModel.js'

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
  assert.deepEqual(Object.fromEntries(analyticsQuery(filters)), { side: 'sell', from_close_utc: '2026-10-01T00:00:00.000Z', to_close_utc: '2026-10-17T23:59:59.999Z' })
})
