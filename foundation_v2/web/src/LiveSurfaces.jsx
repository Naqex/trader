import { currencyLabel } from './moneyFormat.js'
import { liveAccountCapital, mt5AccountName } from './liveAccountModel.js'
import { displayDate } from './dateFormat.js'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import SessionFilter from './SessionFilter.jsx'
import useLiveCalendarAccounts from './useLiveCalendarAccounts.js'
import { calendarAccountSelection } from './liveCalendarAccounts.js'
import TestingIcon from './TestingIcon.jsx'
import { CalendarNavigation, CalendarMonth, CalendarDay } from './CalendarView.jsx'
import { fetchLiveRecords, saveLiveRecord } from './liveLedgerApi.js'
import { fetchPlaybooks } from './playbookApi.js'
import { manualSnapshot, closedTradeStats } from './liveLedgerModel.js'
import { TestingSkeleton } from './TestingReadState.jsx'
import FilterDrawer from './FilterDrawer.jsx'
import LedgerFilterActions from './LedgerFilterActions.jsx'
import TableColumnControl from './TableColumnControl.jsx'
import { MANUAL_TRADE_COLUMNS, LIVE_TRADE_COLUMNS } from './liveTradeColumns.js'
import ProjectDateInput from './ProjectDateInput.jsx'
import { navigate } from './clientNavigation.js'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import { LIVE_FILTERS, calendarWeeks, calendarWeekSummary, liveCalendarBorders, cumulativeDealSeries, dayKey, dealNet, filterLiveDeals } from './liveWorkspaceModel.js'
import { buildAnalyticsModel } from './analyticsViewModel.js'
import { DEFAULT_EXTRA_FILTERS } from './tradingAnalyticsModel.js'
import { AnalyticsCurve, AnalyticsRing } from './AnalyticsCharts.jsx'
import { ChartHeading, ExpectancyComparison, FxAnalyticsFilters, FxAnalyticsReport } from './FxAnalytics.jsx'

const LiveAccounts = lazy(() => import('./LiveAccounts.jsx'))
const LiveDayNote = lazy(() => import('./LiveDayNote.jsx'))
const LiveRecordDialog = lazy(() => import('./LiveRecordDialog.jsx'))
const ManualTrades = lazy(() => import('./LiveJournalSurfaces.jsx').then(module => ({default:module.ManualTrades})))
const JournalNotes = lazy(() => import('./LiveJournalSurfaces.jsx').then(module => ({default:module.JournalNotes})))
const JournalTags = lazy(() => import('./LiveJournalSurfaces.jsx').then(module => ({default:module.JournalTags})))

const FILTER_LABELS = { asset: 'Assets', side: 'Side', outcome: 'Deal result', account: 'Accounts', day: 'Day', timezone: 'Timezone', from: 'Start', to: 'End' }
const FILTER_VALUES = { side: { 0: 'Buy', 1: 'Sell' }, outcome: { gain: 'Positive PnL', loss: 'Negative PnL', flat: 'Zero PnL' }, day: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] }
const ACCOUNT_PICKER_LABELS = { all:'Tất cả tài khoản', count:'{count} tài khoản', choose:'Chọn tài khoản', trigger:'Tài khoản: {name}', dialog:'Chọn tài khoản', search:'Tìm tài khoản', placeholder:'Tìm tài khoản…', empty:'Không tìm thấy tài khoản.' }
const filterValue = (key,value,t) => ['from','to'].includes(key) ? displayDate(value) : FILTER_VALUES[key]?.[value] ? t(FILTER_VALUES[key][value]) : value

function Action({ children, icon, primary, compact, onClick, label, title, ...props }) {
  const { t, timezone } = useTestingLocale()
  return <button type="button" className={`fxa-button${primary ? ' is-primary' : ''}${compact ? ' fxa-icon-button' : ''}`} aria-label={label ? t(label) : undefined} data-tooltip={title ? t(title) : undefined} onClick={onClick} {...props}>{icon && <TestingIcon kind={icon} />}{children}</button>
}

function Empty({ title, copy, icon = 'chart', action, onAction }) {
  const { t, timezone } = useTestingLocale()
  return <div className="live-empty" data-testid="live-empty">{icon && <div className="live-empty-art" aria-hidden="true"><TestingIcon kind={icon} size={72} /></div>}<h2>{t(title)}</h2>{copy && <p>{t(copy)}</p>}{action && <Action primary icon="plus" onClick={onAction}>{t(action)}</Action>}</div>
}

