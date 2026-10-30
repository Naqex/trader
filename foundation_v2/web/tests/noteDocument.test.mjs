import assert from 'node:assert/strict'
import test from 'node:test'
import { documentError, documentText, noteDocument, readNoteValue } from '../src/noteDocument.js'
import { tradeNoteAdapter } from '../src/tradeNoteApi.js'
import { createAutosave } from '../src/autosave.js'

test('rich note retains structure while producing ordinary searchable text',()=>{
  const blocks=[{type:'heading',content:[{type:'text',text:'Plan',styles:{bold:true}}]},
    {type:'checkListItem',props:{checked:true},content:[{type:'text',text:'Risk checked'}]},
    {type:'table',content:{type:'tableContent',rows:[{cells:[[{type:'text',text:'EUR/USD'}],[{type:'text',text:'2R'}]]}]}},
    {type:'image',props:{url:'https://example.com/chart.png'}}]
  const text='Plan\nRisk checked\nEUR/USD\t2R\nhttps://example.com/chart.png'
  assert.equal(documentText(blocks),text)
  const document=noteDocument(blocks)
  assert.deepEqual(readNoteValue({note:text,note_document:document}),{text,document})
  assert.deepEqual(readNoteValue({note:'Old plain note'}),{text:'Old plain note',document:null})
  assert.throws(()=>readNoteValue({note:'Different content',note_document:document}),/không khớp/)
  assert(documentError({format:'other',version:1,blocks}))
  assert(documentError(noteDocument([{type:'unsupported'}])))
})

test('old recovery and in-flight request upgrade without changing original retry body',async()=>{
  const adapter=tradeNoteAdapter({workspace:'qa',session:'s',trade:'t',structured:true})
  const old={value:'Latest local edit',base:'Saved before',record:null,attempt:{value:'Request in flight',record:null,startedAt:Date.now()}}
  const recovery=adapter.migrateRecovery(old)
  assert.deepEqual(recovery.value,{text:'Latest local edit',document:null})
  assert.deepEqual(recovery.base,{text:'Saved before',document:null})
  assert.deepEqual(recovery.attempt.value,{text:'Request in flight',document:null})
  assert.equal(recovery.attempt.legacyPlain,true)
  const originalFetch=globalThis.fetch
  let submitted
  globalThis.fetch=async(path,options)=>{
    submitted=JSON.parse(options.body)
    return Response.json({record_id:'legacy',revision:1,payload:submitted,updated_at_utc:'2026-10-30T00:00:00Z'})
  }
  try {
    await adapter.save(recovery.attempt.value,null,recovery.attempt)
    assert.deepEqual(submitted,{entry_type:'observation',note:'Request in flight',tags:[],source:{kind:'trade-note',id:'["s","t"]',session_id:'s',trade_id:'t'}})
    assert.equal(Object.hasOwn(submitted,'note_document'),false)
  } finally {globalThis.fetch=originalFetch}
})

test('reordered JSON save response does not dirty or reset a rich draft',async()=>{
  const document=noteDocument([{id:'b',type:'paragraph',content:[{type:'text',text:'Plan',styles:{bold:true,italic:false}}],props:{textColor:'default',backgroundColor:'default'},children:[]}])
  const value={text:'Plan',document}, reordered=JSON.parse(JSON.stringify(value),function(key,item){return item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.entries(item).reverse()):item})
  let writes=0
  const controller=createAutosave({key:'rich',initialValue:{text:'',document:null},storage:null,adapter:{load:async()=>({value:{text:'',document:null},record:null}),save:async()=>{writes++;return {value:reordered,record:{revision:1},savedAt:'2026-10-30T00:00:00Z'}}}})
  await controller.start();controller.change(value);assert.equal(await controller.flush(),true)
  controller.change(value)
  assert.equal(controller.getSnapshot().phase,'saved');assert.equal(controller.isDirty(),false)
  await controller.flush();assert.equal(writes,1);await controller.dispose()
})
