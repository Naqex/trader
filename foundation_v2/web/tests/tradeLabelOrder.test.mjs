import test from 'node:test'
import assert from 'node:assert/strict'
import { orderedLabels, moveLabelIds } from '../src/useTradeLabelOrder.js'
const items = ['a','b','c','d'].map(id=>({id,name:id}))
test('Saved display order drops missing/duplicate IDs and appends newly created labels',()=>{
  assert.deepEqual(orderedLabels(items,['c','removed','c','a']).map(item=>item.id),['c','a','b','d'])
  assert.deepEqual(orderedLabels(items,[]),items)
})
test('Move before/after works in both directions without changing label definitions',()=>{
  assert.deepEqual(moveLabelIds(items,'a','c',false),['b','c','a','d'])
  assert.deepEqual(moveLabelIds(items,'d','a',true),['d','a','b','c'])
  assert.deepEqual(moveLabelIds(items,'b','c',true),['a','b','c','d'])
  assert.deepEqual(moveLabelIds(items,'absent','b',true),['a','b','c','d'])
  assert.deepEqual(moveLabelIds(items,'a','a',false),['a','b','c','d'])
  assert.equal(items[0].name,'a')
})
