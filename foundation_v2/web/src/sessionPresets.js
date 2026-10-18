const VERSION = 'session-presets-v1'
export const sessionPresetKey = (workspace, mode) => `tw:session-presets:${encodeURIComponent(workspace)}:${mode}`

function validConfig(config) {
  return config && typeof config.balance === 'string' && typeof config.strategy === 'string'
    && Array.isArray(config.datasets) && config.datasets.length > 0 && config.datasets.length <= 12
    && config.datasets.every(id => typeof id === 'string') && new Set(config.datasets).size === config.datasets.length
    && config.propDraft && ['profileKind','targetPercent','dailyLoss','overallLoss','durationDays'].every(key => typeof config.propDraft[key] === 'string')
    && config.tradingOptions?.version === 'session-trading-options-v2' && typeof config.tradingOptions.costs_enabled === 'boolean'
    && config.tradingOptions.assets && config.datasets.every(id => {
      const asset = config.tradingOptions.assets[id]
      return asset && typeof asset.spread_price === 'string' && typeof asset.commission_per_lot === 'string'
        && ['round_trip','per_side'].includes(asset.commission_charge)
        && ['off','light','medium','fixed'].includes(asset.slippage?.mode)
        && (asset.slippage.mode !== 'fixed' || Number.isInteger(asset.slippage.fixed_steps) && asset.slippage.fixed_steps >= 1 && asset.slippage.fixed_steps <= 20)
    })
}

export function readLegacySessionPresets(storage, workspace, mode) {
  const raw = storage.getItem(sessionPresetKey(workspace, mode))
  if (!raw) return []
  const saved = JSON.parse(raw)
  if (saved.version !== VERSION || !Array.isArray(saved.items) || saved.items.length > 50
    || saved.items.some(item => typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim()
      || !validConfig(item.config))
    || new Set(saved.items.map(item => item.id)).size !== saved.items.length) throw new Error('Không đọc được preset đã lưu.')
  return saved.items
}

export function validateSessionPreset(preset) {
  const name = preset.name.trim()
  if (!name || name.length > 160) throw new Error('Nhập tên preset, tối đa 160 ký tự.')
  if (!validConfig(preset.config)) throw new Error('Cấu hình preset không hợp lệ.')
  return {name,config:structuredClone(preset.config)}
}
