import test from 'node:test'
import assert from 'node:assert/strict'
import {mt5OrderNotice} from '../src/mt5OrderNotices.js'
const command={request_id:'a',action:'place',symbol:'EURUSD',side:'BUY',volume:1}
test('only a final fill with actual price and volume becomes a detailed execution receipt',()=>{
  const value=mt5OrderNotice({status:'filled',volume:0.2,price:1.25},command)
  assert.equal(value.order.status,'executed');assert.equal(value.order.quantity,'0.2 lot');assert.equal(value.order.price,'1.25')
  for(const receipt of [{status:'accepted'},{status:'filled',requires_reconciliation:true},{status:'unknown'},{status:'done'}])assert.equal(mt5OrderNotice(receipt,command).order,undefined)
  assert.equal(mt5OrderNotice({status:'done'},command).title,'MT5 đã hoàn tất yêu cầu.')
})
test('rejection includes actual broker reason and code; protection, close, cancel and controls have distinct outcomes',()=>{
  const rejected=mt5OrderNotice({status:'rejected',reason:'demo_margin_insufficient',retcode:10019},command)
  assert.equal(rejected.tone,'error');assert.match(rejected.message,/EURUSD.*10019.*margin/)
  assert.equal(mt5OrderNotice({status:'filled'},{action:'protect',symbol:'EURUSD',ticket:4}).title,'MT5 đã cập nhật SL/TP.')
  assert.equal(mt5OrderNotice({status:'accepted',reason:'demo_reconciled_cancelled'},{action:'cancel'}).title,'Đã hủy lệnh chờ.')
  assert.equal(mt5OrderNotice({status:'accepted'},{action:'cancel'}).title,'MT5 đã tiếp nhận yêu cầu.')
  assert.equal(mt5OrderNotice({status:'filled',price:1.3,volume:0.2,reason:'demo_reconciled_partial_final'},{...command,action:'close'}).order.status,'partial_closed')
  assert.equal(mt5OrderNotice({status:'accepted'},{action:'pause'}).title,'Đã tạm dừng mở lệnh mới.')
})
