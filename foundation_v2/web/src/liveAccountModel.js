import { manualSnapshot } from './liveLedgerModel.js'
import { summarizeDeals } from './liveWorkspaceModel.js'

const known = value => typeof value === 'number' && Number.isFinite(value)

export function liveAccountRows(accounts, records, broker) {
  return [
    ...(broker?.connections?.length ? broker.connections.map(connection => ({
      id:`broker:${connection.id}`, name:connection.name, source:'MT5', status:connection.status === 'connected' && (Date.now()-Date.parse(connection.last_synced_at)>180000 || broker.connection_id === connection.id && broker.stale) ? 'stale' : connection.status,
      updated:connection.last_synced_at, connection,
      snapshot:broker.connection_id === connection.id && broker.account ? broker : {account:connection.account || {},source:connection.source},
    })) : broker?.account ? [{ id: 'broker', name: `${broker.source || 'MT5'} · ${broker.account.account_ref}`, source: 'MT5', status: broker.stale ? 'stale' : 'synced', updated: broker.captured_at_utc, snapshot: broker }] : []),
    ...accounts.map(record => ({ id: record.record_id, name: record.payload.name, source: 'Ghi tay', status: 'manual', updated: records.filter(item => item.record_id === record.record_id || item.payload.account_id === record.record_id).map(item => item.updated_at_utc || item.created_at_utc).filter(Boolean).sort().at(-1), record, snapshot: manualSnapshot(record, records) })),
  ]
}

export function accountTransactions(row) {
  if (!row) return null
  if (row.record) return [{ id: `opening:${row.id}`, kind: 'opening', label: 'Số dư ban đầu', amount: row.snapshot.account.opening_balance, time: Date.parse(row.record.created_at_utc) }]
  if (!Array.isArray(row.snapshot.cashflows)) return null
  return row.snapshot.cashflows.map(item => {
    // MT5 balance events use profit for the cash movement, not trading PnL.
    const amount = known(item.profit) ? item.profit : null
    const kind = item.type === 2 && amount !== null && amount !== 0 ? amount > 0 ? 'deposit' : 'withdrawal' : [4,7,8,9,10,11,17].includes(item.type) ? 'fee' : 'other'
    return { id: String(item.ticket), kind, label: {deposit:'Nạp tiền',withdrawal:'Rút tiền',fee:'Phí'}[kind] || `MT5 · ${item.type}`, amount, time: item.time_msc }
  }).sort((a,b) => b.time-a.time)
}

export function accountCashSummary(row) {
  const transactions = accountTransactions(row)
  const sum = kind => !row || row.record || transactions === null || transactions.some(item => item.amount === null) ? null : transactions.filter(item => item.kind === kind).reduce((total,item) => total + item.amount,0)
  return { deposit:sum('deposit'),withdrawal:sum('withdrawal'),fees:sum('fee'),net:row ? summarizeDeals(row.snapshot.deals || [],Array.isArray(row.snapshot.deals)).net : null }
}
