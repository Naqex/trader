// Display fixtures for the UI review; none of these records come from an engine.
export const PREVIEW_DATASETS = [
  { value: 'crypto-daily', label: 'BTC/USDT · 1D', scope: ['Crypto spot · Nến ngày', 'Crypto spot · Daily bars'] },
  { value: 'forex-four-hour', label: 'EUR/USD · H4', scope: ['Forex · Nến 4 giờ', 'Forex · 4-hour bars'] },
]
export const PREVIEW_BASELINES = [
  { value: 'trend', label: ['Theo xu hướng', 'Trend following'] },
  { value: 'breakout', label: ['Phá vỡ vùng giá', 'Price breakout'] },
]
export const PREVIEW_STATUSES = {
  review: { label: ['Chờ xem kết quả', 'Ready for review'], icon: 'success', tone: 'success', phase: 4 },
  running: { label: ['Đang nghiên cứu', 'Researching'], icon: 'activity', tone: 'info', phase: 1 },
  insufficient: { label: ['Chưa đủ bằng chứng', 'More evidence needed'], icon: 'clock', tone: 'warning', phase: 4 },
  failed: { label: ['Lượt chạy bị lỗi', 'Run error'], icon: 'warning', tone: 'danger', phase: 1 },
  stopped: { label: ['Đã dừng', 'Stopped'], icon: 'pause', tone: 'muted', phase: 1 },
  draft: { label: ['Bản nháp', 'Draft'], icon: 'document', tone: 'muted', phase: 0 },
}
export const PREVIEW_PHASES = [
  ['Kiểm tra dữ liệu', 'Check data'],
  ['Tạo và thử ứng viên', 'Build and test candidates'],
  ['Kiểm chứng độc lập', 'Independent evaluation'],
  ['Tổng hợp bằng chứng', 'Summarize evidence'],
]
export const PREVIEW_TRIALS = [
  { version: 'v1', change: ['Thêm bộ lọc biến động', 'Add a volatility filter'], verdict: ['Không cải thiện', 'No improvement'], tone: 'muted', pnl: '+5.1%', drawdown: '−9.2%' },
  { version: 'v2', change: ['Điều chỉnh ngưỡng lọc', 'Adjust the filter threshold'], verdict: ['Đề nghị kiểm chứng', 'Proposed for evaluation'], tone: 'info', pnl: '+8.4%', drawdown: '−6.8%' },
  { version: 'v3', change: ['Thêm điều kiện xác nhận', 'Add a confirmation rule'], verdict: ['Chưa đủ giao dịch', 'Too few trades'], tone: 'warning', pnl: null, drawdown: null },
]
export function initialResearchPreview() {
  return [
    { id: 'sample-volatility', title: ['Bộ lọc biến động cho chiến lược xu hướng', 'Volatility filter for a trend strategy'], objective: ['Kiểm tra bộ lọc biến động có cải thiện kết quả sau phí mà vẫn giữ mức sụt giảm phù hợp hay không.', 'Check whether a volatility filter improves results after costs while keeping drawdown acceptable.'], dataset: 'crypto-daily', baseline: 'trend', limit: 12, status: 'review', decision: null },
    { id: 'sample-breakout', title: ['Xác nhận tín hiệu phá vỡ vùng giá', 'Confirm price breakout signals'], objective: ['So sánh điều kiện xác nhận với chiến lược phá vỡ gốc trong cùng điều kiện chi phí.', 'Compare a confirmation rule with the original breakout strategy under the same cost assumptions.'], dataset: 'forex-four-hour', baseline: 'breakout', limit: 8, status: 'running', decision: null },
    { id: 'sample-evidence', title: ['Kiểm tra độ bền qua nhiều giai đoạn', 'Check robustness across market periods'], objective: ['Xem kết quả có phụ thuộc quá nhiều vào một giai đoạn thị trường hay không.', 'Check whether performance depends too heavily on a single market period.'], dataset: 'crypto-daily', baseline: 'trend', limit: 6, status: 'insufficient', decision: null },
    { id: 'sample-data-error', title: ['Đối chiếu dữ liệu trước thử nghiệm', 'Validate data before testing'], objective: ['Kiểm tra dữ liệu thiếu và thời điểm tín hiệu trước khi tạo ứng viên.', 'Check missing data and signal timing before building a candidate.'], dataset: 'forex-four-hour', baseline: 'trend', limit: 6, status: 'failed', decision: null },
  ]
}

export function validPreviewTask(task) {
  return task && typeof task.id === 'string' && task.id.length < 100 &&
    [task.title, task.objective].every(value => typeof value === 'string' || (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string'))) &&
    PREVIEW_DATASETS.some(item => item.value === task.dataset) && PREVIEW_BASELINES.some(item => item.value === task.baseline) &&
    Number.isSafeInteger(task.limit) && task.limit >= 1 && task.limit <= 100 && Object.hasOwn(PREVIEW_STATUSES, task.status) &&
    [null, 'demo-requested', 'rework'].includes(task.decision) &&
    (task.previewOutcome === undefined || ['review', 'insufficient', 'failed'].includes(task.previewOutcome))
}