function FilterBar({ accountPicker, extra, columnControl, payload, draft, setDraft, applied, onApply, onClear, tags, tag, onTagChange }) {
  const { t, timezone } = useTestingLocale(), [show, setShow] = useState(''), [draftTag, setDraftTag] = useState(tag)
  const chips = Object.entries(applied).filter(([key, value]) => key !== 'timezone' && value !== LIVE_FILTERS[key] && value !== '')
  const change = patch => setDraft(current => ({...current,...patch}))
  const assets = [...new Set((payload?.deals || []).map(deal => deal.symbol).filter(Boolean))].sort()
  const choices = (key,options) => <div className="fxl-choices" role="group" aria-label={t(FILTER_LABELS[key])}>{options.map(([value,label]) => <label key={value}><input type="radio" name={`live-filter-${key}`} checked={draft[key] === value} onChange={() => change({[key]:value})} />{t(label)}</label>)}</div>
  const sections = [
    ['Assets', choices('asset',[['all','All assets'],...assets.map(value => [value,value])])],
    ['Side', choices('side',[['all','All sides'],['0','Buy'],['1','Sell']])],
    ['Deal result', choices('outcome',[['all','All results'],['gain','Positive PnL'],['loss','Negative PnL'],['flat','Zero PnL']])],
    ['Day', choices('day',[['all','All days'],...['Su','Mo','Tu','We','Th','Fr','Sa'].map((label,i) => [String(i),label])])],
    ['Date range', <div className="fxl-fields">{['from','to'].map(key => <label key={key} className="fxl-field">{t(FILTER_LABELS[key])}<ProjectDateInput clearable type="date" aria-label={t(FILTER_LABELS[key])} value={draft[key]} onChange={event => change({[key]:event.target.value})} /></label>)}</div>],
  ]
  return <section className="live-filters" aria-label={t('Filters')}>
    <div className="live-toolbar fxa-filter-toolbar is-ledger">{accountPicker}{extra}<LedgerFilterActions columnControl={columnControl} activeTab={show} onOpen={tab => { setDraft({...applied});setDraftTag(tag);setShow(tab) }} /></div>
    {show && <FilterDrawer initialTab={show} sections={sections} tags={<FxSelect label="Nhãn" multiple searchable value={draftTag} triggerContent={draftTag.length ? draftTag.join(', ') : t('Tất cả nhãn')} onChange={setDraftTag} options={tags.map(value => ({value,label:value,localize:false}))} />} onClose={() => setShow('')} onClear={() => { setDraft({...LIVE_FILTERS, timezone});setDraftTag([]) }} onApply={() => { onApply();onTagChange(draftTag);setShow('') }} invalid={Boolean(draft.from && draft.to && draft.from > draft.to)} />}

    {(chips.length > 0 || tag.length > 0) && <div className="live-filter-chips">{tag.length > 0 && <span>{t('Tags')}: {tag.join(', ')}</span>}{chips.map(([key,value]) => <span key={key}>{t(FILTER_LABELS[key])}: {filterValue(key,value,t)}</span>)}<button type="button" className="fxa-clear-filters" onClick={onClear}><TestingIcon kind="delete" />{t('Clear filters')}</button></div>}
  </section>
}

