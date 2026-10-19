import test from 'node:test'
import assert from 'node:assert/strict'
import { orderScale, orderMarkerColumns } from '../src/advancedOrderOverlay.js'
import { orderLabel, orderPriceColor, protectionError, protectionProfit } from '../src/replayOrderLabels.js'
import { orderLevels } from '../src/replayOrderModel.js'

const levels = { entry: 1.1, reference: 1.101, side: 'BUY', quantity: '.12', contractSize: 100000, quoteCurrency: 'USD', currency: 'USD', state: 'position', floating: '-3.12', stop: 1.09, target: 1.12 }
test('price-axis colors distinguish entry side, protection and selection', () => {
  assert.equal(orderPriceColor('entry', 'dark', false, 'BUY'), '#F5F8FF')
  assert.equal(orderPriceColor('entry', 'dark', false, 'SELL'), '#FFBF00')
  for (const side of ['BUY', 'SELL']) for (const kind of ['stop', 'target']) {
    assert.equal(orderPriceColor(kind, 'dark', false, side), '#46C7B7')
    assert.equal(orderPriceColor(kind, 'dark', true, side), '#FFBF00')
  }
})
test('equal and nearby prices separate horizontally while distant levels share the right column', () => {
  const marker = (kind, y, width = 160) => ({ kind, y, width, height: 22 })
  assert.deepEqual(orderMarkerColumns([marker('entry', 100), marker('stop', 103), marker('target', 98)]), [
    { kind: 'entry', right: 64 }, { kind: 'stop', right: 232 }, { kind: 'target', right: 400 },
  ])
  assert.deepEqual(orderMarkerColumns([marker('entry', 100), marker('stop', 150), marker('target', 50)]), [
    { kind: 'entry', right: 64 }, { kind: 'stop', right: 64 }, { kind: 'target', right: 64 },
  ])
  assert.deepEqual(orderMarkerColumns([marker('entry', 100), marker('stop', 100, 30), marker('target', 100, 30)]), [
    { kind: 'entry', right: 64 }, { kind: 'stop', right: 232 }, { kind: 'target', right: 262 },
  ], 'TP and SL at the same price touch; Entry keeps its separate gap')
})
test('protection labels use account currency, direction and actual quantity; unknown FX conversion stays unknown', () => {
  assert.equal(orderLabel(levels, 'target', 1.12, 'dark', s => s).text, 'TP → +240.00 USD')
  assert.equal(orderLabel(levels, 'entry', 1.1, 'dark', s => s).text, 'BUY → -3.12 USD')
  assert.equal(orderLabel(levels, 'entry', 1.1, 'dark', s => s).textColor, '#FF603B', 'Buy uses the reference orange text independently of its green line')
  assert.equal(orderLabel({ ...levels, side: 'SELL', floating: '3.12' }, 'entry', 1.1, 'dark', s => s).textColor, '#FF603B', 'Both sides use orange text independently of their line colors')
  assert.equal(orderLabel(levels, 'entry', 1.1, 'light', s => s).color, '#087F6A')
  assert.equal(orderLabel({ ...levels, side: 'SELL' }, 'entry', 1.1, 'light', s => s).color, '#B54718')
  assert.equal(orderLabel({ ...levels, side: 'SELL' }, 'stop', 1.11, 'dark', s => s).text, 'SL → -120.00 USD')
  assert.equal(orderLabel({ ...levels, stop: null }, 'stop', 1.1, 'dark', s => s).text, 'SL')
  assert.equal(protectionProfit({ ...levels, currency: 'EUR' }, 1.12), null)
  assert.ok(Math.abs(protectionProfit({ ...levels, currency: 'EUR', quoteToAccountRate: .9 }, 1.12) - 216) < 1e-8)
  assert.equal(protectionError(levels, 'stop', 1.1005), '', 'Validation follows current closeable price, including profitable stops')
  assert.notEqual(protectionError(levels, 'target', 1.1005), '')
})

test('Entry-price protections use compact handles without losing saved state or hiding real nonzero distances', () => {
  for (const state of ['queued', 'position']) for (const side of ['BUY', 'SELL']) for (const kind of ['stop', 'target']) {
    const atEntry = { ...levels, state, side, [kind]: levels.entry }
    const label = orderLabel(atEntry, kind, levels.entry, 'dark', s => s)
    assert.equal(label.text, kind === 'stop' ? 'SL' : 'TP')
    assert.equal(label.compact, true)
    assert.equal(label.ghost, false)
    assert.match(label.detail, / → 0.00 USD$/)
    const moved = orderLabel(atEntry, kind, levels.entry + .00001, 'dark', s => s)
    assert.equal(moved.compact, false)
    assert.match(moved.text, / → [-+]0.12 USD$/)
    const tiny = orderLabel(atEntry, kind, levels.entry + .00000001, 'dark', s => s)
    assert.equal(tiny.compact, false, 'Rounding to 0.00 must not turn a distinct price into a compact handle')
  }
  const entry = orderLabel({ ...levels, floating: '0' }, 'entry', levels.entry, 'dark', s => s)
  assert.equal(entry.text, 'BUY → 0.00 USD')
  assert.equal(entry.compact, false)
})

test('scale projection supports log, invert and tiny price ranges with reversible drag coordinates', () => {
  for (const mode of [0, 1, 2, 3]) for (const inverted of [false, true]) {
    for (const range of [{ from: 1.08, to: 1.13 }, { from: .000001, to: .000009 }, { from: 100, to: 100000 }]) {
      const scale = orderScale({ scale: { getMode: () => mode, isInverted: () => inverted }, range, height: 700 })
      assert.ok(Math.abs(scale.toY(range.from) - (inverted ? 0 : 700)) < 1e-8)
      const price = (range.from + range.to) / 2
      assert.ok(Math.abs(scale.toPrice(scale.toY(price)) - price) < Math.abs(price) * 1e-10)
    }
  }
})

test('pending entry is explicitly submitting and authoritative execution wins when it arrives', () => {
  const replay = { view_cursor_index: 4, visible_rows: [{ close: 1.1 }], payload: { cursor_index: 4, execution: null } }
  const pending = { entry: 1.1001, side: 'SELL', quantity: '.12', stop_loss: null, take_profit: null }
  const submitting = orderLevels(replay, { side: 'BUY' }, null, null, null, pending)
  assert.equal(submitting.state, 'submitting')
  assert.equal(submitting.ghostStop, pending.entry)
  assert.equal(submitting.side, 'SELL')
  replay.payload.execution = { cursor_index: 4, instrument_spec: { tick_size: '.0001' }, spread_price: '.0002', position: { side: 'BUY', entry_fill: '1.102', quantity: '.2' } }
  const confirmed = orderLevels(replay, { side: 'SELL' }, null, null, null, pending)
  assert.equal(confirmed.state, 'position')
  assert.equal(confirmed.entry, 1.102)
  assert.equal(confirmed.side, 'BUY')
})
