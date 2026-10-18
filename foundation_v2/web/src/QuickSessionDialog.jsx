import { createPropChartSession } from './propSessionCreation.js'
import { navigate } from './clientNavigation.js'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import DatasetAssetSelect from './DatasetAssetSelect.jsx'
import FxSelect from './FxSelect.jsx'
import SessionPeriodFields from './SessionPeriodFields.jsx'
import { commonSessionRange, sessionPeriodState } from './sessionPeriod.js'
import { fetchOfflineLibrary } from './dataDeskApi.js'
import { createPlaybookDraft, fetchPlaybooks } from './playbookApi.js'
import { createReplaySession, rememberSession, sessionNavigationHref } from './sessionCatalog.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { FieldError, FormFeedback, fieldValidationProps, focusFirstInvalid } from './FormValidation.jsx'
import { quickSessionErrors } from './quickSessionValidation.js'
import SessionTradingOptions from './SessionTradingOptions.jsx'
import { buildTradingOptions, tradingOptionsError, tradingOptionsMatch } from './sessionTradingOptions.js'
import { deleteSessionPreset, readSessionPresets, saveSessionPreset, sessionPresetKey } from './sessionPresets.js'
import SessionPresetMenu from './SessionPresetMenu.jsx'
import TestingIcon from './TestingIcon.jsx'
import './quick-session.css'

const formatBalance = value => value.replace(/^(\d+)/, digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','))