function Summary({ payload, deals, sidebar = false }) {
  const { t, fmt } = useTestingLocale(), available = Boolean(payload?.account && Array.isArray(payload.deals))
  const stats = closedTradeStats(deals), currency = payload?.account?.currency || ''
  const { net, count } = stats
  const average = count && Number.isFinite(net) ? net / count : null
  const values = deals.map(dealNet), known = values.every(Number.isFinite)
  const wins = values.filter(value => value !== null && value > 1e-12).length
  const losses = values.filter(value => value !== null && value < -1e-12).length
  const unknown = values.filter(value => value === null).length, flat = count - wins - losses - unknown
  const suffix = currency ? ` ${currency}` : ''
  const format = value => Number.isFinite(value) ? fmt(value, suffix) : 'N/A'
  const ratio = stats.winRate
  const averageWin = known && wins ? values.filter(value => value > 1e-12).reduce((sum, value) => sum + value, 0) / wins : null
  const averageLoss = known && losses ? values.filter(value => value < -1e-12).reduce((sum, value) => sum + value, 0) / losses : null
  // A filtered deal history cannot reconstruct a broker balance (cashflows and
  // earlier trades may be absent). The sparkline explicitly shows scoped PnL.
  const pnlPoints = useMemo(() => deals.every(deal => Number.isFinite(deal.time_msc)) ? [{ value: 0, label: t('Bắt đầu') }, ...cumulativeDealSeries(deals).map((point, index) => ({ ...point, label: `${index + 1}` }))] : [], [deals, t])
  return <section className={sidebar ? 'live-analytics-side' : 'live-metrics'} aria-label={t('Analytics')}>
    {sidebar && <h2><span className="live-analytics-title"><TestingIcon kind="chart" />{t('Analytics')}</span></h2>}
    {!available || !deals.length ? <Empty icon={sidebar ? null : 'chart'} title="No analytics yet" copy={available ? 'No deals in this selection.' : 'Select a connected account to view analytics.'} /> : <div className="live-analytics-charts">
      <article className="live-analytics-chart-row live-analytics-balance-row">
        <ChartHeading title="Total balance" note={<span>{fmt(count, '', 0)} {t('trades')}</span>} />
        <strong className="live-analytics-chart-value">{format(payload?.account?.balance)}</strong>
        <span className="live-analytics-curve-label">{t('Cumulative PnL in selection')}</span>
        <AnalyticsCurve series={[pnlPoints]} label={t('Cumulative PnL in selection')} suffix={suffix} height={96} sparkline />
      </article>
      <article className="live-analytics-chart-row">
        <div className="live-analytics-expectancy-heading"><strong className="live-analytics-chart-value">{format(average)}</strong><ChartHeading title="Expectancy per trade" /></div>
        <ExpectancyComparison data={{ averageWin, averageLoss }} currency={currency} suffix={suffix} />
      </article>
      <article className="live-analytics-chart-row">
        <ChartHeading title="Win rate" note={<strong>{Number.isFinite(ratio) ? fmt(ratio, '%', 2) : 'N/A'}</strong>} />
        <AnalyticsRing label={t('Win rate')} values={[
          { label: t('Win'), value: wins, color: 'var(--report-positive)' },
          { label: t('Loss'), value: losses, color: 'var(--report-negative)' },
          { label: t('Breakeven'), value: flat, color: 'var(--wm-content-muted)' },
          ...(unknown ? [{ label: t('Unknown'), value: unknown, color: 'var(--wm-border-strong)' }] : []),
        ]} />
      </article>
    </div>}
  </section>
}

function LiveAnalyticsReport({ payload, deals, sessionControl, issue }) {
  const { t, timezone } = useTestingLocale()
  const [filters, setFilters] = useState({ side: 'all', outcome: 'all', from: '', to: '' })
  const [extra, setExtra] = useState({ ...DEFAULT_EXTRA_FILTERS, timezone })
  useEffect(() => setExtra(current => ({ ...current, timezone })), [timezone])
  const analyticsRows = useMemo(() => deals.map((deal, index) => ({
    symbol: deal.symbol,
    side: deal.type === 0 ? 'buy' : 'sell',
    tags: deal.record?.payload?.tags || [],
    trade_id: String(deal.ticket ?? `live-${index + 1}`),
  })), [deals])
  const model = useMemo(() => {
    const opening = liveAccountCapital(payload)
    const datedDeals = filterLiveDeals({ ...payload, deals }, { ...LIVE_FILTERS, ...filters, timezone })
    const ordered = [...datedDeals].sort((a, b) => (a.time_msc || 0) - (b.time_msc || 0))
    let balance = opening
    const ledger = ordered.map((deal, index) => {
      const net = dealNet(deal)
      if (balance !== null && net !== null) balance += net
      else balance = null
      const time = Number.isFinite(deal.time_msc) ? new Date(deal.time_msc).toISOString() : null
      return {
        trade_id: String(deal.ticket ?? `live-${index + 1}`),
        session_id: 'live',
        source_id: 'live',
        symbol: deal.symbol,
        side: deal.type === 0 ? 'BUY' : 'SELL',
        report_time_utc: time,
        close_time_utc: time,
        open_time_utc: time,
        price_open: deal.price,
        price_close: deal.price,
        quantity: deal.volume,
        net_pnl: net,
        gross_pnl: deal.profit,
        fees: [deal.commission, deal.swap, deal.fee].every(Number.isFinite) ? deal.commission + deal.swap + deal.fee : null,
        realized_r: null,
        starting_balance: opening,
        account_currency: payload?.account?.currency,
        status: 'closed',
        tags: deal.record?.payload?.tags || [],
        closed_trade_balance: balance,
      }
    })
    const knownNet = ledger.every(row => Number.isFinite(row.net_pnl))
    const netPnl = knownNet ? ledger.reduce((sum, row) => sum + row.net_pnl, 0) : null
    const times = ledger.map(row => row.close_time_utc).filter(Boolean)
    const result = {
      schema_version: 'analytics-read-model-v1',
      preview: true,
      status: payload?.account ? 'ready' : 'empty',
      analytics_available: Boolean(payload?.account),
      account_currency: payload?.account?.currency,
      ledger,
      metrics: {
        net_pnl: netPnl,
        closed_trade_count: ledger.length,
        starting_balance: opening,
        ending_closed_trade_balance: ledger.at(-1)?.closed_trade_balance ?? opening,
        closed_trade_balance_curve: ledger.map(row => ({ trade_id: row.trade_id, closed_trade_balance: row.closed_trade_balance })),
      },
      scope: {
        selected_trade_count: ledger.length,
        total_trade_count: Array.isArray(payload?.deals) ? payload.deals.length : ledger.length,
        active_filters: false,
        time_basis: 'activity',
      },
      observed_range: { start_utc: times[0] || payload?.history_from_utc, end_utc: times.at(-1) || payload?.captured_at_utc },
      partial: ledger.some(row => !Number.isFinite(row.net_pnl) || !row.close_time_utc),
      sources: [{ session_id: 'live' }],
    }
    return buildAnalyticsModel(result, 'app', timezone)
  }, [payload, deals, timezone, filters])
  const reportExtra = useMemo(() => ({ ...DEFAULT_EXTRA_FILTERS, timezone, ...(extra || {}) }), [extra, timezone])
  return <section className="as-page fxa-page live-analytics-report" aria-label={t('Analytics')}>
    <FxAnalyticsFilters sourceType="Live" persistInUrl={false} filters={filters} onChange={setFilters} extra={reportExtra} onExtra={setExtra} rows={analyticsRows} labels={[]} sessionControl={sessionControl} pending={false} />
    {issue && <p className="live-status live-status-warning" role="status">{t(issue)}</p>}
    {payload?.account ? <FxAnalyticsReport model={model} accountBalance={Number.isFinite(payload.account.balance) ? payload.account.balance : null} extra={reportExtra} experiments={null} experimentStatus="unavailable" experimentError={t('Live chưa có đường giá để mô phỏng từ dữ liệu broker.')} config={{ stop_distance_ticks: 20, stop_multiplier: 1, target_r: 2 }} selected="" onSelect={() => {}} experimentScope="live" onNeedExperiments={() => {}} /> : <Empty title="No analytics yet" copy={issue ? null : 'Select a connected account to view analytics.'} />}
  </section>
}

