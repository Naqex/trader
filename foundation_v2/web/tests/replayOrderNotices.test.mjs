import test from 'node:test'
import assert from 'node:assert/strict'
import { closeNotice, protectionNotice } from '../src/replayOrderNotices.js'
import { protectionError } from '../src/replayOrderLabels.js'

test('TP and SL distinguish adding, moving and removing from persisted state', () => {
  for (const [kind, saved, input, label] of [['target', 'take_profit', 'takeProfit', 'Take profit'], ['stop', 'stop_loss', 'stopLoss', 'Stop loss']]) {
    const draft = { [input]: '1.07065' }
    assert.deepEqual(protectionNotice({}, draft, '.00001', kind), { kind: 'ok', title: 'Order Added', message: `${label} added!` })
    assert.deepEqual(protectionNotice({ [saved]: '1.07' }, draft, '.00001', kind), { kind: 'ok', title: 'Position Updated', message: `${label} moved to {price}!`, values: { price: '1.07065' } })
    assert.equal(protectionNotice({ [saved]: '1.07' }, { [input]: '' }, '.00001', kind).message, `${label} removed!`)
    assert.equal(protectionNotice({}, draft, '.00001').title, 'Order Added', 'dialog submit uses the same state comparison')
  }
  assert.equal(protectionNotice({ stop_loss: '1', take_profit: '3' }, { stopLoss: '1.1', takeProfit: '3.1' }, '.1').message, 'TP/SL updated.')
  assert.equal(protectionNotice({ take_profit: '1' }, { takeProfit: '1.25' }, '.25', 'target').values.price, '1.25')
})

test('direction errors name the exact field and use current closeable price, including equality', () => {
  for (const side of ['BUY', 'SELL']) for (const kind of ['stop', 'target']) {
    const lower = side === 'BUY' ? kind === 'stop' : kind === 'target'
    const levels = { side, entry: 1, reference: 2 }
    const expected = `${kind === 'stop' ? 'Stop Loss' : 'Take Profit'} price must be ${lower ? 'lower' : 'higher'} than the current price`
    assert.equal(protectionError(levels, kind, 2), expected)
    assert.equal(protectionError(levels, kind, lower ? 2.1 : 1.9), expected)
    assert.equal(protectionError(levels, kind, lower ? 1.9 : 2.1), '')
  }
})

test('close notifications use the matching server fill, original side and remaining position', () => {
  for (const side of ['BUY', 'SELL']) {
    const position = { side, quantity: '0.1', entry_fill: '1.07098' }
    const event = { kind: 'manual_close', details: { command_operation_id: 'close-1', fill_price: '1.07124', closed_position: { ...position, quantity: '0.02' } } }
    const next = { position: { ...position, quantity: '0.08' }, ledger: [event] }
    const partial = closeNotice({ position }, next, 'close-1', 'EUR/USD').order
    assert.equal(partial.status, 'partial_closed')
    assert.equal(partial.side, side, 'closing a Buy retains the Buy label, rather than the opposite execution side')
    assert.equal(partial.quantity, '0.02')
    assert.equal(partial.price, '1.07124', 'the close fill is not the entry price')
    assert.equal(partial.values.entryPrice, '1.07098')
    assert.equal(partial.values.remainingQuantity, '0.08')
    const full = closeNotice({ position }, { position: null, ledger: [event] }, 'close-1', 'EUR/USD').order
    assert.equal(full.status, 'closed')
    assert.match(full.detail, /now flat/)
    assert.equal(closeNotice({ position }, next, 'wrong-operation', 'EUR/USD').order, undefined, 'unrelated fills cannot supply receipt details')
  }
})

test('cancelling an unfilled order never invents a close price or flat-position receipt', () => {
  const pending_market_order = { operation_id: 'queued', side: 'SELL', quantity: '0.1' }
  const notice = closeNotice({ pending_market_order }, { position: null, ledger: [{ kind: 'order_cancel', details: { command_operation_id: 'cancel-1', cancelled_order: pending_market_order } }] }, 'cancel-1', 'XAU/USD')
  assert.equal(notice.order.status, 'cancelled')
  assert.equal(notice.order.price, null)
  assert.equal(notice.order.detail, undefined)
  assert.equal(closeNotice({ position: {} }, { position: null, ledger: [] }, 'close-2', 'EUR/USD').text, 'Đã đóng vị thế.')
})
