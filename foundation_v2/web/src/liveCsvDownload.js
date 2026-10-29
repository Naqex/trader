import { exportTradesCsv } from './liveLedgerModel.js'

export function downloadLiveCsv(records = [], name = 'naqex-trader-trades.csv') {
  const url = URL.createObjectURL(new Blob([exportTradesCsv(records)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