function Calendar({ payload, deals, filters, filterBar, reviewScope, canWrite, onPreview, selectionKey, empty = false }) {
  const { t, fmt } = useTestingLocale()
  const [percent,setPercent] = useState(false), [selected,setSelected] = useState(''), [selectedPeriod,setSelectedPeriod] = useState('day')
  const [month, setMonth] = useState(() => dayKey(Date.parse(payload?.captured_at_utc) || Date.now(), filters.timezone).slice(0, 7))
  useEffect(() => { setSelected(''); setSelectedPeriod('day'); setPercent(false) }, [selectionKey])
  useEffect(() => { setSelected(''); setSelectedPeriod('day') }, [filters])
  const weeks = calendarWeeks(month, payload, deals, filters)
  const borders = liveCalendarBorders(weeks)
  const rows = deals.filter(deal => dayKey(deal.time_msc, filters.timezone).startsWith(month))
  const total = calendarWeekSummary(weeks.flat(), empty)
  const partialDetail = t('Chỉ cộng phần dữ liệu đã ghi nhận; chưa đủ dữ liệu cho toàn bộ phạm vi.')
  const currency = payload?.account?.currency || (empty ? 'USD' : '')
  // Summary totals use zero for an empty visual summary; day-level unknown
  // values keep their coverage semantics and are rendered separately below.
  const countLabel = count => t('{count} giao dịch', { count: Number.isFinite(count) ? count : 0 })
  const opening = liveAccountCapital(payload)
  const percentBasis = typeof opening === 'number' && Number.isFinite(opening) && opening > 0 ? opening : null
  const amount = value => percent ? value === null || percentBasis === null ? 'N/A' : fmt(value/percentBasis*100,'%') : fmt(value)
  const money = value => {
    return fmt(Number.isFinite(value) ? value : 0, currency ? ` ${currency}` : '')
  }
  const weekAmount = value => {
    if (percent) return amount(value)
    return money(value)
  }
  const selectedDays = selectedPeriod === 'week' ? (weeks.find(week => week.some(day => day.key === selected)) || []).filter(day => day.inMonth && day.eligible) : weeks.flat().filter(day => day.key === selected)
  const selectedRows = deals.filter(deal => selectedDays.some(day => day.key === dayKey(deal.time_msc, filters.timezone)))
  const review = () => onPreview('note', {
    title: t('Monthly review {month}',{month}),
    note: `${t(payload?.manual ? 'PnL đã ghi' : 'PnL deals đã đồng bộ')}: ${fmt(total.net, currency ? ` ${currency}` : '')}. ${rows.length} ${t(payload?.manual ? 'giao dịch đã đóng' : 'Filled deals')}.\n${t('Tài khoản')}: ${payload?.account?.name || payload?.account?.account_ref || '-'}. ${t('Timezone')}: ${filters.timezone}.\n${t('Scope')}: ${reviewScope}.\n${Object.entries(filters).filter(([key,value]) => key !== 'timezone' && value !== LIVE_FILTERS[key] && value !== '').map(([key,value]) => `${t(FILTER_LABELS[key])}: ${filterValue(key,value,t)}`).join(' · ')}`.trim(),
  })
  return <div className="live-split"><section className="live-calendar-section">
    {filterBar}<div className="live-calendar-content">
    <div className="live-calendar-toolbar"><CalendarNavigation month={month} onChange={next => { setSelected(''); setMonth(next) }}>
      <div className="live-toolbar-actions"><Action aria-pressed={!percent} label="Amount" onClick={() => setPercent(false)}>{currencyLabel(payload?.account?.currency) || '$'}</Action><Action aria-pressed={percent} title={percentBasis === null ? t('Percentage requires opening capital.') : undefined} onClick={() => setPercent(true)}>%</Action><Action disabled title="Chưa hỗ trợ chia sẻ tài khoản">{t('Share')}</Action><span className="live-calendar-action-divider" aria-hidden="true" /><Action icon="plus" disabled={!canWrite || !payload?.account || total.net === null} onClick={review}>{t('Monthly review')}</Action></div></CalendarNavigation>
    </div>
    {percent && percentBasis === null && <p className="live-calendar-unit-state" role="status">{t('Chưa có vốn ban đầu hợp lệ cho mọi tài khoản đã chọn; phần trăm hiển thị N/A.')}</p>}
    <CalendarMonth month={month} weeks={weeks} label={`${t('PnL calendar')} · ${filters.timezone}`} classes={{scroll:'live-calendar-scroll',grid:'live-calendar-grid',week:'live-calendar-week',weekday:'live-calendar-dayname'}} renderDay={day => { const displayValue = day.net === null ? '-' : percent ? amount(day.net) : money(day.net); return <CalendarDay key={day.key} day={day} style={borders.days.get(day.key)} className="live-calendar-cell" showAdd numberClassName="live-day-number" disabled={!day.eligible} selected={selectedPeriod === 'day' && selected === day.key} label={`${displayDate(day.key)} · ${displayValue}${day.partial ? ` · ${t('Data for this day is unavailable or incomplete.')}` : ''}`} value={day.inMonth && day.net !== null ? amount(day.net) : undefined} count={day.count !== null && day.count > 0 ? countLabel(day.count) : null} tooltip={day.partial ? partialDetail : undefined} tone={day.net > 0 ? 'gain' : day.net < 0 ? 'loss' : ''} onClick={() => { setSelectedPeriod('day'); setSelected(selected === day.key && selectedPeriod === 'day' ? '' : day.key) }}/> }} renderWeekTotal={(week,index) => {const summary = calendarWeekSummary(week,empty), monthDays = week.filter(day => day.inMonth), start = monthDays[0]?.key || week[0].key;return <button type="button" className="live-week-total" style={borders.totals[index]} aria-label={`${t('Week {count}',{count:index+1})} · ${countLabel(summary.count)} · ${weekAmount(summary.net)}`} onClick={() => { setSelectedPeriod('week'); setSelected(start) }}><div><span>{countLabel(summary.count)}</span><span aria-hidden="true">W{index+1}</span></div><strong>{weekAmount(summary.net)}</strong><span className="wm-calendar-add live-week-add" aria-hidden="true"><TestingIcon kind="zoom-in" size={20}/></span></button>}}/>
    <div className="live-month-total" title={total.partial ? partialDetail : undefined}><span>{t('Month total')}</span><strong>{weekAmount(total.net)}</strong><span>{countLabel(total.count)}</span></div>
    {selected && <Suspense fallback={null}><LiveDayNote date={selected} endDate={selectedPeriod === 'week' ? selectedDays.at(-1)?.key : undefined} period={selectedPeriod} partial={selectedDays.some(day => day.partial)} timezone={filters.timezone} currency={currency} deals={selectedRows} onClose={() => setSelected('')}/></Suspense>}
  </div></section><Summary payload={payload} deals={rows} sidebar /></div>
}

