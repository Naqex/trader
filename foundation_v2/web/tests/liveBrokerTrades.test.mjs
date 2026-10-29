import test from 'node:test'
import assert from 'node:assert/strict'
import { brokerTradeRows, filterBrokerTrades } from '../src/liveBrokerTrades.js'

const entry = { ticket: 1, order: 10, position_id: 10, entry: 0, type: 1, symbol: 'EURUSD', volume: .01, price: 1.11541, profit: 0, commission: -.1, swap: 0, fee: 0, time_msc: Date.parse('2026-10-27T10:00:00Z') }
const exit = { ...entry, ticket: 2, order: 20, entry: 1, type: 0, price: 1.1139, profit: 1.51, commission: -.1, time_msc: entry.time_msc + 3600000 }
const placement = { deal: 1, order: 10, symbol: 'EURUSD', side: 'SELL', volume: .01, filled_volume: .01, account_login: '123456789', server: 'Broker', order_type: 'market', stop_loss: 1.1166, take_profit: 1.112, currency: 'USD', planned_risk: 1.19 }
const snapshot = () => ({ account: { account_ref: '…6789', currency: 'USD' }, account_login: '123456789', account_binding: { server: 'Broker' }, deals: [exit, entry], positions: [], trade_placements: [placement] })

test('one lifecycle retains original direction, weighted prices and every fee', () => {
  const [row] = brokerTradeRows(snapshot())
  assert.equal(row.status, 'Closed'); assert.equal(row.type, 1)
  assert.equal(row.price_open, 1.11541); assert.equal(row.price_close, 1.1139)
  assert.equal(row.open_time_utc, entry.time_msc); assert.equal(row.close_time_utc, exit.time_msc)
  assert.equal(row.fees, -.2); assert(Math.abs(row.net_pnl - 1.31) < 1e-12)
  assert.equal(row.entry_type, 'Market'); assert.equal(row.stop_loss, 1.1166)
  assert(Math.abs(row.realized_r - 1.51 / 1.19) < 1e-12)
})

test('side, outcome and date filters run after reconstruction', () => {
  const rows = filterBrokerTrades(snapshot(), { side: '1', outcome: 'gain', from: '2026-10-27', to: '2026-10-27' })
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'Closed')
  assert.equal(filterBrokerTrades(snapshot(), { side: '0' }).length, 0)
  assert.equal(filterBrokerTrades(snapshot(), { from: '2026-10-28' }).length, 0)
})

test('missing opening, reversal and inconsistent inventories stay incomplete', () => {
  for (const deals of [[exit], [entry, { ...exit, entry: 2 }], [entry], [entry, { ...exit, volume: .02 }]]) {
    const payload = { ...snapshot(), deals }
    assert.equal(filterBrokerTrades(payload).length, 1)
    const [row] = brokerTradeRows(payload)
    assert.equal(row.status, 'Incomplete'); assert.equal(row.realized_r, null)
    assert.equal(row.price_close, null)
  }
})

test('partial close remains open only when remaining inventory agrees', () => {
  const payload = { ...snapshot(), deals: [entry, { ...exit, volume: .004 }], positions: [{ identifier: 10, ticket: 99, volume: .006 }] }
  const [row] = brokerTradeRows(payload)
  assert.equal(row.status, 'Open'); assert.equal(row.realized_r, null); assert.equal(row.price_close, null)
  payload.positions[0].volume = .005
  assert.equal(brokerTradeRows(payload)[0].status, 'Incomplete')
})

test('split exits use volume weighted price and close-by retains original side', () => {
  const payload = { ...snapshot(), deals: [entry, { ...exit, volume: .004, price: 1.11 }, { ...exit, ticket: 3, entry: 3, volume: .006, price: 1.12 }] }
  const [row] = brokerTradeRows(payload)
  assert.equal(row.status, 'Closed'); assert.equal(row.type, 1)
  assert(Math.abs(row.price_close - 1.116) < 1e-12)
})

test('original stop never crosses identity, partial fills or duplicate provenance', () => {
  for (const update of [{ account_login: 'other' }, { server: 'other' }, { order: 999 }, { stop_loss: 0 }, { stop_loss: null }, { stop_loss: 1.11 }, { filled_volume: .005 }]) {
    const payload = snapshot(); payload.trade_placements = [{ ...placement, ...update }]
    assert.equal(brokerTradeRows(payload)[0].realized_r, null)
  }
  const payload = snapshot(); payload.trade_placements.push(placement)
  assert.equal(brokerTradeRows(payload)[0].realized_r, null)
})

test('imported history has genuine entry prices but no invented order type, SL or R', () => {
  const payload = snapshot(); delete payload.trade_placements
  const [row] = brokerTradeRows(payload)
  assert.equal(row.price_open, 1.11541); assert.equal(row.entry_type, null)
  assert.equal(row.stop_loss, null); assert.equal(row.realized_r, null)
})

test('unknown fees propagate and duplicated ticket never double counts', () => {
  const payload = snapshot(); payload.deals.push(entry)
  assert.equal(brokerTradeRows(payload)[0].fills.length, 2)
  payload.deals[0].fee = null
  const [row] = brokerTradeRows(payload)
  assert.equal(row.net_pnl, null); assert.equal(row.fees, null)
  assert(Number.isFinite(row.realized_r), 'Price R does not pretend to include unknown fees')
  assert.equal(filterBrokerTrades(payload, { outcome: 'gain' }).length, 0)
})

test('R uses actual fills rather than pre-fill preview risk (BTC reference)', () => {
  const payload = snapshot()
  payload.deals = [{ ...entry, price: 81147.4, type: 0 }, { ...exit, price: 81296.73, type: 1 }]
  payload.trade_placements = [{ ...placement, side: 'BUY', stop_loss: 81040.33, planned_risk: 1.07 }]
  const [row] = brokerTradeRows(payload)
  assert.equal(row.realized_r.toFixed(2), '1.39')
})
