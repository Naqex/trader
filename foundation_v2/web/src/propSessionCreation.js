import { createReplaySession } from './sessionCatalog.js'
import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { commonSessionRange } from './sessionPeriod.js'
import { SESSION_COST_VERSION, buildTradingOptions, tradingOptionsMatch } from './sessionTradingOptions.js'

async function propJson(url, workspace, options = {}) {
  const response = options.method ? await scopedMutation(url, workspace, { ...options, headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace } }) : await scopedRead(url, workspace)
  const payload = await response.json()
  if (!response.ok) throw Object.assign(new Error(String(payload.detail || `HTTP ${response.status}`)), { status: response.status })
  return payload
}
function utcIsoFromInput(value) {
  const parsed = new Date(`${value}:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54)
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('')}`
}


export async function createPropChartSession(workspace, draft, datasets) {
  const selectedIds = draft.datasetVersions?.length ? draft.datasetVersions : [draft.datasetVersion]
  if (selectedIds.length > 12 || new Set(selectedIds).size !== selectedIds.length || selectedIds[0] !== draft.datasetVersion) throw Object.assign(new Error('Chọn tối đa 12 tài sản khác nhau, bắt đầu bằng tài sản chính.'), { status: 422 })
  const selectedAssets = selectedIds.map(id => datasets.find(item => item.dataset_id === id))
  if (selectedAssets.some(item => !item)) throw new Error('Tài sản đã chọn không còn khả dụng.')
  const tradingOptions = buildTradingOptions(draft.tradingOptions || { costs_enabled: false, assets: {} }, selectedAssets)
  if (selectedAssets.some(item => (item.instrument_spec?.account_ccy || 'USD') !== draft.currency.toUpperCase())) throw new Error('Các tài sản phải dùng cùng tiền tệ tài khoản.')
  const start = utcIsoFromInput(draft.startUtc)
  const durationDays = Number(draft.durationDays) > 0 ? Math.max(1, Number(draft.durationDays)) : null
  const initialCapital = Number(draft.initialCapital), targetPercent = Number(draft.targetPercent)
  const dailyLoss = Number(draft.dailyLoss), overallLoss = Number(draft.overallLoss)
  const base = slugify(draft.name) || 'prop'
  const datasetItem = datasets.find(item => item.dataset_id === draft.datasetVersion)
  if (!start || !draft.name.trim() || !datasetItem) throw new Error('Tên phiên, ngày bắt đầu hoặc tài sản chưa hợp lệ.')
  const datasetPin = datasetItem.artifact_sha256 || datasetItem.dataset_sha256 || draft.datasetVersion
  const profileId = `${draft.profileKind}-practice-v1`
  const profileCore = {
    contract_version: 'prop-session-v1',
    profile_id: profileId,
    terms_version: 'ui-practice-v1',
    effective_from: start.slice(0, 10),
    source_kind: draft.profileKind,
    source_url: null,
    supported_rule_flags: ['daily_loss', 'overall_drawdown', 'profit_target'],
    phases: [{
      phase_index: 1,
      initial_capital: String(initialCapital),
      currency: draft.currency.toUpperCase(),
      profit_target: { threshold: { amount: null, percent: String(targetPercent), percent_base: 'initial_capital' }, basis: 'balance', comparator: 'gte' },
      daily_loss: { threshold: { amount: String(dailyLoss), percent: null, percent_base: 'initial_capital' }, basis: 'equity', comparator: 'lt' },
      overall_drawdown: {
        threshold: { amount: String(overallLoss), percent: null, percent_base: 'initial_capital' },
        basis: 'equity', comparator: 'lt', kind: 'static', trailing_granularity: null, lock_floor_at_initial: false,
      },
      reset_timezone: 'UTC',
      reset_local_time: '00:00:00',
      reset_order: 'fees_then_reset',
      min_qualifying_days: 1,
      max_calendar_days: durationDays,
      carry_policy: 'reset',
      position_policy: 'must_be_flat',
    }],
  }
  const profileHash = await sha256Text(JSON.stringify(profileCore))
  const profile = { ...profileCore, profile_hash: profileHash }
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const sessionId = `${base}-${suffix}`.slice(0, 96)
  const attemptId = `attempt-${suffix}`
  const range = commonSessionRange(selectedIds.map(id => datasets.find(item => item.dataset_id === id)).filter(Boolean))
  const cutoff = draft.endUtc ? utcIsoFromInput(draft.endUtc) : range?.valid ? new Date(range.max * 1000).toISOString() : null
  if (!range?.valid || !cutoff || Date.parse(start) < range.min * 1000 || Date.parse(cutoff) <= Date.parse(start) || Date.parse(cutoff) > range.max * 1000 || selectedIds.some(id => !datasets.some(item => item.dataset_id === id))) throw new Error('Khoảng dữ liệu không hợp lệ.')
  const session = {
    contract_version: 'prop-session-v1',
    workspace_id: workspace,
    session_id: sessionId,
    mode: 'simulation',
    session_type: 'challenge',
    profile,
    status: 'running',
    revision: 1,
  }
  const attempt = {
    contract_version: 'prop-session-v1',
    workspace_id: workspace,
    session_id: sessionId,
    attempt_id: attemptId,
    mode: 'simulation',
    profile_id: profile.profile_id,
    terms_version: profile.terms_version,
    profile_hash: profile.profile_hash,
    // Prop/Replay binding is checked against the immutable artifact hash.
    // Keep the dataset id in the form, but persist its hash as the pin.
    data_version: datasetPin,
    cost_version: SESSION_COST_VERSION,
    engine_version: 'replay-v1',
    status: 'running',
    revision: 1,
    parent_attempt_id: null,
    branch_kind: 'clean',
    virtual_start_utc: start,
    virtual_cutoff_utc: cutoff,
  }
  const phase = {
    workspace_id: workspace,
    session_id: sessionId,
    attempt_id: attemptId,
    profile_hash: profile.profile_hash,
    phase_index: 1,
    initial_balance: String(initialCapital),
    balance: String(initialCapital),
    floating_pl: '0',
    equity: String(initialCapital),
    high_water_mark: String(initialCapital),
    daily_anchor: String(initialCapital),
    qualifying_days: 0,
    virtual_time_utc: start,
    last_event_sequence: 0,
    open_positions: 0,
    pending_orders: 0,
    evaluation_quality: 'full_for_declared_model',
  }
  const resumeState = {
    cursor: { bar_index: 0, timestamp_utc: start },
    open_positions: [],
    pending_orders: [],
    setup_metadata: {
      session_name: draft.name.trim(),
      dataset_ids: selectedIds,
      strategy_id: draft.strategyId || '',
      strategy_revision: Number.isInteger(draft.strategyRevision) ? draft.strategyRevision : null,
      period_end_utc: draft.endUtc ? utcIsoFromInput(draft.endUtc) : null,
      trading_options: tradingOptions,
    },
  }

  const bundle = await propJson('/api/v2/prop/session-bundles', workspace, {
    method: 'POST',
    body: JSON.stringify({ session, attempt, phase, resume_state: resumeState }),
  })

  const replay = await openPropReplay(workspace, bundle, datasets)
  return { bundle, replay }
}

export async function startReadyPropAttempt(workspace, bundle, signal) {
  if (bundle.attempt?.status !== 'ready') return bundle
  const { attempt, phase } = bundle
  return propJson(`/api/v2/prop/sessions/${encodeURIComponent(attempt.session_id)}/attempts/${encodeURIComponent(attempt.attempt_id)}/transitions`, workspace, {
    method: 'POST', signal,
    body: JSON.stringify({ workspace_id: workspace, session_id: attempt.session_id, attempt_id: attempt.attempt_id,
      profile_hash: attempt.profile_hash, intent_id: `chart-start-${attempt.attempt_id}-${attempt.revision}`,
      expected_revision: attempt.revision, event_sequence: phase.last_event_sequence, action: 'start' }),
  })
}

export async function openPropReplay(workspace, bundle, datasets) {
  const { session, attempt, phase } = bundle
  const metadata = bundle.resume_state?.setup_metadata || {}
  const bound = bundle.resume_state?.replay_binding?.replay_session_id
  if (bound) return { record_id: bound, dataset_id: bundle.resume_state.replay_binding.dataset_id, session_kind: 'prop', prop_session_id: session.session_id, prop_attempt_id: attempt.attempt_id }
  // Creation stores the identity before the chart opens, even before execution exists.
  const catalog = await propJson('/api/v2/replay/sessions', workspace)
  const existing = catalog.items?.find(item => item.prop_session_id === session.session_id && item.prop_attempt_id === attempt.attempt_id)
  if (existing) return existing
  const dataset = datasets.find(item => item.dataset_id === attempt.data_version || item.artifact_sha256 === attempt.data_version || item.dataset_sha256 === attempt.data_version || `sha256:${item.artifact_sha256}` === attempt.data_version)
  const ids = metadata.dataset_ids?.length ? metadata.dataset_ids : [dataset?.dataset_id || attempt.data_version]
  if (!dataset || !ids.includes(dataset.dataset_id) || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => !datasets.some(item => item.dataset_id === id))) throw new Error('Tài sản của phiên không còn khả dụng hoặc không khớp dữ liệu đã khóa.')
  const record = await createReplaySession(workspace, {
    dataset_id: dataset.dataset_id, dataset_ids: [dataset.dataset_id, ...ids.filter(id => id !== dataset.dataset_id)],
    name: metadata.session_name || 'Prop Firm',
    starting_balance: phase.initial_balance,
    ...(metadata.trading_options ? { trading_options: metadata.trading_options } : {}),
    start_timestamp: Math.floor(Date.parse(attempt.virtual_start_utc) / 1000),
    ...(metadata.period_end_utc ? { end_timestamp: Math.floor(Date.parse(metadata.period_end_utc) / 1000) } : {}),
    ...(metadata.strategy_id && metadata.strategy_revision ? { playbook_id: metadata.strategy_id, playbook_revision: metadata.strategy_revision } : {}),
    prop_session_id: session.session_id, prop_attempt_id: attempt.attempt_id,
  })
  if (metadata.trading_options && !tradingOptionsMatch(record.payload?.trading_options, metadata.trading_options)) throw new Error('Cấu hình chi phí đã lưu không khớp lựa chọn. Kiểm tra phiên trước khi giao dịch.')
  return { ...record, dataset_id: record.payload.dataset_id, session_kind: 'prop', prop_session_id: session.session_id, prop_attempt_id: attempt.attempt_id }
}
