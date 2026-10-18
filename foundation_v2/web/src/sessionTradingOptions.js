export const SESSION_COST_VERSION = 'session-cost-v1'
export const TRADING_OPTIONS_VERSION = 'session-trading-options-v1'

export function assetTradingDefaults() {
  return { spread_price: '0', commission_per_lot: '0', commission_charge: 'round_trip', slippage_price: '0' }
}

const validAmount = value => typeof value === 'string' && value.length <= 32 && /^\d+(?:\.\d{1,12})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) <= 1_000_000

export function tradingOptionsError(options, assets) {
  for (const asset of assets) {
    const value = options.assets[asset.dataset_id] || assetTradingDefaults()
    if ((options.costs_enabled && (!validAmount(value.spread_price) || !validAmount(value.commission_per_lot))) || !validAmount(value.slippage_price)) return 'Nhập spread, commission và trượt giá không âm, tối đa 12 chữ số thập phân.'
    if (!['round_trip', 'per_side'].includes(value.commission_charge)) return 'Chọn cách tính commission hợp lệ.'
  }
  return null
}

export function buildTradingOptions(options, assets) {
  const error = tradingOptionsError(options, assets)
  if (error) throw new Error(error)
  return { version: TRADING_OPTIONS_VERSION, costs_enabled: options.costs_enabled, assets: Object.fromEntries(assets.map(asset => {
    const value = options.assets[asset.dataset_id] || assetTradingDefaults()
    return [asset.dataset_id, { ...value, ...(!options.costs_enabled ? { spread_price: '0', commission_per_lot: '0' } : {}) }]
  })) }
}

export function tradingOptionsMatch(saved, requested) {
  if (saved?.version !== requested.version || saved.costs_enabled !== requested.costs_enabled || !saved.assets || Object.keys(saved.assets).length !== Object.keys(requested.assets).length) return false
  return Object.entries(requested.assets).every(([id, value]) => {
    const actual = saved.assets[id]
    return actual?.commission_charge === value.commission_charge && ['spread_price', 'commission_per_lot', 'slippage_price'].every(key => validAmount(actual[key]) && Number(actual[key]) === Number(value[key]))
  })
}

// Legacy sessions keep their stored assumptions; new sessions pin these at creation.
export function sessionExecutionConfig(replay, instrument) {
  const options = replay?.payload?.trading_options
  if (!options) return null
  const value = options.assets?.[replay.payload.dataset_id]
  if (options.version !== TRADING_OPTIONS_VERSION || !value) throw new Error('Thiếu cấu hình giao dịch của tài sản trong phiên.')
  return {
    forceBar: true,
    spread: options.costs_enabled ? value.spread_price : '0',
    costModel: {
      version: SESSION_COST_VERSION, spread_basis: 'bid_ask_embedded',
      commission_per_side_account: '0', commission_per_lot_account: options.costs_enabled ? value.commission_per_lot : '0',
      commission_charge: value.commission_charge,
      minimum_fee_account: '0', slippage_price_per_side: value.slippage_price,
      financing_account: '0', quote_to_account_rate: '1',
      account_ccy: instrument?.account_ccy || 'USD', rounding_decimals: 2,
    },
  }
}
