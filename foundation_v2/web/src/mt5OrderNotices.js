import { demoReason, finalDemoReceipt, positive } from './liveTradingModel.js'

// A broker receipt proves the outcome; a submitted draft never proves a fill.
export function mt5OrderNotice(receipt, command = {}) {
  const context = [command.symbol, command.ticket ? `#${command.ticket}` : '', receipt.retcode != null ? `MT5 ${receipt.retcode}` : ''].filter(Boolean).join(' · ')
  if (!finalDemoReceipt(receipt)) return { tone:'error', title:'Chưa rõ kết quả', message:'Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.' }
  if (receipt.status === 'rejected') return { tone:'error', title:'MT5 đã từ chối yêu cầu.', message:[context, receipt.reason ? demoReason(receipt.reason) : ''].filter(Boolean).join(' · ') }
  const action = command.action || receipt.action
  const provenProtection = receipt.reason === 'demo_reconciled_protection_active'
  const provenCancel = receipt.reason === 'demo_reconciled_cancelled'
  if (receipt.status === 'accepted' && !provenProtection && !provenCancel && !['pause','resume'].includes(action)) return { tone:'success', title:'MT5 đã tiếp nhận yêu cầu.', message:context }
  if ((action === 'place' || action === 'close') && receipt.status === 'filled' && ['BUY','SELL'].includes(command.side) && command.symbol && positive(receipt.volume) && positive(receipt.price)) {
    return { tone:'success', order:{operationId:receipt.request_id || command.request_id,status:action==='place'?'executed':receipt.reason==='demo_reconciled_partial_final'?'partial_closed':'closed',symbol:command.symbol,side:command.side,quantity:`${receipt.volume} lot`,price:String(receipt.price)} }
  }
  const title = { place:receipt.status==='filled'?'MT5 đã khớp lệnh.':'MT5 đã hoàn tất yêu cầu.',close:receipt.reason==='demo_reconciled_partial_final'?'Đã đóng một phần vị thế.':'Đã đóng vị thế.',protect:'MT5 đã cập nhật SL/TP.',cancel:'Đã hủy lệnh chờ.',pause:'Đã tạm dừng mở lệnh mới.',resume:'MT5 đã cho phép mở lệnh mới.' }[action] || 'MT5 đã hoàn tất yêu cầu.'
  return { tone:'success',title,message:context }
}
