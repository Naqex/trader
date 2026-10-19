import { useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { DEFAULT_COST_MODEL, RiskPreview, validateDraft } from './TradeWorkspace.jsx'
import { finiteNumber, marketQuotes, orderDraft, protectionReference, replayAtCutoff, validateEntry } from './replayOrderModel.js'
import { useReplayTickOptions } from './useReplayTickOptions.js'
import FxSelect from './FxSelect.jsx'
import { scalperProtection } from './legacyScalperPreset.js'
import { sessionExecutionConfig } from './sessionTradingOptions.js'
import { closeNotice, protectionNotice } from './replayOrderNotices.js'
import { protectionAmount, protectionPips, protectionPrice, quantityForRisk, selectOrderDraft } from './orderProtection.js'

export function useChartOrder({ workspace, replay, dataset, ready, blocked, closeBlocked = blocked, submit, executionConfig = null }) {
  const execution = replayAtCutoff(replay)?.payload?.execution
  const account = replay?.portfolio_account || execution
  const assetStates = replay?.payload?.asset_states
  const instrument = execution?.instrument_spec || dataset?.instrument_spec || dataset?.replay_instrument_spec
  const sessionConfig = sessionExecutionConfig(replay, instrument)
  executionConfig = sessionConfig || executionConfig
  const [draft, setDraft] = useState(() => orderDraft(replay, instrument))
  const [notice, setNotice] = useState(null)
  const [legacyStartingBalance, setStartingBalance] = useState('10000')
  const startingBalance = sessionConfig ? String(replay.payload.starting_balance ?? '10000') : legacyStartingBalance
  useEffect(() => { setStartingBalance(String(replay?.payload?.starting_balance ?? '10000')) }, [replay?.record_id])
  const [legacySpread, setSpread] = useState('0.0002')
  const spread = sessionConfig?.spread ?? legacySpread
  const [pending, setPending] = useState(false)
  const [pendingOrder, setPendingOrder] = useState(null)
  const busy = useRef(false)
  const context = `${workspace}:${replay?.record_id}:${replay?.payload?.dataset_id}:${replay?.view_cursor_index ?? replay?.payload?.cursor_index}`
  const currentContext = useRef(context)
  currentContext.current = context
  const tick = useReplayTickOptions(workspace, replay)
  useEffect(() => { setDraft(orderDraft(replay, instrument)); setNotice(null) }, [replay?.record_id, replay?.revision, instrument])
  const active = execution?.position || execution?.pending_market_order
  const costs = execution?.cost_model || (dataset ? { ...DEFAULT_COST_MODEL, ...(executionConfig?.costModel || {}), account_ccy: executionConfig?.costModel?.account_ccy || instrument?.account_ccy || DEFAULT_COST_MODEL.account_ccy } : null)
  const quotes = marketQuotes(replay)
  const reference = active ? protectionReference(replay) : draft.orderType && draft.orderType !== 'market' ? finiteNumber(draft.entryPrice) : execution ? (draft.side === 'BUY' ? quotes.ask : quotes.bid) : protectionReference(replay)
  const disabled = !ready || blocked || pending
  const canInitialize = Boolean(instrument && dataset?.timeframe_seconds && costs)
  const run = async (endpoint, body) => {
    if ((endpoint === 'orders/close' ? !ready || closeBlocked || pending : disabled) || busy.current) return
    busy.current = true
    setPending(true)
    setNotice(null)
    try {
      const success = await submit(endpoint, body)
      if (success) setNotice(endpoint === 'orders/close'
        ? closeNotice(execution, success.payload.execution, body.operation_id, instrument?.instrument_id || '—')
        : { kind: 'ok', text: endpoint === 'execution' ? 'Simulator sẵn sàng.' : endpoint.endsWith('protection') ? 'TP/SL đã lưu; áp dụng từ nến tiếp theo.' : execution?.quote_source === 'broker_bid_ask' ? 'Đã queue; fill ở tick đầu tiên của nến kế tiếp.' : 'Đã queue; fill ở giá mở nến kế tiếp.' })
      return success
    } catch (error) { setNotice({ kind: 'error', text: error.message }) }
    finally { busy.current = false; setPending(false) }
  }
  const save = async (nextDraft = draft, options = {}) => {
    if (disabled || busy.current) return false
    const origin = currentContext.current
    busy.current = true
    setPending(true)
    setNotice(null)
    try {
      let nextReplay = replay
      let nextExecution = execution
      if (!nextExecution) {
        const body = initializationBody()
        if (!body) return false
        nextReplay = await submit('execution', body)
        if (!nextReplay) return false
        nextExecution = nextReplay.payload?.execution
        if (!nextExecution) throw new Error('Không khởi tạo được simulator cho phiên này.')
      }
      if (currentContext.current !== origin) throw new Error('Phiên hoặc cutoff đã thay đổi; lệnh chưa được gửi.')
      const nextActive = nextExecution.position || nextExecution.pending_market_order
      const nextQuotes = marketQuotes(nextReplay)
      const conditional = !nextActive && ['limit','stop'].includes(nextDraft.orderType)
      if (conditional && replay?.execution_capabilities?.conditional_orders !== true) throw new Error('Phiên này chưa hỗ trợ lệnh Limit/Stop.')
      const entryError = !nextActive && validateEntry(nextDraft,nextQuotes,instrument)
      if (entryError) throw new Error(entryError)
      const nextReference = nextActive ? protectionReference(nextReplay) : conditional ? finiteNumber(nextDraft.entryPrice) : nextDraft.side === 'BUY' ? nextQuotes.ask : nextQuotes.bid
      if (nextReference === null || nextReference === undefined) throw new Error('Chưa có giá tham chiếu tại cutoff này.')
      const validation = validateDraft(nextDraft, nextReference, { optionalProtection: true })
      if (validation) { setNotice({ kind: 'error', title: 'Order Error', message: validation }); return false }
      const operation_id = `chart-${crypto.randomUUID()}`
      const result = await submit(nextActive ? 'orders/protection' : 'orders/market', nextActive
        ? { operation_id, target_id: nextExecution.position?.position_id || nextExecution.pending_market_order.operation_id, stop_loss: nextDraft.stopLoss || null, take_profit: nextDraft.takeProfit || null }
        : { operation_id, execution_timing: conditional ? 'pending' : 'current_quote', ...(conditional ? { order_type: nextDraft.orderType, entry_price: nextDraft.entryPrice } : {}), side: nextDraft.side, quantity: nextDraft.quantity, stop_loss: nextDraft.stopLoss || null, take_profit: nextDraft.takeProfit || null }, nextReplay.revision)
      if (result) {
        if (!nextActive && !(conditional ? result.payload.execution.pending_market_order : result.payload.execution.position)) {
          throw new Error('Không đủ margin để mở vị thế.')
        }
        if (nextActive) setNotice(protectionNotice(nextActive, nextDraft, instrument?.tick_size, options.movedKind))
        else setNotice({ kind: 'ok', text: conditional ? 'Đã đặt lệnh chờ.' : 'Đã khớp lệnh mô phỏng tại giá hiện tại.' })
      }
      return Boolean(result)
    } catch (error) {
      setNotice({ kind: 'error', title: 'Order Error', message: error.message })
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const changePrice = (kind, price) => {
    if (disabled || (price !== null && !(price > 0))) return
    const next = { ...draft, [kind === 'stop' ? 'stopLoss' : 'takeProfit']: price === null ? '' : String(price) }
    // Validate the direction before an interactive chart drag reaches the API.
    // This keeps the line from briefly accepting a crossed bracket and gives
    // the same immediate feedback as the order form.
    if (active) {
      const validation = validateDraft(next, reference, { optionalProtection: true })
      if (validation) { setNotice({ kind: 'error', title: 'Order Error', message: validation }); return false }
      return save(next, { movedKind: kind === 'stop' ? 'stop' : 'target', movedPrice: price })
    }
    setDraft(next)
    return true
  }
  const reportError = text => setNotice({ kind: 'error', title: 'Order Error', message: String(text || 'Không thể cập nhật TP/SL.') })
  const chooseSide = side => {
    if (!active && !disabled) { setDraft(current => selectOrderDraft(current, replay, instrument, { side })); setNotice(null) }
  }
  const chooseType = type => {
    if (!active && !disabled) { setDraft(current => selectOrderDraft(current, replay, instrument, { orderType: type })); setNotice(null) }
  }
  const initializationBody = () => {
    if (!canInitialize || (tick.options === null && !executionConfig?.forceBar)) return
    const useTicks = !executionConfig?.forceBar && tick.useTicks
    const balance = finiteNumber(startingBalance), spreadValue = useTicks ? 0 : finiteNumber(spread)
    if (!(balance > 0) || spreadValue === null || spreadValue < 0) { setNotice({ kind: 'error', text: 'Nhập vốn dương và spread không âm.' }); return }
    const leverage = finiteNumber(tick.leverage)
    if (useTicks && (!tick.options?.available || !tick.options.snapshot_id || !Number.isInteger(leverage) || leverage < 1 || leverage > 1000)) {
      setNotice({ kind: 'error', text: 'Cần tick tại phút đang chọn và đòn bẩy nguyên từ 1 đến 1000.' }); return
    }
    return { instrument_spec: instrument, cost_model: costs, spread_price: String(spreadValue), timeframe_seconds: Number(dataset.timeframe_seconds), starting_balance: String(balance),
      ...(useTicks ? { tick_snapshot_id: tick.options.snapshot_id, research_margin: { version: 'fixed-starting-balance-leverage-v1', leverage: String(leverage) } } : {}) }
  }
  const initialize = () => {
    const body = initializationBody()
    return body ? run('execution', body) : undefined
  }
  const quickTrade = async (side, quantity, preset) => {
    if (disabled || active || busy.current) return false
    busy.current = true; setPending(true); setNotice(null)
    const origin = context
    try {
      let nextReplay = replay
      let endpoint = 'orders/market'
      let initialization = null
      if (!execution) {
        initialization = initializationBody()
        if (!initialization) throw new Error('Chưa đủ cấu hình simulator để vào lệnh nhanh.')
        endpoint = 'orders/quick'
      }
      const quoteSeed = initialization ? marketQuotes({ ...nextReplay, payload: { ...nextReplay.payload, execution: { cursor_index: nextReplay.view_cursor_index ?? nextReplay.payload.cursor_index, spread_price: initialization.spread_price, instrument_spec: initialization.instrument_spec, cost_model: initialization.cost_model } } }) : marketQuotes(nextReplay)
      const seedPrice = side === 'BUY' ? quoteSeed.ask : quoteSeed.bid
      const seededProtection = seedPrice === null ? null : scalperProtection(preset, seedPrice, side, initialization?.instrument_spec || execution?.instrument_spec)
      const invalidSeed = validateDraft({ side, quantity, ...seededProtection }, seedPrice, { optionalProtection: true })
      if (invalidSeed) throw new Error(invalidSeed)
      setPendingOrder({ context: origin, side, quantity, entry: seedPrice, stop_loss: seededProtection?.stopLoss || null, take_profit: seededProtection?.takeProfit || null })
      if (endpoint === 'orders/quick' && preset.enabled && (initialization?.tick_snapshot_id || !seededProtection)) {
        endpoint = 'execution'
      }
      if (endpoint === 'orders/quick') {
        nextReplay = await submit(endpoint, { ...initialization, operation_id: `quick-${crypto.randomUUID()}`, execution_timing: 'current_quote', side, quantity, stop_loss: seededProtection?.stopLoss || null, take_profit: seededProtection?.takeProfit || null })
      } else if (!execution) {
        nextReplay = await submit('execution', initialization)
      }
      if (!nextReplay) return false
      if (currentContext.current !== origin) throw new Error('Phiên hoặc cutoff đã thay đổi; lệnh nhanh chưa được gửi.')
      const nextExecution = nextReplay.payload.execution
      if (endpoint === 'orders/quick') {
        const position = nextExecution?.position
        if (!position) throw new Error(nextExecution?.ledger?.at(-2)?.details?.reason === 'insufficient_research_margin' ? 'Không đủ margin để mở vị thế.' : 'Không mở được vị thế.')
        setNotice({ kind: 'ok', order: { status: 'executed', side, symbol: nextExecution.instrument_spec?.instrument_id || '—', quantity: String(position.quantity), price: String(position.entry_fill) } })
        return true
      }
      if (nextExecution.position || nextExecution.pending_market_order) throw new Error('Tài sản đã có lệnh đang hoạt động.')
      const quote = marketQuotes(nextReplay)
      const protection = scalperProtection(preset, side === 'BUY' ? quote.ask : quote.bid, side, nextExecution.instrument_spec)
      const nextDraft = { side, quantity, ...protection }
      const invalid = validateDraft(nextDraft, side === 'BUY' ? quote.ask : quote.bid, { optionalProtection: true })
      if (invalid) throw new Error(invalid)
      const result = await submit('orders/market', {
        operation_id: `quick-${crypto.randomUUID()}`, execution_timing: 'current_quote', side, quantity,
        stop_loss: protection.stopLoss || null, take_profit: protection.takeProfit || null,
      }, nextReplay.revision)
      if (result) {
        const position = result.payload.execution.position
        if (!position) throw new Error('Không đủ margin để mở vị thế.')
        setNotice({ kind: 'ok', order: { status: 'executed', side, symbol: nextExecution.instrument_spec?.instrument_id || '—', quantity: String(position.quantity), price: String(position.entry_fill) } })
      }
      return Boolean(result)
    } catch (error) { setNotice({ kind: 'error', text: error.message }); return false }
    finally { busy.current = false; setPending(false); setPendingOrder(null) }
  }
  const close = quantity => active && (typeof quantity !== 'string' || replay?.execution_capabilities?.partial_close === true) && run('orders/close', {
    operation_id: `close-${crypto.randomUUID()}`,
    target_id: execution.position?.position_id || execution.pending_market_order.operation_id,
    ...(typeof quantity === 'string' ? { quantity } : {}),
  })
  return { resetDraft: () => setDraft(orderDraft(replay, instrument)), draft, setDraft, execution, account, assetStates, instrument, costs, active, reference, disabled, pending, pendingOrder: pendingOrder?.context === context ? pendingOrder : null, notice, quickTrade, close, canClose: ready && !closeBlocked && !pending, startingBalance, configuredBalance: replay?.payload?.starting_balance, configuredCurrency: replay?.payload?.starting_balance_ccy, setStartingBalance, spread, setSpread, tick, canInitialize, initialize, save, changePrice, reportError, chooseSide, chooseType, conditionalOrders: replay?.execution_capabilities?.conditional_orders === true, executionConfig }
}

function ProtectionRiskSizing({ order, entry }) {
  const { t, fmt } = useTestingLocale()
  const [basis, setBasis] = useState('current')
  const [input, setInput] = useState({ mode: 'percent', value: '1' })
  const balance = finiteNumber(basis === 'initial' ? order.configuredBalance ?? order.execution?.starting_balance ?? order.startingBalance : order.account?.balance)
  const budget = input.mode === 'percent' ? balance > 0 && finiteNumber(input.value) > 0 ? balance * Number(input.value) / 100 : null : finiteNumber(input.value)
  const percent = input.mode === 'percent' ? input.value : balance > 0 && budget !== null ? Number((budget / balance * 100).toFixed(4)) : ''
  const quantity = quantityForRisk(budget, order.draft.stopLoss, entry, order.draft.side, order.instrument, order.costs)
  return <details className="legacy-risk-sizing" onKeyDown={event => {
    // Calculating a size must not submit the enclosing order form.
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault()
  }}>
    <summary>{t('Tính khối lượng theo rủi ro')}</summary>
    <div className="legacy-risk-fields">
      <label>{t('Tính tỷ lệ theo')}<FxSelect className="is-field" label="Tính tỷ lệ theo" value={basis} disabled={order.disabled} onChange={setBasis} options={[{ value:'initial', label:t('Số dư ban đầu') },{ value:'current', label:t('Số dư hiện tại') }]} /></label>
      <div className="legacy-risk-presets" role="group" aria-label={t('Rủi ro (%)')}>{['0.3','0.5','0.7','1','2','3'].map(value => <button type="button" key={value} aria-pressed={Number(percent) === Number(value)} disabled={order.disabled} onClick={() => setInput({ mode:'percent', value })}>{value}%</button>)}</div>
      <div className="legacy-order-grid">
        <label>{t('Rủi ro (%)')}<input type="number" min="0" step="any" value={percent} disabled={order.disabled} onChange={event => setInput({ mode:'percent', value:event.target.value })} /></label>
        <label>{t('Số tiền rủi ro')} · {order.costs?.account_ccy || '—'}<input type="number" min="0" step="any" value={input.mode === 'amount' ? input.value : budget === null ? '' : Number(budget.toFixed(2))} disabled={order.disabled} onChange={event => setInput({ mode:'amount', value:event.target.value })} /></label>
      </div>
      <div className="legacy-risk-apply"><span>{t('Khối lượng (trước phí)')}: <strong>{quantity === null ? '—' : fmt(quantity, order.instrument?.asset_class === 'fx' ? ' lot' : '', 8)}</strong></span><button type="button" disabled={order.disabled || quantity === null} onClick={() => order.setDraft(current => ({ ...current, quantity }))}>{t('Áp dụng khối lượng')}</button></div>
    </div>
  </details>
}

function LegacyOrderForm({ order, blockedReason, onClose, onJournal }) {
  const { t, fmt } = useTestingLocale()
  const [journal, setJournal] = useState(false)
  const { draft, setDraft, execution, disabled, instrument, active } = order
  const enabled = draft.protectionEnabled
  const changed = !active || ['stopLoss', 'takeProfit'].some((key, i) => String(draft[key] || '') !== String(active[i ? 'take_profit' : 'stop_loss'] ?? ''))
  const change = (key, value) => setDraft(current => ({ ...current, [key]:value }))
  const pip = Number(instrument?.pip_size), entry = finiteNumber(active?.entry_fill ?? active?.entry_price ?? order.reference)
  return <><form className="legacy-order-form" onSubmit={async event => { event.preventDefault(); if (await order.save()) { onClose(); if (journal) onJournal() } }}>
    {!active && <div className="legacy-order-grid"><label>{t('Hướng')}<FxSelect className="is-field" label="Hướng" value={draft.side} disabled={disabled} onChange={order.chooseSide} options={[{ value: 'BUY', label: t('Buy') }, { value: 'SELL', label: t('Sell') }]} /></label><label>{t('Loại lệnh')}<FxSelect className="is-field" label="Loại lệnh" value={draft.orderType || 'market'} disabled={disabled || !order.conditionalOrders} onChange={order.chooseType} options={['market','limit','stop'].map(value => ({ value,label:value[0].toUpperCase()+value.slice(1) }))} /></label>
    <label>{t(instrument?.asset_class==='fx' ? 'Khối lượng (lot)' : 'Khối lượng (quantity)')}<input aria-label={t('Khối lượng lệnh')} type="number" min={instrument?.quantity_min || '0'} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled} onChange={event => change('quantity',event.target.value)} /></label><label>{t('Giá vào lệnh')}<input aria-label={t('Giá vào lệnh')} type={draft.orderType && draft.orderType !== 'market' ? 'number' : 'text'} min="0" step={instrument?.tick_size || 'any'} disabled={disabled} readOnly={!draft.orderType || draft.orderType === 'market'} value={draft.orderType && draft.orderType !== 'market' ? draft.entryPrice : order.reference ?? '—'} onChange={event => change('entryPrice',event.target.value)} /></label></div>}
    {[['stopLoss','Stop loss'],['takeProfit','Take profit']].map(([key,label]) => <section className={active ? 'legacy-edit-protection' : 'legacy-new-protection'} key={key} data-protection={key}><div className="legacy-protection-row"><label><input type="checkbox" role="switch" checked={enabled[key]} disabled={disabled || !execution} onChange={event => {
      const checked = event.target.checked
      const unit = Number(instrument?.pip_size) || Number(instrument?.tick_size)
      const direction = (key === 'stopLoss' ? -1 : 1) * (draft.side === 'BUY' ? 1 : -1)
      const price = order.reference + direction * unit * (key === 'stopLoss' ? 20 : 40)
      setDraft(current => ({ ...current, protectionEnabled: { ...current.protectionEnabled, [key]: checked }, [key]: checked && Number.isFinite(price) && price > 0 ? String(Number(price.toFixed(8))) : '' }))
    }} />{t(label)}</label></div>{enabled[key] && <>
      <div className="legacy-order-grid"><label>{t(label)}<input aria-label={t(label)} type="number" min="0" required step={instrument?.tick_size || 'any'} value={draft[key]} disabled={disabled} onChange={event => change(key,event.target.value)} /></label>{pip > 0 && entry > 0 && <label>{t(key === 'stopLoss' ? 'Stop loss in pips' : 'Take profit in pips')}<input type="number" step="any" value={protectionPips(draft[key], entry, draft.side, key, instrument)} disabled={disabled} onChange={event => change(key, protectionPrice(event.target.value, entry, draft.side, key, instrument))} /></label>}</div>
      <div className="legacy-protection-estimate"><span>{t(key === 'stopLoss' ? 'Ước tính tại SL (trước phí)' : 'Ước tính tại TP (trước phí)')}</span><strong>{fmt(protectionAmount(draft[key], entry, draft.side, draft.quantity, instrument, order.costs), ` ${order.costs?.account_ccy || ''}`)}</strong></div>
      {!active && key === 'stopLoss' && <ProtectionRiskSizing order={order} entry={entry} />}
    </>}</section>)}
    {!active && <div className="legacy-protection-row is-unavailable" title={t('Chưa hỗ trợ tự dời SL về hòa vốn')}><label><input type="checkbox" role="switch" disabled />Auto Break-even</label><small>{t('Sắp có')}</small></div>}
    {!active && <><label>{t('Chiến lược')}<FxSelect className="is-field" label="Chiến lược" value="session" disabled options={[{ value: 'session', label: t('Mặc định của phiên') }]} /></label><button type="button" className="legacy-strategy-create" disabled>{t('+ Tạo chiến lược mới')}</button></>}
    {blockedReason && <p role="status">{t(blockedReason)}</p>}
    {order.notice && <p role={order.notice.kind === 'error' ? 'alert' : 'status'}>{order.notice.title ? <><strong>{t(order.notice.title)}</strong> {t(order.notice.message, order.notice.values)}</> : t(order.notice.text)}</p>}
    <footer>{!active && <label><input type="checkbox" checked={journal} onChange={event => setJournal(event.target.checked)} />{t('Mở nhật ký sau khi đặt lệnh')}</label>}<button type="button" onClick={onClose}>{t('Hủy')}</button><button type="submit" className="legacy-order-save" disabled={disabled || !changed}>{t(order.pending ? 'Đang lưu…' : active ? 'Confirm' : !changed ? 'Không có thay đổi' : 'Save')}</button></footer>
  </form></>
}

export default function ChartOrderPanel({ order, blockedReason, legacy = false, onClose, onJournal }) {
  const { t, fmt } = useTestingLocale()
  const money = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { execution, draft, setDraft, active, instrument, costs, disabled, notice } = order
  if (legacy) return <LegacyOrderForm order={order} blockedReason={blockedReason} onClose={onClose} onJournal={onJournal} />
  return <section className="chart-order-panel" aria-label={t("Lệnh mô phỏng")}>
    <div className="chart-order-mode"><strong>{t("SIMULATOR")}</strong><span>{t("Broker locked")}</span></div>
    {blockedReason && <p role="status">{t(blockedReason)}</p>}
    {!execution ? <form onSubmit={event => { event.preventDefault(); order.initialize() }}>
      <h2>{t("Khởi tạo tài khoản")}</h2><p>{t("Chi phí mô phỏng, không phải báo giá broker.")}</p>
      <label>{t("Vốn ban đầu (")}{costs?.account_ccy || t("Chưa rõ tiền tệ")})<input type="number" min="1" step="0.01" value={order.startingBalance} onChange={event => order.setStartingBalance(event.target.value)} disabled={disabled || Boolean(order.assetStates) || Boolean(order.executionConfig?.forceBar)} /></label>
      {!order.executionConfig?.forceBar && <label className="replay-tick-toggle"><input type="checkbox" checked={order.tick.useTicks} disabled={disabled || !order.tick.options?.available} onChange={event => order.tick.setMode(event.target.checked ? 'tick' : 'bar')} />{t("Khớp lệnh bằng tick Bid/Ask")}</label>}
      {!order.executionConfig?.forceBar && <p role="status">{t(order.tick.options?.reason || 'Đang kiểm tra lịch sử tick…')}</p>}
      {order.tick.useTicks && !order.executionConfig?.forceBar ? <label>{t("Đòn bẩy mô phỏng")}<input type="number" min="1" max="1000" step="1" value={order.tick.leverage} onChange={event => order.tick.setLeverage(event.target.value)} disabled={disabled} /></label> : <label>{t("Spread (đơn vị giá)")}<input type="number" min="0" step={instrument?.tick_size || 'any'} value={order.spread} onChange={event => order.setSpread(event.target.value)} disabled={disabled || Boolean(order.executionConfig?.forceBar)} /></label>}
      <button type="submit" disabled={disabled || !order.canInitialize || (order.tick.options === null && !order.executionConfig?.forceBar)}>{t("Khởi tạo simulator")}</button>
      {!order.canInitialize && <p>{t("Đang thiếu instrument hoặc timeframe trong dataset.")}</p>}
    </form> : <>
      <dl className="chart-account"><div><dt>{t("Balance")}</dt><dd>{money(execution.balance, costs?.account_ccy)}</dd></div><div><dt>{t("Equity")}</dt><dd>{money(execution.equity, costs?.account_ccy)}</dd></div><div><dt>{t("Floating P/L")}</dt><dd>{money(execution.floating_pl, costs?.account_ccy)}</dd></div></dl>
      <form onSubmit={event => { event.preventDefault(); order.save() }}>
        <h2>{execution.position ? t("Vị thế đang mở") : active ? t("Lệnh chờ nến kế tiếp") : t("Lệnh mới")}</h2>
        <div className="chart-order-sides">{['BUY', 'SELL'].map(side => <button key={side} type="button" aria-pressed={draft.side === side} className={side.toLowerCase()} disabled={disabled || Boolean(active)} onClick={() => order.chooseSide(side)}>{side}</button>)}</div>
        <label>{t("Khối lượng (")}{instrument?.asset_class === 'fx' ? t("lot") : t("quantity")})<input aria-label={t("Khối lượng lệnh")} type="number" min={instrument?.quantity_min || '0'} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled || Boolean(active)} onChange={event => setDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
        <label>{t("Stop loss")}<input aria-label={t("Stop loss")} type="number" min="0" step={instrument?.tick_size || 'any'} value={draft.stopLoss} disabled={disabled} onChange={event => setDraft(current => ({ ...current, stopLoss: event.target.value }))} /></label>
        <label>{t("Take profit")}<input aria-label={t("Take profit")} type="number" min="0" step={instrument?.tick_size || 'any'} value={draft.takeProfit} disabled={disabled} onChange={event => setDraft(current => ({ ...current, takeProfit: event.target.value }))} /></label>
        {!active && <RiskPreview draft={draft} entry={order.reference} instrument={instrument} costModel={costs} />}
        <button type="submit" disabled={disabled}>{order.pending ? t("Đang lưu…") : active ? t("Lưu TP/SL") : t("Đặt lệnh mô phỏng")}</button>
        <p>{active ? t("Kéo TP/SL trên chart hoặc nhập giá rồi lưu. Thay đổi áp dụng từ nến kế tiếp.") : t("Khớp tại giá hiện tại, có spread và phí theo cấu hình mô phỏng.")}</p>
      </form>
    </>}
    {notice && <p className={`chart-order-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.title ? <><strong>{t(notice.title)}</strong> {t(notice.message, notice.values)}</> : t(notice.text)}</p>}
  </section>
}
