export const MT5_STATUS = {
  queued:'Đang chờ đồng bộ', syncing:'Đang đồng bộ', connected:'Đã kết nối',
  error:'Lỗi kết nối', paused:'Đã tạm dừng', disconnected:'Đã ngắt kết nối',
}
const ERRORS = {
  mt5_reconciliation_required:'Cần đối soát lệnh chưa rõ kết quả trước khi gỡ kết nối tài khoản.',
  invalid_mt5_connection:'Thông tin tài khoản chưa hợp lệ. Kiểm tra tên, server và số tài khoản MT5.',
  invalid_mt5_start_date:'Ngày bắt đầu phải từ 01/01/2000 đến hôm nay (UTC).',
  mt5_login_failed:'Chưa kết nối được MT5. Kiểm tra terminal, mạng, máy chủ, tài khoản và mật khẩu MT5.',
  mt5_auth_failed:'MT5 từ chối đăng nhập. Kiểm tra máy chủ, tài khoản và mật khẩu MT5.',
  mt5_initialization_failed:'Chưa khởi tạo được kết nối MT5. Kiểm tra terminal, mạng và thông tin đăng nhập.',
  mt5_terminal_unavailable:'Không liên lạc được với terminal MT5 riêng. Kiểm tra terminal trên máy chạy API rồi thử lại.',
  mt5_version_unsupported:'Phiên bản MT5 và bộ kết nối chưa tương thích. Cần kiểm tra phiên bản trên máy chạy API.',
  mt5_trading_disabled:'MT5 chưa cấp quyền giao dịch. Kiểm tra mật khẩu giao dịch và quyền Algo Trading trên terminal.',
  mt5_disconnected:'MT5 đang mất kết nối với broker. Ứng dụng sẽ tự thử lại.',
  mt5_terminal_stopped:'Terminal MT5 vừa dừng. Ứng dụng sẽ tự khởi động lại.',
  mt5_account_mode_unsupported:'Loại tài khoản MT5 này chưa được hỗ trợ.',
  mt5_connection_revoked:'Kết nối đã thay đổi. Tải lại tài khoản trước khi tiếp tục.',
  mt5_investor_required:'Tài khoản đang có quyền giao dịch. Hãy dùng mật khẩu investor (chỉ đọc).',
  mt5_identity_changed:'Thông tin terminal không khớp tài khoản. Kết nối đã bị chặn.',
  mt5_terminal_missing:'Chưa tìm thấy terminal MetaTrader 5 trên máy chạy API.',
  mt5_sdk_missing:'Máy chạy API chưa cài bộ kết nối MetaTrader 5.',
  mt5_secret_unavailable:'Không mở được thông tin đăng nhập đã lưu. Hãy kết nối lại trên máy này.',
  mt5_sync_timeout:'MT5 chưa phản hồi kịp. Kiểm tra kết nối và thử đồng bộ lại.',
  mt5_history_too_large:'Lịch sử quá lớn. Hãy chọn ngày bắt đầu gần hơn rồi kết nối lại.',
  mt5_request_conflict:'Yêu cầu đã thay đổi. Đóng form rồi thử lại.',
  mt5_connection_limit:'Workspace hỗ trợ tối đa 10 kết nối MetaTrader.',
  mt5_terminal_isolation_failed:'Không xác minh được thư mục terminal riêng. Kết nối đã bị chặn.',
}
export const mt5Error = code => ERRORS[code] || 'Chưa đồng bộ được dữ liệu MT5. Kiểm tra terminal, mạng và thông tin đăng nhập rồi thử lại.'

// Deliberately separate from command receipts: credential bodies must never be cached.
export async function mt5Request(workspace, path, body) {
  let response
  try {
    response = await fetch(`/api/v2/live/connections${path}`, {
      method:'POST', headers:{'X-Workspace-Id':workspace,'Content-Type':'application/json'},
      body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(20000),
    })
  } catch {
    const error = new Error('Chưa xác nhận được kết quả. Bấm thử lại để kiểm tra cùng yêu cầu.'); error.uncertain=true; throw error
  }
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(mt5Error(value?.detail))
  if (!value?.id) { const error=new Error('Chưa xác nhận được kết quả. Bấm thử lại.');error.uncertain=true;throw error }
  return value
}
