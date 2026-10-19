import test from 'node:test'
import assert from 'node:assert/strict'
import { orderDraft, protectionReference, replayAtCutoff, orderLevels, marketQuotes, money, validateEntry } from '../src/replayOrderModel.js'
import { projectOrder, ReplayOrderPrimitive } from '../src/replayOrderPrimitive.js'

const replay = { view_cursor_index: 1, visible_rows: [{ timestamp: 120, close: 1.102 }], payload: { cursor_index: 1, execution: {
  cursor_index: 1, spread_price: '.0002', instrument_spec: { tick_size: '.0001' }, position: { side: 'BUY', quantity: '.1', entry_fill: '1.1001', stop_loss: '1.09', take_profit: '1.12', opened_time_utc: 60 },
} } }

test('conditional entries use the correct executable side and enforce price steps', () => {
  const quotes = { bid: 1.1, ask: 1.1002 }, spec = { tick_size: '.0001', pip_size: '.0001', quantity_min: '.01' }
  for (const [side, orderType, entryPrice, wrong] of [['BUY','limit','1.099','1.1002'],['SELL','limit','1.101','1.1'],['BUY','stop','1.101','1.1002'],['SELL','stop','1.099','1.1']]) {
    const draft = { side, orderType, entryPrice }
    assert.equal(validateEntry(draft, quotes, spec), null)
    assert.ok(validateEntry({ ...draft, entryPrice: wrong }, quotes, spec))
    assert.ok(validateEntry({ ...draft, entryPrice: '1.09905' }, quotes, spec))
    assert.ok(validateEntry({ ...draft, entryPrice: '' }, quotes, spec))
    const empty = structuredClone(replay); empty.payload.execution.position = null
    const seeded = orderDraft(empty, spec, side, orderType)
    assert.equal(seeded.stopLoss, '')
    assert.equal(seeded.takeProfit, '')
    assert.equal(validateEntry(seeded, marketQuotes(empty), spec), null)
    assert.equal(orderLevels(empty, draft), null)
  }
  assert.equal(validateEntry({ orderType:'market' }, quotes, spec), null)
  const queued = structuredClone(replay)
  Object.assign(queued.payload.execution, { position:null, pending_market_order:{ side:'BUY', quantity:'.01', order_type:'limit', entry_price:'1.099', stop_loss:null, take_profit:null } })
  assert.equal(protectionReference(queued), 1.099)
  assert.equal(orderDraft(queued, spec).entryPrice, '1.099')
  assert.equal(orderLevels(queued, {}).entry, 1.099)
})
test('historical UI never reads canonical future account or position state', () => {
  const history = { ...replay, view_cursor_index: 0 }
  assert.equal(replayAtCutoff(history).payload.execution, null)
  assert.equal(orderDraft(history, {}).quantity, '')
  assert.equal(orderLevels(history, {}), null)
  assert.equal(replayAtCutoff(replay), replay)
})
test('quote reference includes the closeable side of the spread', () => {
  assert.equal(protectionReference(replay), 1.1019)
  const sell = structuredClone(replay); sell.payload.execution.position.side = 'SELL'
  assert.equal(protectionReference(sell), 1.1021)
  sell.payload.execution.spread_price = null
  assert.equal(protectionReference(sell), null)
  assert.deepEqual(marketQuotes(replay), { bid: 1.1019, ask: 1.1021 })
  assert.deepEqual(marketQuotes(sell), { bid: null, ask: null })
  const fractional = structuredClone(replay); fractional.visible_rows[0].close = 1.10249
  assert.deepEqual(marketQuotes(fractional), { bid: 1.1023, ask: 1.1026 })
  assert.equal(protectionReference(fractional), 1.1023)
})
test('tick quote and draft use pinned historical Bid/Ask without OHLC fallback', () => {
  const tick = structuredClone(replay)
  Object.assign(tick.payload.execution, { quote_source: 'broker_bid_ask', last_bid: '1.1017', last_ask: '1.1024', spread_price: '0', position: null })
  assert.deepEqual(marketQuotes(tick), { bid: 1.1017, ask: 1.1024 })
  assert.equal(orderDraft(tick, { pip_size: '.0001', quantity_min: '.01' }).stopLoss, '')
  assert.equal(orderLevels(tick, { side: 'SELL', stopLoss: '1.11', takeProfit: '1.09' }), null)
  assert.deepEqual(marketQuotes({ ...tick, view_cursor_index: 0 }), { bid: null, ask: null })
  tick.payload.execution.last_ask = null
  assert.deepEqual(marketQuotes(tick), { bid: null, ask: null })
  tick.payload.execution.last_ask = '1.1'
  assert.deepEqual(marketQuotes(tick), { bid: null, ask: null })
})
test('draft prices use declared pip and quantity assumptions without inventing missing values', () => {
  const plain = { visible_rows: [{ close: 1.1 }], payload: {} }
  assert.deepEqual(orderDraft(plain, { pip_size: '.0001', quantity_min: '.01' }), { side: 'BUY', quantity: '.01', stopLoss: '', takeProfit: '' })
  assert.equal(orderDraft(replay, {}).stopLoss, '1.09', 'Opening an existing position keeps its persisted protection')
  assert.equal(orderDraft(replay, {}).takeProfit, '1.12')
  assert.equal(orderDraft(plain, {}, 'SELL').stopLoss, '')
  assert.equal(orderLevels(plain, { side: 'BUY', stopLoss: '', takeProfit: '1.12' }), null)
  assert.equal(orderLevels(replay, { stopLoss: '', takeProfit: '1.12' }).stop, 1.09, 'Persisted protection wins over a stale form draft')
  assert.equal(money(null, 'USD'), 'N/A')
  assert.equal(money(0, null), 'N/A')
  assert.notEqual(money(0, 'USD'), 'N/A')
})

