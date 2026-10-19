import { finiteNumber } from './replayOrderModel.js'

export function partialCloseBasis(levels, basis) {
  return Number(basis === 'original' ? levels.originalQuantity ?? levels.quantity : levels.quantity)
}

export function partialCloseAmount(levels, basis, percentage) {
  const percent = finiteNumber(percentage), base = partialCloseBasis(levels, basis)
  if (!(percent > 0) || percent > 100 || !(base > 0)) return ''
  const step = Number(levels.quantityStep)
  const raw = base * percent / 100
  // Percent shortcuts round down to a tradable step; they never close more
  // than requested. The server validates the exact decimal quantity again.
  return String(Number((step > 0 ? Math.floor(raw / step + 1e-9) * step : raw).toFixed(12)))
}

export function partialCloseError(levels, amount) {
  const value = finiteNumber(amount), remaining = Number(levels.quantity)
  const min = Number(levels.quantityMin), step = Number(levels.quantityStep)
  if (!(value > 0) || value > remaining + 1e-12) return 'Nhập khối lượng lớn hơn 0 và không vượt quá vị thế.'
  if (min > 0 && value < min - 1e-12) return 'Khối lượng đóng nhỏ hơn mức tối thiểu.'
  if (step > 0 && Math.abs(value / step - Math.round(value / step)) > 1e-7) return 'Khối lượng đóng phải đúng bước khối lượng.'
  const rest = Number((remaining - value).toFixed(12))
  if (rest > 1e-12 && min > 0 && rest < min - 1e-12) return 'Khối lượng còn lại nhỏ hơn mức tối thiểu. Chọn Tối đa để đóng hết.'
  return ''
}
