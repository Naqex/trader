import { nativeChartPalette } from './nativeChartPalette.js'

const amountFormat = new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  const name = entry ? levels.side : kind === 'stop' ? 'SL' : 'TP'
  const ghost = !entry && levels[kind] == null
  const compact = !entry && (ghost || Number(price) === Number(levels.entry))
  const color = kind === 'stop' ? palette.warning : kind === 'target' ? palette.positive : levels.side === 'SELL' ? palette.negative : palette.positive
  const profit = entry ? levels.floating : protectionProfit(levels, price)
  let text = name
  if (entry && levels.state === 'submitting') text += ` · ${t('Đang gửi…')}`
  else if (entry && levels.state === 'queued') text += ` · ${t('Chờ khớp')}`
  else if (!ghost && profit != null && Number.isFinite(Number(profit)) && levels.currency) {
    const value = Number(profit)
    text += ` → ${value > 0 ? '+' : value < 0 ? '-' : ''}${amountFormat.format(Math.abs(value))} ${levels.currency}`
  }
  // A protection at Entry shares the small handle layout, but remains a real
  // saved protection. Keep its full details available without marking it unset.
  return { text: compact ? name : text, detail: text, compact, ghost, color, textColor: color }
}

export function protectionError(levels, kind, price) {
  const reference = Number(levels?.reference ?? levels?.entry)
  if (!(reference > 0) || !(price > 0)) return 'Giá TP/SL không hợp lệ.'
  const buy = levels.side === 'BUY'
  const valid = kind === 'stop' ? buy ? price < reference : price > reference : buy ? price > reference : price < reference
  return valid ? '' : `Lệnh ${levels.side} cần ${kind === 'stop' ? 'SL' : 'TP'} ${kind === 'stop' ? buy ? 'dưới' : 'trên' : buy ? 'trên' : 'dưới'} giá tham chiếu.`
}
