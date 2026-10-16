import { useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { DEFAULT_COST_MODEL, RiskPreview, validateDraft } from './TradeWorkspace.jsx'
import { finiteNumber, marketQuotes, orderDraft, protectionReference, replayAtCutoff } from './replayOrderModel.js'
import { useReplayTickOptions } from './useReplayTickOptions.js'
import FxSelect from './FxSelect.jsx'
import { scalperProtection } from './legacyScalperPreset.js'

export function useChartOrder({ workspace, replay, dataset, ready, blocked, closeBlocked = blocked, submit, executionConfig = null }) {
  const execution = replayAtCutoff(replay)?.payload?.execution
  const account = replay?.portfolio_account || execution
  const assetStates = replay?.payload?.asset_states
  const instrument = execution?.instrument_spec || dataset?.instrument_spec || dataset?.replay_instrument_spec
  const [draft, setDraft] = useState(() => orderDraft(replay, instrument))
  const [notice, setNotice] = useState(null)
  const [startingBalance, setStartingBalance] = useState('10000')
  useEffect(() => { setStartingBalance(String(replay?.payload?.starting_balance ?? '10000')) }, [replay?.record_id])
  const [spread, setSpread] = useState('0.0002')
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const context = `${workspace}:${replay?.record_id}:${replay?.payload?.dataset_id}:${replay?.view_cursor_index ?? replay?.payload?.cursor_index}`
  const currentContext = useRef(context)
  currentContext.current = context
  const tick = useReplayTickOptions(workspace, replay)
  useEffect(() => { setDraft(orderDraft(replay, instrument)); setNotice(null) }, [replay?.record_id, replay?.revision, instrument])
  const active = execution?.position || execution?.pending_market_order
  const costs = execution?.cost_model || (dataset ? { ...DEFAULT_COST_MODEL, ...(executionConfig?.costModel || {}), account_ccy: executionConfig?.costModel?.account_ccy || instrument?.account_ccy || DEFAULT_COST_MODEL.account_ccy } : null)
  const quotes = marketQuotes(replay)
  const reference = active ? protectionReference(replay) : execution ? (draft.side === 'BUY' ? quotes.ask : quotes.bid) : protectionReference(replay)
  const disabled = !ready || blocked || pending
  const canInitialize = Boolean(instrument && dataset?.timeframe_seconds && costs)
  const run = async (endpoint, body) => {
    if ((endpoint === 'orders/close' ? !ready || closeBlocked || pending : disabled) || busy.current) return
    busy.current = true
    setPending(true)
    setNotice(null)
    try {
      const success = await submit(endpoint, body)
      if (success) setNotice({ kind: 'ok', text: endpoint === 'execution' ? 'Simulator sẵn sàng.' : endpoint.endsWith('close') ? 'Đã đóng/hủy lệnh mô phỏng.' : endpoint.endsWith('protection') ? 'TP/SL đã lưu; áp dụng từ nến tiếp theo.' : execution?.quote_source === 'broker_bid_ask' ? 'Đã queue; fill ở tick đầu tiên của nến kế tiếp.' : 'Đã queue; fill ở giá mở nến kế tiếp.' })
      return success
    } catch (error) { setNotice({ kind: 'error', text: error.message }) }
    finally { busy.current = false; setPending(false) }
  }
  const save = async (nextDraft = draft) => {
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
      const nextReference = nextActive ? protectionReference(nextReplay) : nextDraft.side === 'BUY' ? nextQuotes.ask : nextQuotes.bid
      if (nextReference === null || nextReference === undefined) throw new Error('Chưa có giá tham chiếu tại cutoff này.')
      const validation = validateDraft(nextDraft, nextReference, { optionalProtection: true })
      if (validation) { setNotice({ kind: 'error', text: validation }); return false }
      const operation_id = `chart-${crypto.randomUUID()}`
      const result = await submit(nextActive ? 'orders/protection' : 'orders/market', nextActive
        ? { operation_id, target_id: nextExecution.position?.position_id || nextExecution.pending_market_order.operation_id, stop_loss: nextDraft.stopLoss || null, take_profit: nextDraft.takeProfit || null }
        : { operation_id, side: nextDraft.side, quantity: nextDraft.quantity, stop_loss: nextDraft.stopLoss || null, take_profit: nextDraft.takeProfit || null }, nextReplay.revision)
      if (result) setNotice({ kind: 'ok', text: nextActive ? 'TP/SL đã lưu; áp dụng từ nến tiếp theo.' : nextExecution.quote_source === 'broker_bid_ask' ? 'Đã queue; fill ở tick đầu tiên của nến kế tiếp.' : 'Đã queue; fill ở giá mở nến kế tiếp.' })
      return Boolean(result)
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const changePrice = (kind, price) => {
    if (disabled || (price !== null && !(price > 0))) return
    const next = { ...draft, [kind === 'stop' ? 'stopLoss' : 'takeProfit']: price === null ? '' : String(price) }
    if (active) save(next)
    else setDraft(next)
  }
  const chooseSide = side => {
    if (!active && !disabled) { setDraft(current => ({ ...orderDraft(replay, instrument, side), quantity: current.quantity })); setNotice(null) }
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
      const quoteSeed = initialization ? marketQuotes({ ...nextReplay, payload: { ...nextReplay.payload, execution: { spread_price: initialization.spread_price, instrument_spec: initialization.instrument_spec } } }) : marketQuotes(nextReplay)
      const seedPrice = side === 'BUY' ? quoteSeed.ask : quoteSeed.bid
      const seededProtection = seedPrice === null ? null : scalperProtection(preset, seedPrice, side, initialization?.instrument_spec || execution?.instrument_spec)
      if (endpoint === 'orders/quick' && preset.enabled && (initialization?.tick_snapshot_id || !seededProtection)) {
        endpoint = 'execution'
      }
      if (endpoint === 'orders/quick') {
        nextReplay = await submit(endpoint, { ...initialization, operation_id: `quick-${crypto.randomUUID()}`, side, quantity, stop_loss: seededProtection?.stopLoss || null, take_profit: seededProtection?.takeProfit || null })
      } else if (!execution) {
        nextReplay = await submit('execution', initialization)
      }
      if (!nextReplay) return false
      if (currentContext.current !== origin) throw new Error('Phiên hoặc cutoff đã thay đổi; lệnh nhanh chưa được gửi.')
      const nextExecution = nextReplay.payload.execution
      if (endpoint === 'orders/quick') {
        const queued = nextExecution?.pending_market_order
        if (!queued) throw new Error('Không queue được lệnh nhanh.')
        setNotice({ kind: 'ok', text: nextExecution.quote_source === 'broker_bid_ask' ? 'Đã queue; fill ở tick đầu tiên của nến kế tiếp.' : 'Đã queue; fill ở giá mở nến kế tiếp.', order: { status: 'queued', side, symbol: nextExecution.instrument_spec?.instrument_id || instrument?.instrument_id || '—', quantity: String(quantity), price: String(side === 'BUY' ? quoteSeed.ask : quoteSeed.bid) } })
        return true
      }
      if (nextExecution.position || nextExecution.pending_market_order) throw new Error('Tài sản đã có lệnh đang hoạt động.')
      const quote = marketQuotes(nextReplay)
      const protection = scalperProtection(preset, side === 'BUY' ? quote.ask : quote.bid, side, nextExecution.instrument_spec)
      const nextDraft = { side, quantity, ...protection }
      const invalid = validateDraft(nextDraft, side === 'BUY' ? quote.ask : quote.bid, { optionalProtection: true })
      if (invalid) throw new Error(invalid)
      const result = endpoint === 'orders/quick'
        ? nextReplay
        : await submit('orders/market', {
            operation_id: `quick-${crypto.randomUUID()}`, side, quantity,
            stop_loss: protection.stopLoss || null, take_profit: protection.takeProfit || null,
          }, nextReplay.revision)
      if (result) setNotice({ kind: 'ok', text: nextExecution.quote_source === 'broker_bid_ask' ? 'Đã queue; fill ở tick đầu tiên của nến kế tiếp.' : 'Đã queue; fill ở giá mở nến kế tiếp.', order: { status: 'queued', side, symbol: nextExecution.instrument_spec?.instrument_id || instrument?.instrument_id || '—', quantity: String(quantity), price: String(side === 'BUY' ? quote.ask : quote.bid) } })
      return Boolean(result)
    } catch (error) { setNotice({ kind: 'error', text: error.message }); return false }
    finally { busy.current = false; setPending(false) }
  }
  const close = () => active && run('orders/close', {
    operation_id: `close-${crypto.randomUUID()}`,
    target_id: execution.position?.position_id || execution.pending_market_order.operation_id,
  })
  return { draft, setDraft, execution, account, assetStates, instrument, costs, active, reference, disabled, pending, notice, quickTrade, close, canClose: ready && !closeBlocked && !pending, startingBalance, configuredBalance: replay?.payload?.starting_balance, configuredCurrency: replay?.payload?.starting_balance_ccy, setStartingBalance, spread, setSpread, tick, canInitialize, initialize, save, changePrice, chooseSide, executionConfig }
}

function LegacyOrderForm({ order, blockedReason, onClose, onJournal }) {
  const { t } = useTestingLocale()
  const [journal, setJournal] = useState(false)
  const { draft, setDraft, execution, disabled, instrument, active } = order
  const change = (key, value) => setDraft(current => ({ ...current, [key]:value }))
  return <><form className="legacy-order-form" onSubmit={async event => { event.preventDefault(); if (await order.save()) { onClose(); if (journal) onJournal() } }}>
    <div className="legacy-order-grid"><label>{t('Hướng')}<FxSelect className="is-field" label="Hướng" value={draft.side} disabled={disabled || Boolean(active)} onChange={order.chooseSide} options={[{ value: 'BUY', label: t('Buy') }, { value: 'SELL', label: t('Sell') }]} /></label><label>{t('Loại lệnh')}<FxSelect className="is-field" label="Loại lệnh" value="market" disabled options={[{ value: 'market', label: 'Market' }]} /></label>
    <label>{t(instrument?.asset_class==='fx' ? 'Khối lượng (lot)' : 'Khối lượng (quantity)')}<input aria-label={t('Khối lượng lệnh')} type="number" min={instrument?.quantity_min || '0'} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled || Boolean(active)} onChange={event => change('quantity',event.target.value)} /></label><label>{t('Giá vào lệnh')}<input type="text" readOnly value={order.reference ?? '—'} /></label></div>
    {[['stopLoss','Stop loss'],['takeProfit','Take profit']].map(([key,label]) => <div className="legacy-protection-row" key={key}><label><input type="checkbox" role="switch" checked={draft[key] !== ''} disabled={disabled || !execution} onChange={event => {
      if (!event.target.checked) { change(key, ''); return }
      const unit = Number(instrument?.pip_size) || Number(instrument?.tick_size)
      const direction = (key === 'stopLoss' ? -1 : 1) * (draft.side === 'BUY' ? 1 : -1)
      const price = order.reference + direction * unit * (key === 'stopLoss' ? 20 : 40)
      change(key, Number.isFinite(price) && price > 0 ? String(Number(price.toFixed(8))) : '')
    }} />{t(label)}</label>{draft[key] !== '' && <input aria-label={t(label)} type="number" min="0" required step={instrument?.tick_size || 'any'} value={draft[key]} disabled={disabled} onChange={event => change(key,event.target.value)} />}</div>)}
    <div className="legacy-protection-row is-unavailable" title={t('Chưa hỗ trợ tự dời SL về hòa vốn')}><label><input type="checkbox" role="switch" disabled />Auto Break-even</label><small>{t('Sắp có')}</small></div>
    <label>{t('Chiến lược')}<FxSelect className="is-field" label="Chiến lược" value="session" disabled options={[{ value: 'session', label: t('Mặc định của phiên') }]} /></label><button type="button" className="legacy-strategy-create" disabled>{t('+ Tạo chiến lược mới')}</button>
    {blockedReason && <p role="status">{t(blockedReason)}</p>}
    {execution && <p className="legacy-order-hint">{t(active ? 'Thay đổi TP/SL áp dụng từ nến tiếp theo.' : 'Market được queue và khớp ở nến tiếp theo; giá trên là giá tham chiếu.')} · SIM</p>}
    {order.notice && <p role={order.notice.kind === 'error' ? 'alert' : 'status'}>{t(order.notice.text)}</p>}
    <footer><label><input type="checkbox" checked={journal} onChange={event => setJournal(event.target.checked)} />{t('Mở nhật ký sau khi đặt lệnh')}</label><button type="button" onClick={onClose}>{t('Hủy')}</button><button type="submit" className="legacy-order-save" disabled={disabled}>{t(order.pending ? 'Đang lưu…' : 'Save')}</button></footer>
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
      <label>{t("Vốn ban đầu (")}{costs?.account_ccy || t("Chưa rõ tiền tệ")})<input type="number" min="1" step="0.01" value={order.startingBalance} onChange={event => order.setStartingBalance(event.target.value)} disabled={disabled || Boolean(order.assetStates)} /></label>
      <label className="replay-tick-toggle"><input type="checkbox" checked={order.tick.useTicks} disabled={disabled || !order.tick.options?.available} onChange={event => order.tick.setMode(event.target.checked ? 'tick' : 'bar')} />{t("Khớp lệnh bằng tick Bid/Ask")}</label>
      <p role="status">{t(order.tick.options?.reason || 'Đang kiểm tra lịch sử tick…')}</p>
      {order.tick.useTicks ? <label>{t("Đòn bẩy mô phỏng")}<input type="number" min="1" max="1000" step="1" value={order.tick.leverage} onChange={event => order.tick.setLeverage(event.target.value)} disabled={disabled} /></label> : <label>{t("Spread (đơn vị giá)")}<input type="number" min="0" step={instrument?.tick_size || 'any'} value={order.spread} onChange={event => order.setSpread(event.target.value)} disabled={disabled} /></label>}
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
        <button type="submit" disabled={disabled}>{order.pending ? t("Đang lưu…") : active ? t("Lưu TP/SL") : t("Queue lệnh mô phỏng")}</button>
        <p>{active ? t("Kéo TP/SL trên chart hoặc nhập giá rồi lưu. Thay đổi áp dụng từ nến kế tiếp.") : execution.quote_source === 'broker_bid_ask' ? t("Entry là Bid/Ask tại cutoff. Market fill ở tick đầu tiên của nến kế tiếp; phí theo model.") : t("Entry là giá tham chiếu. Market fill ở giá mở nến kế tiếp, có spread và phí.")}</p>
      </form>
    </>}
    {notice && <p className={`chart-order-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{t(notice.text)}</p>}
  </section>
}
