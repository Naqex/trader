import { dayBoundary, zonedDateKey } from './timezone.js'
import { displayDate } from './dateFormat.js'

const DAY = 86400000
const timeOffset = (time,timeZone) => new Intl.DateTimeFormat('en',{timeZone,timeZoneName:'shortOffset'}).formatToParts(time).find(part=>part.type==='timeZoneName').value
export function timeCurveCoordinates(timestamps, count) {
  const times = timestamps?.length === count ? timestamps.map(value => typeof value === 'number' || typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) < 1e11 ? Number(value)*1000 : Number(value) : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN) : []
  if(!times.length || !times.every((value,index)=>Number.isFinite(value)&&(!index||value>=times[index-1])))return null
  const first=times[0],last=times.at(-1)
  // A single observation needs viewing room, without inventing another trade.
  const min=last>first ? first : first-DAY/2,max=last>first ? last : last+DAY/2,span=max-min
  return {min,max,last,positions:times.map(value=>(value-min)/span),temporal:true,minimumSpan:Math.min(1,1000/span)}
}

export function presetTimeRange(preset, coordinates) {
  const duration={day:DAY,hour:3600000,quarter:900000}[preset]
  if(!duration||!coordinates||coordinates.positions.every(value=>value===coordinates.positions[0]))return [0,1]
  const {min,max,last}=coordinates,span=max-min,end=(last-min)/span
  return [Math.max(0,end-duration/span),end]
}

const STEPS=[500,1000,2000,5000,10000,15000,30000,60000,120000,300000,600000,900000,1800000,3600000,7200000,10800000,21600000,43200000].map(ms=>({ms}))
  .concat([1,2,7,14].map(days=>({days,ms:days*DAY})),[1,3,6].map(months=>({months,ms:months*30.4375*DAY})),[1,2,5,10,20,50,100].map(years=>({months:years*12,ms:years*365.25*DAY})))

function timeTicks(from,to,step,timeZone) {
  if(!step.days&&!step.months){
    // Align instants rather than inventing wall-clock times in DST gaps.
    const start=Math.ceil(from/step.ms)*step.ms
    return Array.from({length:Math.min(40,Math.max(0,Math.floor((to-start)/step.ms)+1))},(_,index)=>start+index*step.ms)
  }
  const date=zonedDateKey(from,timeZone),nominal=new Date(`${date}T00:00:00Z`),ticks=[]
  if(step.months){nominal.setUTCDate(1);nominal.setUTCMonth(Math.floor(nominal.getUTCMonth()/step.months)*step.months);if(step.months>=12){nominal.setUTCMonth(0);nominal.setUTCFullYear(Math.floor(nominal.getUTCFullYear()/(step.months/12))*(step.months/12))}}
  for(let index=0;index<42;index++){
    const instant=dayBoundary(nominal.toISOString().slice(0,10),timeZone)
    if(instant>to)break
    if(instant>=from && ticks.at(-1)!==instant)ticks.push(instant)
    if(step.months)nominal.setUTCMonth(nominal.getUTCMonth()+step.months);else nominal.setUTCDate(nominal.getUTCDate()+step.days)
  }
  return ticks
}

export function timeAxisTicks(from,to,width,{timeZone='UTC',measure=text=>text.length*7}={}) {
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||width<=0)return {ticks:[],context:''}
  const span=to-from,capacity=Math.max(2,Math.min(12,Math.floor(width/80))),target=span/Math.max(1,capacity-1)
  const dateFrom=displayDate(new Date(from),{timeZone}),dateTo=displayDate(new Date(to),{timeZone}),sameYear=dateFrom.slice(-4)===dateTo.slice(-4)
  let result
  for(const step of STEPS.filter(step=>step.ms>=Math.max(target,span>=DAY?DAY:500))){
    const label=time=>{
      const date=displayDate(new Date(time),{timeZone,timeStyle:step.ms<DAY?'medium':undefined})
      if(step.months>=12)return date.slice(6,10)
      if(step.months)return date.slice(3,10)
      if(step.ms>=DAY)return date.slice(0,sameYear?5:10)
      const clock=date.slice(11)
      return step.ms>=60000?clock.slice(0,5):step.ms>=1000?clock:`${clock}.${String(Math.round((time%1000+1000)%1000)).padStart(3,'0')}`
    }
    const values=timeTicks(from,to,step,timeZone)
    const labels=values.map(label),keys=values.map((time,index)=>`${zonedDateKey(time,timeZone)} ${labels[index]}`),duplicates=new Set(keys.filter((text,index)=>keys.indexOf(text)!==index))
    const ticks=values.map((time,index)=>{const text=labels[index]+(duplicates.has(keys[index]) ? ` ${timeOffset(time,timeZone)}` : ''),size=measure(text),position=(time-from)/span,px=position*width,anchor=px<size/2?'start':px+size/2>width?'end':'middle';return {time,label:text,position,anchor,left:px-(anchor==='start'?0:anchor==='end'?size:size/2),right:px+(anchor==='end'?0:anchor==='start'?size:size/2)}})
    const fits=ticks.every((tick,index)=>!index||tick.left-ticks[index-1].right>=20)
    if(fits&&ticks.length>=2){result={ticks,context:step.ms<DAY?(dateFrom===dateTo?dateFrom:`${dateFrom} – ${dateTo}`):'',step:step.ms};break}
  }
  if(result)return result
  const intraday=span<DAY, endpoint=time=>{
    const date=displayDate(new Date(time),{timeZone,timeStyle:intraday?'medium':undefined})
    if(!intraday)return date
    const clock=date.slice(11)
    return span>=60000?clock.slice(0,5):span>=2000?clock:`${clock}.${String(Math.round((time%1000+1000)%1000)%1000).padStart(3,'0')}`
  }
  const duplicate=intraday&&endpoint(from)===endpoint(to),first=endpoint(from)+(duplicate?` ${timeOffset(from,timeZone)}`:''),last=endpoint(to)+(duplicate?` ${timeOffset(to,timeZone)}`:''),context=intraday?(dateFrom===dateTo?dateFrom:`${dateFrom} – ${dateTo}`):''
  const ticks=measure(first)+measure(last)+20<=width ? [{time:from,label:first,position:0,anchor:'start'},{time:to,label:last,position:1,anchor:'end'}] : [{time:(from+to)/2,label:endpoint((from+to)/2)+(duplicate?` ${timeOffset((from+to)/2,timeZone)}`:''),position:.5,anchor:'middle'}]
  return {ticks,context,step:span}
}
