import { finiteNumber, marketQuotes, orderDraft } from './replayOrderModel.js'

const direction = (side, kind) => (side === 'BUY' ? 1 : -1) * (kind === 'stopLoss' ? -1 : 1)
const positive = (...values) => values.every(value => finiteNumber(value) > 0)

export function selectOrderDraft(current, replay, instrument, { side = current.side, orderType = current.orderType || 'market' }) {
  if (side === current.side && orderType === (current.orderType || 'market')) return current
  const next = { ...orderDraft(replay, instrument, side, orderType), quantity: current.quantity, sizingMode:current.sizingMode, protectionEnabled: current.protectionEnabled }
  const quotes = marketQuotes(replay)
  const reference = draft => draft.orderType && draft.orderType !== 'market' ? draft.entryPrice : draft.side === 'BUY' ? quotes.ask : quotes.bid
  // Only reprice protection the user enabled; blank enabled fields stay blank.
  for (const key of ['stopLoss', 'takeProfit']) {
    const pips = protectionPips(current[key], reference(current), current.side, key, instrument)
    next[key] = current.protectionEnabled[key] && pips !== '' ? protectionPrice(pips, reference(next), side, key, instrument) : ''
  }
  if (current.takeProfits?.length) next.takeProfits = current.takeProfits.map(target => ({ ...target,
    price: protectionPrice(protectionPips(target.price, reference(current), current.side, 'takeProfit', instrument), reference(next), side, 'takeProfit', instrument) }))
  return next
}

export function formatProtectionMoney(amount, currency, locale) {
  if (amount === null || !currency) return '-'
  const parts = new Intl.NumberFormat(locale, { style:'currency', currency, currencyDisplay:'narrowSymbol', minimumFractionDigits:2, maximumFractionDigits:2 }).formatToParts(Math.abs(amount))
  const symbol = parts.find(part => part.type === 'currency')?.value || currency
  return `${symbol}${/^[A-Z]+$/.test(symbol) ? ' ' : ''}${parts.filter(part => !['currency','literal'].includes(part.type)).map(part => part.value).join('')}`
}

// Percentages are a form convenience. Persist exact lot quantities so replay
// never reallocates a previously accepted target after rounding or a fill.
export function partialTargets(draft, instrument) {
  if (!draft.takeProfits?.length || !draft.protectionEnabled.takeProfit) return null
  const total = finiteNumber(draft.quantity), step = finiteNumber(instrument?.quantity_step), min = finiteNumber(instrument?.quantity_min)
  const rows = draft.takeProfits.map((row,index) => ({ ...row, price:index === 0 ? draft.takeProfit : row.price }))
  if (!(total > 0 && step > 0 && min > 0) || rows.length > 8 || rows.some(row => !(finiteNumber(row.percent) > 0)) || Math.abs(rows.reduce((sum,row) => sum + Number(row.percent),0) - 100) > 1e-7) throw new Error('Tổng tỷ lệ chốt lời phải bằng 100%.')
  let allocated = 0
  return rows.map((row,index) => {
    const quantity = index === rows.length - 1 ? Number((total - allocated).toFixed(10)) : Number((Math.floor((total * Number(row.percent) / 100) / step + 1e-8) * step).toFixed(10))
    const units = quantity / step
    if (quantity < min || Math.abs(units - Math.round(units)) > 1e-7) throw new Error('Khối lượng quá nhỏ để chia các mức TP theo bước của tài sản.')
    const price = finiteNumber(row.price), previous = index > 0 ? Number(rows[index-1].price) : null
    if (!(price > 0) || (previous !== null && (draft.side === 'BUY' ? price <= previous : price >= previous))) throw new Error('Các mức TP phải xếp từ gần đến xa theo hướng lệnh.')
    allocated += quantity
    return { target_id:row.id, price:String(row.price), quantity:String(quantity) }
  })
}

export function protectionPips(price, entry, side, kind, instrument) {
  const pip = finiteNumber(instrument?.pip_size)
  if (!positive(price, entry, pip)) return ''
  const pips = (Number(price) - Number(entry)) * direction(side, kind) / pip
  return Number.isFinite(pips) ? Number(pips.toFixed(4)) : ''
}

export function protectionPrice(pips, entry, side, kind, instrument) {
  const pip = finiteNumber(instrument?.pip_size), tick = finiteNumber(instrument?.tick_size)
  if (finiteNumber(pips) === null || !positive(entry, pip, tick)) return ''
  const price = Number(entry) + Number(pips) * pip * direction(side, kind)
  const rounded = Math.round(price / tick) * tick
  return rounded > 0 && Number.isFinite(rounded) ? String(Number(rounded.toFixed(10))) : ''
}

// A gross estimate only: the simulator remains authoritative for fills and fees.
export function protectionAmount(price, entry, side, quantity, instrument, costs) {
  const contract = finiteNumber(instrument?.contract_size), rate = finiteNumber(costs?.quote_to_account_rate)
  if (!costs?.account_ccy || !positive(price, entry, quantity, contract, rate)) return null
  const amount = (Number(price) - Number(entry)) * (side === 'BUY' ? 1 : -1) * Number(quantity) * contract * rate
  return Number.isFinite(amount) ? amount : null
}

export function quantityForRisk(budget, price, entry, side, instrument, costs) {
  const lossPerUnit = -protectionAmount(price, entry, side, 1, instrument, costs)
  const step = finiteNumber(instrument?.quantity_step), minimum = finiteNumber(instrument?.quantity_min)
  if (!positive(budget, lossPerUnit, step, minimum)) return null
  const units = Number(budget) / lossPerUnit / step
  let quantity = Number((Math.floor(units + Number.EPSILON * Math.max(1, Math.abs(units)) * 4) * step).toFixed(10))
  // Floating point rounding must never turn the preview into an upward size round.
  if (quantity * lossPerUnit > Number(budget) + 1e-8) quantity = Number((quantity - step).toFixed(10))
  return quantity >= minimum && Number.isFinite(quantity) ? String(quantity) : null
}
