import assert from 'node:assert/strict'
import test from 'node:test'
import {createAutosave} from '../src/autosave.js'
import {migrateReviewRecovery,reviewSummary,reviewTradeRows,inReviewRange,noteTradeLink} from '../src/liveReviewNoteModel.js'

test('summary uses whole lifecycles, keeps account identity, unknown/stale/mixed currency',()=>{
 const fill=(ticket,position_id,type,entry,profit)=>({ticket,position_id,type,entry,profit,commission:-.1,swap:0,fee:0,symbol:'EURUSD',volume:.1,price:1.1,time_msc:Date.parse('2026-10-30T01:00:00Z')+entry*3600000})
 const source=(id,currency='USD',stale=false)=>({id,payload:{account:{currency},stale,positions:[],deals:[fill(1,123,0,0,0),fill(2,123,1,1,2)]}})
 const rows=reviewTradeRows([source('broker:a'),source('broker:b','EUR')],new Map())
 assert.equal(rows.length,2);assert.equal(rows[0].net,1.8)
 const links=rows.map(noteTradeLink)
 assert.equal(reviewSummary(links,rows).net,null);assert.equal(reviewSummary(links,rows).winRate,100)
 assert.equal(reviewSummary([links[0]],rows).net,1.8)
 assert.equal(reviewSummary(links,rows.slice(0,1)).missing,1)
 assert.equal(reviewSummary(links,rows.slice(0,1)).winRate,null)
 assert.equal(reviewSummary([links[0]],[{...rows[0],stale:true}]).net,null)
 assert.equal(reviewSummary([links[0]],[{...rows[0],net:null}]).winRate,null)
 assert.equal(reviewSummary([],[]).net,null)
 assert.equal(inReviewRange({time_msc:Date.parse('2026-10-29T20:00:00Z')},'2026-10-30','2026-10-30','Asia/Ho_Chi_Minh'),true)
})

test('legacy recovery migrates all local snapshots while preserving unresolved wire body',async()=>{
 const old={title:'Legacy',note:'Old body',tags:[],account_id:null,connection_id:null,playbook_id:null,playbook_revision:null}
 const defaults={...old,note_document:null,note_type:'general',linked_trades:[],review_from:'2026-10-30',review_to:'2026-10-30',review_timezone:'UTC'}
 const attempt={value:{...old,note:'Pending'},record:{record_id:'n',revision:1},startedAt:Date.now()}
 const recovered={value:{...old,note:'Later edit'},base:old,attempt,record:attempt.record}
 const migration=migrateReviewRecovery(recovered,defaults)
 assert.deepEqual(migration.attempt.legacyPayload,attempt.value)
 assert.deepEqual(migration.base,defaults)
 const storage={getItem:()=>JSON.stringify(recovered),setItem(){},removeItem(){}}
 const received=[]
 const controller=createAutosave({key:'legacy',initialValue:defaults,storage,delay:999999,adapter:{migrateRecovery:r=>migrateReviewRecovery(r,defaults),load:async()=>({value:defaults,record:attempt.record}),save:async(value,record,submitted)=>{received.push(submitted.legacyPayload || value);return {value,record:{...record,revision:2}}}}})
 assert.deepEqual(controller.getSnapshot().value.linked_trades,[])
 assert(await controller.start());assert.equal(controller.getSnapshot().phase,'dirty')
 assert(await controller.flush({drain:true}));assert.equal(controller.getSnapshot().value.note,'Later edit')
 // The first pending request is retried exactly, then the newer draft drains.
 assert.deepEqual(received[0],attempt.value);assert.equal(received[1].note,'Later edit')
 await controller.dispose()
})
