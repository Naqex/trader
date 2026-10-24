import { DEMO_DRAFT } from './liveTradingModel.js'
import { scalperProtection } from './legacyScalperPreset.js'

export function mt5QuickDraft(snapshot, side, quantity, preset) {
  const reference = side === 'BUY' ? snapshot?.quote?.ask : snapshot?.quote?.bid
  const protection = scalperProtection(preset, reference, side, snapshot?.instrument)
  return { ...DEMO_DRAFT, side, quantity: String(quantity), ...protection,
    protectionEnabled: { stopLoss: Boolean(protection.stopLoss), takeProfit: Boolean(protection.takeProfit) } }
}
