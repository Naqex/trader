import { useEffect } from 'react'
import ChartTradingDock from './ChartTradingDock.jsx'
import LegacyPositions from './LegacyPositions.jsx'
import { useNotifications } from './Notifications.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { finiteNumber } from './replayOrderModel.js'

export default function LegacyTradingBar({ order, analyticsHref, propRulesAction, symbol, theme, sessionId, workspace, readStatus, onPresetChange }) {
  const { fmt } = useTestingLocale()
  const notify = useNotifications()
  useEffect(() => { if (order.notice && notify) notify(order.notice, order.notice.kind === 'error' ? 'error' : 'success') }, [order.notice, notify])
  const execution = order.execution, account = order.account
  const disabled = order.disabled || Boolean(order.active) || (!execution && (!order.canInitialize || order.tick.options === null && !order.executionConfig?.forceBar))
  const currency = account?.account_ccy || execution?.cost_model?.account_ccy || order.configuredCurrency || order.costs?.account_ccy
  const money = value => {
    const amount = finiteNumber(value)
    if (amount === null) return '-'
    if (!currency) return fmt(amount)
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency, maximumFractionDigits:2 }).format(amount) }
    catch { return fmt(amount, ' ' + currency) }
  }
  const realized = finiteNumber(account?.balance) !== null && finiteNumber(account?.starting_balance) !== null ? Number(account.balance) - Number(account.starting_balance) : null
  const hasPosition = account?.open_position_count != null ? Number(account.open_position_count) > 0 : order.assetStates ? Object.values(order.assetStates).some(asset => Boolean(asset.execution?.position)) : Boolean(execution?.position)
  return <ChartTradingDock key={`${workspace}:${sessionId}`} workspace={workspace} scopeId={sessionId} instrument={order.instrument} reference={order.reference}
    disabled={disabled} onQuickTrade={order.quickTrade} onPresetChange={onPresetChange} analyticsHref={analyticsHref} propRulesAction={propRulesAction}
    readStatus={readStatus} theme={theme} label="Giao dịch mô phỏng" money={money} equity={account ? account.equity : order.configuredBalance}
    floating={finiteNumber(account?.floating_pl)} hasPosition={hasPosition}
    accountDetails={account ? [['Equity',account.equity],['Realized PnL',realized],['Unrealized PnL',account.floating_pl]] : [['Account Balance',order.configuredBalance]]}>
    {active => <LegacyPositions execution={execution} assetStates={order.assetStates} symbol={symbol} active={active} />}
  </ChartTradingDock>
}
