import { getTimezone } from './timezone.js'
import ChartTradingDock from './ChartTradingDock.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { readLiveStatus } from './liveStatusApi.js'
import { mt5AccountPnl } from './mt5AccountPnl.js'

export default function Mt5TradingBar({ workspace, connectionId, scopeId, snapshot, positions, instrument, onQuickTrade, ledgerEvent, disabled, analyticsHref, theme, children }) {
  const { t, fmt, locale } = useTestingLocale()
  const [walletOpen,setWalletOpen] = useState(false)
  const cache = useMemo(()=>({}),[workspace,connectionId])
  const history = useQuery({queryKey:['mt5-wallet-history',workspace,connectionId],queryFn:({signal})=>readLiveStatus(workspace,signal,connectionId,false,cache),
    enabled:walletOpen&&Boolean(connectionId)&&snapshot?.status==='ready',staleTime:15000,gcTime:30000,retry:false,refetchInterval:walletOpen?15000:false})
  const money = value => {
    if (!Number.isFinite(value)) return '-'
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency:snapshot.account.currency }).format(value) }
    catch { return fmt(value, snapshot?.account?.currency ? ` ${snapshot.account.currency}` : '') }
  }
  const {floating,realized,from,to} = mt5AccountPnl(snapshot,history.isError?null:history.data,connectionId)
  const date = value => new Intl.DateTimeFormat(locale,{timeZone:getTimezone(),day:'2-digit',month:'2-digit',year:'numeric'}).format(value)
  const note = history.isFetching && !history.data ? t('Đang đọc lịch sử giao dịch…') : realized===null ? t('Chưa có lịch sử giao dịch hợp lệ để tính PnL đã chốt.')
    : t('PnL giao dịch từ {from} đến {to}, gồm phí và swap; không gồm nạp/rút.',{from:date(from),to:new Intl.DateTimeFormat(locale,{timeZone:getTimezone(),day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(to)})
  return <ChartTradingDock key={`${workspace}:${scopeId}`} workspace={workspace} scopeId={`mt5:${scopeId}`} label="Giao dịch MT5" theme={theme}
    instrument={instrument} reference={snapshot?.quote?.ask} disabled={disabled} settingsDisabled={!instrument} onQuickTrade={onQuickTrade}
    quickLabel="Chuẩn bị lệnh MT5 theo khối lượng và preset đã chọn" analyticsHref={analyticsHref} openSignal={ledgerEvent?.sequence}
    money={money} equity={snapshot?.account?.equity} floating={floating} hasPosition={positions.length > 0}
    onAccountOpenChange={setWalletOpen} accountNote={note}
    accountDetails={[["Equity",snapshot?.account?.equity],["Realized PnL",realized],["Unrealized PnL",floating]]}>
    {children}
  </ChartTradingDock>
}
