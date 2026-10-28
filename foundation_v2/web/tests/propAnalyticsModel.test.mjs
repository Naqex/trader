import test from 'node:test'
import assert from 'node:assert/strict'
import { propObjectiveRows, propChartReferences } from '../src/propAnalyticsModel.js'

const snapshot = () => ({
  phase:{phase_index:1,initial_balance:'100000',evaluation_quality:'full_for_declared_model',virtual_time_utc:'2026-10-11T03:00:00Z'},
  attempt:{virtual_start_utc:'2026-10-01T00:00:00Z'},outcome:{status:'running',terminal:false},
  objectives:{schema:'prop-objectives-v1',phase_index:1,technical_status:'ready',money:{
    daily_loss:{reference:'110500',current:'108500',floor:'108500',breached:true},
    overall_drawdown:{kind:'trailing',reference:'113500',current:'108500',floor:'108500',breached:true},
    profit_target:{current:'108500',target:'108000',hit:true},
  },calendar:{qualifying_days:7,min_qualifying_days_satisfied:true,expired:false}},
})
const row = (report,key) => propObjectiveRows(report).find(row=>row.key===key)

test('chart thresholds use phase capital, including a positive trailing floor', () => {
  const report=snapshot(), lines=propChartReferences(report)
  assert.equal(lines.find(line=>line.key==='profit_target').value,8000)
  assert.equal(lines.find(line=>line.key==='overall_drawdown').value,8500)
  assert.equal(lines.find(line=>line.key==='overall_drawdown').dashed,true)
  report.objectives.money.overall_drawdown={kind:'static',reference:100000,current:100000,floor:90000,breached:false}
  const loss=propChartReferences(report).find(line=>line.key==='overall_drawdown')
  assert.equal(loss.value,-10000);assert.equal(loss.dashed,false)
  report.phase.phase_index=2;assert.deepEqual(propChartReferences(report),[])
})

test('chart thresholds reject invalid capital, overflow and unknown drawdown kind', () => {
  for(const initial of [null,0,-1,'']){const report=snapshot();report.phase.initial_balance=initial;assert.deepEqual(propChartReferences(report),[])}
  const report=snapshot();delete report.objectives.money.overall_drawdown.kind
  assert.equal(propChartReferences(report).some(line=>line.key==='overall_drawdown'),false)
  report.objectives.technical_status='blocked_by_data';assert.deepEqual(propChartReferences(report),[])
})

test('objective amounts use evaluator references, not absolute account balances', () => {
  const report = snapshot()
  const daily=row(report,'daily_loss'),overall=row(report,'overall_drawdown'),target=row(report,'profit_target')
  assert.equal(daily.value,-2000);assert.equal(daily.limit,-2000);assert.equal(daily.percent,-2000/110500*100);assert.equal(daily.state,'breached')
  assert.equal(overall.value,-5000);assert.equal(overall.limit,-5000);assert.equal(overall.percent,-5000/113500*100)
  assert.equal(target.value,8500);assert.equal(target.limit,8000);assert.equal(target.percent,8.5);assert.equal(target.state,'passed')
  assert.equal(report.outcome.status,'running','A target hit does not pass the challenge')
})

test('replay duration and qualifying days stay distinct', () => {
  const report=snapshot()
  assert.equal(row(report,'time').minutes,10*1440+3*60)
  assert.equal(row(report,'time').state,'pending')
  assert.equal(row(report,'days').days,7)
  report.phase.virtual_time_utc=null;assert.equal(row(report,'time').minutes,null)
  report.phase.virtual_time_utc='2026-09-30T00:00:00Z';assert.equal(row(report,'time').state,'unknown')
})

test('phase transitions and incomplete evaluation never reuse stale success flags', () => {
  for(const change of [r=>r.phase.phase_index=2,r=>r.objectives.technical_status='blocked_by_data',r=>r.phase.evaluation_quality='approximate',r=>r.objectives.schema='unknown']){
    const report=snapshot();change(report)
    for(const key of ['daily_loss','overall_drawdown','profit_target']){assert.equal(row(report,key).state,'unknown');assert.equal(row(report,key).value,null)}
    assert.equal(row(report,'days').state,'unknown');assert.equal(row(report,'days').days,null)
  }
})

test('arithmetic overflow stays unknown and missing calendar preserves the phase rule', () => {
  const report=snapshot()
  report.objectives.money.daily_loss={reference:1e308,current:-1e308,floor:1e307,breached:false}
  assert.equal(row(report,'daily_loss').state,'unknown');assert.equal(row(report,'daily_loss').percent,null)
  report.objectives.money.daily_loss={reference:1e-308,current:1e308,floor:0,breached:false}
  assert.equal(row(report,'daily_loss').state,'unknown')
  delete report.objectives.calendar;report.phase.qualifying_days=7
  assert.equal(row(report,'days').state,'unknown');assert.equal(row(report,'days').days,null)
})

test('missing values, invalid references and nonboolean flags stay unknown', () => {
  for(const value of [null,'',false,undefined,'not-a-number']){
    const report=snapshot();report.objectives.money.daily_loss.current=value
    assert.equal(row(report,'daily_loss').state,'unknown');assert.equal(row(report,'daily_loss').value,null)
  }
  for(const value of [0,-1,null]){const report=snapshot();report.objectives.money.daily_loss.reference=value;assert.equal(row(report,'daily_loss').state,'unknown')}
  for(const value of [undefined,'false',0]){const report=snapshot();report.objectives.money.profit_target.hit=value;assert.equal(row(report,'profit_target').state,'unknown')}
  const report=snapshot();report.objectives.money.daily_loss.breached=false;assert.equal(row(report,'daily_loss').state,'within')
})

test('elapsed duration uses the whole attempt across phases, target uses phase initial capital', () => {
  const report=snapshot();report.phase.phase_index=2;report.objectives.phase_index=2;report.phase.initial_balance='50000'
  report.objectives.money.profit_target={current:'52000',target:'52500',hit:false}
  assert.equal(row(report,'time').minutes,10*1440+180)
  assert.equal(row(report,'profit_target').value,2000);assert.equal(row(report,'profit_target').percent,4)
  report.outcome.terminal=true;assert.equal(row(report,'time').state,'finished')
})
