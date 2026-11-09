export const groupMemberKey = member => JSON.stringify([member.kind,member.source_id,member.trade_id])
const membershipIdentity=member=>member.kind==='manual'?JSON.stringify(['manual',member.trade_id]):groupMemberKey(member)

export function describeLiveGroupTrade(row,payload={}) {
  const manual=Boolean(row.record),account=row.source_account
  const source=manual?row.record.payload.account_id:account?.startsWith('broker:')?account.slice(7):row.connection_id||payload.connection_id
  const id=manual?row.record.record_id:account && String(row.ticket).startsWith(`${account}:`)?String(row.ticket).slice(account.length+1):String(row.ticket)
  return {member:{kind:manual?'manual':'broker',source_id:source,trade_id:id},symbol:row.symbol,side:row.type===0?'BUY':row.type===1?'SELL':'',closed:manual||row.status==='Closed',closedAt:row.time_msc,quantity:row.quantity??row.volume}
}

export function tradeGroupIssue(trades,groups=[]) {
  if(trades.length<2)return 'Chọn ít nhất 2 giao dịch.'
  if(trades.length>500)return 'Mỗi nhóm tối đa 500 giao dịch.'
  if(trades.some(trade=>!trade?.member?.source_id || !trade.member.trade_id))return 'Không đọc đủ giao dịch đã chọn. Chọn lại giao dịch.'
  if(trades.some(trade=>trade.closed!==true))return 'Chỉ gộp các giao dịch đã đóng và có đủ lịch sử.'
  const first=trades[0]
  if(trades.some(trade=>trade.member.kind!==first.member.kind || trade.member.source_id!==first.member.source_id))return 'Các giao dịch phải cùng tài khoản hoặc cùng phiên.'
  if(!first.symbol || trades.some(trade=>trade.symbol!==first.symbol))return 'Các giao dịch phải cùng tài sản.'
  if(!['BUY','SELL'].includes(first.side) || trades.some(trade=>trade.side!==first.side))return 'Các giao dịch phải cùng hướng lệnh.'
  const existing=new Set(groups.flatMap(group=>group.members.map(membershipIdentity)))
  if(trades.some(trade=>existing.has(membershipIdentity(trade.member))))return 'Giao dịch đã thuộc nhóm gộp. Tách nhóm trước khi gộp lại.'
  return ''
}

export function groupedTradeRows(rows,groups,describe) {
  const membership=new Map(groups.flatMap(group=>group.members.map(member=>[membershipIdentity(member),group])))
  const result=[],seen=new Map()
  for(const row of rows){
    const group=membership.get(membershipIdentity(describe(row).member))
    if(!group){result.push({row});continue}
    if(!seen.has(group.id)){const entry={group,rows:[],stale:false};result.push(entry);seen.set(group.id,entry)}
    const entry=seen.get(group.id),facts=describe(row)
    entry.stale ||= facts.symbol!==group.symbol || facts.side!==group.side || !facts.closed || !group.members.some(member=>groupMemberKey(member)===groupMemberKey(facts.member))
    entry.rows.push(row)
  }
  return result
}