test('chart markers require an accepted order even while Quick Buy/Sell is submitting', () => {
  const empty = structuredClone(replay)
  empty.payload.execution.position = null
  const draft = { side:'BUY', quantity:'.01', stopLoss:'1.09', takeProfit:'1.12' }
  const submitting = { side:'BUY', quantity:'.01', entry:1.1021, stop_loss:'1.09', take_profit:'1.12' }
  assert.equal(orderLevels(empty, draft, null, null, null, submitting), null)
  assert.equal(orderLevels({ ...empty, payload:{} }, draft, null, null, null, submitting), null)
  assert.equal(orderLevels(replay, draft).state, 'position')
  const accepted = structuredClone(empty)
  accepted.payload.execution.pending_market_order = { ...submitting, order_type:'limit', entry_price:'1.099' }
  assert.equal(orderLevels(accepted, draft).state, 'queued')
  assert.equal(orderLevels(accepted, draft).entry, 1.099)
})
test('order projection changes with price scale and keeps unmappable anchors out', () => {
  const levels = orderLevels(replay, orderDraft(replay))
  let offset = 0
  const chart = { timeScale: () => ({ width: () => 600, timeToCoordinate: () => 400 }), panes: () => [{ getHeight: () => 300 }] }
  const series = { priceToCoordinate: p => (1.13 - p) * 10000 + offset }
  const first = projectOrder(levels, chart, series)
  assert.ok(first.target < first.entry && first.entry < first.stop)
  offset = 20
  assert.equal(projectOrder(levels, chart, series).entry, first.entry + 20)
  assert.equal(projectOrder({ ...levels, stop: NaN }, chart, series), null)
  assert.equal(projectOrder(levels, chart, { priceToCoordinate: () => null }), null)
})
test('order primitive releases references and redraws through native engine lifecycle', () => {
  let updates = 0
  const primitive = new ReplayOrderPrimitive(() => {})
  primitive.attached({ requestUpdate: () => updates++ })
  primitive.setLevels(null)
  assert.equal(primitive.autoscaleInfo(), null)
  assert.equal(updates, 2)
  primitive.detached()
  assert.equal(primitive.attachment, null)
  primitive.setLevels({ entry: 1.1, stop: 1.09, target: 1.12 })
  assert.deepEqual(primitive.autoscaleInfo(), { priceRange: { minValue: 1.09, maxValue: 1.12 } })
})
