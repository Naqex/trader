import test from 'node:test'
import assert from 'node:assert/strict'
import {tagAnalysis,tagCurves,tagColorValue} from '../src/tagAnalysisModel.js'

const deal=(ticket,tags,profit,time_msc=ticket)=>({ticket,tags,profit,commission:0,swap:0,fee:0,time_msc})
const catalog={groups:[{id:'rating',name:'Rating'},{id:'setup',name:'Setup'}],items:[{name:'Good',color:'green',group_id:'rating'},{name:'Bad',color:'red',group_id:'rating'},{name:'Breakout',color:'orange',group_id:'setup'}]}

test('Overall and group totals count overlapping tag assignments once',()=>{
  const result=tagAnalysis([deal(1,['Good','Good','Bad','Breakout'],10),deal(2,['Bad'],-3),deal(3,[],100)],catalog)
  assert.equal(result.overall.count,2);assert.equal(result.overall.net,7)
  assert.equal(result.groups.find(group=>group.id==='rating').count,2)
  assert.equal(result.groups.find(group=>group.id==='rating').net,7)
  assert.equal(result.tags.find(tag=>tag.name==='Good').count,1)
  assert.equal(result.tags.find(tag=>tag.name==='Bad').net,7)
})
test('historical unknown tags stay in Ungrouped and missing financial facts stay unknown',()=>{
  const result=tagAnalysis([deal(1,['Old'],null)],catalog)
  assert.equal(result.groups.find(group=>group.id==='').children[0].name,'Old')
  assert.equal(result.overall.net,null);assert.equal(result.overall.winRate,null)
  assert.equal(result.tags.find(tag=>tag.name==='Good').winRate,null)
})
test('selected curves share the same actual timeline and do not change Overall',()=>{
  const result=tagCurves([deal(2,['Bad'],-3),deal(1,['Good'],10)],['Good','Bad'])
  assert.deepEqual(result.timestamps,[1,2])
  assert.deepEqual(result.series.map(series=>series.map(point=>point.value)),[[10,7],[10,10],[0,-3]])
  assert.deepEqual(tagCurves([deal(1,['Good'],null),deal(2,['Bad'],2)],['Good']).series.map(series=>series.map(point=>point.value)),[[null,null],[null,null]])
  assert.deepEqual(tagCurves([deal(1,['Good'],1,NaN)],[]).series,[[]])
})
test('all catalog colors resolve to the existing label tokens',()=>{
  assert.equal(tagColorValue('green'),'var(--report-positive)')
  assert.equal(tagColorValue('orange'),'var(--report-peach)')
  assert.equal(tagColorValue('red'),'var(--report-negative)')
  assert.equal(tagColorValue('unknown'),'var(--project-muted)')
})
