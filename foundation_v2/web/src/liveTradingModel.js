export const DEMO_TIMEFRAMES = Object.freeze({ M1:60, M5:300, M15:900, H1:3600, H4:14400, D1:86400 })
export const DEMO_DRAFT = Object.freeze({ side:'BUY', orderType:'market', quantity:'', entryPrice:'', stopLoss:'', takeProfit:'' })
export const positive = value => value !== '' && value !== null && value !== undefined && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) > 0
export function demoIdentity(snapshot) {
  const account = snapshot?.account
  return account?.login && account?.server ? `${account.login}:${account.server}` : ''
}
export function tradingBlockReason(snapshot, now = Date.now(), allowPaused = false) {
  if (snapshot?.status !== 'ready' || !(snapshot.execution_enabled === true || allowPaused && snapshot.paused === true && snapshot.reason === 'demo_paused')) return snapshot?.reason || 'mt5_connection_not_ready'
  if (!['demo','real'].includes(snapshot.mode) || !demoIdentity(snapshot) || !(snapshot.mode==='demo'?['demo',0]:['real',2]).includes(snapshot.account.trade_mode) || snapshot.mode==='real' && !snapshot.connection_id) return 'demo_identity_mismatch'
  if (!positive(snapshot.quote?.bid) || !positive(snapshot.quote?.ask) || Number(snapshot.quote.ask) < Number(snapshot.quote.bid)) return 'demo_quote_unavailable'
  const age = now - Number(snapshot.quote?.time_msc)
  if (!Number.isFinite(age) || age < -1000 || age > Math.min(Number(snapshot.policy?.max_quote_age_ms) || 5000,10000)) return 'demo_quote_stale'
  return ''
}
export function tradingReady(snapshot, now = Date.now(), allowPaused = false) {
  return tradingBlockReason(snapshot, now, allowPaused) === ''
}
export function demoIntent(snapshot, symbol, draft) {
  return { mode:snapshot.mode, ...(snapshot.connection_id?{connection_id:snapshot.connection_id}:{}), account_id:String(snapshot.account.login), server:snapshot.account.server, symbol,
    side:draft.side, order_type:draft.orderType, volume:Number(draft.quantity), entry_price:null,
    stop_loss:positive(draft.stopLoss) ? Number(draft.stopLoss) : null, take_profit:positive(draft.takeProfit) ? Number(draft.takeProfit) : null }
}
export function demoDraftError(draft, instrument, quote, broker = false) {
  if (!['BUY','SELL'].includes(draft.side) || draft.orderType !== 'market') return 'Hiện chỉ hỗ trợ lệnh Market.'
  if (!positive(draft.quantity)) return 'Nhập khối lượng lớn hơn 0.'
  const quantity = Number(draft.quantity), step = Number(instrument?.quantity_step)
  if (!positive(instrument?.quantity_min) || !positive(instrument?.quantity_max) || !(step > 0)) return 'Chưa có thông số khối lượng từ MT5.'
  if (quantity < Number(instrument.quantity_min) || quantity > Number(instrument.quantity_max) || Math.abs(quantity / step - Math.round(quantity / step)) > 1e-7) return 'Khối lượng không khớp giới hạn hoặc bước lot của MT5.'
  if (!broker && !positive(draft.stopLoss)) return 'Cần Stop loss trước khi kiểm tra lệnh.'
  const entry = Number(draft.side === 'BUY' ? quote?.ask : quote?.bid)
  if (!(entry > 0)) return 'Chưa có báo giá MT5.'
  if (draft.stopLoss !== '' && (!positive(draft.stopLoss) || (draft.side === 'BUY' && Number(draft.stopLoss) >= entry) || (draft.side === 'SELL' && Number(draft.stopLoss) <= entry))) return 'Stop loss đang ở sai phía giá vào lệnh.'
  if (draft.takeProfit !== '' && (!positive(draft.takeProfit) || (draft.side === 'BUY' ? Number(draft.takeProfit) <= entry : Number(draft.takeProfit) >= entry))) return 'Take profit đang ở sai phía giá vào lệnh.'
  return ''
}
export function previewMatches(preview, intent, now = Date.now()) {
  return preview?.value?.passed === true && preview.key === JSON.stringify(intent) && now >= preview.at && now - preview.at < 5000
}
export function decodeDemoSnapshot(payload) {
  if (!payload || !['ready','locked','unavailable'].includes(payload.status) || !['demo','real'].includes(payload.mode)) throw new Error('demo_response_invalid')
  if (payload.status === 'ready' && (!demoIdentity(payload) || !Array.isArray(payload.bars) || !Array.isArray(payload.positions) || !Array.isArray(payload.orders))) throw new Error('demo_response_invalid')
  if (!Array.isArray(payload.bars) || !payload.bars.length) return payload
  const bars = payload.bars.map(bar => {
    const timestamp = typeof bar.timestamp === 'string' && !Number.isFinite(Number(bar.timestamp)) ? Date.parse(bar.timestamp) / 1000 : Number(bar.timestamp)
    if (!Number.isFinite(timestamp) || timestamp <= 0 || !['open','high','low','close'].every(key => positive(bar[key]))) throw new Error('demo_response_invalid')
    return {...bar,timestamp}
  })
  return {...payload,bars}
}

