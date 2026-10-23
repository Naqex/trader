const errors = {
  ai_policy_changed: ['Hệ thống AI đã cập nhật trước khi gửi yêu cầu. Gửi một yêu cầu mới để dùng cấu hình hiện tại.', 'AI policy changed before this request was sent. Submit a new request with the current configuration.'],
  invalid_ai_source: ['Nguồn dữ liệu không còn khả dụng trong workspace này. Chọn lại nguồn.', 'This data source is unavailable in this workspace. Select a source again.'],
  ai_source_too_large: ['Nguồn dữ liệu vượt giới hạn ngữ cảnh. Chọn nguồn nhỏ hơn.', 'The source exceeds the context limit. Choose a smaller source.'],
  ai_workflow_not_configured: ['Worker luồng AI chưa được cấu hình trên máy chủ.', 'The workflow worker is not configured on this server.'],
  ai_workflow_protocol_failed: ['Luồng AI bị gián đoạn. Xem trạng thái lần chạy trước khi chạy lại.', 'The workflow was interrupted. Check its run before starting another.'],
  ai_workflow_output_too_large: ['Một nhánh vượt giới hạn kết quả. Thu gọn yêu cầu rồi chạy lại.', 'A branch exceeded its output limit. Narrow the request before retrying.'],
  invalid_ai_document: ['Chọn tệp TXT hoặc Markdown UTF-8 có nội dung văn bản.', 'Choose a nonempty UTF-8 TXT or Markdown file.'],
  ai_document_too_large: ['Tệp vượt giới hạn 10 MB.', 'The file exceeds the 10 MB limit.'],
  ai_document_count: ['Mỗi agent có tối đa 5 tài liệu.', 'Each agent supports up to 5 documents.'],
  ai_document_not_found: ['Không tìm thấy tài liệu trong workspace này.', 'Document not found in this workspace.'],
  ai_document_in_use: ['Tài liệu đang được agent sử dụng. Gỡ khỏi agent trước khi xóa.', 'This document is used by an agent. Detach it before deleting.'],
  ai_document_storage_full: ['Thư viện đã đạt giới hạn 100 tệp hoặc 200 MB.', 'The library has reached its limit of 100 files or 200 MB.'],
  ai_document_capacity: ['Đang xử lý tài liệu khác. Thử lại sau.', 'Other documents are being processed. Try again shortly.'],
  invalid_ai_agent: ['Cấu hình agent không hợp lệ. Kiểm tra tên, hướng dẫn và tài liệu.', 'Invalid agent configuration. Check the name, instructions and knowledge files.'],
  ai_agent_not_found: ['Không tìm thấy agent trong workspace này.', 'This agent was not found in this workspace.'],
  ai_agent_changed: ['Agent đã được sửa ở nơi khác. Mở lại cài đặt để dùng bản mới.', 'This agent was edited elsewhere. Reopen settings to load the latest version.'],
  ai_agent_readonly: ['Mentor là trợ lý mặc định, không thể chỉnh sửa.', 'Mentor is the built-in assistant and cannot be edited.'],
  ai_agent_mismatch: ['Chat này thuộc agent khác. Mở lại chat hoặc tạo chat mới.', 'This chat belongs to another agent. Reopen it or start a new chat.'],
  ai_agents_full: ['Workspace đã có tối đa 32 agent tùy chỉnh.', 'This workspace already has the maximum of 32 custom agents.'],
  invalid_ai_continuation: ['Câu trả lời đã thay đổi. Mở lại chat trước khi tiếp tục.', 'The response has changed. Reopen the chat before continuing.'],
  ai_profile_changed: ['Cấu hình đã thay đổi ở nơi khác. Tải lại trang trước khi lưu.', 'This profile changed elsewhere. Reload the page before saving.'],
  ai_invalid_response: ['Model trả dữ liệu không hợp lệ. Ứng dụng không tự gửi lại.', 'The model returned invalid data. The app does not resend.'],
  ai_response_too_large: ['Phản hồi vượt giới hạn của cuộc chat.', 'The response exceeds the chat limit.'],
  chatgpt_model_unavailable: ['Model hiện không khả dụng. Kiểm tra Kết nối AI.', 'This model is unavailable. Check AI Connections.'],
  chatgpt_selection_required: ['Chọn lại model và mức suy luận cho ChatGPT Web.', 'Select a model and reasoning effort for ChatGPT Web.'],
  invalid_chat_context: ['Ngữ cảnh màn hình không hợp lệ. Tải lại trang.', 'Invalid screen context. Reload the page.'],
  ai_run_interrupted: ['Phản hồi bị gián đoạn; chưa rõ model đã xử lý xong hay chưa. Ứng dụng không tự gửi lại.', 'The response was interrupted; the model outcome is unknown. The app does not resend.'],
  ai_reconnect_required: ['Mất kết nối nhận phản hồi. Kết nối lại để đọc tiếp tác vụ này.', 'Response connection lost. Reconnect to continue reading this run.'],
  ai_queue_full: ['Hàng đợi AI đã đầy. Chờ tác vụ hiện tại hoàn tất.', 'The AI queue is full. Wait for active runs to finish.'],
  ai_conversation_busy: ['Cuộc chat này đang có phản hồi. Bạn có thể mở cuộc chat khác.', 'This chat has an active response. You can open another chat.'],
  ai_history_full: ['Lịch sử đã đạt giới hạn. Mở chat mới hoặc xóa các chat cũ.', 'The history limit was reached. Start a new chat or delete old chats.'],
  ai_idempotency_conflict: ['Yêu cầu đã thay đổi. Tải lại cuộc chat trước khi gửi.', 'The request has changed. Reload the chat before sending.'],
  ai_conversation_changed: ['Cuộc chat đã thay đổi. Tải lại rồi thử lại.', 'The chat has changed. Reload it and retry.'],
  ai_timeout: ['Đã hết thời gian chờ; chưa rõ kết quả ở model. Ứng dụng không tự gửi lại.', 'The request timed out; the model outcome is unknown. The app does not resend.'],
  ai_transport_failed: ['Kết nối model bị gián đoạn. Kiểm tra kết nối trước khi gửi lại.', 'The model connection was interrupted. Check the connection before resending.'],
  database_unavailable: ['Chưa truy cập được lịch sử AI. Thử kết nối lại.', 'AI history is unavailable. Try reconnecting.'],
  invalid_chat_messages: ['Hội thoại vượt giới hạn hoặc không hợp lệ. Mở cuộc chat mới.', 'The conversation exceeds the limit or is invalid. Start a new chat.'],
  chatgpt_login_required: ['Đăng nhập ChatGPT trong Kết nối AI để tiếp tục.', 'Sign in to ChatGPT in AI Connections to continue.'],
  chatgpt_turn_not_found: ['Không tìm thấy cuộc chat hoặc phản hồi này.', 'This chat or response was not found.'],
  ai_gateway_not_installed: ['Chưa cài gateway trên máy chạy ứng dụng.', 'The gateway is not installed on the app server.'],
  ai_gateway_binary_invalid: ['Bản gateway không khớp phiên bản đã cấu hình.', 'The gateway binary does not match the configured version.'],
  ai_gateway_panel_invalid: ['Trang quản trị chưa đúng phiên bản. Cài lại panel đã ghim trước khi bật kết nối.', 'The management panel does not match the pinned version. Reinstall it before starting.'],
  ai_gateway_config_invalid: ['Cấu hình gateway không đọc được. Kiểm tra tệp managed.yaml.', 'Cannot read the gateway configuration. Check managed.yaml.'],
  ai_gateway_config_conflict: ['Cấu hình gateway đã đổi phần kết nối của ứng dụng. Kiểm tra địa chỉ local, khóa truy cập và thư mục tài khoản trước khi bật lại.', 'Gateway configuration changed app connection settings. Check loopback, access keys and the auth directory before restarting.'],
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

export function aiEffortName(value, en) {
  const names = { minimal: ['Tối thiểu', 'Minimal'], low: ['Thấp', 'Low'], medium: ['Trung bình', 'Medium'], high: ['Cao', 'High'], xhigh: ['Rất cao', 'Extra high'], max: ['Tối đa', 'Max'], ultra: ['Ultra', 'Ultra'] }
  return value == null || value === '' ? (en ? 'Default' : 'Mặc định') : names[value]?.[en ? 1 : 0] || value
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
