import { displayDate } from './dateFormat.js'
import { useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { timezoneOptions } from './AnalyticsFilterControls.jsx'
import { fetchLiveRecords } from './liveLedgerApi.js'
import { fetchPlaybooks } from './playbookApi.js'
import { manualSnapshot, closedTradeStats } from './liveLedgerModel.js'
import LiveRecordDialog from './LiveRecordDialog.jsx'
import FilterDrawer from './FilterDrawer.jsx'
import ProjectDateInput from './ProjectDateInput.jsx'
import LiveAccounts from './LiveAccounts.jsx'
import { ManualTrades, JournalNotes, JournalTags } from './LiveJournalSurfaces.jsx'
import { navigate } from './clientNavigation.js'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import { LIVE_FILTERS, calendarWeeks, cumulativeDealSeries, dayKey, dealNet, filterLiveDeals, summarizeDeals } from './liveWorkspaceModel.js'

const FILTER_LABELS = { asset: 'Assets', side: 'Side', outcome: 'Deal result', account: 'Accounts', day: 'Day', timezone: 'Timezone', from: 'Start', to: 'End' }
const FILTER_VALUES = { side: { 0: 'Buy', 1: 'Sell' }, outcome: { gain: 'Positive PnL', loss: 'Negative PnL', flat: 'Zero PnL' }, day: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] }
const filterValue = (key,value,t) => ['from','to'].includes(key) ? displayDate(value) : FILTER_VALUES[key]?.[value] ? t(FILTER_VALUES[key][value]) : value

function Action({ children, icon, primary, compact, onClick, label, ...props }) {
  const { t } = useTestingLocale()
  return <button type="button" className={`fxa-button${primary ? ' is-primary' : ''}${compact ? ' fxa-icon-button' : ''}`} aria-label={label ? t(label) : undefined} onClick={onClick} {...props}>{icon && <TestingIcon kind={icon} />}{children}</button>
}

function Empty({ title, copy, icon = 'chart', action, onAction }) {
  const { t } = useTestingLocale()
  return <div className="live-empty" data-testid="live-empty">{icon && <div className="live-empty-art" aria-hidden="true"><TestingIcon kind={icon} size={72} /></div>}<h2>{t(title)}</h2>{copy && <p>{t(copy)}</p>}{action && <Action primary icon="plus" onClick={onAction}>{t(action)}</Action>}</div>
}

function FilterBar({ section, accountPicker, extra, payload, draft, setDraft, applied, onApply, onClear, onRefresh }) {
  const { t } = useTestingLocale(), [show, setShow] = useState(false)
  const chips = Object.entries(applied).filter(([key, value]) => value !== LIVE_FILTERS[key] && value !== '')
  const change = patch => setDraft(current => ({...current,...patch}))
  const assets = [...new Set((payload?.deals || []).map(deal => deal.symbol).filter(Boolean))].sort()
  const choices = (key,options) => <div className="fxl-choices" role="group" aria-label={t(FILTER_LABELS[key])}>{options.map(([value,label]) => <label key={value}><input type="radio" name={`live-filter-${key}`} checked={draft[key] === value} onChange={() => change({[key]:value})} />{t(label)}</label>)}</div>
  const sections = [
    ['Assets', choices('asset',[['all','All assets'],...assets.map(value => [value,value])])],
    ['Side', choices('side',[['all','All sides'],['0','Buy'],['1','Sell']])],
    ['Deal result', choices('outcome',[['all','All results'],['gain','Positive PnL'],['loss','Negative PnL'],['flat','Zero PnL']])],
    ['Day', choices('day',[['all','All days'],...['Su','Mo','Tu','We','Th','Fr','Sa'].map((label,i) => [String(i),label])])],
    ['Timezone', <FxSelect searchable label="Timezone" value={draft.timezone} onChange={timezone => change({timezone})} options={timezoneOptions.map(option => ({...option,localize:false}))} />],
    ['Date range', <div className="fxl-fields">{['from','to'].map(key => <label key={key} className="fxl-field">{t(FILTER_LABELS[key])}<ProjectDateInput clearable type="date" aria-label={t(FILTER_LABELS[key])} value={draft[key]} onChange={event => change({[key]:event.target.value})} /></label>)}</div>],
  ]
  return <section className="live-filters" aria-label={t('Filters')}>
    <div className="live-toolbar fxa-filter-toolbar is-ledger">{accountPicker}<div className="fxa-filter-actions">{extra}{section === 'trades' && <Action compact icon="refresh" label="Tải lại dữ liệu" onClick={onRefresh} />}<span className="fxa-filter-label">{t('Filter by')}</span><button className="fxa-button" type="button" aria-haspopup="dialog" aria-expanded={show} onClick={() => { setDraft({...applied});setShow(true) }}>{t('Basic')}</button></div></div>
    {show && <FilterDrawer sections={sections} onClose={() => setShow(false)} onClear={() => setDraft({...LIVE_FILTERS})} onApply={() => { onApply();setShow(false) }} invalid={Boolean(draft.from && draft.to && draft.from > draft.to)} />}
    {chips.length > 0 && <div className="live-filter-chips">{chips.map(([key,value]) => <span key={key}>{t(FILTER_LABELS[key])}: {filterValue(key,value,t)}</span>)}<button type="button" className="fxa-clear-filters" onClick={onClear}><TestingIcon kind="delete" />{t('Clear filters')}</button></div>}
  </section>
}

