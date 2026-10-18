import { categoryOf } from './dataLibraryModel.js'

export const SESSION_COST_VERSION = 'session-cost-v2'
export const TRADING_OPTIONS_VERSION = 'session-trading-options-v2'
export const LEGACY_TRADING_OPTIONS_VERSION = 'session-trading-options-v1'

export function assetTradingDefaults() {
  return { spread_price: '0', commission_per_lot: '0', commission_charge: 'round_trip', slippage: { mode: 'off' } }
}

export function assetSlippageUnit(asset) {
  const spec = asset.instrument_spec || asset.replay_instrument_spec
  const unit = ['fx', 'forex'].includes(spec?.asset_class) ? 'pip' : 'tick'
  const price = unit === 'pip' ? spec?.pip_size : spec?.tick_size
  return { unit, price, available: typeof price === 'string' && validAmount(price) && Number(price) > 0 }
}

export function slippageGroups(assets, options) {
  const groups = new Map()
  for (const asset of assets) {
    const category = categoryOf({ ...asset, instrument_spec:asset.instrument_spec || asset.replay_instrument_spec })
    if (!groups.has(category)) groups.set(category, { category, assets:[] })
    groups.get(category).assets.push(asset)
  }
  return [...groups.values()].map(group => {
    const values = group.assets.map(asset => (options.assets[asset.dataset_id] || assetTradingDefaults()).slippage)
    const first = values[0]
    // Older presets can contain different assumptions within a category. Reading
    // them must not silently replace those assumptions with the first asset's.
    const mixed = values.some(value => value.mode !== first.mode || (value.mode === 'fixed' && String(value.fixed_steps) !== String(first.fixed_steps)))
    return { ...group, mixed, slippage:mixed ? {mode:null} : first,
      unit:assetSlippageUnit(group.assets[0]).unit,
      available:group.assets.every(asset => assetSlippageUnit(asset).available) }
  })
}

export function updateGroupSlippage(options, assets, slippage) {
  return { ...options, assets:{ ...options.assets, ...Object.fromEntries(assets.map(asset => [asset.dataset_id,
    { ...(options.assets[asset.dataset_id] || assetTradingDefaults()), slippage:{...slippage} }
  ])) } }
}

const validAmount = value => typeof value === 'string' && value.length <= 32 && /^\d+(?:\.\d{1,12})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) <= 1_000_000

export function tradingOptionsError(options, assets) {
  const legacy = options.version === LEGACY_TRADING_OPTIONS_VERSION
  if (options.version && ![LEGACY_TRADING_OPTIONS_VERSION, TRADING_OPTIONS_VERSION].includes(options.version)) return 'Cấu hình giao dịch không tương thích.'
  for (const asset of assets) {
    const value = options.assets[asset.dataset_id] || assetTradingDefaults()
    if ((options.costs_enabled && (!validAmount(value.spread_price) || !validAmount(value.commission_per_lot))) || (legacy && !validAmount(value.slippage_price))) return 'Nhập chi phí không âm, tối đa 12 chữ số thập phân.'
    if (!['round_trip', 'per_side'].includes(value.commission_charge)) return 'Chọn cách tính commission hợp lệ.'
    if (!legacy) {
      const slippage = value.slippage
      if (!slippage || !['off', 'light', 'medium', 'fixed'].includes(slippage.mode)) return 'Chọn chế độ trượt giá.'
      if (slippage.mode !== 'off' && !assetSlippageUnit(asset).available) return 'Thiếu quy cách pip hoặc tick của tài sản.'
      if (slippage.mode === 'fixed' && (!/^\d+$/.test(String(slippage.fixed_steps ?? '')) || Number(slippage.fixed_steps) < 1 || Number(slippage.fixed_steps) > 20)) return 'Nhập số nguyên từ 1 đến 20.'
    }
  }
  return null
}

