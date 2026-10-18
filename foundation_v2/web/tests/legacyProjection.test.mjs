import test from 'node:test'
import assert from 'node:assert/strict'
import { closedChartTrades, sessionChartTrades } from '../src/legacyChartTrades.js'
import { previousClosedChartTrades, projectionFixture } from './legacyProjectionFixture.mjs'

test('indexed projection preserves the previous fields, lots, missing fees and ordering on identical prefixes', () => {
  for (const count of [0, 10000, 100000]) for (const every of [10, 1000]) {
    const execution = projectionFixture(count, every), ledger = execution.ledger, first = ledger[0]
    assert.deepEqual(closedChartTrades(execution), previousClosedChartTrades(execution))
    assert.equal(execution.ledger, ledger)
    assert.equal(execution.ledger[0], first)
  }
})

test('first matching entry and existing truthy fallbacks remain exact, including absent or later entries', () => {
  const execution = { ledger: [
    { kind: 'market_fill', virtual_time_utc: 1, details: { position_id: 'one', side: 'SELL', quantity: '0.01', fill_price: '1.1' } },
    { kind: 'market_fill', virtual_time_utc: 2, details: { position_id: 'one', side: 'BUY', quantity: '5', fill_price: '9' } },
    { kind: 'manual_close', sequence: 3, virtual_time_utc: 3, details: { position_id: 'one', side: '', quantity: 0, closed_position: { stop_loss: null, take_profit: '1.2', entry: 'ignored' }, net_pnl: '-0.12', cost_breakdown: { commission_account: 0 } } },
    { kind: 'protective_fill', sequence: 4, virtual_time_utc: 3, details: { position_id: 'missing', fill_price: '1.0', net_pnl: '0' } },
    { kind: 'protective_fill', sequence: 5, virtual_time_utc: 4, details: { position_id: 'later' } },
    { kind: 'market_fill', virtual_time_utc: 6, details: { position_id: 'later', side: 'BUY', quantity: '2', fill_price: '2' } },
  ] }
  const before = structuredClone(execution), rows = closedChartTrades(execution)
  assert.deepEqual(rows, previousClosedChartTrades(execution))
  assert.deepEqual(execution, before)
  assert.equal(rows[0].side, 'SELL')
  assert.equal(rows[0].quantity, '0.01')
  assert.equal(rows[0].commission, 0)
  assert.equal(rows[1].commission, undefined)
  assert.deepEqual(closedChartTrades(null), [])
})

test('portfolio symbol, currency, key and close-time tie ordering are unchanged', () => {
  const first = projectionFixture(100, 10), second = projectionFixture(100, 10)
  second.instrument_spec = { instrument_id: 'BTCUSD', asset_class: 'crypto' }
  second.cost_model.account_ccy = 'EUR'
  const states = { z: { execution: first }, a: { execution: second } }
  const expected = Object.entries(states).flatMap(([id, state]) => previousClosedChartTrades(state.execution).map(row => ({ ...row, key: `${id}:${row.key}`, symbol: state.execution.instrument_spec.instrument_id, assetClass: state.execution.instrument_spec.asset_class, currency: state.execution.cost_model.account_ccy }))).sort((a, b) => a.closed_time_utc - b.closed_time_utc || String(a.key).localeCompare(String(b.key)))
  assert.deepEqual(sessionChartTrades(null, states, 'ignored'), expected)
  assert.deepEqual(sessionChartTrades(first, null, 'EURUSD'), previousClosedChartTrades(first).map(row => ({ ...row, symbol: 'EURUSD', assetClass: 'fx', currency: 'USD' })))
})