function Summary({ payload, deals, sidebar = false }) {
  const { t, fmt } = useTestingLocale(), available = Boolean(payload?.account && Array.isArray(payload.deals))
  const summary = summarizeDeals(deals, available), currency = payload?.account?.currency || ''
  const stats = closedTradeStats(deals, payload?.account?.opening_balance)
  const metrics = payload?.manual ? [['PnL ròng',stats.net,currency],['Giao dịch đã đóng',stats.count,''],['Tỷ lệ thắng',stats.winRate,'%'],['Profit factor',stats.profitFactor,''],['Return (%)',stats.returnPercent,'%']] : [['Net deal PnL', summary.net, currency], ['Filled deals', summary.count, ''], ['Return (%)', null, '']]
  return <section className={sidebar ? 'live-analytics-side' : 'live-metrics'} aria-label={t('Analytics')}>
    {sidebar && <h2><TestingIcon kind="chart" />{t('Analytics')}</h2>}
    {!available || !deals.length ? <Empty icon={sidebar ? null : 'chart'} title="No analytics yet" copy={available ? 'No deals in this selection.' : 'Select a connected account to view analytics.'} /> : <>
      <dl>{metrics.map(([label, value, suffix]) => <div key={label}><dt>{t(label)}</dt><dd className={['Net deal PnL','PnL ròng'].includes(label) ? summary.net < 0 ? 'is-loss' : summary.net > 0 ? 'is-gain' : '' : ''}>{fmt(value, suffix ? ` ${suffix}` : '', ['Filled deals','Giao dịch đã đóng'].includes(label) ? 0 : 2)}</dd></div>)}</dl>
    </>}
  </section>
}

function PnlCurve({ deals, currency, emptyTitle = 'No analytics yet' }) {
  const { t, fmt } = useTestingLocale(), series = cumulativeDealSeries(deals), known = series.filter(point => point.value !== null)
  const values = [0, ...known.map(point => point.value)], min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  const x = i => 70 + i / Math.max(1, series.length - 1) * 700, y = value => 240 - (value - min) / range * 180
  const path = series.map((point, i) => point.value === null ? '' : `${i === 0 || series[i - 1].value === null ? 'M' : 'L'}${x(i)},${y(point.value)}`).join(' ')
  return <section className="live-pnl-curve"><div className="live-section-heading"><h2>{t('Cumulative deal PnL')}</h2><span className="live-muted">{currency || '—'}</span></div>
    {known.length ? <><svg viewBox="0 0 800 290" role="img" aria-label={t('Cumulative deal PnL')} preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3].map(i => { const value = min + range * i / 3; return <g key={i}><line x1="70" x2="770" y1={y(value)} y2={y(value)} /><text x="60" y={y(value)} textAnchor="end" dominantBaseline="middle">{fmt(value)}</text></g> })}
      <path d={path} className="live-pnl-line" />{known.length === 1 && <circle cx={x(0)} cy={y(known[0].value)} r="4" className="live-pnl-point" />}
    </svg><div className="live-curve-range"><span>{dayKey(series[0].time)}</span><span>{dayKey(series.at(-1).time)} · UTC</span></div>{series.some(point => point.value === null) && <p className="live-muted">{t('Curve stops where deal costs are incomplete.')}</p>}</> : <Empty title={emptyTitle} copy="PnL will appear when complete deal data is available." />}
  </section>
}

