import ChartTradingDock from './ChartTradingDock.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function Mt5TradingBar({ workspace, scopeId, snapshot, positions, instrument, onQuickTrade, ledgerEvent, disabled, analyticsHref, theme, children }) {
  const { fmt } = useTestingLocale()
  const money = value => {
    if (!Number.isFinite(value)) return '—'
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency:snapshot.account.currency }).format(value) }
    catch { return fmt(value, snapshot?.account?.currency ? ` ${snapshot.account.currency}` : '') }
  }
  const floating = positions.length && positions.every(item => Number.isFinite(item.profit)) ? positions.reduce((sum,item) => sum + item.profit,0) : null
  return <ChartTradingDock key={`${workspace}:${scopeId}`} workspace={workspace} scopeId={`mt5:${scopeId}`} label="Giao dịch MT5" theme={theme}
    instrument={instrument} reference={snapshot?.quote?.ask} disabled={disabled} settingsDisabled={!instrument} onQuickTrade={onQuickTrade}
    quickLabel="Chuẩn bị lệnh MT5 theo khối lượng và preset đã chọn" analyticsHref={analyticsHref} openSignal={ledgerEvent?.sequence}
    money={money} equity={snapshot?.account?.equity} floating={floating} hasPosition={positions.length > 0}
    accountDetails={[["Balance",snapshot?.account?.balance],["Equity",snapshot?.account?.equity],["Free margin",snapshot?.account?.margin_free]]}>
    {children}
  </ChartTradingDock>
}
