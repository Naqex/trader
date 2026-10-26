import { mt5AccountName } from './liveAccountModel.js'
import { displayDate } from './dateFormat.js'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import SessionFilter from './SessionFilter.jsx'
import useLiveCalendarAccounts from './useLiveCalendarAccounts.js'
import { calendarAccountSelection } from './liveCalendarAccounts.js'
import TestingIcon from './TestingIcon.jsx'
import { CalendarNavigation, CalendarMonth, CalendarDay } from './CalendarView.jsx'
import ReportInfo from './ReportInfo.jsx'
import { fetchLiveRecords, saveLiveRecord } from './liveLedgerApi.js'
import { fetchPlaybooks } from './playbookApi.js'
import { manualSnapshot, closedTradeStats } from './liveLedgerModel.js'
import { TestingSkeleton } from './TestingReadState.jsx'
import FilterDrawer from './FilterDrawer.jsx'
import LedgerFilterActions from './LedgerFilterActions.jsx'
import TableColumnControl from './TableColumnControl.jsx'
import { MANUAL_TRADE_COLUMNS, BROKER_DEAL_COLUMNS } from './liveTradeColumns.js'
import ProjectDateInput from './ProjectDateInput.jsx'
import { navigate } from './clientNavigation.js'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import { LIVE_FILTERS, calendarWeeks, calendarWeekSummary, cumulativeDealSeries, dayKey, dealNet, filterLiveDeals, summarizeDeals } from './liveWorkspaceModel.js'

const LiveAccounts = lazy(() => import('./LiveAccounts.jsx'))
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
  const summary = summarizeDeals(deals, available), currency = payload?.account?.currency || ''
  const stats = closedTradeStats(deals, payload?.account?.opening_balance)
  const metrics = payload?.aggregate ? [['PnL ròng',summary.net,currency],['Bản ghi giao dịch',summary.count,'']] : payload?.manual ? [['PnL ròng',stats.net,currency],['Giao dịch đã đóng',stats.count,''],['Tỷ lệ thắng',stats.winRate,'%'],['Profit factor',stats.profitFactor,''],['Return (%)',stats.returnPercent,'%']] : [['Net deal PnL', summary.net, currency], ['Filled deals', summary.count, ''], ['Return (%)', null, '']]
  return <section className={sidebar ? 'live-analytics-side' : 'live-metrics'} aria-label={t('Analytics')}>
    {sidebar && <h2><TestingIcon kind="chart" />{t('Analytics')}</h2>}
    {!available || !deals.length ? <Empty icon={sidebar ? null : 'chart'} title="No analytics yet" copy={available ? 'No deals in this selection.' : 'Select a connected account to view analytics.'} /> : <>
      <dl>{metrics.map(([label, value, suffix]) => <div key={label}><dt>{t(label)}</dt><dd className={['Net deal PnL','PnL ròng'].includes(label) ? summary.net < 0 ? 'is-loss' : summary.net > 0 ? 'is-gain' : '' : ''}>{fmt(value, suffix ? ` ${suffix}` : '', ['Filled deals','Giao dịch đã đóng','Bản ghi giao dịch'].includes(label) ? 0 : 2)}</dd></div>)}</dl>
    </>}
  </section>
}

