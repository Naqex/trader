import test from 'node:test'
import assert from 'node:assert/strict'
import { removeLiveAccounts } from '../src/liveAccountActions.js'

const rows=[{id:'manual'},{id:'mt5'},{id:'last'}]
test('bulk removal excludes completed writes from retry after a known failure',async()=>{
  const removed=[], calls=[]
  const failure=new Error('revision conflict')
  const result=await removeLiveAccounts(rows,async row=>{calls.push(row.id);if(row.id==='mt5')throw failure},row=>removed.push(row.id))
  assert.deepEqual(calls,['manual','mt5','last'])
  assert.deepEqual(removed,['manual','last'])
  assert.deepEqual(result,{failures:[{row:rows[1],error:failure}],remaining:[rows[1]],uncertain:false})
})
test('ambiguous removal stops later writes and retains unresolved targets',async()=>{
  for(const flag of [{uncertain:true},{outcomeKnown:false}]) {
    const removed=[],calls=[],failure=Object.assign(new Error('unknown outcome'),flag)
    const result=await removeLiveAccounts(rows,async row=>{calls.push(row.id);if(row.id==='mt5')throw failure},row=>removed.push(row.id))
    assert.deepEqual(calls,['manual','mt5'])
    assert.deepEqual(removed,['manual'])
    assert.deepEqual(result.remaining,[rows[1],rows[2]])
    assert.equal(result.uncertain,true)
  }
})
