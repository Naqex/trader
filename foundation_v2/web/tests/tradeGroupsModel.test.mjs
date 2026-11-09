import assert from 'node:assert/strict'
import test from 'node:test'
import {tradeGroupIssue,groupedTradeRows,describeLiveGroupTrade} from '../src/tradeGroupsModel.js'
const trade=(id,patch={})=>({member:{kind:'testing',source_id:'session-a',trade_id:id},closed:true,symbol:'EURUSD',side:'BUY',...patch})
test('merge requires closed trades with the same source, symbol and side',()=>{
 assert.equal(tradeGroupIssue([trade('1'),trade('2')]),'')
 for(const patch of [{closed:false},{symbol:'XAUUSD'},{side:'SELL'},{member:{kind:'testing',source_id:'other',trade_id:'2'}}])assert.notEqual(tradeGroupIssue([trade('1'),trade('2',patch)]),'')
 assert.notEqual(tradeGroupIssue([trade('1'),undefined]),'')
})
test('groups preserve rows, order, partial membership and flag changed source facts',()=>{
 const rows=[trade('3'),trade('1'),trade('2')],group={id:'group',symbol:'EURUSD',side:'BUY',members:rows.slice(1).map(row=>row.member)}
 const entries=groupedTradeRows(rows,[group],row=>row)
 assert.deepEqual(entries.map(entry=>entry.row?.member.trade_id||entry.group.id),['3','group'])
 assert.deepEqual(entries[1].rows,rows.slice(1));assert.equal(entries[1].stale,false)
 assert.equal(groupedTradeRows([trade('1',{side:'SELL'})],[group],row=>row)[0].stale,true)
 assert.equal(groupedTradeRows([rows[1]],[group],row=>row)[0].rows.length,1)
})
test('multi-account rows retain broker identity and manual account edits cannot evade membership',()=>{
 assert.deepEqual(describeLiveGroupTrade({source_account:'broker:abc',ticket:'broker:abc:position:7',symbol:'EURUSD',type:0,status:'Closed'}).member,{kind:'broker',source_id:'abc',trade_id:'position:7'})
 const old=trade('1',{member:{kind:'manual',source_id:'account-a',trade_id:'1'}}),changed={...old,member:{...old.member,source_id:'account-b'}},other=trade('2',{member:{kind:'manual',source_id:'account-b',trade_id:'2'}})
 const group={id:'group',symbol:'EURUSD',side:'BUY',members:[old.member,trade('3').member]}
 assert.notEqual(tradeGroupIssue([changed,other],[group]),'')
 assert.equal(groupedTradeRows([changed],[group],row=>row)[0].stale,true)
})