export const finalDemoReceipt = receipt => receipt?.requires_reconciliation !== true && ['filled','accepted','rejected','cancelled','done'].includes(receipt?.status)

export const DEMO_REASONS = Object.freeze({
  demo_invalid_number:'Báo giá hoặc thông số mã MT5 chưa hợp lệ. Đợi dữ liệu mới trước khi giao dịch.',
  demo_quote_unavailable:'Chưa có báo giá MT5 hợp lệ. Đợi dữ liệu mới trước khi giao dịch.',
  mt5_trading_access_required:'Tài khoản đang ở chế độ Chỉ xem. Kết nối lại và chọn Giao dịch để đặt lệnh.', mt5_connection_not_ready:'Kết nối MT5 chưa sẵn sàng. Kiểm tra tài khoản giao dịch.',
  mt5_permissions_unverified:'Chưa xác minh được quyền giao dịch từ MT5.', mt5_connection_not_available:'Chưa chọn được kết nối MT5.', mt5_trading_disabled:'MT5 chưa cho phép giao dịch. Kiểm tra mật khẩu giao dịch và Algo Trading.',
  mt5_startup_timeout:'Terminal MT5 khởi động chậm. Kiểm tra kết nối tài khoản.', mt5_operation_timeout:'MT5 chưa phản hồi. Đối soát trước khi gửi lại lệnh.',
  demo_policy_locked:'Chưa cấu hình terminal giao dịch demo.', demo_terminal_missing:'Chưa có terminal giao dịch demo.',
  demo_terminal_invalid:'Đường dẫn terminal demo chưa hợp lệ.', demo_terminal_not_dedicated:'Cần terminal riêng cho giao dịch demo.',
  demo_account_required:'Terminal phải đăng nhập tài khoản demo đã cấu hình.', demo_trading_disabled:'MT5 chưa cho phép giao dịch tự động.',
  demo_native_runtime_required:'Cần API native để giao dịch demo.', demo_symbol_denied:'Mã này chưa được phép giao dịch.',
  demo_stop_required:'Cần Stop loss trước khi kiểm tra lệnh.', demo_volume_step_or_limit:'Khối lượng không khớp giới hạn hoặc bước lot của MT5.',
  demo_stop_direction_or_distance:'Stop loss sai hướng hoặc quá gần giá MT5.', demo_target_direction_or_distance:'Take profit sai hướng hoặc quá gần giá MT5.',
  demo_risk_limit:'Lệnh vượt giới hạn rủi ro đã cấu hình.', demo_existing_risk_unknown:'Chưa xác định được rủi ro của các vị thế đang mở.',
  demo_margin_insufficient:'Không đủ margin khả dụng.', demo_order_check_rejected:'MT5 từ chối bước kiểm tra lệnh.',
  demo_ticket_not_managed:'Lệnh này không do luồng giao dịch của ứng dụng quản lý.', demo_partial_close_unsupported:'Chưa hỗ trợ đóng một phần vị thế.',
  demo_order_type_unsupported:'Hiện chỉ hỗ trợ lệnh Market.', demo_hedging_required:'Luồng demo hiện yêu cầu tài khoản Hedging.',
  demo_unresolved_request:'Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.', demo_request_conflict:'Mã yêu cầu đã dùng cho một thao tác khác.',
  demo_adapter_timeout:'Terminal phản hồi quá chậm. Kiểm tra trạng thái trước khi gửi tiếp.', demo_send_outcome_unknown:'Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.',
  demo_identity_changed:'Tài khoản trong terminal đã thay đổi. Gửi lệnh đã bị chặn.',
  demo_policy_missing:'Chưa cấu hình terminal giao dịch demo.', demo_policy_invalid:'Cấu hình giao dịch demo chưa hợp lệ.',
  demo_disabled:'Gửi lệnh demo chưa được bật.', demo_policy_disabled:'Gửi lệnh demo chưa được bật.',
  demo_workspace_denied:'Workspace này chưa được cấp quyền giao dịch demo.', demo_identity_mismatch:'Tài khoản hoặc máy chủ MT5 không khớp cấu hình.',
  demo_only:'Chỉ chấp nhận tài khoản demo.', demo_terminal_unavailable:'Terminal giao dịch demo chưa sẵn sàng.',
  demo_quote_stale:'Báo giá MT5 chưa đủ mới. Kiểm tra đồng hồ Windows và kết nối giá trước khi gửi lệnh.', demo_response_invalid:'Dữ liệu giao dịch chưa hợp lệ.',
  demo_paused:'Đã tạm dừng mở lệnh mới.', demo_outcome_unknown:'Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.',
  demo_pending_unsupported:'Hiện chỉ hỗ trợ lệnh Market.', demo_not_configured:'Chưa cấu hình terminal giao dịch demo.',
})
export const demoReason = code => DEMO_REASONS[code] || 'Chưa sẵn sàng giao dịch. Kiểm tra terminal và tài khoản MT5.'
