import test from 'node:test'
import assert from 'node:assert/strict'
import {mt5AccountPnl} from '../src/mt5AccountPnl.js'
const snapshot={status:'ready',account:{login:'42',currency:'USD'},positions:[]}
const deal=(type,profit,commission=0)=>({type,profit,commission,swap:-1,fee:0,time_msc:2000})
const history={status:'ready',connection_id:'a',account:{currency:'USD'},account_binding:{login:'42'},history_from_utc:'1970-01-01T00:00:01Z',captured_at_utc:'1970-01-01T00:00:03Z',deals:[deal(0,100,-2),deal(1,-20,-2),deal(2,10000)]}
test('booked PnL includes costs while cashflows never become profit; known empty positions are zero',()=>{
 assert.deepEqual(mt5AccountPnl(snapshot,history,'a'),{realized:74,floating:0,from:1000,to:3000})
 assert.equal(mt5AccountPnl({...snapshot,positions:[{profit:8},{profit:-3}]},history,'a').floating,5)
 assert.equal(mt5AccountPnl(snapshot,{...history,deals:[]},'a').realized,0)
})
test('missing, stale, incomplete and wrong-account history stay unknown',()=>{
 for(const value of [null,{...history,stale:true},{...history,connection_id:'b'},{...history,account_binding:{login:'99'}},{...history,account:{currency:'EUR'}},{...history,deals:[{...deal(0,10),commission:null}]},{...history,history_from_utc:null}])assert.equal(mt5AccountPnl(snapshot,value,'a').realized,null)
 assert.equal(mt5AccountPnl({...snapshot,status:'unavailable'},history,'a').floating,null)
})
