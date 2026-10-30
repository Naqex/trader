import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutosave } from '../src/autosave.js'

const storage = () => { const values=new Map();return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)} }
const tick=()=>new Promise(resolve=>setTimeout(resolve,15))
function setup({save,load,store=storage(),key='a'}={}) {
  let value='',revision=0
  const writes=[]
  const controller=createAutosave({key,storage:store,delay:5,initialValue:'',adapter:{
    load:load || (async()=>({value,record:revision ? {revision} : null,savedAt:revision ? '2026-10-30T04:00:00Z' : null})),
    validate:value=>!value.trim() ? 'empty' : null,
    save:async(v,record)=>{writes.push([v,record]);if(save)return save(v,record);value=v;return {value,record:{revision:++revision},savedAt:'2026-10-30T04:00:00Z'}},
  }})
  return {controller,writes,store}
}

test('coalesces typing and only shows saved after server confirmation',async()=>{
  let resolve
  const {controller:c,writes}=setup({save:value=>new Promise(done=>{resolve=()=>done({value,record:{revision:1},savedAt:'2026-10-30T04:00:00Z'})})})
  await c.start();c.change('first');c.change('final');await tick()
  assert.equal(writes.length,1);assert.equal(writes[0][0],'final');assert.equal(c.getSnapshot().phase,'saving');assert.equal(c.getSnapshot().savedAt,null)
  resolve();await tick();assert.equal(c.getSnapshot().phase,'saved');c.dispose()
})

test('serializes trailing edits and close flush waits for the newest value',async()=>{
  let release
  const {controller:c,writes}=setup({save:async(value,record)=>{if(!record)await new Promise(resolve=>{release=resolve});return {value,record:{revision:(record?.revision || 0)+1},savedAt:'2026-10-30T04:00:00Z'}}})
  await c.start();c.change('A');const first=c.flush();await Promise.resolve();c.change('B');const close=c.flush();release();await first;assert.equal(await close,true)
  assert.deepEqual(writes.map(([value,record])=>[value,record?.revision]),[['A',undefined],['B',1]]);assert.equal(c.getSnapshot().value,'B');c.dispose()
})

test('close starts the write and drains typing that arrives during that write',async()=>{
  let release
  const {controller:c,writes}=setup({save:async(value,record)=>{if(!record)await new Promise(resolve=>{release=resolve});return {value,record:{revision:(record?.revision || 0)+1},savedAt:'2026-10-30T04:00:00Z'}}})
  await c.start();c.change('A');const close=c.flush({drain:true});await Promise.resolve();c.change('B');release();assert.equal(await close,true)
  assert.deepEqual(writes.map(([value])=>value),['A','B']);c.dispose()
})

test('expired unknown attempts cannot create a duplicate record',async()=>{
  const store=storage();store.setItem('naqex-draft-v1:a',JSON.stringify({value:'mine',base:'',attempt:{value:'mine',record:null,startedAt:Date.now()-25*60*60*1000}}))
  const {controller:c,writes}=setup({store});await c.start();await c.retry();assert.equal(c.getSnapshot().phase,'conflict');assert.equal(writes.length,0);c.dispose()
})

test('unknown outcome retries the exact snapshot before newer edits',async()=>{
  let attempts=0
  const {controller:c,writes}=setup({save:async(value,record)=>{if(++attempts===1)throw Object.assign(new Error('lost response'),{outcomeKnown:false});return {value,record:{revision:(record?.revision || 0)+1},savedAt:'2026-10-30T04:00:00Z'}}})
  await c.start();c.change('A');await c.flush();c.change('B');assert.equal(c.getSnapshot().phase,'error');await c.retry();await c.flush()
  assert.deepEqual(writes.map(([value])=>value),['A','A','B']);assert.equal(c.getSnapshot().phase,'saved');c.dispose()
})

test('close cannot succeed after reverting to the baseline while a write is unconfirmed',async()=>{
  let reject
  const {controller:c}=setup({load:async()=>({value:'old',record:{revision:1},savedAt:'2026-10-30T04:00:00Z'}),save:()=>new Promise((resolve,fail)=>{reject=fail})})
  await c.start();c.change('new');const first=c.flush();await Promise.resolve();c.change('old');const close=c.flush({drain:true})
  reject(Object.assign(new Error('lost response'),{outcomeKnown:false}));await first
  assert.equal(await close,false);assert.equal(c.getSnapshot().phase,'error');assert.equal(c.isDirty(),true);c.dispose()
})

test('conflict preserves local draft and never overwrites the newer revision',async()=>{
  const {controller:c,writes,store}=setup({save:async()=>{throw Object.assign(new Error('conflict'),{status:409})}})
  await c.start();c.change('my draft');await c.flush();assert.equal(c.getSnapshot().phase,'conflict');assert.equal(await c.flush(),false);assert.equal(writes.length,1)
  assert.equal(JSON.parse(store.getItem('naqex-draft-v1:a')).value,'my draft');c.dispose()
})

test('reload recovers unsaved text without silently replacing changed server text',async()=>{
  const store=storage();store.setItem('naqex-draft-v1:a',JSON.stringify({value:'mine',base:'old',record:{revision:1}}))
  const {controller:c,writes}=setup({store,load:async()=>({value:'theirs',record:{revision:2},savedAt:'2026-10-30T04:00:00Z'})})
  await c.start();assert.equal(c.getSnapshot().value,'mine');assert.equal(c.getSnapshot().phase,'conflict');assert.equal(writes.length,0)
  await c.discardAndReload();assert.equal(c.getSnapshot().value,'theirs');assert.equal(c.getSnapshot().phase,'saved');assert.equal(store.getItem('naqex-draft-v1:a'),undefined);c.dispose()
})

test('empty edits stay unsaved, read errors cannot create records, storage failure is explicit',async()=>{
  const {controller:c,writes}=setup();await c.start();c.change('saved');await c.flush();c.change('');assert.equal(await c.flush(),false);assert.equal(c.getSnapshot().phase,'invalid');assert.equal(writes.length,1);c.dispose()
  const {controller:bad,writes:blocked}=setup({load:async()=>{throw new Error('denied')}});await bad.start();bad.change('text');assert.equal(bad.getSnapshot().value,'');assert.equal(blocked.length,0);bad.dispose()
  const {controller:noStorage}=setup({store:{getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}}});await noStorage.start();noStorage.change('draft');assert.equal(noStorage.getSnapshot().localBackup,false);await noStorage.flush();noStorage.dispose()
})
