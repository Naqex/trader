import test from 'node:test'
import assert from 'node:assert/strict'
import { canSyncMt5Connection, syncMt5Connections, mt5Request } from '../src/mt5Connections.js'

test('bulk sync skips paused, revoked and already queued connections; continues after failure',async()=>{
  const connections=['connected','paused','error','queued','syncing','disconnected','connected'].map((status,id)=>({id:String(id),status}))
  assert.deepEqual(connections.filter(canSyncMt5Connection).map(item=>item.id),['0','2','6'])
  const calls=[], error=new Error('unavailable')
  let active=0
  const failures=await syncMt5Connections('tenant-a',connections,async(workspace,path)=>{
    assert.equal(workspace,'tenant-a');assert.equal(active++,0)
    calls.push(path);await Promise.resolve();active--
    if(path==='/2/sync')throw error
    return {id:path.split('/')[1]}
  })
  assert.deepEqual(calls,['/0/sync','/2/sync','/6/sync'])
  assert.deepEqual(failures,[{connection:connections[2],error}])
  assert.deepEqual(await syncMt5Connections('tenant-a',[]),[])
})

test('connector writes distinguish definitive rejection from uncertain server outcomes',async t=>{
  for(const [status,uncertain] of [[409,false],[423,false],[500,true],[503,true],[408,true]]) {
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({detail:'mt5_reconciliation_required'}),{status,headers:{'Content-Type':'application/json'}}))
    await assert.rejects(mt5Request('fixture','/fixture/remove'),error=>error.uncertain===uncertain)
    t.mock.restoreAll()
  }
})
