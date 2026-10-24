import { memo, useMemo, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { sessionChartTrades } from './legacyChartTrades.js'
import ChartPositionsPanel from './ChartPositionsPanel.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { TestingEmptyState } from './TestingPageState.jsx'

export default memo(function LegacyPositions({ execution, assetStates, symbol, active = true }) {
  const { t, fmt } = useTestingLocale()
  const [tab, setTab] = useState('open'), [page, setPage] = useState(0), [size, setSize] = useState(10)
  const rows = useMemo(() => {
    if (!active) return []
    if (tab === 'closed') return sessionChartTrades(execution, assetStates, symbol)
    const executions = assetStates ? Object.entries(assetStates).filter(([, state]) => state.execution).map(([id, state]) => ({ id, execution:state.execution, symbol:state.execution.instrument_spec.instrument_id })) : [{ id:'active', execution, symbol }]
    return executions.flatMap(asset => {
      const item = tab === 'open' ? asset.execution?.position : asset.execution?.pending_market_order
      return item ? [{ ...item, key:`${asset.id}:${item.position_id || item.operation_id}`, symbol:asset.symbol, unrealized:tab === 'open' ? asset.execution.floating_pl : undefined, realized:tab === 'open' ? item.realized_pnl ?? '0' : undefined }] : []
    })
  }, [active, tab, execution, assetStates, symbol])
  if (!active) return null
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages - 1)
  const known = execution || Object.values(assetStates || {}).some(state => state.execution)
  return <ChartPositionsPanel label="Lệnh trong phiên replay" tab={tab} onTab={key => { setTab(key); setPage(0) }}
    tabs={[["open","Vị thế đang mở"],["pending","Lệnh chờ"],["closed","Vị thế đã đóng"]]}>
      {rows.length ? <><div className="legacy-position-scroll" tabIndex={0} role="region" aria-labelledby={`position-tab-${tab}`}><table><thead><tr>{['Mã giao dịch', 'Hướng', 'Khối lượng', 'Take profit', 'Stop loss', 'PnL chưa chốt', 'PnL đã chốt', 'Phí hoa hồng'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>
        {rows.slice(current * size, (current + 1) * size).map(row => <tr key={row.key}><td>{row.symbol}</td><td>{row.side || '—'}</td><td>{fmt(row.quantity, '', 8)}</td><td>{fmt(row.take_profit, '', 8)}</td><td>{fmt(row.stop_loss, '', 8)}</td><td>{fmt(row.unrealized)}</td><td>{fmt(row.realized)}</td><td>{fmt(row.commission)}</td></tr>)}
      </tbody></table></div>
      <PaginationFooter className="legacy-position-paging" label="Lệnh trong phiên replay" page={current + 1} pages={pages} onPageChange={value => setPage(value - 1)} pageSize={size} sizes={[10, 25, 50]} onPageSizeChange={value => { setSize(value); setPage(0) }} /></>
        : <TestingEmptyState kind={known ? `chart-${tab}` : 'chart-unknown'} />}
  </ChartPositionsPanel>
})
