import { dealNet, filterLiveDeals, LIVE_FILTERS } from './liveWorkspaceModel.js'

const known = Number.isFinite
const positive = value => known(value) && value > 0
const same = (a, b) => positive(a) && positive(b) && Math.abs(a - b) <= Math.max(a, b) * 1e-8
const sum = (rows, value) => rows.every(row => known(value(row))) ? rows.reduce((total, row) => total + value(row), 0) : null
const weighted = rows => rows.length && rows.every(row => positive(row.volume) && positive(row.price))
  ? rows.reduce((total, row) => total + row.price * row.volume, 0) / sum(rows, row => row.volume) : null
export const MT5_ORDER_LABELS = ['Market', 'Market', 'Buy limit', 'Sell limit', 'Buy stop', 'Sell stop', 'Buy stop limit', 'Sell stop limit']

function placementFor(deal, payload) {
  const matches = (payload.trade_placements || []).filter(item => item.deal === deal.ticket
    && item.order === deal.order && item.symbol === deal.symbol && item.side === (deal.type === 0 ? 'BUY' : 'SELL')
    && same(item.volume, deal.volume) && same(item.filled_volume, deal.volume)
    && item.account_login === payload.account_login && item.server === payload.account_binding?.server)
  return matches.length === 1 ? matches[0] : null
}

// Reconstruct from unfiltered history: an exit is the opposite deal side, not
// another independent trade. Never fabricate an opening outside this history.
export function brokerTradeRows(payload) {
  const groups = new Map()
  const tickets = new Set()
  for (const deal of payload?.deals || []) {
    if (![0, 1].includes(deal.type) || tickets.has(deal.ticket)) continue
    tickets.add(deal.ticket)
    const key = positive(deal.position_id) ? `position:${deal.position_id}` : `deal:${deal.ticket}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(deal)
  }
  return [...groups].map(([ticket, fills]) => {
    const ordered = [...fills].sort((a, b) => a.time_msc - b.time_msc || a.ticket - b.ticket)
    const entries = ordered.filter(deal => deal.entry === 0), exits = ordered.filter(deal => [1, 3].includes(deal.entry))
    const first = entries[0], last = exits.at(-1), type = first?.type ?? null
    let remaining = 0
    const coherent = Boolean(first && ordered[0] === first && positive(first.position_id)) && ordered.every(deal => {
      if (!positive(deal.volume) || !known(deal.time_msc) || deal.symbol !== first.symbol) return false
      if (deal.entry === 0 && deal.type === type) remaining += deal.volume
      else if ([1, 3].includes(deal.entry) && deal.type !== type) remaining -= deal.volume
      else return false // Netting reversals need a separate lifecycle, not a guessed pair.
      return remaining >= -1e-8
    })
    const volume = sum(entries, deal => deal.volume), exited = sum(exits, deal => deal.volume)
    const live = (payload.positions || []).find(position => String(position.identifier ?? position.ticket) === String(first?.position_id))
    const closed = coherent && same(volume, exited) && !live && Array.isArray(payload.positions)
    const open = coherent && volume > exited && live && same(volume - exited, live.volume)
    const status = closed ? 'Closed' : open ? 'Open' : 'Incomplete'
    const placements = entries.map(deal => placementFor(deal, payload))
    const metadata = coherent ? placements : []
    const uniform = key => metadata.length && metadata.every(item => item && item[key] === metadata[0]?.[key]) ? metadata[0][key] : null
    const orderType = uniform('order_type')
    const net = sum(ordered, dealNet), gross = sum(ordered, deal => deal.profit)
    const fees = sum(ordered, row => known(row.commission) && known(row.swap) && known(row.fee) ? row.commission + row.swap + row.fee : null)
    const priceOpen = coherent ? weighted(entries) : null, priceClose = closed ? weighted(exits) : null
    const stop = uniform('stop_loss'), direction = type === 0 ? 1 : -1
    const stopDistance = positive(priceOpen) && positive(stop) ? (priceOpen - stop) * direction : null
    return {
      ticket, position_id: first?.position_id ?? ordered[0].position_id, fills: ordered, status,
      symbol: ordered[0].symbol, type, entry_type: typeof orderType === 'number' ? MT5_ORDER_LABELS[orderType] : orderType === 'market' ? 'Market' : null,
      time_msc: (closed ? last : first)?.time_msc ?? ordered.at(-1).time_msc,
      recorded_at_utc: first?.time_msc ?? null, open_time_utc: first?.time_msc ?? null,
      report_time_utc: closed ? last.time_msc : null, close_time_utc: closed ? last.time_msc : null,
      price_open: priceOpen, price_close: priceClose,
      quantity: volume || null, stop_loss: positive(uniform('stop_loss')) ? uniform('stop_loss') : null,
      take_profit: positive(uniform('take_profit')) ? uniform('take_profit') : null,
      net_pnl: net, gross_pnl: gross, fees,
      // R measures the realized price move in original stop-distance units.
      // Placement previews can use a different quote; fees remain in net PnL.
      realized_r: closed && stopDistance > 0 && positive(priceClose) ? (priceClose - priceOpen) * direction / stopDistance : null,
      // Feed the existing filter semantics a trade's side and complete net PnL.
      profit: gross, commission: fees, swap: 0, fee: 0,
    }
  })
}

export function filterBrokerTrades(payload, filters = LIVE_FILTERS) {
  const rows = brokerTradeRows(payload)
  const selected = { ...LIVE_FILTERS, ...filters }
  const eligible = rows.filter(row => selected.side === 'all' || row.type === Number(selected.side))
  const ids = new Set(filterLiveDeals({ ...payload, deals: eligible.map(row => ({ ...row, type: row.type ?? 0 })) }, { ...selected, side: 'all' }).map(row => row.ticket))
  return rows.filter(row => ids.has(row.ticket))
}
