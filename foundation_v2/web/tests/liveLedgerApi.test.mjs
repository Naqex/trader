import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLiveRecords, saveLiveRecord } from '../src/liveLedgerApi.js'

test('manual record command retains account scope and optimistic revision',async()=>{
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (path,options) => { calls.push({path,options}); return Response.json({record_id:'saved',kind:'note',revision:3,payload:{title:'QA'}}) }
  try {
    const result=await saveLiveRecord('tenant-fixture','note',{title:'QA'},{record_id:'saved',revision:2})
    assert.equal(result.revision,3);assert.equal(calls[0].path,'/api/v2/live/records/saved/revisions')
    assert.deepEqual(JSON.parse(calls[0].options.body),{kind:'note',payload:{title:'QA'},expected_revision:2})
    assert.equal(new Headers(calls[0].options.headers).get('X-Workspace-Id'),'tenant-fixture')
    assert.ok(new Headers(calls[0].options.headers).get('Idempotency-Key'))
  } finally {globalThis.fetch=original}
})
test('successful HTTP without trustworthy write result remains uncertain',async()=>{
  const original=globalThis.fetch
  try {
    globalThis.fetch=async()=>new Response('{broken',{status:201})
    await assert.rejects(saveLiveRecord('tenant-fixture','note',{title:'unique-QA'}),error=>error.outcomeKnown===false)
  } finally {globalThis.fetch=original}
})
test('denied read is distinct from a valid empty workspace ledger',async()=>{
  const original=globalThis.fetch
  try {
    globalThis.fetch=async()=>Response.json({version:'live-records-v1',items:[]})
    assert.deepEqual(await fetchLiveRecords('empty-fixture'),[])
    globalThis.fetch=async()=>new Response('{}',{status:403})
    await assert.rejects(fetchLiveRecords('denied-fixture'),error=>error.status===403)
  } finally {globalThis.fetch=original}
})
test('proxy/server errors cannot authorize a duplicate journal write',async()=>{
  const original=globalThis.fetch
  try {
    globalThis.fetch=async()=>new Response('gateway failure',{status:502})
    await assert.rejects(saveLiveRecord('tenant-fixture','note',{title:'gateway-QA'}),error=>error.outcomeKnown===false)
    globalThis.fetch=async()=>Response.json({detail:'invalid_live_payload'},{status:422})
    await assert.rejects(saveLiveRecord('tenant-fixture','note',{title:'invalid-QA'}),error=>error.status===422 && error.outcomeKnown!==false)
  } finally {globalThis.fetch=original}
})
