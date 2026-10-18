import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quickSessionErrors } from '../src/quickSessionValidation.js'

const fixture = () => ({ draft: { name:'Practice', balance:'10000', datasets:['local'] }, mode:'prop', propDraft:{ targetPercent:'10', dailyLoss:'500', overallLoss:'1000' }, selectedAssets:[{ dataset_id:'local', instrument_spec:{ account_ccy:'USD' } }], period:{ valid:true }, dataStatus:'ready', addingStrategy:false })

test('a valid draft has no client errors; whitespace, NaN and unavailable selections are blocked', () => {
  assert.deepEqual(quickSessionErrors(fixture()), {})
  const input = fixture()
  input.draft = { name:'  ', balance:'Infinity', datasets:['missing'] }
  input.selectedAssets = []
  assert.deepEqual(Object.keys(quickSessionErrors(input)), ['name','balance','assets'])
})
test('loaded selection must have a shared currency and a valid replay range', () => {
  const input = fixture()
  input.draft.datasets.push('eur')
  input.selectedAssets.push({ dataset_id:'eur', instrument_spec:{ account_ccy:'EUR' } })
  input.period.valid = false
  assert.deepEqual(Object.keys(quickSessionErrors(input)), ['assets','period'])
})
test('prop-only errors do not leak into backtest after switching tabs', () => {
  const input = fixture()
  input.propDraft = { targetPercent:'', dailyLoss:'0', overallLoss:'-1' }
  assert.deepEqual(Object.keys(quickSessionErrors(input)), ['targetPercent','dailyLoss','overallLoss'])
  input.mode = 'backtest'
  assert.deepEqual(quickSessionErrors(input), {})
})
test('positive values below the displayed field minimum are blocked', () => {
  const input = fixture()
  input.propDraft = { targetPercent:'0.01', dailyLoss:'0.99', overallLoss:'0.5' }
  assert.equal(Object.keys(quickSessionErrors(input)).length, 3)
})
test('catalog loading/error and unfinished strategy creation explain why submission is blocked', () => {
  for (const dataStatus of ['loading','error']) {
    const input = { ...fixture(), dataStatus, addingStrategy:true }
    assert.deepEqual(Object.keys(quickSessionErrors(input)), ['assets','strategy'])
  }
})
test('asset cap is enforced separately from availability', () => {
  const input = fixture()
  input.mode = 'backtest'
  input.draft.datasets = Array.from({length:13}, (_, i) => `local-${i}`)
  input.selectedAssets = input.draft.datasets.map(dataset_id => ({ dataset_id }))
  assert.match(quickSessionErrors(input).assets, /12/)
})

test('both modes preserve and accept a multiasset draft with a shared currency', () => {
  const input = fixture()
  input.draft.datasets.push('other')
  input.selectedAssets.push({ dataset_id:'other', instrument_spec:{ account_ccy:'USD' } })
  input.mode = 'backtest'
  assert.deepEqual(quickSessionErrors(input), {})
  input.mode = 'prop'
  assert.deepEqual(quickSessionErrors(input), {})
  assert.deepEqual(input.draft.datasets, ['local', 'other'], 'validation never silently discards a selection')
  input.draft.datasets.push('other')
  input.selectedAssets.push(input.selectedAssets[1])
  assert.match(quickSessionErrors(input).assets, /một lần/)
})