function Calendar({ payload, deals, filters, filterBar, reviewScope, canWrite, onPreview }) {
  const { t, fmt, locale } = useTestingLocale()
  const [percent,setPercent] = useState(false)
  const [month, setMonth] = useState(() => dayKey(Date.parse(payload?.captured_at_utc) || Date.now(), filters.timezone).slice(0, 7)), [selected, setSelected] = useState('')
  const first = new Date(`${month}-01T00:00:00Z`), weeks = calendarWeeks(month, payload, deals, filters)
  const shift = delta => { setSelected(''); setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + delta, 1)).toISOString().slice(0, 7)) }
  const rows = deals.filter(deal => dayKey(deal.time_msc, filters.timezone).startsWith(month))
  const total = summarizeDeals(rows, Boolean(payload?.account && Array.isArray(payload.deals) && weeks.flat().some(day => day.count !== null)))
  const currency = payload?.account?.currency || ''
  const canPercent = payload?.manual && payload.account.opening_balance > 0
  const amount = value => percent && canPercent ? fmt(value === null ? null : value/payload.account.opening_balance*100,'%') : fmt(value)
  const review = () => onPreview('note', {
    title: `Tổng kết tháng ${month}`,
    note: `${payload?.manual ? 'PnL đã ghi' : 'PnL deals đã đồng bộ'}: ${fmt(total.net)} ${currency}. ${rows.length} ${payload?.manual ? 'giao dịch đã đóng' : 'deals'}.\nTài khoản: ${payload?.account?.name || payload?.account?.account_ref || '—'}. Múi giờ: ${filters.timezone}.\nPhạm vi: ${reviewScope}.\n${Object.entries(filters).filter(([key,value]) => key !== 'timezone' && value !== LIVE_FILTERS[key] && value !== '').map(([key,value]) => `${t(FILTER_LABELS[key])}: ${filterValue(key,value,t)}`).join(' · ')}`.trim(),
  })
  return <div className="live-split"><section className="live-calendar-section">
    {filterBar}<div className="live-calendar-content">
    <div className="live-calendar-toolbar"><div className="live-month-nav"><div className="live-month-step"><Action compact icon="chevron-left" label="Previous month" onClick={() => shift(-1)} /><h2 aria-live="polite">{first.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })}</h2><Action compact icon="chevron-right" label="Next month" onClick={() => shift(1)} /></div><div className="live-month-step"><Action compact icon="chevron-left" label="Previous year" onClick={() => shift(-12)} /><strong>{first.getUTCFullYear()}</strong><Action compact icon="chevron-right" label="Next year" onClick={() => shift(12)} /></div></div>
      <div className="live-toolbar-actions"><Action aria-pressed={!percent} label="Amount" onClick={() => setPercent(false)}>{currency || '$'}</Action><Action disabled={!canPercent} aria-pressed={percent} title={canPercent ? '% vốn ban đầu' : t('Percentage requires opening capital.')} onClick={() => setPercent(true)}>%</Action><Action disabled title="Chưa hỗ trợ chia sẻ tài khoản">{t('Share')}</Action><Action icon="plus" disabled={!canWrite || total.net === null} onClick={review}>{t('Monthly review')}</Action></div>
    </div>
    <div className="live-calendar-scroll" role="region" aria-label={`${t('PnL calendar')} · ${filters.timezone}`} tabIndex={0}><div className="live-calendar-grid">
      {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su', 'Total'].map(day => <div className="live-calendar-dayname" key={day}>{t(day)}</div>)}
      {weeks.map((week, index) => <div className="live-calendar-week" key={week[0].key}>{week.map(day => <button type="button" key={day.key} className={`live-calendar-cell${!day.inMonth ? ' is-outside' : ''}${day.net > 0 ? ' is-gain' : day.net < 0 ? ' is-loss' : ''}`} disabled={!day.inMonth} aria-pressed={selected === day.key} aria-label={`${displayDate(day.key)} · ${fmt(day.net, currency ? ` ${currency}` : '')}`} onClick={() => setSelected(selected === day.key ? '' : day.key)}>
        <span className="live-day-number">{day.date.getUTCDate()}</span><div className="live-day-result"><strong>{day.inMonth ? amount(day.net) : ''}</strong>{day.count !== null && day.count > 0 && <small title={payload?.manual ? `${day.count} giao dịch` : t('{count} filled deals', { count: day.count })}>{payload?.manual ? `${day.count} giao dịch` : `${day.count} deals`}</small>}</div>
      </button>)}<div className="live-week-total"><div><span>{week.filter(day => day.inMonth).every(day => day.count !== null) ? payload?.manual ? `${week.reduce((sum, day) => sum + (day.inMonth ? day.count : 0), 0)} giao dịch` : `${week.reduce((sum, day) => sum + (day.inMonth ? day.count : 0), 0)} deals` : '—'}</span><span aria-label={t('Week {count}', { count: index + 1 })}>W{index + 1}</span></div><strong>{amount(week.filter(day => day.inMonth).every(day => day.net !== null) ? week.filter(day => day.inMonth).reduce((sum, day) => sum + day.net, 0) : null)}</strong></div></div>)}
    </div></div>
    <div className="live-month-total"><span>{payload?.manual ? 'PnL đã ghi trong tháng' : 'PnL đã đồng bộ trong tháng'}</span><strong>{percent && canPercent ? amount(total.net) : fmt(total.net, currency ? ` ${currency}` : '')}</strong><span>{total.count !== null ? payload?.manual ? `${total.count} giao dịch` : t('{count} filled deals', { count: total.count }) : '—'}</span></div>
    {selected && <div className="live-day-detail"><h3>{displayDate(selected)}</h3>{deals.filter(deal => dayKey(deal.time_msc, filters.timezone) === selected).length ? <ul>{deals.filter(deal => dayKey(deal.time_msc, filters.timezone) === selected).map(deal => <li key={deal.ticket}><span>{deal.symbol} · #{deal.ticket}</span><strong>{fmt(dealNet(deal), currency ? ` ${currency}` : '')}</strong></li>)}</ul> : <p>{t(weeks.flat().find(day => day.key === selected)?.covered ? 'No deals recorded for this day.' : 'Data for this day is unavailable or incomplete.')}</p>}</div>}
  </div></section><Summary payload={payload} deals={rows} sidebar /></div>
}

export default function LiveSurfaces({ workspace = 'tenant-a', section, payload: broker, query, preview, onRefresh }) {
  const { t } = useTestingLocale()
  const [ledger,setLedger] = useState({status:preview ? 'ready' : 'loading',items:[],error:''})
  const [strategies,setStrategies] = useState([]), [strategyError,setStrategyError] = useState(''), [strategyReady,setStrategyReady] = useState(false), [action,setAction] = useState(null), [reload,setReload] = useState(0)
  const selected = query.get('live_account') || ''
  const strategy = query.get('playbook') ? `${query.get('playbook')}${query.get('playbook_revision') ? `:${query.get('playbook_revision')}` : ''}` : 'all'
  const [tag,setTag] = useState('all')
  const [draft,setDraft] = useState({...LIVE_FILTERS}), [applied,setApplied] = useState({...LIVE_FILTERS})
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setLedger(current => ({...current,status:'loading',error:''}))
    fetchLiveRecords(workspace,controller.signal).then(items => { if (!controller.signal.aborted) setLedger({status:'ready',items,error:''}) }).catch(error => { if (!controller.signal.aborted) setLedger(current => ({...current,status:'error',items:error.status === 403 ? [] : current.items,error:current.items.length && error.status !== 403 ? `${error.message} Đang hiển thị dữ liệu đã đọc trước đó.` : error.message})) })
    setStrategyError('')
    setStrategyReady(false)
    fetchPlaybooks(workspace,controller.signal).then(items => { if (!controller.signal.aborted) { setStrategies(items); setStrategyReady(true) } }).catch(error => { if (!controller.signal.aborted) setStrategyError('Chưa đọc được chiến lược. Tải lại trước khi tạo hoặc sửa giao dịch.') })
    return () => controller.abort()
  },[workspace,preview,reload])
  const accounts = ledger.items.filter(record => record.kind === 'account')
  const chosen = selected || (broker?.connection_id ? `broker:${broker.connection_id}` : broker?.account ? 'broker' : accounts[0]?.record_id || '')
  const account = accounts.find(item => item.record_id === chosen)
  const payload = chosen === 'broker' || chosen.startsWith('broker:') ? broker?.account ? broker : null : manualSnapshot(account,ledger.items)
  useEffect(() => { setDraft({...LIVE_FILTERS}); setApplied({...LIVE_FILTERS}); setTag('all') },[chosen])
  const choose = value => {
    const url = new URL(window.location.href); url.searchParams.set('live_account',value); navigate(url.pathname+url.search)
  }
  const [strategyId,strategyRevision] = strategy.split(':')
  const changeStrategy = value => {
    const [id,revision] = value.split(':'), url = new URL(window.location.href)
    if (value === 'all') { url.searchParams.delete('playbook'); url.searchParams.delete('playbook_revision') }
    else { url.searchParams.set('playbook',id); if (revision) url.searchParams.set('playbook_revision',revision); else url.searchParams.delete('playbook_revision') }
    navigate(url.pathname+url.search,{replace:true})
  }
  const deals = filterLiveDeals(payload,applied).filter(deal => !payload?.manual || (strategy === 'all' || deal.record?.payload.playbook_id === strategyId && (!strategyRevision || deal.record?.payload.playbook_revision === Number(strategyRevision))) && (tag === 'all' || deal.record?.payload.tags.includes(tag)))
  const showContent = preview || ledger.status === 'ready' || ledger.items.length > 0 || Boolean(broker?.account || broker?.connections?.length)
  const tags = [...new Set((payload?.deals || []).flatMap(deal => deal.record?.payload.tags || []))]
  const strategySeed = payload?.manual && strategy !== 'all' ? {playbook_id:strategyId,playbook_revision:Number(strategyRevision || strategies.find(item => item.record_id === strategyId)?.revision)} : undefined
  const open = (kind,record) => { if (!preview && ledger.status === 'ready' && (strategyReady || kind === 'account')) setAction({kind,record,seed: !record ? strategySeed : undefined}) }
  const create = (kind,seed) => { if (seed && !preview && ledger.status === 'ready' && strategyReady) setAction({kind:'note',seed:{...strategySeed,...seed}}); else if (!seed) open(kind === 'Add trade' ? 'trade' : kind === 'note' ? 'note' : 'account') }
  const saved = (record,close = true) => {
    setLedger(current => ({status:'ready',items:[record,...current.items.filter(item => item.record_id !== record.record_id)],error:''}))
    if (record.kind === 'account') choose(record.record_id)
    if (close) setAction(null)
  }
  const apply = override => { const next = override || draft; if (!next.from || !next.to || next.from <= next.to) setApplied({...next}) }
  const accountPicker = <div className="live-account-picker"><FxSelect label="Tài khoản trực tiếp" triggerContent={chosen ? undefined : 'Chọn tài khoản'} value={chosen} onChange={choose} options={[...(broker?.connections?.length ? broker.connections.map(item=>({value:`broker:${item.id}`,label:`${item.name} · ${item.login_hint}`,localize:false})) : broker?.account ? [{value:'broker',label:`${broker.source} · ${broker.account.account_ref}`,localize:false}] : []),...accounts.map(item => ({value:item.record_id,label:`${item.payload.name} · ${item.payload.currency}`,localize:false}))]} />{(payload?.manual || broker?.account) && <span className="live-muted">{payload?.manual ? 'Ghi tay' : 'Đồng bộ · chỉ đọc'}</span>}</div>
  const headerActions = <div className="live-toolbar-actions"><Action primary icon="plus" disabled={preview || ledger.status !== 'ready' || !strategyReady && accounts.length > 0} onClick={() => open(accounts.length ? 'trade' : 'account')}>{accounts.length ? 'Thêm giao dịch' : 'Tạo tài khoản'}</Action><Action icon="upload" disabled={preview || ledger.status !== 'ready' || !strategyReady || !accounts.length} onClick={() => open('import')}>Nhập CSV</Action></div>
  const filterBar = <FilterBar accountPicker={accountPicker} extra={payload?.manual ? <div className="live-journal-filters"><FxSelect label="Chiến lược" value={strategy} onChange={changeStrategy} options={[{value:'all',label:'Tất cả chiến lược'},...(strategyRevision ? [{value:strategy,label:`${strategies.find(item => item.record_id === strategyId)?.payload.name || 'Chiến lược'} · v${strategyRevision}`,localize:false}] : []),...strategies.map(item => ({value:item.record_id,label:item.payload.name,localize:false}))]} /><FxSelect label="Nhãn" value={tag} onChange={setTag} options={[{value:'all',label:'Tất cả nhãn'},...tags.map(value => ({value,label:value,localize:false}))]} /></div> : null} section={section} payload={payload} draft={draft} setDraft={setDraft} applied={applied} onApply={apply} onClear={() => { setDraft({...LIVE_FILTERS});setApplied({...LIVE_FILTERS});changeStrategy('all');setTag('all') }} onPreview={create} onRefresh={() => { setReload(value => value+1);onRefresh() }} />
  return <>
    {section === 'trades' && <div className="live-toolbar">{headerActions}</div>}
    {ledger.error && <div className="live-status live-status-error" role="alert"><span>{ledger.error}</span><Action onClick={() => setReload(value => value+1)}>Thử lại</Action></div>}
    {strategyError && <div className="live-status live-status-warning" role="alert"><span>{strategyError}</span><Action onClick={() => setReload(value => value+1)}>Tải lại</Action></div>}
    {ledger.status === 'loading' && <p className="live-status" role="status">Đang đọc sổ giao dịch…</p>}
    {showContent && !['calendar','notes','trading-accounts'].includes(section) && filterBar}
    {showContent && section === 'notes' && <div className="live-toolbar">{accountPicker}</div>}
    {showContent && <>
    {section === 'calendar' && <Calendar filterBar={showContent ? filterBar : null} canWrite={!preview && ledger.status === 'ready' && strategyReady} key={chosen} payload={payload} deals={deals} filters={applied} reviewScope={payload?.manual ? `${strategy === 'all' ? 'Tất cả chiến lược' : `${strategies.find(item => item.record_id === strategyId)?.payload.name || strategyId}${strategyRevision ? ` · v${strategyRevision}` : ' · mọi phiên bản'}`} · ${tag === 'all' ? 'Tất cả nhãn' : tag}` : 'Deals đã đồng bộ'} onPreview={create} />}
    {section === 'trades' && <div className="live-split"><section>{payload?.manual ? <ManualTrades writable={!preview && ledger.status === 'ready' && strategyReady} filterKey={JSON.stringify([chosen,applied,strategy,tag])} workspace={workspace} deals={deals} currency={payload.account.currency} strategies={strategies} onEdit={record => open('trade',record)} /> : payload?.account ? <LiveBrokerSnapshot payload={payload} section="trades" deals={deals} filterKey={JSON.stringify(applied)} /> : <Empty title="No trades yet" copy="Tạo tài khoản ghi tay và thêm giao dịch để bắt đầu." icon="journal" />}</section><Summary payload={payload} deals={deals} sidebar /></div>}
    {section === 'notes' && <JournalNotes writable={!preview && ledger.status === 'ready' && strategyReady} key={chosen} records={ledger.items} accountId={chosen || null} strategies={strategies} onEdit={record => open('note',record)} onCreate={() => open('note')} />}
    {section === 'tag-analytics' && <JournalTags deals={deals} currency={payload?.account?.currency || ''} />}
    {section === 'analytics' && <><Summary payload={payload} deals={deals} />{deals.length > 0 && <PnlCurve deals={deals} currency={payload?.account?.currency} />}</>}
    {section === 'trading-accounts' && <LiveAccounts key={workspace} workspace={workspace} accounts={accounts} records={ledger.items} broker={broker} chosen={chosen} onSelect={choose} transactions={query.get('account_tab') === 'transactions'} writable={!preview && ledger.status === 'ready'} canImport={!preview && ledger.status === 'ready' && strategyReady && accounts.length > 0} onCreate={() => open('account')} onImport={() => open('import')} onEdit={record => open('account',record)} onRefresh={onRefresh} />}

    </>}
    {action && <LiveRecordDialog key={`${workspace}:${action.kind}:${action.record?.record_id || 'new'}`} workspace={workspace} kind={action.kind} record={action.record} seed={action.seed} accountId={account?.record_id} accounts={accounts} strategies={strategies} onClose={() => setAction(null)} onSaved={saved} />}
  </>
}
