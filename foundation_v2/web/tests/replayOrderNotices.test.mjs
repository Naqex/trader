import test from 'node:test'
import assert from 'node:assert/strict'
import { protectionNotice } from '../src/replayOrderNotices.js'
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
