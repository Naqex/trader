const errors = {
  ai_gateway_not_installed: ['Chưa cài gateway trên máy chạy ứng dụng.', 'The gateway is not installed on the app server.'],
  ai_gateway_binary_invalid: ['Bản gateway không khớp phiên bản đã cấu hình.', 'The gateway binary does not match the configured version.'],
  ai_gateway_port_in_use: ['Gateway đang chạy ngoài ứng dụng. Dừng bản đó trước khi bật kết nối tại đây.', 'The gateway is running outside the app. Stop that instance before starting it here.'],
  ai_gateway_start_failed: ['Chưa bật được kết nối AI. Thử lại.', 'Could not start the AI connection. Retry.'],
  ai_gateway_stopped: ['Kết nối AI đã dừng. Bật lại để tiếp tục.', 'The AI connection stopped. Start it again to continue.'],
  ai_gateway_login_failed: ['Chưa hoàn tất đăng nhập Google. Thử kết nối lại.', 'Google sign-in did not complete. Try connecting again.'],
  ai_gateway_login_timeout: ['Đã hết thời gian đăng nhập Google. Thử kết nối lại.', 'Google sign-in timed out. Try connecting again.'],
  ai_gateway_unmanaged: ['Kết nối này được quản lý ngoài ứng dụng.', 'This connection is managed outside the app.'],
  ai_selection_changed: ['Lựa chọn AI đã thay đổi. Kiểm tra model rồi gửi lại câu hỏi.', 'The AI selection changed. Check the model before resending your question.'],
  ai_gateway_not_configured: ['Chưa cấu hình gateway trên máy này.', 'The gateway is not configured on this machine.'],
  ai_gateway_key_invalid: ['Khóa kết nối gateway không hợp lệ. Kiểm tra cấu hình máy chủ.', 'Invalid gateway key. Check the server configuration.'],
  ai_gateway_unavailable: ['Không kết nối được gateway local. Kiểm tra gateway đang chạy rồi thử lại.', 'Cannot reach the local gateway. Check that it is running and try again.'],
  ai_gateway_auth_failed: ['Gateway từ chối khóa kết nối. Kiểm tra cấu hình máy chủ.', 'The gateway rejected the connection key. Check the server configuration.'],
  ai_gateway_rate_limited: ['Model đang chạm hạn mức. Chờ rồi gửi lại; ứng dụng không tự gửi lại hoặc đổi model.', 'The model is rate limited. Wait before resending; the app does not retry or change models.'],
  ai_gateway_timeout: ['Đã hết thời gian chờ model. Kiểm tra kết nối trước khi gửi lại.', 'The model timed out. Check the connection before resending.'],
  ai_gateway_selection_required: ['Chọn model cho gateway trong Cài đặt AI.', 'Select a gateway model in AI settings.'],
  invalid_ai_selection: ['Model không còn trong danh sách. Tải lại model rồi chọn lại.', 'The model is no longer listed. Refresh the models and select again.'],
  ai_gateway_invalid_response: ['Gateway trả dữ liệu không hợp lệ.', 'The gateway returned invalid data.'],
  ai_gateway_incomplete_response: ['Model chưa trả lời hoàn tất. Ứng dụng không tự gửi lại.', 'The model did not finish its response. The app does not resend automatically.'],
  ai_gateway_empty_response: ['Model trả về phản hồi trống.', 'The model returned an empty response.'],
  ai_gateway_response_too_large: ['Phản hồi vượt giới hạn của cuộc trò chuyện.', 'The response exceeds the chat limit.'],
  ai_gateway_response_failed: ['Chưa nhận được phản hồi từ model. Kiểm tra kết nối và hạn mức trong gateway.', 'No response received from the model. Check the gateway connection and quota.'],
  ai_gateway_model_unavailable: ['Model hiện không khả dụng. Chọn lại trong Cài đặt AI.', 'The model is unavailable. Select a model in AI settings.'],
  chatgpt_busy: ['AI đang xử lý tác vụ. Chờ hoàn tất hoặc dừng phản hồi hiện tại.', 'AI is processing a task. Wait or stop the active response.'],
  workspace_access_denied: ['Workspace này chưa được cấp quyền dùng AI.', 'This workspace does not have AI access.'],
  trusted_identity_missing: ['Workspace này chưa được cấp quyền dùng AI.', 'This workspace does not have AI access.'],
}

export function aiErrorCopy(code, en = false) {
  return errors[code]?.[en ? 1 : 0] || (en ? 'Cannot read the AI connection. Try again.' : 'Không đọc được kết nối AI. Hãy thử lại.')
}

export function isGatewayError(code) { return code?.startsWith('ai_gateway_') || code === 'invalid_ai_selection' || code === 'ai_selection_changed' }

export function googleOAuthUrl(value) {
  try {
    const url = new URL(value), callback = new URL(url.searchParams.get('redirect_uri'))
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.port && !url.username && !url.password && !url.hash
      && ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname) && url.searchParams.get('response_type') === 'code' && url.searchParams.get('state')
      && callback.origin === 'http://localhost:51121' && callback.pathname === '/oauth-callback' && !callback.search && !callback.hash && !callback.username && !callback.password ? url.href : null
  } catch { return null }
}