export default function LiveSurfaces({ workspace = 'tenant-a', section, payload: broker, query, preview, onRefresh }) {
  const { t, timezone } = useTestingLocale()
  const [ledger,setLedger] = useState({status:preview ? 'ready' : 'loading',items:[],error:''})
  const [strategies,setStrategies] = useState([]), [strategyError,setStrategyError] = useState(''), [strategyReady,setStrategyReady] = useState(false), [action,setAction] = useState(null), [reload,setReload] = useState(0)
  const selected = query.get('live_account') || ''
  const strategy = query.get('playbook') ? `${query.get('playbook')}${query.get('playbook_revision') ? `:${query.get('playbook_revision')}` : ''}` : 'all'
  const [tag,setTag] = useState([]), [tableColumns,setTableColumns] = useState({})
  const [draft,setDraft] = useState({...LIVE_FILTERS, timezone}), [applied,setApplied] = useState({...LIVE_FILTERS, timezone})
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setLedger(current => ({...current,status:'loading',error:''}))
    fetchLiveRecords(workspace,controller.signal).then(items => { if (!controller.signal.aborted) setLedger({status:'ready',items,error:''}) }).catch(error => { if (!controller.signal.aborted) setLedger(current => ({...current,status:'error',items:error.status === 403 ? [] : current.items,error:current.items.length && error.status !== 403 ? t('Previous journal data is shown. {error}',{error:t(error.message)}) : error.message})) })
    return () => controller.abort()
  },[workspace,preview,reload])
  const accounts = useMemo(() => ledger.items.filter(record => record.kind === 'account'),[ledger.items])
  const pickerItems = [
    ...(broker?.connections?.length ? broker.connections.map(item => ({record_id:`broker:${item.id}`,name:mt5AccountName(item),detail:['MT5',item.server,currencyLabel(item.account?.currency)].filter(Boolean).join(' · ')})) : broker?.account ? [{record_id:'broker',name:broker.source,detail:broker.account.account_ref}] : []),
    ...accounts.map(item => ({record_id:item.record_id,name:item.payload.name,detail:currencyLabel(item.payload.currency)})),
  ]
  const calendarSelection = calendarAccountSelection(query)
  const calendarIds = calendarSelection === null ? pickerItems.map(item => item.record_id) : calendarSelection
  const chosen = section === 'calendar' ? calendarIds.length === 1 ? calendarIds[0] : '' : selected || (broker?.connection_id ? `broker:${broker.connection_id}` : broker?.account ? 'broker' : accounts[0]?.record_id || '')
  const account = accounts.find(item => item.record_id === chosen)
  const singlePayload = useMemo(() => chosen === 'broker' || chosen.startsWith('broker:') ? broker?.account ? broker : null : manualSnapshot(account,ledger.items),[chosen,broker,account,ledger.items])
  const calendar = useLiveCalendarAccounts({ workspace, enabled:section === 'calendar' || section === 'analytics', selection:calendarSelection, items:pickerItems, broker, accounts, records:ledger.items, preview })
  const payload = section === 'calendar' || section === 'analytics' ? calendar.payload : singlePayload
  const selectionKey = section === 'calendar' ? JSON.stringify(calendarIds) : chosen
  const needsStrategies = Boolean(payload?.manual && section !== 'analytics' || section === 'notes' || action && action.kind !== 'account')
  useEffect(() => {
    if (preview || !needsStrategies || strategyReady) return
    const controller = new AbortController()
    setStrategyError('')
    fetchPlaybooks(workspace,controller.signal).then(items => {
      if (!controller.signal.aborted) { setStrategies(items); setStrategyReady(true) }
    }).catch(() => { if (!controller.signal.aborted) setStrategyError('Chưa đọc được chiến lược. Tải lại trước khi tạo hoặc sửa giao dịch.') })
    return () => controller.abort()
  },[workspace,preview,needsStrategies,strategyReady,reload])
  useEffect(() => { setDraft({...LIVE_FILTERS, timezone}); setApplied({...LIVE_FILTERS, timezone}); setTag([]) },[selectionKey])
  useEffect(() => { setDraft(current=>({...current,timezone}));setApplied(current=>({...current,timezone})) },[timezone])
  const choose = value => {
    const url = new URL(window.location.href); url.searchParams.set('live_account',value);
    url.searchParams.delete('live_accounts')
    if(value.startsWith('broker:'))url.searchParams.set('mt5_connection',value.slice(7));else url.searchParams.delete('mt5_connection')
    navigate(url.pathname+url.search)
  }
  const chooseCalendar = value => {
    const url = new URL(window.location.href)
    url.searchParams.set('live_accounts',value === null ? 'all' : value.length ? value.join(',') : 'none')
    const single = value?.length === 1 ? value[0] : ''
    if (single) url.searchParams.set('live_account',single); else url.searchParams.delete('live_account')
    if (single.startsWith('broker:')) url.searchParams.set('mt5_connection',single.slice(7)); else url.searchParams.delete('mt5_connection')
    navigate(url.pathname+url.search,{replace:true})
  }
  const [strategyId,strategyRevision] = strategy.split(':')
  const changeStrategy = value => {
    const [id,revision] = value.split(':'), url = new URL(window.location.href)
    if (value === 'all') { url.searchParams.delete('playbook'); url.searchParams.delete('playbook_revision') }
    else { url.searchParams.set('playbook',id); if (revision) url.searchParams.set('playbook_revision',revision); else url.searchParams.delete('playbook_revision') }
    navigate(url.pathname+url.search,{replace:true})
  }
  const deals = useMemo(() => filterLiveDeals(payload,{...applied,tags:tag}).filter(deal => !payload?.manual || strategy === 'all' || deal.record?.payload.playbook_id === strategyId && (!strategyRevision || deal.record?.payload.playbook_revision === Number(strategyRevision))),[payload,applied,strategy,strategyId,strategyRevision,tag])
  const showContent = preview || ledger.status === 'ready' || ledger.items.length > 0 || Boolean(broker?.account || broker?.connections?.length)
  const journalReadable = preview || ledger.status === 'ready' || ledger.items.length > 0
  const tags = [...new Set((payload?.deals || []).flatMap(deal => deal.record?.payload.tags || []))]
  const strategySeed = payload?.manual && strategy !== 'all' ? {playbook_id:strategyId,playbook_revision:Number(strategyRevision || strategies.find(item => item.record_id === strategyId)?.revision)} : undefined
  const open = (kind,record) => { if (!preview && ledger.status === 'ready') setAction({kind,record,seed: !record ? strategySeed : undefined}) }
  const openAccountAction = (kind,record) => { if (!preview && ledger.status === 'ready') setAction({kind,accountId:record?.record_id,seed:strategySeed}) }
  const navigateAccount = (row,target) => {
    const url=new URL(window.location.href)
    url.searchParams.set('live_account',row.id)
    url.searchParams.delete('live_accounts')
    if(row.id.startsWith('broker:'))url.searchParams.set('mt5_connection',row.id.slice(7));else url.searchParams.delete('mt5_connection')
    url.searchParams.set('section',target==='transactions'?'trading-accounts':target)
    if(target==='transactions')url.searchParams.set('account_tab','transactions');else url.searchParams.delete('account_tab')
    navigate(url.pathname+url.search)
  }
  const archiveAccount = async record => {
    await saveLiveRecord(workspace,'account',{...record.payload,archived:true},record)
    setLedger(current=>({...current,items:current.items.filter(item=>item.record_id!==record.record_id && item.payload.account_id!==record.record_id)}))
    if(chosen===record.record_id)choose('')
  }
  const create = (kind,seed) => { if (seed && !preview && ledger.status === 'ready') setAction({kind:'note',seed:{...strategySeed,...seed}}); else if (!seed) open(kind === 'Add trade' ? 'trade' : kind === 'note' ? 'note' : 'account') }
  const saved = (record,close = true) => {
    setLedger(current => ({status:'ready',items:[record,...current.items.filter(item => item.record_id !== record.record_id)],error:''}))
    if (record.kind === 'account') choose(record.record_id)
    if (close) setAction(null)
  }
  const apply = override => { const next = override || draft; if (!next.from || !next.to || next.from <= next.to) setApplied({...next}) }
  const accountPicker = <div className="live-account-picker"><SessionFilter items={pickerItems} value={section === 'calendar' ? calendarSelection : chosen} multiple={section === 'calendar'} onChange={section === 'calendar' ? chooseCalendar : choose} labels={ACCOUNT_PICKER_LABELS} /></div>
  const columnKind = payload?.manual ? 'manual' : 'broker'
  const columnOptions = payload?.manual ? MANUAL_TRADE_COLUMNS : LIVE_TRADE_COLUMNS
  const columns = tableColumns[columnKind] || columnOptions.map(([key]) => key)
  const columnControl = section === 'trades' ? <TableColumnControl columns={columns} options={columnOptions} onChange={next => setTableColumns(current => ({...current,[columnKind]:next}))} /> : null
  const filterBar = <FilterBar columnControl={columnControl} tags={tags} tag={tag} onTagChange={setTag} accountPicker={accountPicker} extra={payload?.manual ? <div className="live-journal-filters"><FxSelect label="Chiến lược" value={strategy} onChange={changeStrategy} options={[{value:'all',label:'Tất cả chiến lược'},...(strategyRevision ? [{value:strategy,label:`${strategies.find(item => item.record_id === strategyId)?.payload.name || 'Chiến lược'} · v${strategyRevision}`,localize:false}] : []),...strategies.map(item => ({value:item.record_id,label:item.payload.name,localize:false}))]} /></div> : null} payload={payload} draft={draft} setDraft={setDraft} applied={applied} onApply={apply} onClear={() => { setDraft({...LIVE_FILTERS, timezone});setApplied({...LIVE_FILTERS, timezone});changeStrategy('all');setTag([]) }} />
  return <Suspense fallback={<TestingSkeleton />}>
    {ledger.error && <div className="live-status live-status-error" role="alert"><span>{t(ledger.error)}</span><Action onClick={() => setReload(value => value+1)}>{t('Thử lại')}</Action></div>}
    {strategyError && <div className="live-status live-status-warning" role="alert"><span>{t(strategyError)}</span><Action onClick={() => setReload(value => value+1)}>{t('Tải lại')}</Action></div>}
    {section === 'calendar' && calendar.issue && <div className="live-status live-status-warning" role="status">{t(calendar.issue)}</div>}
    {ledger.status === 'loading' && <p className="live-status" role="status">{t('Đang đọc sổ giao dịch…')}</p>}
    {showContent && !['calendar','trades','notes','trading-accounts','analytics'].includes(section) && filterBar}
    {showContent && <>
    {section === 'calendar' && <Calendar empty={ledger.status === 'ready' && !calendarIds.length && !broker?.stale} filterBar={showContent ? filterBar : null} canWrite={!preview && ledger.status === 'ready' && calendarIds.length === 1} selectionKey={selectionKey} payload={payload} deals={deals} filters={applied} reviewScope={payload?.manual ? `${strategy === 'all' ? t('Tất cả chiến lược') : `${strategies.find(item => item.record_id === strategyId)?.payload.name || strategyId}${strategyRevision ? ` · v${strategyRevision}` : ` · ${t('mọi phiên bản')}`}`} · ${!tag.length ? t('Tất cả nhãn') : tag.join(', ')}` : t('Synced deals')} onPreview={create} />}
    {section === 'trades' && <div className="live-split"><section className="live-trades-section">{filterBar}<div className="live-trades-content">{payload?.manual ? <ManualTrades columns={columns} writable={!preview && ledger.status === 'ready' && strategyReady} filterKey={JSON.stringify([chosen,applied,strategy,tag])} workspace={workspace} deals={deals} currency={payload.account.currency} strategies={strategies} onEdit={record => open('trade',record)} /> : payload?.account ? <LiveBrokerSnapshot columns={columns} payload={payload} section="trades" deals={deals} filterKey={JSON.stringify(applied)} /> : <Empty title="No trades yet" copy="Tạo tài khoản thủ công và thêm giao dịch để bắt đầu." icon="journal" />}</div></section><Summary payload={payload} deals={deals} sidebar /></div>}
    {section === 'notes' && <JournalNotes accountPicker={accountPicker} readable={journalReadable} writable={!preview && ledger.status === 'ready' && strategyReady} key={chosen} records={ledger.items} accountId={chosen || null} strategies={strategies} onEdit={record => open('note',record)} onCreate={() => open('note')} />}
    {section === 'tag-analytics' && <JournalTags readable={journalReadable} filterKey={JSON.stringify([chosen,applied,strategy,tag])} deals={deals} currency={payload?.account?.currency || ''} />}
    {section === 'analytics' && <LiveAnalyticsReport payload={payload} deals={payload?.deals || []} issue={calendar.issue} sessionControl={<SessionFilter items={pickerItems} value={calendarSelection} multiple onChange={chooseCalendar} labels={ACCOUNT_PICKER_LABELS} />} />}
    {section === 'trading-accounts' && <LiveAccounts key={workspace} workspace={workspace} accounts={accounts} records={ledger.items} broker={broker} chosen={chosen} onSelect={choose} transactions={query.get('account_tab') === 'transactions'} writable={!preview && ledger.status === 'ready'} canImport={!preview && ledger.status === 'ready' && accounts.length > 0} onCreate={seed => {if(!preview && ledger.status==='ready')setAction({kind:'account',seed})}} onImport={record => openAccountAction('import',record?.record_id ? record : null)} onEdit={record => open('account',record)} onTrade={record=>openAccountAction('trade',record)} onNavigate={navigateAccount} onArchive={archiveAccount} onRefresh={onRefresh} />}

    </>}
    <Suspense fallback={null}>{action && (action.kind === 'account' || strategyReady) && <LiveRecordDialog key={`${workspace}:${action.kind}:${action.record?.record_id || 'new'}`} workspace={workspace} kind={action.kind} record={action.record} seed={action.seed} accountId={action.accountId || (action.kind === 'note' && chosen.startsWith('broker:') ? chosen : account?.record_id)} accounts={accounts} connections={broker?.connections || []} strategies={strategies} onClose={() => setAction(null)} onSaved={saved} />}</Suspense>
    {action && action.kind !== 'account' && !strategyReady && !strategyError && <TestingSkeleton label="Đang tải chiến lược…" />}
  </Suspense>
}