function PnlCurve({ deals, currency, emptyTitle = 'No analytics yet' }) {
  const { t, fmt, timezone } = useTestingLocale(), series = cumulativeDealSeries(deals), known = series.filter(point => point.value !== null)
  const values = [0, ...known.map(point => point.value)], min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  const x = i => 70 + i / Math.max(1, series.length - 1) * 700, y = value => 240 - (value - min) / range * 180
  const path = series.map((point, i) => point.value === null ? '' : `${i === 0 || series[i - 1].value === null ? 'M' : 'L'}${x(i)},${y(point.value)}`).join(' ')
  return <section className="live-pnl-curve"><div className="live-section-heading"><h2>{t('Cumulative deal PnL')}</h2><span className="live-muted">{currency || '-'}</span></div>
    {known.length ? <><svg viewBox="0 0 800 290" role="img" aria-label={t('Cumulative deal PnL')} preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3].map(i => { const value = min + range * i / 3; return <g key={i}><line x1="70" x2="770" y1={y(value)} y2={y(value)} /><text x="60" y={y(value)} textAnchor="end" dominantBaseline="middle">{fmt(value)}</text></g> })}
      <path d={path} className="live-pnl-line" />{known.length === 1 && <circle cx={x(0)} cy={y(known[0].value)} r="4" className="live-pnl-point" />}
    </svg><div className="live-curve-range"><span>{dayKey(series[0].time, timezone)}</span><span>{dayKey(series.at(-1).time, timezone)}</span></div>{series.some(point => point.value === null) && <p className="live-muted">{t('Curve stops where deal costs are incomplete.')}</p>}</> : <Empty title={emptyTitle} copy="PnL will appear when complete deal data is available." />}
  </section>
}

