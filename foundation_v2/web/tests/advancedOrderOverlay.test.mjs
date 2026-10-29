import test from 'node:test'
import assert from 'node:assert/strict'
import { orderScale, orderMarkerColumns, readOrderPriceScale } from '../src/advancedOrderOverlay.js'
import { orderLabel, orderPriceColor, protectionError, protectionProfit } from '../src/replayOrderLabels.js'
import { orderLevels } from '../src/replayOrderModel.js'

const levels = { entry: 1.1, reference: 1.101, side: 'BUY', quantity: '.12', contractSize: 100000, quoteCurrency: 'USD', currency: 'USD', state: 'position', floating: '-3.12', stop: 1.09, target: 1.12 }

test('resolution changes tolerate unavailable price scales and resume on the new range', () => {
  let visible = null
  const scale = {getVisiblePriceRange:() => { if (visible === 'detached') throw new Error('Value is null'); return visible }}
  const pane = {getMainSourcePriceScale:() => scale}
  const chart = {getPanes:() => [pane],getVisiblePriceRange:() => { throw new Error('Deprecated getter must never run') }}
  assert.equal(readOrderPriceScale(chart),null)
  visible = 'detached'
  assert.equal(readOrderPriceScale(chart),null)
  for (const value of [{from:1,to:1},{from:NaN,to:2},{from:1,to:Infinity}]) {
    visible = value; assert.equal(readOrderPriceScale(chart),null)
  }
  visible = {from:1.12,to:1.09}
  assert.deepEqual(readOrderPriceScale(chart),{pane,scale,range:{from:1.09,to:1.12}})
  assert.equal(readOrderPriceScale({getPanes:() => []}),null)
  assert.equal(readOrderPriceScale({getPanes:() => {throw new Error('Chart removed')}}),null)
})
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
  assert.equal(orderLabel(levels, 'target', 1.12, 'dark', s => s).text, 'TP → +$240.00')
  assert.equal(orderLabel(levels, 'entry', 1.1, 'dark', s => s).text, 'BUY → −$3.12')
  assert.equal(orderLabel(levels, 'entry', 1.1, 'dark', s => s).textColor, '#FF603B', 'Buy uses orange text independently of its white entry line')
  assert.equal(orderLabel({ ...levels, side: 'SELL', floating: '3.12' }, 'entry', 1.1, 'dark', s => s).textColor, '#FF603B', 'Both sides use orange text independently of their line colors')
  assert.equal(orderLabel(levels, 'entry', 1.1, 'light', s => s).color, '#087D50')
  assert.equal(orderLabel({ ...levels, side: 'SELL' }, 'entry', 1.1, 'light', s => s).color, '#B54718')
  assert.equal(orderLabel({ ...levels, side: 'SELL' }, 'stop', 1.11, 'dark', s => s).text, 'SL → −$120.00')
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
    assert.match(label.detail, / → \$0.00$/)
    const moved = orderLabel(atEntry, kind, levels.entry + .00001, 'dark', s => s)
    assert.equal(moved.compact, false)
    assert.match(moved.text, / → [−+]\$0.12$/)
    const tiny = orderLabel(atEntry, kind, levels.entry + .00000001, 'dark', s => s)
    assert.equal(tiny.compact, false, 'Rounding to 0.00 must not turn a distinct price into a compact handle')
  }
  const entry = orderLabel({ ...levels, floating: '0' }, 'entry', levels.entry, 'dark', s => s)
  assert.equal(entry.text, 'BUY → $0.00')
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

test('unaccepted submissions stay off chart and authoritative execution wins when it arrives', () => {
  const replay = { view_cursor_index: 4, visible_rows: [{ close: 1.1 }], payload: { cursor_index: 4, execution: null } }
  const pending = { entry: 1.1001, side: 'SELL', quantity: '.12', stop_loss: null, take_profit: null }
  const submitting = orderLevels(replay, { side: 'BUY' }, null, null, null, pending)
  assert.equal(submitting,null)
  replay.payload.execution = { cursor_index: 4, instrument_spec: { tick_size: '.0001' }, spread_price: '.0002', position: { side: 'BUY', entry_fill: '1.102', quantity: '.2' } }
  const confirmed = orderLevels(replay, { side: 'SELL' }, null, null, null, pending)
  assert.equal(confirmed.state, 'position')
  assert.equal(confirmed.entry, 1.102)
  assert.equal(confirmed.side, 'BUY')
})


test('accepted partial targets expose separate marker identities and per-slice profit', () => {
  const replay={view_cursor_index:0,visible_rows:[{close:1.1}],payload:{cursor_index:0,execution:{cursor_index:0,spread_price:'0',instrument_spec:{tick_size:'.0001',contract_size:'100000',account_ccy:'USD',quote_ccy:'USD'},cost_model:{account_ccy:'USD',quote_to_account_rate:'1'},position:{side:'BUY',entry_fill:'1.1',quantity:'.04',take_profit:'1.101',take_profits:[{target_id:'a',price:'1.101',quantity:'.02'},{target_id:'b',price:'1.102',quantity:'.02'}]}}}}
  const levels=orderLevels(replay,{side:'BUY'})
  assert.equal(levels['target:a'],1.101)
  assert.equal(levels['target:b'],1.102)
  const label=orderLabel(levels,'target:b',1.102,'dark',text=>text)
  assert.match(label.text,/TP2.*\$4.00/)
  assert.equal(label.ghost,false)
  assert.match(protectionError(levels,'target:b',1.1005),/gần đến xa/)
})
