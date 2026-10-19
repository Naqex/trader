import { nativeChartPalette } from './nativeChartPalette.js'

const amountFormat = new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function orderKinds(levels) {
  return ['entry','stop',...(levels?.targets?.length ? levels.targets.map(target => `target:${target.id}`) : ['target'])]
}

export function orderPriceColor(kind, theme, selected = false, side = 'BUY') {
  const palette = nativeChartPalette(theme)
  return kind === 'entry' ? side === 'SELL' ? palette.orderSelectedPrice : palette.orderEntryPrice : selected ? palette.orderSelectedPrice : palette.orderProtectionPrice
}

export function protectionProfit(levels, price) {
  const quantity = Number(levels.quantity), contract = Number(levels.contractSize)
  const declaredRate = Number(levels.quoteToAccountRate)
  const rate = declaredRate > 0 ? declaredRate : levels.quoteCurrency && levels.quoteCurrency === levels.currency ? 1 : NaN
  if (!(quantity > 0) || !(contract > 0) || !(rate > 0)) return null
  return (price - levels.entry) * (levels.side === 'SELL' ? -1 : 1) * quantity * contract * rate
}

export function orderLabel(levels, kind, price, theme, t) {
  const palette = nativeChartPalette(theme)
  const entry = kind === 'entry'
  const targetIndex = levels.targets?.findIndex(target => `target:${target.id}` === kind) ?? -1
  const target = targetIndex >= 0 ? levels.targets[targetIndex] : null
  const name = entry ? levels.side : kind === 'stop' ? 'SL' : target ? `TP${targetIndex+1}` : 'TP'
  const ghost = !entry && levels[kind] == null
  const compact = !entry && (ghost || Number(price) === Number(levels.entry))
  const color = kind === 'stop' ? palette.warning : kind.startsWith('target') ? palette.positive : levels.side === 'SELL' ? palette.orderSell : palette.positive
  const profit = entry ? levels.floating : protectionProfit(target ? { ...levels,quantity:target.quantity } : levels, price)
  let text = name
  if (entry && levels.state === 'submitting') text += ` · ${t('Đang gửi…')}`
  else if (entry && levels.state === 'queued') text += `${['limit','stop'].includes(levels.orderType) ? ` ${levels.orderType.toUpperCase()}` : ''} · ${t('Chờ khớp')}`
  else if (!ghost && profit != null && Number.isFinite(Number(profit)) && levels.currency) {
    const value = Number(profit)
    text += ` → ${value > 0 ? '+' : value < 0 ? '−' : ''}${amountFormat.format(Math.abs(value))} ${levels.currency}`
  }
  // A protection at Entry shares the small handle layout, but remains a real
  // saved protection. Keep its full details available without marking it unset.
  const borderColor = entry ? levels.side === 'SELL' ? palette.orderSellBorder : palette.primary : color
  return { text: compact ? name : text, detail: text, compact, ghost, color, borderColor, lineColor: entry && levels.side === 'BUY' ? palette.orderEntryPrice : borderColor, textColor: entry ? levels.side === 'SELL' ? palette.orderSellText : palette.orderBuyText : color }
}

export function protectionError(levels, kind, price) {
  const reference = Number(levels?.reference ?? levels?.entry)
  if (!(reference > 0) || !(price > 0)) return 'Giá TP/SL không hợp lệ.'
  const buy = levels.side === 'BUY'
  const valid = kind === 'stop' ? buy ? price < reference : price > reference : buy ? price > reference : price < reference
  if (valid && kind.startsWith('target:')) {
    const index = levels.targets?.findIndex(target => `target:${target.id}` === kind) ?? -1
    if (index >= 0 && levels.targets.some((target,i) => i !== index && (buy ? i < index ? target.price >= price : target.price <= price : i < index ? target.price <= price : target.price >= price))) return 'Các mức TP phải xếp từ gần đến xa theo hướng lệnh.'
  }
  if (valid) return ''
  return kind === 'stop'
    ? buy ? 'Stop Loss price must be lower than the current price' : 'Stop Loss price must be higher than the current price'
    : buy ? 'Take Profit price must be higher than the current price' : 'Take Profit price must be lower than the current price'
}