function Calendar({ payload, deals, filters, filterBar, reviewScope, canWrite, onPreview, selectionKey, empty = false }) {
  const { t, fmt, locale } = useTestingLocale()
  const [percent,setPercent] = useState(false)
  const [month, setMonth] = useState(() => dayKey(Date.parse(payload?.captured_at_utc) || Date.now(), filters.timezone).slice(0, 7)), [selected, setSelected] = useState('')
  useEffect(() => { setSelected(''); setPercent(false) }, [selectionKey])
  useEffect(() => { setSelected('') }, [filters])
  const weeks = calendarWeeks(month, payload, deals, filters)
  const rows = deals.filter(deal => dayKey(deal.time_msc, filters.timezone).startsWith(month))
  const total = calendarWeekSummary(weeks.flat(), empty)
  const partialLabel = t('Một phần'), partialDetail = t('Chỉ cộng phần dữ liệu đã ghi nhận; chưa đủ dữ liệu cho toàn bộ phạm vi.')
  const currency = payload?.account?.currency || (empty ? 'USD' : '')
  const countLabel = count => count === null ? '-' : payload?.aggregate ? t('{count} bản ghi', { count }) : (empty || payload?.manual) ? t('{count} giao dịch', { count }) : t('{count} filled deals', { count })
  const canPercent = payload?.manual && payload.account.opening_balance > 0
  const amount = value => percent && canPercent ? fmt(value === null ? null : value/payload.account.opening_balance*100,'%') : fmt(value)
  const weekAmount = value => {
    if (empty) return `$${fmt(value)}`
    if (value === null || percent || !currency) return amount(value)
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value) } catch { return fmt(value, ` ${currency}`) }
  }
  const review = () => onPreview('note', {
    title: t('Monthly review {month}',{month}),
    note: `${t(payload?.manual ? 'PnL đã ghi' : 'PnL deals đã đồng bộ')}: ${fmt(total.net)} ${currency}. ${rows.length} ${t(payload?.manual ? 'giao dịch đã đóng' : 'Filled deals')}.\n${t('Tài khoản')}: ${payload?.account?.name || payload?.account?.account_ref || '-'}. ${t('Timezone')}: ${filters.timezone}.\n${t('Scope')}: ${reviewScope}.\n${Object.entries(filters).filter(([key,value]) => key !== 'timezone' && value !== LIVE_FILTERS[key] && value !== '').map(([key,value]) => `${t(FILTER_LABELS[key])}: ${filterValue(key,value,t)}`).join(' · ')}`.trim(),
  })
  return <div className="live-split"><section className="live-calendar-section">
    {filterBar}<div className="live-calendar-content">
    <div className="live-calendar-toolbar"><CalendarNavigation month={month} onChange={next => { setSelected(''); setMonth(next) }}>
      <div className="live-toolbar-actions"><Action aria-pressed={!percent} label="Amount" onClick={() => setPercent(false)}>{payload?.account?.currency || '$'}</Action><Action disabled={!canPercent} aria-pressed={percent} title={canPercent ? '% vốn ban đầu' : t('Percentage requires opening capital.')} onClick={() => setPercent(true)}>%</Action><ReportInfo title="P/L calendar" text="Lãi/lỗ ròng gồm profit, commission, swap và fee. Ngày được chia theo múi giờ đã chọn. Tài khoản MT5 đếm filled deals; tài khoản thủ công đếm giao dịch đã đóng.\n\nNgày chỉ hiện 0 khi có dữ liệu bao phủ cả ngày. Một phần nghĩa là dữ liệu chưa bao phủ đủ hoặc thiếu chi phí; tổng chỉ cộng phần đã ghi nhận. Ngày ngoài tháng không tính vào tổng.\n\nPhần trăm chỉ dùng vốn ban đầu hợp lệ của tài khoản thủ công. Ghi chú, review và lựa chọn tài khoản giữ theo phạm vi Live."/><Action disabled title="Chưa hỗ trợ chia sẻ tài khoản">{t('Share')}</Action><span className="live-calendar-action-divider" aria-hidden="true" /><Action icon="plus" disabled={!canWrite || !payload?.account || total.net === null} onClick={review}>{t('Monthly review')}</Action></div></CalendarNavigation>
    </div>
    <CalendarMonth month={month} weeks={weeks} label={`${t('PnL calendar')} · ${filters.timezone}`} classes={{scroll:'live-calendar-scroll',grid:'live-calendar-grid',week:'live-calendar-week',weekday:'live-calendar-dayname'}} renderDay={day => <CalendarDay key={day.key} day={day} className="live-calendar-cell" numberClassName="live-day-number" disabled={!day.eligible} selected={selected === day.key} label={`${displayDate(day.key)} · ${fmt(day.net, currency ? ` ${currency}` : '')}${day.partial ? ` · ${partialLabel}` : ''}`} value={day.inMonth && day.net !== null ? amount(day.net) : undefined} count={day.count !== null && day.count > 0 ? countLabel(day.count) : null} note={day.partial && day.count > 0 ? partialLabel : null} tooltip={day.partial ? partialDetail : undefined} tone={day.net > 0 ? 'gain' : day.net < 0 ? 'loss' : ''} onClick={() => setSelected(selected === day.key ? '' : day.key)}/>} renderWeekTotal={(week,index) => {const summary = calendarWeekSummary(week,empty);return <div className="live-week-total"><div><span>{countLabel(summary.count)}</span><span aria-label={t('Week {count}',{count:index+1})}>W{index+1}</span></div><strong>{weekAmount(summary.net)}</strong>{summary.partial && summary.count !== null && <small data-tooltip={partialDetail}>{partialLabel}</small>}</div>}}/>
    <div className="live-month-total"><span>{t(empty ? 'Tổng tháng' : payload?.aggregate ? 'PnL trong tháng' : payload?.manual ? 'PnL đã ghi trong tháng' : 'PnL đã đồng bộ trong tháng')}</span><strong>{weekAmount(total.net)}</strong><span>{countLabel(total.count)}</span>{total.partial && total.count !== null && <small data-tooltip={partialDetail}>{partialLabel}</small>}</div>
    {selected && <div className="live-day-detail"><h3>{displayDate(selected)}</h3>{deals.filter(deal => dayKey(deal.time_msc, filters.timezone) === selected).length ? <ul>{deals.filter(deal => dayKey(deal.time_msc, filters.timezone) === selected).map(deal => <li key={`${deal.source_account || ''}:${deal.ticket}`}><span>{deal.symbol} · #{deal.ticket}</span><strong>{fmt(dealNet(deal), currency ? ` ${currency}` : '')}</strong></li>)}</ul> : <p>{t(weeks.flat().find(day => day.key === selected)?.covered ? 'No deals recorded for this day.' : 'Data for this day is unavailable or incomplete.')}</p>}</div>}
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
    ...(broker?.connections?.length ? broker.connections.map(item => ({record_id:`broker:${item.id}`,name:mt5AccountName(item),detail:['MT5',item.server,item.account?.currency].filter(Boolean).join(' · ')})) : broker?.account ? [{record_id:'broker',name:broker.source,detail:broker.account.account_ref}] : []),
    ...accounts.map(item => ({record_id:item.record_id,name:item.payload.name,detail:item.payload.currency})),
  ]
  const calendarSelection = calendarAccountSelection(query)
  const calendarIds = calendarSelection === null ? pickerItems.map(item => item.record_id) : calendarSelection
  const chosen = section === 'calendar' ? calendarIds.length === 1 ? calendarIds[0] : '' : selected || (broker?.connection_id ? `broker:${broker.connection_id}` : broker?.account ? 'broker' : accounts[0]?.record_id || '')
  const account = accounts.find(item => item.record_id === chosen)
  const singlePayload = useMemo(() => chosen === 'broker' || chosen.startsWith('broker:') ? broker?.account ? broker : null : manualSnapshot(account,ledger.items),[chosen,broker,account,ledger.items])
  const calendar = useLiveCalendarAccounts({ workspace, enabled:section === 'calendar', selection:calendarSelection, items:pickerItems, broker, accounts, records:ledger.items, preview })
  const payload = section === 'calendar' ? calendar.payload : singlePayload
  const selectionKey = section === 'calendar' ? JSON.stringify(calendarIds) : chosen
  const needsStrategies = Boolean(payload?.manual || section === 'notes' || action && action.kind !== 'account')
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
  const deals = useMemo(() => filterLiveDeals(payload,applied).filter(deal => !payload?.manual || (strategy === 'all' || deal.record?.payload.playbook_id === strategyId && (!strategyRevision || deal.record?.payload.playbook_revision === Number(strategyRevision))) && (!tag.length || tag.some(value => deal.record?.payload.tags.includes(value)))),[payload,applied,strategy,strategyId,strategyRevision,tag])
  const showContent = preview || ledger.status === 'ready' || ledger.items.length > 0 || Boolean(broker?.account || broker?.connections?.length)
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
  const columnOptions = payload?.manual ? MANUAL_TRADE_COLUMNS : BROKER_DEAL_COLUMNS
  const columns = tableColumns[columnKind] || columnOptions.map(([key]) => key)
  const columnControl = section === 'trades' ? <TableColumnControl columns={columns} options={columnOptions} onChange={next => setTableColumns(current => ({...current,[columnKind]:next}))} /> : null
  const filterBar = <FilterBar columnControl={columnControl} tags={tags} tag={tag} onTagChange={setTag} accountPicker={accountPicker} extra={payload?.manual ? <div className="live-journal-filters"><FxSelect label="Chiến lược" value={strategy} onChange={changeStrategy} options={[{value:'all',label:'Tất cả chiến lược'},...(strategyRevision ? [{value:strategy,label:`${strategies.find(item => item.record_id === strategyId)?.payload.name || 'Chiến lược'} · v${strategyRevision}`,localize:false}] : []),...strategies.map(item => ({value:item.record_id,label:item.payload.name,localize:false}))]} /></div> : null} payload={payload} draft={draft} setDraft={setDraft} applied={applied} onApply={apply} onClear={() => { setDraft({...LIVE_FILTERS, timezone});setApplied({...LIVE_FILTERS, timezone});changeStrategy('all');setTag([]) }} />
  return <Suspense fallback={<TestingSkeleton />}>
    {ledger.error && <div className="live-status live-status-error" role="alert"><span>{t(ledger.error)}</span><Action onClick={() => setReload(value => value+1)}>{t('Thử lại')}</Action></div>}
    {strategyError && <div className="live-status live-status-warning" role="alert"><span>{t(strategyError)}</span><Action onClick={() => setReload(value => value+1)}>{t('Tải lại')}</Action></div>}
    {section === 'calendar' && calendar.issue && <div className="live-status live-status-warning" role="status">{t(calendar.issue)}</div>}
    {ledger.status === 'loading' && <p className="live-status" role="status">{t('Đang đọc sổ giao dịch…')}</p>}
    {showContent && !['calendar','trades','notes','trading-accounts'].includes(section) && filterBar}
    {showContent && section === 'notes' && <div className="live-toolbar">{accountPicker}</div>}
    {showContent && <>
    {section === 'calendar' && <Calendar empty={ledger.status === 'ready' && !calendarIds.length && !broker?.stale} filterBar={showContent ? filterBar : null} canWrite={!preview && ledger.status === 'ready' && calendarIds.length === 1} selectionKey={selectionKey} payload={payload} deals={deals} filters={applied} reviewScope={payload?.manual ? `${strategy === 'all' ? t('Tất cả chiến lược') : `${strategies.find(item => item.record_id === strategyId)?.payload.name || strategyId}${strategyRevision ? ` · v${strategyRevision}` : ` · ${t('mọi phiên bản')}`}`} · ${!tag.length ? t('Tất cả nhãn') : tag.join(', ')}` : t('Synced deals')} onPreview={create} />}
    {section === 'trades' && <div className="live-split"><section className="live-trades-section">{filterBar}<div className="live-trades-content">{payload?.manual ? <ManualTrades columns={columns} writable={!preview && ledger.status === 'ready' && strategyReady} filterKey={JSON.stringify([chosen,applied,strategy,tag])} workspace={workspace} deals={deals} currency={payload.account.currency} strategies={strategies} onEdit={record => open('trade',record)} /> : payload?.account ? <LiveBrokerSnapshot columns={columns} payload={payload} section="trades" deals={deals} filterKey={JSON.stringify(applied)} /> : <Empty title="No trades yet" copy="Tạo tài khoản thủ công và thêm giao dịch để bắt đầu." icon="journal" />}</div></section><Summary payload={payload} deals={deals} sidebar /></div>}
    {section === 'notes' && <JournalNotes writable={!preview && ledger.status === 'ready' && strategyReady} key={chosen} records={ledger.items} accountId={chosen || null} strategies={strategies} onEdit={record => open('note',record)} onCreate={() => open('note')} />}
    {section === 'tag-analytics' && <JournalTags filterKey={JSON.stringify([chosen,applied,strategy,tag])} deals={deals} currency={payload?.account?.currency || ''} />}
    {section === 'analytics' && <><Summary payload={payload} deals={deals} />{deals.length > 0 && <PnlCurve deals={deals} currency={payload?.account?.currency} />}</>}
    {section === 'trading-accounts' && <LiveAccounts key={workspace} workspace={workspace} accounts={accounts} records={ledger.items} broker={broker} chosen={chosen} onSelect={choose} transactions={query.get('account_tab') === 'transactions'} writable={!preview && ledger.status === 'ready'} canImport={!preview && ledger.status === 'ready' && accounts.length > 0} onCreate={seed => {if(!preview && ledger.status==='ready')setAction({kind:'account',seed})}} onImport={record => openAccountAction('import',record?.record_id ? record : null)} onEdit={record => open('account',record)} onTrade={record=>openAccountAction('trade',record)} onNavigate={navigateAccount} onArchive={archiveAccount} onRefresh={onRefresh} />}

    </>}
    <Suspense fallback={null}>{action && (action.kind === 'account' || strategyReady) && <LiveRecordDialog key={`${workspace}:${action.kind}:${action.record?.record_id || 'new'}`} workspace={workspace} kind={action.kind} record={action.record} seed={action.seed} accountId={action.accountId || (action.kind === 'note' && chosen.startsWith('broker:') ? chosen : account?.record_id)} accounts={accounts} connections={broker?.connections || []} strategies={strategies} onClose={() => setAction(null)} onSaved={saved} />}</Suspense>
    {action && action.kind !== 'account' && !strategyReady && !strategyError && <TestingSkeleton label="Đang tải chiến lược…" />}
  </Suspense>
}
