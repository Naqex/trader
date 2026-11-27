import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppIcon from './AppIcon.jsx'
import FxSelect from './FxSelect.jsx'
import LegacyModal from './LegacyModal.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { formatAmount } from './moneyFormat.js'
import { displayDate } from './dateFormat.js'
import { createBundledFleetLedger, createBundledParetoPreview } from './propFleetFixture.js'
import {
  ALLOWED_TRANSITIONS,
  ALL_STATES,
  CANONICAL_STATES,
  FLAT_REQUIRED_EDGES,
  FTMO_SCALING_PLAN,
  FUNDED_ENTRY_EDGES,
  PRESET_MODE_EVAL_P1_SPRINT,
  PRESET_MODE_EVAL_P2_SPRINT,
  PRESET_MODE_FUNDED_1X,
  PRESET_MODE_NONE,
  STATE_SHORT_META,
  STATE_TONES,
  applyDraftTransition,
  buildExportLedger,
  clearWorkspaceDraft,
  deriveFleetKpis,
  evaluateFleetGuards,
  loadWorkspaceDraft,
  saveWorkspaceDraft,
  sha256Hex,
  validateFleetLedger,
  validateParetoImport,
} from './propFleetModel.js'
import './data-table.css'
import './prop-fleet.css'

const GUARD_LABELS = {
  E1: 'Làm nguội rớt Eval (30d)',
  E2: 'Đóng băng DD Funded',
  E3: 'Hậu kiểm vi phạm Funded',
  E4: 'Trần 400K & sức chứa VPS',
  E5: 'Chống hedge chéo & Magic/Dir',
  E6: 'Không lệnh (21/27/30d) & SHA',
}

const GUARD_STATUS_LABELS = {
  PASS: 'Đạt',
  WARNING: 'Cảnh báo',
  URGENT: 'Khẩn cấp',
  BLOCK: 'Khóa',
}

function fmtUsd(value, locale, digits = 2) {
  if (value == null || typeof value === 'boolean' || !Number.isFinite(Number(value))) return '—'
  return formatAmount(Number(value), '$', digits, locale)
}

