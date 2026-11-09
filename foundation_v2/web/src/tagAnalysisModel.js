import { closedTradeStats } from './liveLedgerModel.js'
import { dealNet } from './liveWorkspaceModel.js'

export const tagsOf = deal => [...new Set(deal.record?.payload?.tags || deal.tags || [])]
export const tagColorValue = color => `var(--${({green:'report-positive',blue:'report-blue',orange:'report-peach',red:'report-negative',purple:'report-violet',cyan:'report-cyan'})[color] || 'project-muted'})`

export function tagAnalysis(deals, catalog) {
  const tagged = deals.filter(deal => tagsOf(deal).length)
  const names = [...new Set([...(catalog.items || []).filter(item=>!item.archived).map(item=>item.name),...tagged.flatMap(tagsOf)])]
  const tags = names.map(name=>{
    const item=catalog.items?.find(item=>item.name===name), rows=tagged.filter(deal=>tagsOf(deal).includes(name))
    return {id:name,name,color:item?.color || 'gray',groupId:item?.group_id || '',...closedTradeStats(rows)}
  })
  const ids=[...new Set(tags.map(tag=>tag.groupId))]
  const groups=ids.map(id=>{
    const children=tags.filter(tag=>tag.groupId===id),names=new Set(children.map(tag=>tag.name))
    // A trade with two tags in one group contributes once to the group total.
    return {id,name:catalog.groups?.find(group=>group.id===id)?.name || '',children,...closedTradeStats(tagged.filter(deal=>tagsOf(deal).some(tag=>names.has(tag))))}
  })
  return {tags,groups,tagged,overall:closedTradeStats(tagged)}
}

export function tagCurves(tagged, selected) {
  if(!tagged.every(deal=>Number.isFinite(deal.time_msc)))return {series:[[]],timestamps:[]}
  const ordered=[...tagged].sort((a,b)=>a.time_msc-b.time_msc)
  const series=[null,...selected].map(tag=>{
    let total=0,unknown=false
    return ordered.map(deal=>{
      if(tag===null || tagsOf(deal).includes(tag)){
        const value=dealNet(deal)
        if(value===null)unknown=true
        else total+=value
      }
      return {time:deal.time_msc,value:unknown?null:total}
    })
  })
  return {series,timestamps:ordered.map(deal=>deal.time_msc)}
}
