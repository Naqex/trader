import { manualSnapshot } from './liveLedgerModel.js'
import { summarizeDeals } from './liveWorkspaceModel.js'

const known = value => typeof value === 'number' && Number.isFinite(value)

export function mt5AccountName(connection) {
  const login = connection.account_login || connection.login_hint
  const nickname = connection.name?.trim()
  return [login ? `MT5 ${login}` : 'MT5',
    ['demo','real','contest'].includes(connection.account_environment) ? connection.account_environment : null,
    nickname && nickname !== [login ? `MT5 ${login}` : 'MT5', connection.account_environment].filter(Boolean).join(' - ') && !/^(?:MetaTrader(?:\s*5)?|MT5)$/i.test(nickname) ? nickname : null,
  ].filter(Boolean).join(' - ')
}

export function accountDraftErrors(draft) {
  const errors = {}
  if (!draft.name.trim()) errors.name = 'Nhập tên tài khoản.'
  else if (draft.name.trim().length > 160) errors.name = 'Tên tài khoản tối đa 160 ký tự.'
  if (!/^[A-Z]{3}$/.test(draft.currency)) errors.currency = 'Chọn đơn vị tiền tệ.'
  if (!['live','demo','prop'].includes(draft.account_type)) errors.account_type = 'Chọn loại tài khoản.'
  if (!/^\d+(\.\d{1,12})?$/.test(draft.opening_balance) || Number(draft.opening_balance) > 1e15) errors.opening_balance = 'Nhập số tiền từ 0 đến 1.000.000.000.000.000, tối đa 12 số thập phân.'
  if (!draft.opening_at_utc || !Number.isFinite(Date.parse(`${draft.opening_at_utc.replace(/Z$/,'')}Z`))) errors.opening_at_utc = 'Chọn ngày và giờ vốn ban đầu.'
  return errors
}

export function duplicateAccountSeed(row, now = Date.now()) {
  // Copy configuration into a new manual journal; never duplicate trades or credentials.
  return { name:`${row.name.slice(0,148)} (bản sao)`, currency:row.snapshot.account.currency || 'USD',
    account_type:row.record?.payload.account_type || '',
    opening_balance:row.record?.payload.opening_balance ?? (known(row.snapshot.account.balance) ? String(row.snapshot.account.balance) : ''),
    opening_at_utc:new Date(now).toISOString().slice(0,16) }
}

export function liveAccountRows(accounts, records, broker) {
  return [
    ...(broker?.connections?.length ? broker.connections.map(connection => ({
      id:`broker:${connection.id}`, name:mt5AccountName(connection), source:'MT5', status:connection.status === 'connected' && (Date.now()-Date.parse(connection.last_synced_at)>180000 || broker.connection_id === connection.id && broker.stale) ? 'stale' : connection.status,
      updated:connection.last_synced_at, connection,
      snapshot:broker.connection_id === connection.id && broker.account ? broker : {account:connection.account || {},source:connection.source},
    })) : broker?.account ? [{ id: 'broker', name: `${broker.source || 'MT5'} · ${broker.account.account_ref}`, source: 'MT5', status: broker.stale ? 'stale' : 'synced', updated: broker.captured_at_utc, snapshot: broker }] : []),
    ...accounts.map(record => ({ id: record.record_id, name: record.payload.name, source: 'Thủ công', status: 'manual', updated: records.filter(item => item.record_id === record.record_id || item.payload.account_id === record.record_id).map(item => item.updated_at_utc || item.created_at_utc).filter(Boolean).sort().at(-1), record, snapshot: manualSnapshot(record, records) })),
  ]
}

export function accountTransactions(row, { key = 'time', ascending = false } = {}) {
  if (!row) return null
  const opening = accountInitialBalance(row)
  const initial = opening ? [{ id:`opening:${row.id}`,kind:'opening',label:'Số dư ban đầu',...opening }] : []
  if (row.record) return initial
  if (!Array.isArray(row.snapshot.cashflows) && !initial.length) return null
  return [...initial,...(row.snapshot.cashflows || []).map(item => {
    // MT5 balance events use profit for the cash movement, not trading PnL.
    const amount = known(item.profit) ? item.profit : null
    const kind = item.type === 2 && amount !== null && amount !== 0 ? amount > 0 ? 'deposit' : 'withdrawal' : [4,7,8,9,10,11,17].includes(item.type) ? 'fee' : 'other'
    return { id: String(item.ticket), kind, label: {deposit:'Nạp tiền',withdrawal:'Rút tiền',fee:'Phí'}[kind] || `MT5 · ${item.type}`, amount, time: item.time_msc }
  })].sort((a,b) => {
    const left = a[key], right = b[key]
    if (!known(left)) return known(right) ? 1 : 0
    if (!known(right)) return -1
    return (left-right)*(ascending ? 1 : -1)
  })
}

export function accountInitialBalance(row) {
  if (!row) return null
  if (row.record) return {amount:row.snapshot.account.opening_balance,currency:row.snapshot.account.currency,time:Date.parse(row.record.payload.opening_at_utc || row.record.created_at_utc)}
  const baseline = row.connection?.balance_baseline || row.snapshot.balance_baseline
  return known(baseline?.amount) && baseline.currency && Number.isFinite(Date.parse(baseline.captured_at_utc))
    ? {amount:baseline.amount,currency:baseline.currency,time:Date.parse(baseline.captured_at_utc)} : null
}

export function accountCashSummary(row) {
  const transactions = accountTransactions(row)
  const sum = kind => !row || row.record || !Array.isArray(row.snapshot.cashflows) || transactions.some(item => item.amount === null) ? null : transactions.filter(item => item.kind === kind).reduce((total,item) => total + item.amount,0)
  return { deposit:sum('deposit'),withdrawal:sum('withdrawal'),fees:sum('fee'),net:row ? summarizeDeals(row.snapshot.deals || [],Array.isArray(row.snapshot.deals)).net : null }
}
