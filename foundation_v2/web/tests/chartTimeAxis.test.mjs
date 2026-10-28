import test from 'node:test'
import assert from 'node:assert/strict'
import {timeCurveCoordinates,presetTimeRange,timeAxisTicks} from '../src/chartTimeAxis.js'
const ms=Date.parse
test('elapsed positions preserve duplicates, reject invalid time and never reorder',()=>{
  const times=['2026-01-01','2026-01-01','2026-01-03']
  const c=timeCurveCoordinates(times,3)
  assert.deepEqual(c.positions,[0,0,1]);assert.deepEqual(times,['2026-01-01','2026-01-01','2026-01-03'])
  for(const values of [[null,1],['','2026-01-01'],[2,1]])assert.equal(timeCurveCoordinates(values,2),null)
  assert.equal(timeCurveCoordinates([1],2),null)
})
test('trailing presets retain full observation domain and single-instant safety',()=>{
  const c=timeCurveCoordinates(['2026-01-01','2026-01-03'],2),span=c.max-c.min
  for(const [key,duration] of [['day',86400000],['hour',3600000],['quarter',900000]]){
    const [start,end]=presetTimeRange(key,c);assert.equal(end,1);assert.ok(Math.abs((end-start)*span-duration)<.001)
  }
  assert.deepEqual(presetTimeRange('all',c),[0,1])
  for(const key of ['day','hour','quarter'])assert.deepEqual(presetTimeRange(key,timeCurveCoordinates(['2026-01-01'],1)),[0,1])
})
test('responsive ticks remain inside bounds and do not overlap at date/year/second scales',()=>{
  for(const [from,to] of [['2003-01-01','2026-01-01'],['2025-12-25','2026-01-15'],['2026-01-01T00:00:00Z','2026-01-01T01:00:00Z'],['2026-01-01T00:00:00Z','2026-01-01T00:00:01Z']])for(const width of [220,350,1200]){
    const result=timeAxisTicks(ms(from),ms(to),width)
    assert.ok(result.ticks.length>=2)
    for(const [i,tick] of result.ticks.entries()){
      assert.ok(tick.position>=0&&tick.position<=1)
      if(tick.left!==undefined){assert.ok(tick.left>=0&&tick.right<=width+.001);if(i)assert.ok(tick.left-result.ticks[i-1].right>=20)}
    }
  }
})
test('subsecond and civil date context survive zoom; year ticks remain meaningful',()=>{
  const start=ms('2026-01-01T00:00:00Z'),result=timeAxisTicks(start,start+1000,1200)
  assert.equal(result.step,500);assert.ok(result.ticks.some(t=>t.label.endsWith('.500')));assert.equal(result.context,'01/01/2026')
  const years=timeAxisTicks(ms('2000-01-01'),ms('2026-01-01'),1200)
  assert.ok(years.ticks.every(t=>/^\d{4}$/.test(t.label)))
})
test('unaligned narrow intraday windows keep clocks and civil date context',()=>{
  for(const width of [220,300]){
    const result=timeAxisTicks(ms('2026-05-01T10:03:00Z'),ms('2026-05-01T10:18:00Z'),width)
    assert.ok(result.ticks.length>=2);assert.ok(result.ticks.every(t=>t.label.includes(':')));assert.equal(result.context,'01/05/2026')
  }
})
test('civil day ticks follow DST and duplicate intraday wall labels are disambiguated',()=>{
  const result=timeAxisTicks(ms('2026-03-06'),ms('2026-03-12'),1200,{timeZone:'America/New_York'})
  const dates=result.ticks.map(t=>new Date(t.time).toISOString());assert.ok(dates.some(t=>t.includes('T05:00:00')));assert.ok(dates.some(t=>t.includes('T04:00:00')))
  const fold=timeAxisTicks(ms('2026-11-01T04:00:00Z'),ms('2026-11-01T08:00:00Z'),1200,{timeZone:'America/New_York'})
  assert.equal(new Set(fold.ticks.map(t=>t.label)).size,fold.ticks.length)
  const narrow=timeAxisTicks(ms('2026-11-01T05:03:00Z'),ms('2026-11-01T06:03:00Z'),220,{timeZone:'America/New_York'})
  assert.equal(new Set(narrow.ticks.map(t=>t.label)).size,narrow.ticks.length);assert.ok(narrow.ticks.every(t=>t.label.includes('GMT')))
})