export function buildTradingOptions(options, assets) {
  const error = tradingOptionsError(options, assets)
  if (error) throw new Error(error)
  const legacy = options.version === LEGACY_TRADING_OPTIONS_VERSION
  return { version: legacy ? LEGACY_TRADING_OPTIONS_VERSION : TRADING_OPTIONS_VERSION, costs_enabled: options.costs_enabled, assets: Object.fromEntries(assets.map(asset => {
    const value = options.assets[asset.dataset_id] || assetTradingDefaults()
    return [asset.dataset_id, {
      spread_price: options.costs_enabled ? value.spread_price : '0',
      commission_per_lot: options.costs_enabled ? value.commission_per_lot : '0',
      commission_charge: value.commission_charge,
      ...(legacy ? { slippage_price: value.slippage_price } : { slippage: { mode: value.slippage.mode, ...(value.slippage.mode === 'fixed' ? { fixed_steps: Number(value.slippage.fixed_steps) } : {}) } }),
    }]
  })) }
}

export function tradingOptionsMatch(saved, requested) {
  if (saved?.version !== requested.version || saved.costs_enabled !== requested.costs_enabled || !saved.assets || Object.keys(saved.assets).length !== Object.keys(requested.assets).length) return false
  return Object.entries(requested.assets).every(([id, value]) => {
    const actual = saved.assets[id]
    const amounts = requested.version === LEGACY_TRADING_OPTIONS_VERSION ? ['spread_price', 'commission_per_lot', 'slippage_price'] : ['spread_price', 'commission_per_lot']
    return actual?.commission_charge === value.commission_charge && amounts.every(key => validAmount(actual[key]) && Number(actual[key]) === Number(value[key]))
      && (requested.version === LEGACY_TRADING_OPTIONS_VERSION || (actual.slippage?.mode === value.slippage.mode && (value.slippage.mode !== 'fixed' || actual.slippage.fixed_steps === value.slippage.fixed_steps)))
  })
}

// An order preview uses bounds; it must not sample an execution outcome.
export function slippageAllowance(costModel) {
  if (costModel?.version !== SESSION_COST_VERSION) {
    const price = Number(costModel?.slippage_price_per_side ?? 0)
    return { risk:price * 2, reward:price * 2, variable:false }
  }
  const model = costModel.slippage_model
  if (model?.mode === 'off') return { risk:0, reward:0, variable:false }
  const unit = Number(model?.unit_price)
  if (!(unit > 0)) return null
  if (model.mode === 'fixed') {
    if (!Number.isInteger(model.fixed_steps) || model.fixed_steps < 1 || model.fixed_steps > 20) return null
    const price = unit * model.fixed_steps
    return { risk:price * 2, reward:price, variable:false }
  }
  if (!['light','medium'].includes(model.mode)) return null
  const [market, stop] = model.mode === 'light' ? [1,2] : [3,8]
  return { risk:unit * (market + stop), reward:unit * market, variable:true }
}

// Legacy sessions keep their stored assumptions; new sessions pin these at creation.
export function sessionExecutionConfig(replay, instrument) {
  const options = replay?.payload?.trading_options
  if (!options) return null
  const value = options.assets?.[replay.payload.dataset_id]
  if (![TRADING_OPTIONS_VERSION, LEGACY_TRADING_OPTIONS_VERSION].includes(options.version) || !value) throw new Error('Thiếu cấu hình giao dịch của tài sản trong phiên.')
  const legacy = options.version === LEGACY_TRADING_OPTIONS_VERSION
  const { unit, price } = assetSlippageUnit({ instrument_spec:instrument })
  return {
    forceBar: true,
    spread: options.costs_enabled ? value.spread_price : '0',
    costModel: {
      // This also drives previews before initialization. Rust independently
      // rebuilds the model from frozen options and the persisted server seed.
      version: legacy ? 'session-cost-v1' : SESSION_COST_VERSION, spread_basis: 'bid_ask_embedded',
      commission_per_side_account: '0', commission_per_lot_account: options.costs_enabled ? value.commission_per_lot : '0',
      commission_charge: value.commission_charge,
      minimum_fee_account: '0', slippage_price_per_side: legacy ? value.slippage_price : '0',
      financing_account: '0', quote_to_account_rate: '1',
      account_ccy: instrument?.account_ccy || 'USD', rounding_decimals: 2,
      ...(!legacy ? { slippage_model: { version:'deterministic-adverse-fill-v1', mode:value.slippage.mode, fixed_steps:value.slippage.mode === 'fixed' ? Number(value.slippage.fixed_steps) : null, unit, unit_price:price, seed:replay.payload.trading_options_seed } } : {}),
    },
  }
}
