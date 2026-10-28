export const MANUAL_TRADE_COLUMNS = [
  ['time', 'Ngày đóng lệnh'], ['asset', 'Sản phẩm'], ['side', 'Chiều / Khối lượng'],
  ['strategy', 'Chiến lược'], ['tags', 'Nhãn'], ['net', 'PnL ròng'],
]
export const BROKER_DEAL_COLUMNS = [
  ['account', 'Account'], ['type', 'Type'], ['source', 'Source'], ['time', 'Entry date'],
  ['asset', 'Asset'], ['side', 'Side'], ['entry', 'Entry type'], ['net', 'Return'],
  ['return_pct', 'Return (%)'], ['price', 'Entry price'], ['volume', 'Size'],
  ['exit_time', 'Exit date'], ['exit_price', 'Exit price'], ['profit', 'Gross PnL'], ['fees', 'Fees'],
]

// The live broker adapter uses the same default column contract as the
// backtesting ledger. Only the session identity is replaced by account.
export const LIVE_TRADE_COLUMNS = [
  ['account', 'Account'], ['status', 'Type'], ['source', 'Source'],
  ['recorded_at_utc', 'Entry Date (Realtime)'], ['open_time_utc', 'Entry Date (Chart UTC)'],
  ['symbol', 'Asset'], ['side', 'Side'], ['entry_type', 'Entry type'],
  ['net_pnl', 'Return'], ['return_pct', 'Return (%)'], ['realized_r', 'Return (R)'],
  ['tags', 'Tags'], ['price_open', 'Entry price'], ['quantity', 'Size'],
  ['stop_loss', 'Stop loss'], ['take_profit', 'Take profit'],
  ['report_time_utc', 'Exit Date (Realtime)'], ['close_time_utc', 'Exit Date (Chart UTC)'],
  ['price_close', 'Exit price'], ['gross_pnl', 'Gross PnL'], ['fees', 'Fees'],
]
