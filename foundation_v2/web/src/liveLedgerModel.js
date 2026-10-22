import { dealNet } from './liveWorkspaceModel.js'

const amount = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null

export function manualSnapshot(account, records, now = Date.now()) {
  if (!account) return null
  const trades = records.filter(record => record.kind === 'trade' && record.payload.account_id === account.record_id)
  const deals = trades.map(record => {
    const item = record.payload
    return { ticket: record.record_id, type: item.side === 'BUY' ? 0 : 1, entry: 1, symbol: item.symbol,
      time_msc: Date.parse(item.closed_at_utc), volume: Number(item.quantity), price: Number(item.exit_price),
      profit: amount(item.gross_pnl), commission: amount(item.commission), swap: amount(item.swap), fee: amount(item.fee), record }
  })
  const total = deals.every(deal => dealNet(deal) !== null) ? deals.reduce((sum, deal) => sum + dealNet(deal), 0) : null
  const opening = amount(account.payload.opening_balance)
  return { source: 'Thủ công', manual: true, captured_at_utc: new Date(now).toISOString(),
    history_from_utc: account.payload.opening_at_utc || account.created_at_utc,
    account: { account_ref: account.record_id, name: account.payload.name, currency: account.payload.currency,
      opening_balance: opening, balance: opening !== null && total !== null ? opening + total : null,
      equity: null, profit: null }, deals, positions: null, orders: null, quotes: null, cashflows: [] }
}

export function closedTradeStats(deals, openingBalance) {
  const values = deals.map(dealNet), known = values.every(value => value !== null)
  const wins = values.filter(value => value !== null && value > 1e-12)
  const losses = values.filter(value => value !== null && value < -1e-12)
  const net = known ? values.reduce((sum, value) => sum + value, 0) : null
  return { net, count: deals.length, winRate: known && deals.length ? wins.length / deals.length * 100 : null,
    profitFactor: known && losses.length ? wins.reduce((sum, value) => sum + value, 0) / -losses.reduce((sum, value) => sum + value, 0) : null,
    returnPercent: net !== null && typeof openingBalance === 'number' && openingBalance > 0 ? net / openingBalance * 100 : null }
}

export function tagResults(deals) {
  const groups = new Map()
  for (const deal of deals) for (const tag of new Set(deal.record?.payload.tags || [])) {
    if (!groups.has(tag)) groups.set(tag,[])
    groups.get(tag).push(deal)
  }
  return [...groups].map(([tag, rows]) => ({ tag, ...closedTradeStats(rows) })).sort((a, b) => a.tag.localeCompare(b.tag))
}

export const LIVE_CSV_COLUMNS = ['symbol','side','quantity','opened_at_utc','closed_at_utc','entry_price','exit_price','gross_pnl','commission','swap','fee','tags','note']
const quote = (value, numeric = false) => {
  const text = String(value ?? '')
  const safe = /^[\t\r\n]/.test(text) || !numeric && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"','""')}"`
}
export function exportTradesCsv(records) {
  return '\uFEFF' + [LIVE_CSV_COLUMNS.join(','), ...records.map(record => LIVE_CSV_COLUMNS.map(key => quote(key === 'tags' ? record.payload.tags.join('|') : record.payload[key], ['quantity','entry_price','exit_price','gross_pnl','commission','swap','fee'].includes(key))).join(','))].join('\r\n')
}

// The same strict schema is used for the downloadable template and import review.
export function parseTradesCsv(text) {
  const rows = [], row = []; let cell = '', quoted = false, afterQuote = false
  const source = text.replace(/^\uFEFF/, '')
  if (source.length > 1_000_000) throw new Error('Tệp CSV tối đa 1 MB.')
  for (let i = 0; i <= source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i+1] === '"') { cell += '"'; i++ }
      else if (char === '"') { quoted = false; afterQuote = true }
      else if (char === undefined) throw new Error('CSV có dấu ngoặc kép chưa đóng.')
      else cell += char
    } else if (char === ',' || char === '\n' || char === undefined) {
      row.push(cell.replace(/\r$/, '')); cell = ''; afterQuote = false
      if (char !== ',') { if (row.some(value => value !== '')) rows.push([...row]); row.length = 0 }
    } else if (char === '"' && !cell && !afterQuote) quoted = true
    else if (afterQuote && char !== '\r') throw new Error('CSV không đúng định dạng.')
    else cell += char
  }
  if (rows.shift()?.join(',') !== LIVE_CSV_COLUMNS.join(',')) throw new Error('Cột CSV không đúng mẫu. Tải mẫu CSV để kiểm tra.')
  if (!rows.length || rows.length > 500) throw new Error('Mỗi tệp cần từ 1 đến 500 giao dịch.')
  return rows.map((values, index) => {
    if (values.length !== LIVE_CSV_COLUMNS.length) throw new Error(`Dòng ${index+2} không đủ cột.`)
    const item = Object.fromEntries(LIVE_CSV_COLUMNS.map((key,i) => [key,values[i]]))
    const tags = item.tags.split('|').map(tag => tag.trim()).filter(Boolean)
    if (item.symbol.trim().length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(item.symbol) || item.note.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(item.note) || tags.length > 20 || tags.some(tag => tag.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(tag)) || new Set(tags.map(tag => tag.toLowerCase())).size !== tags.length) throw new Error(`Dòng ${index+2}: kiểm tra ký tự và giới hạn sản phẩm (64), ghi chú (20.000), nhãn (tối đa 20 nhãn riêng biệt, 64 ký tự mỗi nhãn).`)
    const decimals = ['quantity','entry_price','exit_price','gross_pnl','commission','swap','fee']
    if (!item.symbol.trim() || !['BUY','SELL'].includes(item.side) || decimals.some(key => item[key].length > 32 || !/^-?\d+(\.\d{1,12})?$/.test(item[key]) || !Number.isFinite(Number(item[key])) || Math.abs(Number(item[key])) > 1e15)
      || ['quantity','entry_price','exit_price'].some(key => Number(item[key]) <= 0)
      || ![item.opened_at_utc,item.closed_at_utc].every(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19))
      || Date.parse(item.closed_at_utc) < Date.parse(item.opened_at_utc)) throw new Error(`Dòng ${index+2}: kiểm tra giá, thời gian UTC và số tiền.`)
    return { ...item, symbol:item.symbol.trim().toUpperCase(), tags }
  })
}