export default function QuickSessionDialog({ workspace, query, onClose, initialDataset = '', initialMode = 'backtest', sessions = [] }) {
  const { t } = useTestingLocale(), id = useId()
  const dialog = useRef(null), nameInput = useRef(null), opener = useRef(document.activeElement), submitLock = useRef(false)
  const [mode, setMode] = useState(initialMode === 'prop' ? 'prop' : 'backtest'), [advanced, setAdvanced] = useState(false)
  const panelBody = useRef(null)
  useLayoutEffect(() => { panelBody.current?.scrollTo(0, 0) }, [advanced, mode])
  const [draft, setDraft] = useState({ name: '', balance: '10000', datasets: initialDataset ? [initialDataset] : [], strategy: '', period: { start: '', end: '', endMode: 'auto' } })
  const [balanceMode, setBalanceMode] = useState('10000')
  const [tradingOptions, setTradingOptions] = useState({ costs_enabled: false, assets: {} })
  const [propDraft, setPropDraft] = useState({ profileKind: 'generic', targetPercent: '10', dailyLoss: '500', overallLoss: '1000', durationDays: '' })
  const [presets,setPresets] = useState([]), [activePreset,setActivePreset] = useState(''), [presetProblem,setPresetProblem] = useState('')
  const [presetEditor,setPresetEditor] = useState(null)
  const balanceInput = useRef(null), balanceCaret = useRef(null)
  const balanceDisplay = formatBalance(draft.balance)
  const [data, setData] = useState({ status: 'loading', items: [], error: '' })
  const [strategies, setStrategies] = useState({ items: [], error: '', status: 'loading' })
  const [addingStrategy, setAddingStrategy] = useState(false), [strategyName, setStrategyName] = useState('')
  const [strategyPending, setStrategyPending] = useState(false), [strategyProblem, setStrategyProblem] = useState(null)
  const [strategySubmitted, setStrategySubmitted] = useState(false)
  const strategyLock = useRef(false)
  const strategyInput = useRef(null), strategyOpener = useRef(null), wasAddingStrategy = useRef(false)
  const [reload, setReload] = useState(0), [pending, setPending] = useState(false), [problem, setProblem] = useState(null), [submitted, setSubmitted] = useState(false)
  const selectedAssets = draft.datasets.map(key => data.items.find(item => item.dataset_id === key)).filter(Boolean)
  const selected = selectedAssets[0]
  const currency = selected?.instrument_spec?.account_ccy || 'USD'
  const selectedStrategy = strategies.items.find(item => item.record_id === draft.strategy)
  const range = commonSessionRange(selectedAssets)
  const period = sessionPeriodState(draft.period, range)
  const validation = quickSessionErrors({ draft:presetEditor ? {...draft,name:presetEditor.name} : draft, mode, propDraft, selectedAssets, period:presetEditor ? {valid:true} : period, dataStatus: data.status, addingStrategy })
  if (presetEditor && !presetEditor.name.trim()) validation.name = 'Tên preset là bắt buộc.'
  if (draft.strategy && strategies.status === 'ready' && !selectedStrategy) validation.strategy = 'Chiến lược đã lưu không còn khả dụng. Chọn lại hoặc bỏ chọn.'
  const optionsError = tradingOptionsError(tradingOptions, selectedAssets)
  if (optionsError) validation.tradingOptions = optionsError
  const errors = submitted ? validation : {}
  const strategyError = strategySubmitted && !strategyName.trim() ? 'Tên chiến lược là bắt buộc.' : errors.strategy
  const fieldProps = key => fieldValidationProps(errors[key], `${id}-${key}-error`)
  const change = (key, value) => { if (!['name','period'].includes(key)) setActivePreset(''); setDraft(current => ({ ...current, [key]: value })) }
  const changeProp = (key, value) => {setActivePreset('');setPropDraft(current => ({ ...current, [key]: value }))}
  const changeTradingOptions = value => {setActivePreset('');setTradingOptions(value)}
  const loadPresets = () => {
    try {setPresets(readSessionPresets(window.localStorage,workspace,mode));setPresetProblem('')}
    catch {setPresetProblem('Không đọc được preset đã lưu.');setPresets([])}
  }
  useEffect(() => {
    loadPresets();setActivePreset('')
    const refresh = event => {if(event.key === null || event.key === sessionPresetKey(workspace,mode)) loadPresets()}
    window.addEventListener('storage',refresh)
    return () => window.removeEventListener('storage',refresh)
  },[workspace,mode])
  useLayoutEffect(() => {if(presetEditor) {panelBody.current?.scrollTo(0,0);nameInput.current?.focus()} else dialog.current?.querySelector('.session-preset-trigger')?.focus()},[Boolean(presetEditor)])
  const applyPreset = item => {
    const config = structuredClone(item.config)
    setDraft(current => ({...current,balance:config.balance,datasets:config.datasets,strategy:config.strategy}))
    setBalanceMode(['10000','50000','100000','250000'].includes(config.balance) ? config.balance : 'custom')
    setPropDraft(config.propDraft);setTradingOptions(config.tradingOptions);setActivePreset(item.id)
    setSubmitted(false);setPresetProblem('');setAddingStrategy(false)
  }
  const editPreset = item => {
    const before = structuredClone({draft,propDraft,tradingOptions,balanceMode,activePreset,advanced})
    if(item) applyPreset(item)
    setPresetEditor({id:item?.id || null,name:item?.name || '',before});setSubmitted(false);setPresetProblem('')
  }
  const leavePreset = () => {
    const before = presetEditor.before
    setDraft(before.draft);setPropDraft(before.propDraft);setTradingOptions(before.tradingOptions)
    setBalanceMode(before.balanceMode);setActivePreset(before.activePreset);setAdvanced(before.advanced)
    setPresetEditor(null);setPresetProblem('');setSubmitted(false)
  }
  const removePreset = item => {
    try {
      deleteSessionPreset(window.localStorage,workspace,mode,item.id)
      loadPresets();if(activePreset === item.id) setActivePreset('')
    } catch {throw new Error('Không lưu được preset trên trình duyệt này.')}
  }
  useLayoutEffect(() => {
    if (balanceCaret.current === null) return
    balanceInput.current?.setSelectionRange(balanceCaret.current, balanceCaret.current)
    balanceCaret.current = null
  })
  useEffect(() => {
    if (addingStrategy) strategyInput.current?.focus()
    else if (wasAddingStrategy.current) strategyOpener.current?.focus()
    wasAddingStrategy.current = addingStrategy
  }, [addingStrategy])
  useEffect(() => {
    dialog.current.showModal()
    nameInput.current?.focus()
    return () => { dialog.current?.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setData(current => ({ ...current, status: 'loading', error: '' }))
    fetchOfflineLibrary(workspace, controller.signal).then(library => {
      if (!controller.signal.aborted) setData({ status: 'ready', items: library.datasets, instruments: library.instruments, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setData({ status: 'error', items: [], error: error.message }) })
    fetchPlaybooks(workspace, controller.signal).then(items => {
      if (!controller.signal.aborted) setStrategies({ items, status: 'ready', error: '' })
    }).catch(error => { if (!controller.signal.aborted) setStrategies({ items: [], status: 'error', error: error.message }) })
    return () => controller.abort()
  }, [workspace, reload])
  const busy = pending || strategyPending
  const close = () => { if (!submitLock.current && !strategyLock.current) {if(presetEditor) leavePreset(); else onClose()} }
  const addStrategy = async () => {
    if (busy || strategyLock.current || strategyProblem?.uncertain) return
    setStrategySubmitted(true)
    if (!strategyName.trim()) { strategyInput.current?.focus(); return }
    strategyLock.current = true; setStrategyPending(true); setStrategyProblem(null)
    try {
      const record = await createPlaybookDraft(workspace, strategyName.trim())
      if (!record.record_id || !Number.isInteger(record.revision) || !record.payload?.name) throw new Error('Invalid strategy response')
      setStrategies(current => ({ ...current, items: [...current.items, record] }))
      change('strategy', record.record_id); setAddingStrategy(false); setStrategyName('')
    } catch (error) { setStrategyProblem({ text: error.message, uncertain: !error.status || error.status >= 500 }) }
    finally { strategyLock.current = false; setStrategyPending(false) }
  }
  const create = async event => {
    event.preventDefault()
    if (busy || problem?.uncertain || submitLock.current) return
    setSubmitted(true)
    if (Object.keys(validation).length) {
      setAdvanced(Boolean(optionsError && Object.keys(validation).length === 1))
      const form = event.currentTarget
      requestAnimationFrame(() => focusFirstInvalid(form))
      return
    }
    const savedTradingOptions = buildTradingOptions(tradingOptions, selectedAssets)
    if(presetEditor) {
      try {
        const saved = saveSessionPreset(window.localStorage,workspace,mode,{id:presetEditor.id,name:presetEditor.name,config:{balance:draft.balance,datasets:draft.datasets,strategy:draft.strategy,propDraft,tradingOptions:savedTradingOptions}})
        const original = presetEditor.before
        setDraft(current => ({...current,name:original.draft.name,period:original.draft.period}))
        setPresets(readSessionPresets(window.localStorage,workspace,mode));setActivePreset(saved.id)
        setAdvanced(original.advanced);setPresetEditor(null);setPresetProblem('');setSubmitted(false)
      } catch(error) {setPresetProblem(error.name === 'QuotaExceededError' || error.name === 'SecurityError' ? 'Không lưu được preset trên trình duyệt này.' : error.message)}
      return
    }
    if (mode === 'prop') {
      const propStart = Number.isFinite(period.start)
        ? new Date(period.start * 1000).toISOString().slice(0, 16)
        : period.start instanceof Date
          ? period.start.toISOString().slice(0, 16)
          : String(period.start || '').replace('Z', '').slice(0, 16)
      const propHandoff = {
          name: draft.name.trim(),
          profileKind: propDraft.profileKind,
          initialCapital: draft.balance,
          currency,
          targetPercent: propDraft.targetPercent,
          dailyLoss: propDraft.dailyLoss,
          overallLoss: propDraft.overallLoss,
          datasetVersion: selected.dataset_id,
          datasetVersions: draft.datasets,
          strategyId: selectedStrategy?.record_id || '',
          strategyRevision: selectedStrategy?.revision || null,
          startUtc: propStart,
          endUtc: period.end !== null ? new Date(period.end * 1000).toISOString().slice(0, 16) : '',
          durationDays: propDraft.durationDays,
          tradingOptions: savedTradingOptions,
      }
      submitLock.current = true; setPending(true); setProblem(null)
      try {
        const { replay } = await createPropChartSession(workspace, propHandoff, data.items)
        rememberSession(workspace, replay.record_id)
        navigate(sessionNavigationHref('replay', workspace, query, replay, { select: null, surface: 'workspace' }))
      } catch (error) {
        setProblem({ text: error.message, uncertain: !error.status || error.status >= 500 })
        submitLock.current = false; setPending(false)
      }
      return
    }
    submitLock.current = true; setPending(true); setProblem(null)
    try {
      const record = await createReplaySession(workspace, {
        name: draft.name.trim(), dataset_id: selected.dataset_id, dataset_ids: draft.datasets, starting_balance: draft.balance,
        chart_engine: 'legacy', start_timestamp: period.start, end_timestamp: period.end,
        trading_options: savedTradingOptions,
        ...(selectedStrategy ? { playbook_id: selectedStrategy.record_id, playbook_revision: selectedStrategy.revision } : {}),
      })
      if (!record.record_id || !record.payload || record.payload.dataset_id !== selected.dataset_id || JSON.stringify(record.payload.dataset_ids || [record.payload.dataset_id]) !== JSON.stringify(draft.datasets) || !Number.isInteger(record.revision)) throw new Error('Phản hồi tạo phiên không đúng định dạng.')
      if (record.session_period?.requested_start_timestamp !== period.start || record.session_period?.requested_end_timestamp !== period.end) throw new Error('Phản hồi tạo phiên không đúng khoảng thời gian đã chọn.')
      if (!tradingOptionsMatch(record.payload.trading_options, savedTradingOptions)) throw new Error('Cấu hình chi phí đã lưu không khớp lựa chọn. Kiểm tra phiên trước khi giao dịch.')
      rememberSession(workspace, record.record_id)
      navigate(sessionNavigationHref('replay', workspace, query, { record_id: record.record_id, dataset_id: selected.dataset_id }, { select: null, surface: 'workspace', chart_iframe: query.get('chart_iframe') || 'srcdoc', chart_engine: null, fresh: null }))
    } catch (error) {
      setProblem({ text: error.message, uncertain: !error.status || error.status >= 500 })
      submitLock.current = false; setPending(false)
    }
  }
  return <dialog ref={dialog} className="quick-session-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const r = event.currentTarget.getBoundingClientRect()
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close()
  }}>
    <header className="quick-session-header">
      {presetEditor && <button type="button" className="session-preset-back" aria-label={t('Quay lại tạo phiên')} onClick={close} disabled={busy}><TestingIcon kind="chevron-left" size={18} /></button>}
      <h2 id={`${id}-title`}>{t(presetEditor ? presetEditor.id ? 'Sửa preset' : 'Tạo preset' : 'Create session')}</h2>
        {!presetEditor && <div className="quick-session-tabs" role="tablist" aria-label={t('Loại phiên')}>{[['backtest','Backtesting'],['prop','Prop Firm']].map(([key,label]) => <button key={key} id={`${id}-${key}`} role="tab" type="button" aria-selected={mode === key} aria-controls={`${id}-panel`} tabIndex={mode === key ? 0 : -1} disabled={busy} onClick={() => setMode(key)} onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
          event.preventDefault(); const next = event.key === 'Home' ? 'backtest' : event.key === 'End' ? 'prop' : mode === 'backtest' ? 'prop' : 'backtest'; setMode(next); document.getElementById(`${id}-${next}`).focus()
        }}>{label}</button>)}</div>}
      {!presetEditor && <SessionPresetMenu items={presets} selected={activePreset} disabled={busy || problem?.uncertain || data.status !== 'ready'} onApply={applyPreset} onCreate={() => editPreset(null)} onEdit={editPreset} onDelete={removePreset} />}
      <button type="button" className="quick-session-close wm-dialog-close" aria-label={t('Đóng tạo phiên')} disabled={busy} onClick={close}>×</button>
    </header>
    <form noValidate onSubmit={create} className="quick-session-form">
      <div className={`quick-session-layout${presetEditor ? ' is-preset-editor' : ''}`}>
        {!presetEditor && <nav className="quick-session-sections" aria-label={t('Thiết lập phiên')}>
          <button type="button" aria-pressed={!advanced} aria-controls={`${id}-panel`} disabled={busy} onClick={() => setAdvanced(false)}>
            <strong>{t('Cơ bản')}</strong><span>{t('Tên, số dư, chiến lược và tài sản')}</span>
          </button>
          <button type="button" aria-pressed={advanced} aria-controls={`${id}-panel`} disabled={busy} onClick={() => setAdvanced(true)}>
            <strong>{t('Tùy chọn thêm')}</strong><span>{t('Chi phí và cách khớp lệnh')}</span>
          </button>
        </nav>}
        <div className="quick-session-body" ref={panelBody}>
        <div role={presetEditor ? undefined : 'tabpanel'} id={`${id}-panel`} aria-labelledby={presetEditor ? undefined : `${id}-${mode}`} className="quick-session-fields">
          {advanced && !presetEditor ? <SessionTradingOptions assets={selectedAssets} value={tradingOptions} onChange={changeTradingOptions} disabled={busy} error={errors.tradingOptions} id={id} /> : <>
            <label className={errors.name ? 'quick-session-invalid-field' : ''}><span>{t(presetEditor ? 'Tên preset' : 'Name')} <span className="quick-session-required" aria-hidden="true">*</span></span><input ref={nameInput} required maxLength={160} placeholder={t(presetEditor ? 'Đặt tên preset' : 'Đặt tên phiên của bạn')} value={presetEditor ? presetEditor.name : draft.name} disabled={busy} {...fieldProps('name')} onChange={event => presetEditor ? setPresetEditor(current => ({...current,name:event.target.value})) : change('name', event.target.value)} /><FieldError id={`${id}-name-error`} error={errors.name} /></label>
            <label className={errors.balance ? 'quick-session-invalid-field' : ''}><span>{t('Account Balance')} <span className="quick-session-required" aria-hidden="true">*</span></span><div className="quick-session-balance-picker" role="radiogroup" aria-label={t('Account Balance')}>
              {[['10000', '$10K'], ['50000', '$50K'], ['100000', '$100K'], ['250000', '$250K']].map(([value, label]) => <button key={value} type="button" role="radio" aria-label={label} aria-checked={balanceMode === value} disabled={busy} onClick={() => { setBalanceMode(value); change('balance', value) }}>{label}</button>)}
              <button type="button" role="radio" aria-label="Custom" aria-checked={balanceMode === 'custom'} disabled={busy} onClick={() => setBalanceMode('custom')}>Custom</button>
            </div>{balanceMode === 'custom' && <div className="quick-session-balance" onClick={() => balanceInput.current?.focus()}><span className="quick-session-balance-currency" aria-hidden="true">{currency === 'USD' ? '$' : currency}</span><input ref={balanceInput} required type="text" inputMode="decimal" aria-label={t('Account Balance')} {...fieldProps('balance')} value={balanceDisplay} disabled={busy} onKeyDown={event => {
              const input = event.currentTarget, caret = input.selectionStart
              if (caret !== input.selectionEnd) return
              if (event.key === 'Backspace' && input.value[caret - 1] === ',') input.setSelectionRange(caret - 1, caret - 1)
              if (event.key === 'Delete' && input.value[caret] === ',') input.setSelectionRange(caret + 1, caret + 1)
            }} onChange={event => {
              const input = event.currentTarget, value = input.value.replaceAll(',', '')
              if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return
              const rawCaret = input.value.slice(0, input.selectionStart).replaceAll(',', '').length
              const formatted = formatBalance(value)
              let caret = 0, digits = 0
              while (caret < formatted.length && digits < rawCaret) {
                if (formatted[caret] !== ',') digits++
                caret++
              }
              balanceCaret.current = caret
              change('balance', value)
            }} /></div>}<FieldError id={`${id}-balance-error`} error={errors.balance} /></label>
            <div className="quick-session-field quick-session-strategy"><span>{t('Strategy')}</span><FxSelect searchable={strategies.items.length > 0} label={t('Strategy')} value={draft.strategy} disabled={busy || strategies.status === 'loading'} onChange={value => change('strategy',value)} className={draft.strategy ? 'is-field' : 'is-field is-placeholder'} triggerContent={selectedStrategy?.payload?.name || t('Chọn chiến lược hoặc tạo mới')} localizeOptions={false} placeholder={t('Tìm chiến lược…')} emptyLabel={t('Không tìm thấy kết quả')} options={strategies.items.map(item => ({ value:item.record_id, label:item.payload?.name || item.record_id, localize:false }))} />{draft.strategy && <button type="button" className="quick-session-text-action" disabled={busy} onClick={() => change('strategy','')}>{t('Bỏ chọn chiến lược')}</button>}{!addingStrategy ? <button type="button" ref={strategyOpener} className="quick-session-text-action quick-session-new-strategy" disabled={busy || strategies.status === 'loading'} onClick={() => { setStrategySubmitted(false); setAddingStrategy(true) }}>{t('+ Tạo chiến lược mới')}</button> : <div className="quick-session-strategy-create"><input ref={strategyInput} maxLength={160} placeholder={t('Tên chiến lược')} aria-label={t('Tên chiến lược')} {...fieldValidationProps(strategyError, `${id}-strategy-error`)} value={strategyName} disabled={strategyPending} onChange={event => setStrategyName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addStrategy() } }} /><button type="button" disabled={busy || strategyProblem?.uncertain} onClick={addStrategy}>{t(strategyPending ? 'Đang tạo…' : 'Tạo chiến lược')}</button><button type="button" disabled={strategyPending} onClick={() => setAddingStrategy(false)}>{t('Cancel')}</button><FieldError id={`${id}-strategy-error`} error={strategyError} />{strategyProblem && <small role="alert">{strategyProblem.uncertain ? t('Chưa xác định chiến lược đã tạo hay chưa. Kiểm tra danh sách chiến lược trước khi thử lại.') : strategyProblem.text}{strategyProblem.uncertain && <a aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('playbook',workspace,query)}>{t('Quản lý chiến lược')}</a>}</small>}</div>}{strategies.error && <small>{t('Chưa đọc được chiến lược. Bạn vẫn có thể tạo phiên không gắn chiến lược.')}</small>}</div>
            <div className="quick-session-field"><div className="quick-session-field-title"><span>{t('Assets')} <span className="quick-session-required" aria-hidden="true">*</span></span><a aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('data',workspace,query)}>{t('Kho dữ liệu')}</a></div><DatasetAssetSelect maxAssets={12} datasets={data.items} instruments={data.instruments} sessions={sessions} {...fieldProps('assets')} value={draft.datasets} disabled={busy || data.status !== 'ready'} onChange={value => change('datasets',value)} /><FieldError id={`${id}-assets-error`} error={errors.assets} />{data.status === 'loading' ? <small role="status">{t('Đang đọc danh mục dữ liệu…')}</small> : data.status === 'error' ? <div role="alert">{t('Không đọc được danh mục:')} {data.error}<button type="button" onClick={() => setReload(value => value + 1)}>{t('Thử lại')}</button></div> : !data.items.length && <small>{t('Chưa có dataset local trong workspace này.')}</small>}</div>
            {!presetEditor && selectedAssets.length > 0 && <SessionPeriodFields error={errors.period} range={range} value={draft.period} onChange={value => change('period', value)} disabled={busy || data.status !== 'ready'} />}
            {mode === 'prop' ? <section className="quick-session-prop-rules" aria-label={t('Prop Firm rules')}>
              <div className="quick-session-prop-rule-group">
                <div className="quick-session-prop-grid">
                <label className="quick-session-rule-target"><span>{t('Profit target')}</span><div className="quick-session-rule-input"><span className="quick-session-currency-prefix" aria-hidden="true">%</span><input aria-label={`${t('Profit target')} %`} {...fieldProps('targetPercent')} type="number" min="0.1" step="0.1" value={propDraft.targetPercent} disabled={busy} onChange={event => changeProp('targetPercent', event.target.value)} /></div><FieldError id={`${id}-targetPercent-error`} error={errors.targetPercent} /></label>
                <label><span>{t('Max daily loss')}</span><div className="quick-session-rule-input"><span className="quick-session-currency-prefix" aria-hidden="true">{currency === 'USD' ? '$' : currency}</span><input aria-label={`${t('Max daily loss')} ${currency}`} {...fieldProps('dailyLoss')} type="number" min="1" step="0.01" value={propDraft.dailyLoss} disabled={busy} onChange={event => changeProp('dailyLoss', event.target.value)} /></div><FieldError id={`${id}-dailyLoss-error`} error={errors.dailyLoss} /></label>
                <label><span>{t('Max total loss')}</span><div className="quick-session-rule-input"><span className="quick-session-currency-prefix" aria-hidden="true">{currency === 'USD' ? '$' : currency}</span><input aria-label={`${t('Max total loss')} ${currency}`} {...fieldProps('overallLoss')} type="number" min="1" step="0.01" value={propDraft.overallLoss} disabled={busy} onChange={event => changeProp('overallLoss', event.target.value)} /></div><FieldError id={`${id}-overallLoss-error`} error={errors.overallLoss} /></label>
                </div>
              </div>
            </section> : <>
              <div className="quick-session-field"><span>{t('Select Chart Layout (Optional)')}</span><div className="session-chart-options"><FxSelect className="is-field" label={t('Chart Layout')} value="default" disabled options={[{value:'default',label:'Bố cục mặc định'}]} onChange={() => {}} /><div className="session-smooth-candles"><span>{t('Smooth candles')}<small>{t('Chưa hỗ trợ')}</small></span><button type="button" role="switch" aria-label={t('Smooth candles')} aria-checked="false" title={t('Chưa hỗ trợ')} disabled><span /></button></div></div></div>
              {!presetEditor && <section className="quick-session-engine" aria-label={t('Charting engine')}><h3>{t('Charting engine')}</h3><p>{t('Chọn một lần cho phiên này.')}</p><div role="radiogroup" aria-label={t('Charting engine')}><button type="button" role="radio" aria-checked="false" disabled>New Chart <small>{t('Chưa khả dụng')}</small></button><button type="button" role="radio" aria-checked="true" disabled={busy}>Legacy Chart</button></div></section>}
            </>}
            {presetEditor && <section className="session-preset-more"><h3>{t('Tùy chọn thêm')}</h3><SessionTradingOptions assets={selectedAssets} value={tradingOptions} onChange={changeTradingOptions} disabled={busy} error={errors.tradingOptions} id={id} /></section>}
          </>}
          {presetProblem && <p className="wm-field-error" role="alert">{t(presetProblem)}</p>}
          {problem && <div role="alert" className="quick-session-error">{problem.uncertain ? t('Chưa xác định phiên đã tạo hay chưa. Kiểm tra danh sách phiên trước khi tạo lại.') : t('Không tạo được phiên: {error}', {error:problem.text})}{problem.uncertain && <a aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('replay',workspace,query,{select:'1',surface:null,fresh:null})}>{t('Xem danh sách phiên')}</a>}</div>}
        </div>
      </div>
      </div>
      <footer className="quick-session-footer"><FormFeedback errors={errors} /><button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button><button type="submit" className="quick-session-submit" disabled={busy || problem?.uncertain}>{t(presetEditor ? 'Lưu preset' : pending ? 'Đang tạo…' : 'Create session')}</button></footer>
    </form>
  </dialog>
}