function fmtVnd(value, locale) {
  if (value == null || typeof value === 'boolean' || !Number.isFinite(Number(value))) return '—'
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(Number(value)))} VND`
}

function fmtPct(value, digits = 1) {
  if (value == null || typeof value === 'boolean' || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}

function StatePill({ state, language }) {
  const tone = STATE_TONES[state] || 'neutral'
  const meta = STATE_SHORT_META[state] || { code: state, vi: state, en: state }
  const label = language === 'en' ? meta.en : meta.vi
  return (
    <span className={`pf-pill is-${tone}`} data-state-code={meta.code}>
      <span className="pf-dot" aria-hidden="true" />
      <span>{meta.code} · {label}</span>
    </span>
  )
}

function MiniStepper({ state }) {
  const activeIdx = CANONICAL_STATES.indexOf(state)
  const isIncident = activeIdx < 0 && state !== 'CLOSED_ARCHIVED'
  return (
    <div className="pf-mini-stepper" aria-label={state}>
      {CANONICAL_STATES.map((s, idx) => {
        let cls = 'pf-mini-step'
        if (isIncident && idx === 5) cls += ' is-incident'
        else if (activeIdx === idx) cls += s === 'S4_PASS_P2_TO_FUNDED_LOCK' ? ' is-lock' : ' is-current'
        else if (activeIdx > idx) cls += ' is-done'
        return <span key={s} className={cls}>S{idx}</span>
      })}
    </div>
  )
}

function defaultPresetForTarget(targetState, account) {
  if (targetState === 'S1_CHALLENGE_P1') {
    return {
      presetMode: PRESET_MODE_EVAL_P1_SPRINT,
      presetName: `${account.firm_profile}_P1_Sprint_4_5x.set`,
      presetSha: account.preset_sha256 || '',
    }
  }
  if (targetState === 'S3_CHALLENGE_P2') {
    return {
      presetMode: PRESET_MODE_EVAL_P2_SPRINT,
      presetName: `${account.firm_profile}_P2_Sprint_3_5x.set`,
      presetSha: account.preset_sha256 || '',
    }
  }
  if (targetState === 'S5_FUNDED_ACTIVE') {
    return {
      presetMode: PRESET_MODE_FUNDED_1X,
      presetName: `${account.firm_profile}_Funded_Safe_1x.set`,
      presetSha: account.preset_sha256 || '',
    }
  }
  return {
    presetMode: account.preset_mode || PRESET_MODE_NONE,
    presetName: account.preset_name || '',
    presetSha: account.preset_sha256 || '',
  }
}

export default function PropFleetWorkspace({ workspace = 'tenant-a' }) {
  const { t, language, locale } = useTestingLocale()
  const { appearance } = useFxReplayContext()
  const theme = appearance?.theme || 'dark'

  const [ledgerState, setLedgerState] = useState(() => {
    const draft = loadWorkspaceDraft(workspace)
    if (draft.status === 'ok' && draft.ledger) {
      return { ledger: draft.ledger, source: draft.source || 'local_draft', storageWarning: false, lastImported: null }
    }
    return {
      ledger: createBundledFleetLedger(),
      source: 'bundled_fixture',
      storageWarning: draft.status === 'storage_error',
      lastImported: null,
    }
  })

  // Reload workspace draft cleanly if workspace changes
  useEffect(() => {
    const draft = loadWorkspaceDraft(workspace)
    if (draft.status === 'ok' && draft.ledger) {
      setLedgerState({ ledger: draft.ledger, source: draft.source || 'local_draft', storageWarning: false, lastImported: null })
    } else {
      setLedgerState({
        ledger: createBundledFleetLedger(),
        source: 'bundled_fixture',
        storageWarning: draft.status === 'storage_error',
        lastImported: null,
      })
    }
  }, [workspace])

  const [paretoData, setParetoData] = useState(() => createBundledParetoPreview())
  const [selectedTierMVnd, setSelectedTierMVnd] = useState(40)
  const [stateFilter, setStateFilter] = useState('ALL')
  const [firmFilter, setFirmFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState(() => ledgerState.ledger.accounts[0]?.account_id || '')
  const [pageBanner, setPageBanner] = useState(null)

  // Transition modal state
  const [modalAccountId, setModalAccountId] = useState(null)
  const [modalTargetState, setModalTargetState] = useState('')
  const [modalOpenPos, setModalOpenPos] = useState('0')
  const [modalFlatConfirm, setModalFlatConfirm] = useState(false)
  const [modalOps2Pass, setModalOps2Pass] = useState(false)
  const [modalPresetMode, setModalPresetMode] = useState(PRESET_MODE_NONE)
  const [modalPresetName, setModalPresetName] = useState('')
  const [modalPresetSha, setModalPresetSha] = useState('')
  const [modalOps5Sha, setModalOps5Sha] = useState('')
  const [modalPayoutGross, setModalPayoutGross] = useState('500')
  const [modalEquity, setModalEquity] = useState('')
  const [modalTradingDays, setModalTradingDays] = useState('4')
  const [modalError, setModalError] = useState(null)

  const importInputRef = useRef(null)
  const paretoImportInputRef = useRef(null)

  const { ledger, source, storageWarning, lastImported } = ledgerState

  useEffect(() => {
    if (!ledger.accounts.some(a => a.account_id === selectedAccountId)) {
      setSelectedAccountId(ledger.accounts[0]?.account_id || '')
    }
  }, [ledger.accounts, selectedAccountId])

  const guardEval = useMemo(() => evaluateFleetGuards(ledger), [ledger])
  const kpis = useMemo(() => deriveFleetKpis(ledger, guardEval), [ledger, guardEval])

  const firmOptions = useMemo(() => {
    const firms = [...new Set(ledger.accounts.map(a => String(a.firm_id || '').toUpperCase()).filter(Boolean))].sort()
    return [
      { value: 'ALL', label: t('Tất cả hãng'), localize: false },
      ...firms.map(f => ({ value: f, label: f, localize: false })),
    ]
  }, [ledger.accounts, t])

  const stateOptions = useMemo(() => [
    { value: 'ALL', label: t('Tất cả pha'), localize: false },
    ...ALL_STATES.map(s => {
      const m = STATE_SHORT_META[s]
      return { value: s, label: `${m.code} · ${language === 'en' ? m.en : m.vi}`, localize: false }
    }),
  ], [language, t])

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return ledger.accounts.filter(acct => {
      if (stateFilter !== 'ALL' && acct.state !== stateFilter) return false
      if (firmFilter !== 'ALL' && String(acct.firm_id || '').toUpperCase() !== firmFilter) return false
      if (q) {
        const hay = `${acct.account_id} ${acct.contract_id} ${acct.firm_profile} ${acct.display_name} ${acct.preset_name}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [ledger.accounts, stateFilter, firmFilter, searchQuery])

  const selectedAccount = useMemo(
    () => ledger.accounts.find(a => a.account_id === selectedAccountId) || ledger.accounts[0] || null,
    [ledger.accounts, selectedAccountId],
  )

  const selectedScaling = useMemo(
    () => guardEval.scalingAccounts.find(s => s.account_id === selectedAccount?.account_id) || null,
    [guardEval.scalingAccounts, selectedAccount],
  )

  const modalAccount = useMemo(
    () => (modalAccountId ? ledger.accounts.find(a => a.account_id === modalAccountId) || null : null),
    [ledger.accounts, modalAccountId],
  )

  const persistNextLedger = useCallback((nextLedger, nextSource, nextLastImported) => {
    const saved = saveWorkspaceDraft(workspace, nextLedger, nextSource)
    setLedgerState(prev => ({
      ledger: nextLedger,
      source: nextSource,
      storageWarning: !saved.ok,
      lastImported: nextLastImported !== undefined ? nextLastImported : prev.lastImported,
    }))
  }, [workspace])

  const openTransitionModal = useCallback((account) => {
    const allowed = ALLOWED_TRANSITIONS[account.state] || []
    if (!allowed.length) return
    const firstTarget = allowed[0]
    const defaults = defaultPresetForTarget(firstTarget, account)
    setSelectedAccountId(account.account_id)
    setModalAccountId(account.account_id)
    setModalTargetState(firstTarget)
    setModalOpenPos(String(account.open_positions ?? 0))
    setModalFlatConfirm(false)
    setModalOps2Pass(Boolean(account.ops2_preflight_pass))
    setModalPresetMode(defaults.presetMode)
    setModalPresetName(defaults.presetName)
    setModalPresetSha(defaults.presetSha)
    setModalOps5Sha(account.ops5_audit_bundle_sha256 || '')
    setModalPayoutGross(String(Math.max(100, Math.round((account.equity_usd || account.capital_usd) - account.capital_usd) || 500)))
    setModalEquity(String(account.equity_usd ?? account.capital_usd))
    setModalTradingDays(String(Math.max(account.trading_days_completed ?? 0, account.min_trading_days ?? 4)))
    setModalError(null)
  }, [])

  const handleTargetStateChange = useCallback((nextTarget) => {
    setModalTargetState(nextTarget)
    setModalError(null)
    if (modalAccount) {
      const defaults = defaultPresetForTarget(nextTarget, modalAccount)
      setModalPresetMode(defaults.presetMode)
      setModalPresetName(defaults.presetName)
      setModalPresetSha(defaults.presetSha)
    }
  }, [modalAccount])

  const handleSubmitTransition = useCallback((event) => {
    event.preventDefault()
    if (!modalAccount) return
    const edge = `${modalAccount.state}->${modalTargetState}`
    const parsedOpenPos = modalOpenPos.trim() === '' ? NaN : Number(modalOpenPos)
    if (FLAT_REQUIRED_EDGES.has(edge) && !modalFlatConfirm) {
      setModalError({
        code: 'FLAT_HANDOFF_CONFIRMATION_REQUIRED',
        message: t('Bắt buộc đánh dấu xác nhận phẳng lệnh (open_positions == 0) trước khi chuyển pha.'),
      })
      return
    }
    const payload = {
      account_id: modalAccount.account_id,
      to_state: modalTargetState,
      actor: 'browser-draft',
      open_positions: parsedOpenPos,
      ops2_preflight_pass: modalOps2Pass,
      preset_mode: modalPresetMode,
      preset_name: modalPresetName,
      preset_sha256: modalPresetSha,
      ops5_audit_bundle_sha256: modalOps5Sha,
      equity_usd: modalEquity.trim() === '' ? undefined : Number(modalEquity),
      trading_days_completed: modalTradingDays.trim() === '' ? undefined : Number(modalTradingDays),
      payout_gross_usd: modalTargetState === 'S7_AFTER_PAYOUT_ALLOCATOR' ? Number(modalPayoutGross) : undefined,
      order_send_capable: false,
    }
    const result = applyDraftTransition(ledger, payload)
    if (!result.ok) {
      setModalError({ code: result.code, message: result.message })
      return
    }
    persistNextLedger(result.ledger, 'local_draft')
    setModalAccountId(null)
    setModalError(null)
    setPageBanner({
      tone: 'success',
      code: result.event.event_id,
      message: t('Đã ghi nhận bản nháp chuyển pha {from} → {to} cho {account}.', {
        from: STATE_SHORT_META[result.event.from_state]?.code || result.event.from_state,
        to: STATE_SHORT_META[result.event.to_state]?.code || result.event.to_state,
        account: result.event.account_id,
      }),
    })
  }, [
    ledger, modalAccount, modalEquity, modalFlatConfirm, modalOpenPos, modalOps2Pass,
    modalOps5Sha, modalPayoutGross, modalPresetMode, modalPresetName, modalPresetSha,
    modalTargetState, modalTradingDays, persistNextLedger, t,
  ])

  const handleImportLedgerFile = useCallback((event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''))
        const checked = validateFleetLedger(parsed)
        if (!checked.ok) {
          setPageBanner({ tone: 'danger', code: checked.code, message: checked.message })
          return
        }
        persistNextLedger(checked.ledger, 'imported_json', structuredClone(checked.ledger))
        setPageBanner({
          tone: 'success',
          code: 'IMPORT_VERIFIED',
          message: t('Đã nạp sổ cái {id} ({accounts} tài khoản, {transitions} sự kiện).', {
            id: checked.ledger.ledger_id || 'fleet_ledger.json',
            accounts: checked.ledger.accounts.length,
            transitions: checked.ledger.transitions.length,
          }),
        })
      } catch {
        setPageBanner({
          tone: 'danger',
          code: 'INVALID_JSON_SYNTAX',
          message: t('Tệp JSON không hợp lệ. Dữ liệu hiện tại được giữ nguyên.'),
        })
      }
    }
    reader.readAsText(file, 'utf-8')
  }, [persistNextLedger, t])

  const handleExportLedger = useCallback(() => {
    try {
      const exported = buildExportLedger(ledger)
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'fleet_ledger.json'
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setPageBanner({
        tone: 'success',
        code: 'EXPORT_READY',
        message: t('Đã xuất fleet_ledger.json (chỉ đọc, order_send_capable = false).'),
      })
    } catch (error) {
      setPageBanner({ tone: 'danger', code: 'EXPORT_FAILED', message: String(error?.message || error) })
    }
  }, [ledger, t])

  const handleResetFixture = useCallback(() => {
    clearWorkspaceDraft(workspace)
    setLedgerState({
      ledger: createBundledFleetLedger(),
      source: 'bundled_fixture',
      storageWarning: false,
      lastImported: null,
    })
    setPageBanner({
      tone: 'success',
      code: 'FIXTURE_RESTORED',
      message: t('Đã khôi phục bộ dữ liệu mẫu ban đầu và xóa bản nháp cục bộ.'),
    })
  }, [workspace, t])

  const handleDiscardDraftToImport = useCallback(() => {
    if (!lastImported) return
    persistNextLedger(structuredClone(lastImported), 'imported_json', lastImported)
    setPageBanner({
      tone: 'success',
      code: 'DRAFT_DISCARDED',
      message: t('Đã hoàn tác bản nháp về bản JSON vừa nhập.'),
    })
  }, [lastImported, persistNextLedger, t])

  const handleImportParetoFile = useCallback((event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''))
        const checked = validateParetoImport(parsed)
        if (!checked.ok) {
          setPageBanner({ tone: 'danger', code: checked.code, message: checked.message })
          return
        }
        setParetoData(checked.pareto)
        if (checked.pareto.tiers.length) setSelectedTierMVnd(checked.pareto.tiers[0].bankroll_m_vnd)
        setPageBanner({
          tone: 'success',
          code: 'PARETO_IMPORTED',
          message: t('Đã nạp bảng Pareto ({count} bậc vốn VND).', { count: checked.pareto.tiers.length }),
        })
      } catch {
        setPageBanner({
          tone: 'danger',
          code: 'INVALID_PARETO_JSON',
          message: t('Tệp Pareto JSON không hợp lệ. Giữ nguyên bảng xem trước.'),
        })
      }
    }
    reader.readAsText(file, 'utf-8')
  }, [t])

  const activeTier = useMemo(
    () => paretoData.tiers.find(r => r.bankroll_m_vnd === selectedTierMVnd) || paretoData.tiers[0] || null,
    [paretoData.tiers, selectedTierMVnd],
  )

  const sourceLabel = source === 'bundled_fixture'
    ? t('Bộ mẫu tích hợp')
    : source === 'imported_json'
      ? t('JSON đã nhập')
      : t('Bản nháp cục bộ')

  const riskTone = kpis.fleetRiskState === 'RED' ? 'danger' : kpis.fleetRiskState === 'AMBER' ? 'warning' : 'success'
  const capFillClass = kpis.ftmoCapPct != null && kpis.ftmoCapPct >= 100 ? 'is-danger' : kpis.ftmoCapPct != null && kpis.ftmoCapPct >= 80 ? 'is-warning' : ''
  const modalEdge = modalAccount ? `${modalAccount.state}->${modalTargetState}` : ''
  const modalIsFundedEntry = FUNDED_ENTRY_EDGES.has(modalEdge)
  const modalFlatRequired = FLAT_REQUIRED_EDGES.has(modalEdge)
  const modalAllowedTargets = modalAccount ? ALLOWED_TRANSITIONS[modalAccount.state] || [] : []

  const reversedTransitions = useMemo(() => [...ledger.transitions].reverse(), [ledger.transitions])

  return (
    <main className="wm-page pf-page" aria-labelledby="pf-page-title" data-testid="prop-fleet-workspace">
      <header className="wm-page-header pf-header">
        <div className="pf-header-copy">
          <h1 id="pf-page-title">{t('Bảng điều phối vòng đời Prop Fleet')}</h1>
          <p>{t('Theo dõi tập trung vòng đời tài khoản Prop (S0–S7), 6 khóa an toàn E1–E6, quỹ phân bổ 3 giỏ và bậc vốn Pareto hoàn toàn ngoại tuyến.')}</p>
        </div>
        <div className="pf-header-actions">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="pf-file-input"
            data-testid="pf-import-input"
            aria-label={t('Nhập fleet_ledger.json')}
            onChange={handleImportLedgerFile}
          />
          <button
            type="button"
            className="wm-button"
            data-testid="pf-import-btn"
            onClick={() => importInputRef.current?.click()}
          >
            <AppIcon name="upload" size={16} />
            {t('Nhập JSON')}
          </button>
          <button
            type="button"
            className="wm-button is-primary"
            data-testid="pf-export-btn"
            onClick={handleExportLedger}
          >
            <AppIcon name="download" size={16} />
            {t('Xuất fleet_ledger.json')}
          </button>
          {lastImported && source === 'local_draft' && (
            <button
              type="button"
              className="wm-button"
              data-testid="pf-discard-draft-btn"
              onClick={handleDiscardDraftToImport}
            >
              <AppIcon name="undo" size={16} />
              {t('Hoàn tác bản nháp')}
            </button>
          )}
          <button
            type="button"
            className="wm-button"
            data-testid="pf-reset-btn"
            onClick={handleResetFixture}
          >
            <AppIcon name="restore" size={16} />
            {t('Khôi phục mẫu')}
          </button>
        </div>
      </header>

      {/* Safety & Provenance Context Strip */}
      <div className="pf-safety-bar" data-testid="pf-safety-bar">
        <span className="pf-pill is-info" data-testid="pf-readonly-badge">
          <AppIcon name="lock" size={13} />
          <span>execution_capability: false · OrderSend = 0</span>
        </span>
        <span className="pf-pill is-neutral" data-testid="pf-holdout-badge">
          <AppIcon name="shield" size={13} />
          <span>Holdout 2025+ SEALED ({ledger.holdout_cutoff_date})</span>
        </span>
        <span className={`pf-pill ${source === 'local_draft' ? 'is-warning' : 'is-neutral'}`} data-testid="pf-source-badge">
          <span className="pf-dot" aria-hidden="true" />
          <span>{sourceLabel}</span>
        </span>
        <span className="pf-safety-meta">
          <span>{t('Sổ cái')}: <strong className="pf-mono">{ledger.ledger_id}</strong></span>
          <span>·</span>
          <span>{t('Cập nhật')}: {displayDate(ledger.updated_utc, { timeStyle: 'short', timeZone: 'UTC' })} UTC</span>
        </span>
      </div>

      {storageWarning && (
        <div className="pf-alert is-warning" role="status" data-testid="pf-storage-warning">
          <AppIcon name="warning" size={16} />
          <div className="pf-alert-body">
            {t('Trình duyệt không cho phép lưu localStorage; thay đổi bản nháp chỉ tồn tại trong phiên hiện tại.')}
          </div>
        </div>
      )}

      {pageBanner && (
        <div
          className={`pf-alert is-${pageBanner.tone}`}
          role={pageBanner.tone === 'danger' ? 'alert' : 'status'}
          data-testid="pf-page-alert"
        >
          <AppIcon name={pageBanner.tone === 'danger' ? 'error' : 'success'} size={16} />
          <div className="pf-alert-body">
            <span className="pf-alert-code">[{pageBanner.code}]</span>
            <span>{pageBanner.message}</span>
          </div>
          <button
            type="button"
            className="wm-button is-icon"
            aria-label={t('Đóng')}
            onClick={() => setPageBanner(null)}
          >
            <AppIcon name="close" size={14} />
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <section className="pf-kpi-strip" aria-label={t('Chỉ số tổng quan Prop Fleet')} data-testid="pf-kpi-strip">
        <div className="pf-kpi-cell" data-testid="pf-kpi-reserve">
          <span className="pf-kpi-label">
            <AppIcon name="wallet" size={14} />
            {t('Tiền rút thực nhận & 3 giỏ')}
          </span>
          <strong className="pf-kpi-value">{fmtUsd(kpis.settledPayoutsNetUsd, locale)}</strong>
          <span className="pf-kpi-sub">{fmtVnd(kpis.settledPayoutsNetVnd, locale)}</span>
          <div className="pf-kpi-buckets">
            <span>{t('Thu gốc')}: {fmtUsd(kpis.houseMoneyUsd, locale)}</span>
            <span>{t('Quỹ vé')}: {fmtUsd(kpis.upgradeChallengeUsd, locale)}</span>
            <span>Own-Book: {fmtUsd(kpis.ownBookUsd, locale)}</span>
          </div>
        </div>

        <div className="pf-kpi-cell" data-testid="pf-kpi-funded-cap">
          <span className="pf-kpi-label">
            <AppIcon name="target" size={14} />
            {t('Vốn Funded hoạt động / Trần 400K')}
          </span>
          <strong className="pf-kpi-value">{fmtUsd(kpis.activeFundedNominalUsd, locale, 0)}</strong>
          <div className="pf-progress-track" aria-hidden="true">
            <div
              className={`pf-progress-fill ${capFillClass}`}
              style={{ width: `${Math.min(100, Math.max(0, kpis.ftmoCapPct || 0))}%` }}
            />
          </div>
          <span className="pf-kpi-sub">
            {fmtPct(kpis.ftmoCapPct, 1)} / {fmtUsd(kpis.ftmoCapUsd, locale, 0)} · {kpis.activeFundedCount} Funded · {kpis.activeEvalCount} Eval
          </span>
        </div>

        <div className="pf-kpi-cell" data-testid="pf-kpi-risk">
          <span className="pf-kpi-label">
            <AppIcon name="shield" size={14} />
            {t('Trạng thái rủi ro đội hình')}
          </span>
          <div>
            <span className={`pf-pill is-${riskTone}`} data-testid="pf-fleet-risk-pill">
              <span className="pf-dot" aria-hidden="true" />
              <span>{kpis.fleetRiskState} · {kpis.fleetScaleFactor.toFixed(1)}x</span>
            </span>
          </div>
          <span className="pf-kpi-sub">
            {kpis.blockingCount === 0
              ? t('0/6 khóa chặn · Đủ điều kiện mở vé mới theo chính sách.')
              : t('{count}/6 khóa đang chặn mở vé mới.', { count: kpis.blockingCount })}
          </span>
        </div>

        <div className="pf-kpi-cell" data-testid="pf-kpi-lock">
          <span className="pf-kpi-label">
            <AppIcon name="lock" size={14} />
            {t('Khóa thực thi & kiểm toán')}
          </span>
          <strong className="pf-kpi-value">OrderSend = 0</strong>
          <span className="pf-kpi-sub">
            {t('{accounts} tài khoản · {transitions} sự kiện chuỗi băm SHA-256', {
              accounts: kpis.totalAccounts,
              transitions: kpis.transitionsCount,
            })}
          </span>
        </div>
      </section>

      {/* Active Guards Panel E1..E6 */}
      <section className="pf-section" aria-labelledby="pf-guards-title" data-testid="pf-guards-panel">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-guards-title">{t('6 Khóa an toàn đội hình (E1–E6)')}</h2>
            <p className="pf-section-sub">{t('Khớp nguyên tắc đóng an toàn với fleet_admission_and_edge_cases.py')}</p>
          </div>
        </div>
        <div className="pf-guards-grid">
          {guardEval.guards.map(guard => {
            const label = t(GUARD_LABELS[guard.code])
            const stLabel = t(GUARD_STATUS_LABELS[guard.status])
            const iconName = guard.tone === 'danger' ? 'error' : guard.tone === 'warning' ? 'warning' : 'success'
            return (
              <div key={guard.id} className="pf-guard-cell" data-testid={`pf-guard-${guard.code}`}>
                <div className="pf-guard-top">
                  <span className="pf-guard-code">
                    <AppIcon name={iconName} size={14} />
                    <span>{guard.code}</span>
                  </span>
                  <span className={`pf-pill is-${guard.tone}`}>
                    <span className="pf-dot" aria-hidden="true" />
                    <span>{stLabel}</span>
                  </span>
                </div>
                <span className="pf-guard-name">{label}</span>
                <span className="pf-guard-metric">{guard.metric}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Account Fleet Table + S0..S7 Stepper Drill-Down */}
      <section className="pf-section" aria-labelledby="pf-fleet-title" data-testid="pf-fleet-section">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-fleet-title">{t('Danh sách tài khoản Prop (S0–S7)')}</h2>
            <p className="pf-section-sub">{t('Chọn một dòng để xem chi tiết cổng 8 pha và ghi nhận bản nháp chuyển pha.')}</p>
          </div>
        </div>

        <div className="pf-toolbar">
          <FxSelect
            label={t('Lọc theo pha')}
            value={stateFilter}
            options={stateOptions}
            onChange={setStateFilter}
            icon="filter"
            localizeOptions={false}
            data-testid="pf-filter-state"
          />
          <FxSelect
            label={t('Lọc theo hãng')}
            value={firmFilter}
            options={firmOptions}
            onChange={setFirmFilter}
            localizeOptions={false}
            data-testid="pf-filter-firm"
          />
          <input
            type="search"
            className="wm-field pf-search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder={t('Tìm mã tài khoản, hợp đồng, preset…')}
            aria-label={t('Tìm kiếm tài khoản')}
            data-testid="pf-filter-search"
          />
          <span className="pf-toolbar-count">
            {t('Hiển thị {shown}/{total} tài khoản', { shown: filteredAccounts.length, total: ledger.accounts.length })}
          </span>
        </div>

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-fleet-table">
            <thead>
              <tr>
                <th scope="col">{t('Tài khoản')}</th>
                <th scope="col">{t('Pha hiện tại')}</th>
                <th scope="col">{t('Tiến trình S0–S7')}</th>
                <th scope="col" className="is-numeric">{t('Vốn / Equity')}</th>
                <th scope="col" className="is-numeric">{t('DD ngày / tổng')}</th>
                <th scope="col" className="is-numeric">{t('Vị thế mở')}</th>
                <th scope="col">{t('OPS-2 / OPS-4')}</th>
                <th scope="col" className="is-center">{t('Thao tác')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map(acct => {
                const isSelected = selectedAccount?.account_id === acct.account_id
                const canAdvance = (ALLOWED_TRANSITIONS[acct.state] || []).length > 0
                return (
                  <tr
                    key={acct.account_id}
                    className={`is-actionable ${isSelected ? 'is-selected' : ''}`}
                    aria-selected={isSelected}
                    tabIndex={0}
                    data-testid={`pf-account-row-${acct.account_id}`}
                    onClick={() => setSelectedAccountId(acct.account_id)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedAccountId(acct.account_id)
                      }
                    }}
                  >
                    <td>
                      <span className="pf-acct-id">{acct.account_id}</span>
                      <span className="pf-acct-meta">{acct.firm_profile} · {acct.contract_id}</span>
                    </td>
                    <td><StatePill state={acct.state} language={language} /></td>
                    <td><MiniStepper state={acct.state} /></td>
                    <td className="is-numeric">
                      <div>{fmtUsd(acct.capital_usd, locale, 0)}</div>
                      <span className="pf-acct-meta">{fmtUsd(acct.equity_usd, locale)}</span>
                    </td>
                    <td className="is-numeric">
                      {fmtPct(acct.daily_dd_pct)} / {fmtPct(acct.static_dd_pct)}
                    </td>
                    <td className="is-numeric">{acct.open_positions}</td>
                    <td>
                      <span className={`pf-pill is-${acct.ops2_preflight_pass ? 'success' : 'warning'}`}>
                        <span className="pf-dot" aria-hidden="true" />
                        <span>{acct.ops2_preflight_pass ? 'OPS-2 PASS' : 'OPS-2 WAIT'}</span>
                      </span>
                      <span className="pf-acct-meta">OPS-4 {acct.ops4_traffic_light} · {acct.days_since_last_trade}d</span>
                    </td>
                    <td className="is-center">
                      <button
                        type="button"
                        className="wm-button"
                        disabled={!canAdvance}
                        data-testid={`pf-advance-btn-${acct.account_id}`}
                        onClick={event => {
                          event.stopPropagation()
                          openTransitionModal(acct)
                        }}
                      >
                        {t('Chuyển pha')}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filteredAccounts.length === 0 && (
                <tr>
                  <td colSpan={8}>{t('Không có tài khoản nào khớp bộ lọc hiện tại.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Selected Account Drill-Down + Full 8-Stage Stepper */}
        {selectedAccount && (
          <div className="pf-detail-band" data-testid="pf-account-detail">
            <div className="pf-detail-header">
              <div className="pf-detail-title">
                <h3>{selectedAccount.display_name || selectedAccount.account_id}</h3>
                <p>
                  {language === 'en'
                    ? ledger.fsm_spec?.state_metadata?.[selectedAccount.state]?.label_en || selectedAccount.state
                    : ledger.fsm_spec?.state_metadata?.[selectedAccount.state]?.label_vi || selectedAccount.state}
                </p>
              </div>
              <button
                type="button"
                className="wm-button is-primary"
                disabled={(ALLOWED_TRANSITIONS[selectedAccount.state] || []).length === 0}
                data-testid="pf-open-transition-modal"
                onClick={() => openTransitionModal(selectedAccount)}
              >
                <AppIcon name="step" size={16} />
                {t('Ghi nhận chuyển pha')}
              </button>
            </div>

            <div className="pf-stepper-full" role="list" aria-label={t('Chuỗi 8 pha S0–S7')}>
              {CANONICAL_STATES.map((s, idx) => {
                const activeIdx = CANONICAL_STATES.indexOf(selectedAccount.state)
                const meta = STATE_SHORT_META[s]
                const cls = activeIdx === idx ? 'pf-step-node is-current' : activeIdx > idx ? 'pf-step-node is-done' : 'pf-step-node'
                return (
                  <div key={s} className={cls} role="listitem" aria-current={activeIdx === idx ? 'step' : undefined}>
                    <strong>{meta.code}</strong>
                    <span>{language === 'en' ? meta.en : meta.vi}</span>
                  </div>
                )
              })}
            </div>

            <dl className="pf-detail-facts">
              <div>
                <dt>{t('Chế độ preset hiện tại')}</dt>
                <dd>{selectedAccount.preset_mode || 'NONE'}</dd>
              </div>
              <div>
                <dt>{t('Tệp preset & SHA-256')}</dt>
                <dd className="pf-mono">
                  {selectedAccount.preset_name || '—'}
                  {selectedAccount.preset_sha256 ? ` (${selectedAccount.preset_sha256.slice(0, 12)}…)` : ''}
                </dd>
              </div>
              <div>
                <dt>{t('Chu kỳ rút & Tổng nhận ròng')}</dt>
                <dd>
                  {selectedAccount.payout_cycles_completed} · {fmtUsd(selectedAccount.cumulative_net_payout_usd, locale)}
                  {selectedAccount.fee_refunded ? ` (+${fmtUsd(selectedAccount.fee_refund_usd, locale)})` : ''}
                </dd>
              </div>
              <div>
                <dt>{t('Lộ trình FTMO Scaling Plan (+25%)')}</dt>
                <dd>
                  {selectedScaling
                    ? t('{months} tháng · {payouts}/{reqPayouts} lần rút · mục tiêu {nextCap}', {
                      months: selectedScaling.elapsed_months,
                      payouts: selectedScaling.payout_cycles_completed,
                      reqPayouts: FTMO_SCALING_PLAN.min_payout_cycles,
                      nextCap: fmtUsd(selectedScaling.next_capital_usd, locale, 0),
                    })
                    : t('Áp dụng sau khi vào pha S5 Funded (4 tháng, ≥ 10% lãi, ≥ 2 lần rút).')}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {/* Capital Tier Pareto Explorer (10tr..500tr VND) */}
      <section className="pf-section" aria-labelledby="pf-pareto-title" data-testid="pf-pareto-section">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-pareto-title">{t('Khám phá bậc vốn Pareto (10tr–500tr VND)')}</h2>
            <span className={`pf-pill ${paretoData.is_fixture_preview ? 'is-warning' : 'is-success'}`} data-testid="pf-pareto-source-badge">
              <span className="pf-dot" aria-hidden="true" />
              <span>
                {paretoData.is_fixture_preview
                  ? `${t('Bản mẫu xem trước')} · ${paretoData.resolution_label_vi}`
                  : `${t('Pareto đã nhập')} · ${paretoData.resolution_label_vi}`}
              </span>
            </span>
          </div>
          <div>
            <input
              ref={paretoImportInputRef}
              type="file"
              accept=".json,application/json"
              className="pf-file-input"
              data-testid="pf-pareto-import-input"
              aria-label={t('Nhập Pareto JSON')}
              onChange={handleImportParetoFile}
            />
            <button
              type="button"
              className="wm-button"
              data-testid="pf-pareto-import-btn"
              onClick={() => paretoImportInputRef.current?.click()}
            >
              <AppIcon name="upload" size={16} />
              {t('Nhập Pareto JSON')}
            </button>
          </div>
        </div>

        <div className="pf-tier-tabs" role="group" aria-label={t('Chọn bậc vốn VND')}>
          {paretoData.tiers.map(tier => (
            <button
              key={tier.bankroll_m_vnd}
              type="button"
              className="pf-tier-btn"
              aria-pressed={activeTier?.bankroll_m_vnd === tier.bankroll_m_vnd}
              onClick={() => setSelectedTierMVnd(tier.bankroll_m_vnd)}
            >
              {tier.bankroll_m_vnd}tr VND
            </button>
          ))}
        </div>

        {activeTier && (
          <div className="pf-pareto-spotlight" data-testid="pf-pareto-spotlight">
            <p>
              <strong>{activeTier.bankroll_m_vnd}tr VND ({fmtUsd(activeTier.bankroll_usd, locale, 0)})</strong>
              {' · '}
              {language === 'en' ? activeTier.tier_note_en : activeTier.tier_note_vi}
            </p>
            <small>
              {activeTier.concurrency_mode} · {activeTier.allocation_policy} · {t('Đậu/Rớt/Chờ 12m')}:{' '}
              {fmtPct(activeTier.pass_12m_pct)} / {fmtPct(activeTier.fail_12m_pct)} / {fmtPct(activeTier.pending_12m_pct)}
            </small>
          </div>
        )}

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-pareto-table">
            <thead>
              <tr>
                <th scope="col" className="is-numeric">{t('Bậc vốn')}</th>
                <th scope="col">{t('Chế độ song song')}</th>
                <th scope="col">{t('Chính sách sau rút')}</th>
                <th scope="col" className="is-numeric">{t('Funded tối đa')}</th>
                <th scope="col" className="is-numeric">{t('Đậu / Rớt / Chờ (12m)')}</th>
                <th scope="col" className="is-numeric">{t('Rủi ro cháy 36m')}</th>
                <th scope="col" className="is-numeric">{t('Trung vị ròng 36m')}</th>
                <th scope="col" className="is-numeric">{t('Điểm giao Own-Book')}</th>
              </tr>
            </thead>
            <tbody>
              {paretoData.tiers.map(tier => {
                const isSelected = activeTier?.bankroll_m_vnd === tier.bankroll_m_vnd
                return (
                  <tr
                    key={tier.bankroll_m_vnd}
                    className={`is-actionable ${isSelected ? 'is-selected' : ''}`}
                    aria-selected={isSelected}
                    onClick={() => setSelectedTierMVnd(tier.bankroll_m_vnd)}
                  >
                    <td className="is-numeric">
                      <strong>{tier.bankroll_m_vnd}tr</strong>
                      <span className="pf-acct-meta">{fmtUsd(tier.bankroll_usd, locale, 0)}</span>
                    </td>
                    <td>{tier.concurrency_mode}</td>
                    <td>{tier.allocation_policy}</td>
                    <td className="is-numeric">{fmtUsd(tier.max_base_funded_usd, locale, 0)}</td>
                    <td className="is-numeric">
                      {fmtPct(tier.pass_12m_pct)} / {fmtPct(tier.fail_12m_pct)} / {fmtPct(tier.pending_12m_pct)}
                    </td>
                    <td className="is-numeric">{fmtPct(tier.ruin_36m_pct)}</td>
                    <td className="is-numeric">{fmtVnd(tier.median_net_36m_vnd, locale)}</td>
                    <td className="is-numeric">
                      {tier.own_book_crossover_month != null
                        ? t('Tháng {month}', { month: tier.own_book_crossover_month })
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Immutable Hash-Chained Transition Audit Log */}
      <section className="pf-section" aria-labelledby="pf-audit-title" data-testid="pf-transitions-section">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-audit-title">{t('Nhật ký chuỗi băm chuyển pha (SHA-256)')}</h2>
            <span className="pf-pill is-neutral" data-testid="pf-transition-count">
              <AppIcon name="history" size={13} />
              <span>{t('{count} sự kiện', { count: ledger.transitions.length })}</span>
            </span>
          </div>
        </div>

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-transitions-table">
            <thead>
              <tr>
                <th scope="col" className="is-numeric">#</th>
                <th scope="col">{t('Thời gian (UTC)')}</th>
                <th scope="col">{t('Tài khoản')}</th>
                <th scope="col">{t('Chuyển pha')}</th>
                <th scope="col">{t('Preset')}</th>
                <th scope="col" className="is-numeric">{t('Vị thế mở')}</th>
                <th scope="col">{t('Người ghi')}</th>
                <th scope="col">{t('Mã băm SHA-256')}</th>
              </tr>
            </thead>
            <tbody>
              {reversedTransitions.map(ev => (
                <tr key={ev.event_id}>
                  <td className="is-numeric">{ev.seq}</td>
                  <td>{displayDate(ev.utc_ts, { timeStyle: 'short', timeZone: 'UTC' })}</td>
                  <td className="pf-acct-id">{ev.account_id}</td>
                  <td>
                    <span className="pf-mono">
                      {STATE_SHORT_META[ev.from_state]?.code || ev.from_state} → {STATE_SHORT_META[ev.to_state]?.code || ev.to_state}
                    </span>
                  </td>
                  <td>{ev.preset_mode}</td>
                  <td className="is-numeric">{ev.open_positions}</td>
                  <td>{ev.actor}</td>
                  <td className="pf-mono">{String(ev.event_sha256 || '').slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Fail-Closed Phase Transition Modal */}
      {modalAccount && (
        <LegacyModal
          theme={theme}
          label={t('Chuyển pha tài khoản {account}', { account: modalAccount.account_id })}
          className="pf-modal"
          onClose={() => { setModalAccountId(null); setModalError(null) }}
        >
          <form className="pf-modal-body" data-testid="pf-transition-modal" onSubmit={handleSubmitTransition}>
            <div className="pf-modal-context">
              <StatePill state={modalAccount.state} language={language} />
              <span aria-hidden="true">→</span>
              {modalTargetState && <StatePill state={modalTargetState} language={language} />}
            </div>

            {modalIsFundedEntry && (
              <div className="pf-alert is-warning" role="status">
                <AppIcon name="shield" size={16} />
                <div className="pf-alert-body">
                  {t('CỔNG 2 KHÓA BẮT BUỘC: Bắt buộc 0 vị thế mở, OPS-2 PASS, preset FUNDED_1X (cấm mọi .set Eval/Sprint) và SHA-256 hợp lệ.')}
                </div>
              </div>
            )}

            {modalError && (
              <div className="pf-alert is-danger" role="alert" data-testid="pf-modal-error">
                <AppIcon name="error" size={16} />
                <div className="pf-alert-body">
                  <span className="pf-alert-code">[{modalError.code}]</span>
                  <span>{modalError.message}</span>
                </div>
              </div>
            )}

            <div className="pf-field-grid">
              <label className="pf-field is-full">
                <span>{t('Pha đích')}</span>
                <select
                  value={modalTargetState}
                  onChange={event => handleTargetStateChange(event.target.value)}
                  data-testid="pf-modal-target-state"
                >
                  {modalAllowedTargets.map(target => {
                    const m = STATE_SHORT_META[target]
                    return (
                      <option key={target} value={target}>
                        {m.code} · {language === 'en' ? m.en : m.vi}
                      </option>
                    )
                  })}
                </select>
              </label>

              <label className="pf-field">
                <span>{t('Số vị thế đang mở (open_positions)')}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={modalOpenPos}
                  onChange={event => { setModalOpenPos(event.target.value); setModalError(null) }}
                  data-testid="pf-modal-open-positions"
                />
              </label>

              <label className="pf-field">
                <span>{t('Chế độ preset')}</span>
                <select
                  value={modalPresetMode}
                  onChange={event => { setModalPresetMode(event.target.value); setModalError(null) }}
                  data-testid="pf-modal-preset-mode"
                >
                  <option value={PRESET_MODE_NONE}>NONE</option>
                  <option value={PRESET_MODE_FUNDED_1X}>FUNDED_1X</option>
                  <option value={PRESET_MODE_EVAL_P1_SPRINT}>EVAL_P1_SPRINT_4_5X</option>
                  <option value={PRESET_MODE_EVAL_P2_SPRINT}>EVAL_P2_SPRINT_3_5X</option>
                </select>
              </label>

              <label className="pf-field is-full">
                <span>{t('Tên tệp .set (preset_name)')}</span>
                <input
                  type="text"
                  value={modalPresetName}
                  onChange={event => { setModalPresetName(event.target.value); setModalError(null) }}
                  placeholder="FTMO_Swing10K_Funded_Safe_1x.set"
                  data-testid="pf-modal-preset-name"
                />
              </label>

              <label className="pf-field is-full">
                <span>{t('Mã băm SHA-256 của tệp .set (64 ký tự hex)')}</span>
                <div className="pf-sha-row">
                  <input
                    type="text"
                    className="pf-mono"
                    value={modalPresetSha}
                    onChange={event => { setModalPresetSha(event.target.value); setModalError(null) }}
                    placeholder="64 lowercase hex characters"
                    data-testid="pf-modal-preset-sha"
                  />
                  <button
                    type="button"
                    className="wm-button"
                    data-testid="pf-modal-fill-sha"
                    onClick={() => setModalPresetSha(sha256Hex(`${modalAccount.account_id}:${modalPresetMode}:${modalPresetName || 'preset'}`))}
                  >
                    {t('Tạo SHA mẫu')}
                  </button>
                </div>
              </label>

              {modalTargetState === 'S6_PAYOUT_AUDIT_AND_HARVEST' && (
                <label className="pf-field is-full">
                  <span>{t('Mã băm gói kiểm toán OPS-5 (64 ký tự hex)')}</span>
                  <div className="pf-sha-row">
                    <input
                      type="text"
                      className="pf-mono"
                      value={modalOps5Sha}
                      onChange={event => { setModalOps5Sha(event.target.value); setModalError(null) }}
                      data-testid="pf-modal-ops5-sha"
                    />
                    <button
                      type="button"
                      className="wm-button"
                      onClick={() => setModalOps5Sha(sha256Hex(`${modalAccount.account_id}:ops5:${ledger.transitions.length + 1}`))}
                    >
                      {t('Tạo SHA mẫu')}
                    </button>
                  </div>
                </label>
              )}

              {modalTargetState === 'S7_AFTER_PAYOUT_ALLOCATOR' && (
                <label className="pf-field is-full">
                  <span>{t('Lợi nhuận rút gộp (USD)')}</span>
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    value={modalPayoutGross}
                    onChange={event => setModalPayoutGross(event.target.value)}
                    data-testid="pf-modal-payout-gross"
                  />
                </label>
              )}

              {(modalTargetState === 'S2_PASS_P1_HANDOFF' || modalTargetState === 'S4_PASS_P2_TO_FUNDED_LOCK') && (
                <>
                  <label className="pf-field">
                    <span>{t('Equity chốt pha (USD)')}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={modalEquity}
                      onChange={event => setModalEquity(event.target.value)}
                      data-testid="pf-modal-equity"
                    />
                  </label>
                  <label className="pf-field">
                    <span>{t('Số ngày giao dịch đã đạt')}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={modalTradingDays}
                      onChange={event => setModalTradingDays(event.target.value)}
                      data-testid="pf-modal-trading-days"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="pf-checks">
              <label className="pf-check-label">
                <input
                  type="checkbox"
                  checked={modalOps2Pass}
                  onChange={event => { setModalOps2Pass(event.target.checked); setModalError(null) }}
                  data-testid="pf-modal-ops2-pass"
                />
                <span>{t('Xác nhận đã chạy tiền kiểm OPS-2 (ops2_preflight_pass = true)')}</span>
              </label>
              {modalFlatRequired && (
                <label className="pf-check-label">
                  <input
                    type="checkbox"
                    checked={modalFlatConfirm}
                    onChange={event => { setModalFlatConfirm(event.target.checked); setModalError(null) }}
                    data-testid="pf-modal-flat-confirm"
                  />
                  <span>{t('Xác nhận tài khoản phẳng lệnh hoàn toàn (open_positions == 0)')}</span>
                </label>
              )}
            </div>

            <div className="pf-modal-actions">
              <button
                type="button"
                className="wm-button"
                onClick={() => { setModalAccountId(null); setModalError(null) }}
              >
                {t('Hủy')}
              </button>
              <button type="submit" className="wm-button is-primary" data-testid="pf-modal-submit">
                {t('Xác nhận ghi bản nháp')}
              </button>
            </div>
          </form>
        </LegacyModal>
      )}
    </main>
  )
}
