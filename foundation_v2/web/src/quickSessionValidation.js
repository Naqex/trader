export function quickSessionErrors({ draft, mode, propDraft, selectedAssets, period, dataStatus, addingStrategy }) {
  const errors = {}
  if (!draft.name.trim()) errors.name = 'Tên phiên là bắt buộc.'
  if (!(Number.isFinite(Number(draft.balance)) && Number(draft.balance) > 0)) errors.balance = 'Số dư phải lớn hơn 0.'
  if (dataStatus !== 'ready') errors.assets = 'Danh mục tài sản chưa sẵn sàng. Chờ tải xong hoặc thử lại nguồn dữ liệu.'
  else if (!draft.datasets.length) errors.assets = 'Chọn ít nhất một tài sản.'
  else if (selectedAssets.length !== draft.datasets.length) errors.assets = 'Tài sản đã chọn không còn khả dụng.'
  else if (new Set(draft.datasets).size !== draft.datasets.length) errors.assets = 'Mỗi tài sản chỉ được chọn một lần.'
  else if (draft.datasets.length > 12) errors.assets = 'Chọn tối đa 12 tài sản.'
  else if (new Set(selectedAssets.map(item => item.instrument_spec?.account_ccy || 'USD')).size > 1) errors.assets = 'Các tài sản phải dùng cùng tiền tệ tài khoản.'
  if (selectedAssets.length && !period.valid) errors.period = 'Chọn ngày bắt đầu và khoảng thời gian hợp lệ.'
  if (addingStrategy) errors.strategy = 'Hoàn tất hoặc hủy tạo chiến lược trước khi tạo phiên.'
  if (mode === 'prop') {
    if (!(Number.isFinite(Number(propDraft.targetPercent)) && Number(propDraft.targetPercent) >= 0.1)) errors.targetPercent = 'Mục tiêu lợi nhuận phải từ 0,1%.'
    if (!(Number.isFinite(Number(propDraft.dailyLoss)) && Number(propDraft.dailyLoss) >= 1)) errors.dailyLoss = 'Giới hạn lỗ ngày phải từ 1 đơn vị tiền tệ.'
    if (!(Number.isFinite(Number(propDraft.overallLoss)) && Number(propDraft.overallLoss) >= 1)) errors.overallLoss = 'Giới hạn lỗ tổng phải từ 1 đơn vị tiền tệ.'
  }
  return errors
}
