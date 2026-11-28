/**
 * Pure client-side Wave 5 Evaluation Scorecard (`evaluation-scorecard@1.0.0`),
 * 5-Tier Speed Spectrum (`T1..T5 + Bellman DP + C00/C10/Sprint`), and
 * Closed-Loop Alpha Factory validation & formatting model.
 *
 * Imported ONLY by the lazy Wave 5 panels (`PropFleetSpectrumPanel.jsx`,
 * `PropFleetAlphaBenchPanel.jsx`) and unit tests — 0 B delta to base chunk
 * and 0 B delta to startup bundle.
 *
 * HARD SAFETY INVARIANTS:
 * - Zero broker/API/network calls (`WAVE5_ORDER_SEND_CAPABLE === false`, `WAVE5_ORDER_SEND_COUNT === 0`)
 * - Read-only presentation (`WAVE5_EXECUTION_CAPABILITY === false`, `WAVE5_AUTO_DEPLOY_PERMITTED === false`)
 * - Holdout 2025+ sealed (`WAVE5_HOLDOUT_CUTOFF_DATE === '2024-12-31'`, `WAVE5_HOLDOUT_ROWS_ANALYSED === 0`)
 * - Fail-closed on NaN, Infinity, booleans disguised as numbers, invalid 100% partitions,
 *   missing `presentation-state@1.0.0` labels on `UNKNOWN_LEGACY_UNINSTRUMENTED`,
 *   or stripped T5 gambling/research-boundary warnings.
 */

export const WAVE5_SCORECARD_SCHEMA = 'naqex-evaluation-scorecard-v1'
export const WAVE5_CONTRACT_VERSION = '1.0.0'
export const WAVE5_EXECUTION_CAPABILITY = false
export const WAVE5_ORDER_SEND_CAPABLE = false
export const WAVE5_ORDER_SEND_COUNT = 0
export const WAVE5_HOLDOUT_CUTOFF_DATE = '2024-12-31'
export const WAVE5_HOLDOUT_ROWS_ANALYSED = 0
export const WAVE5_AUTO_DEPLOY_PERMITTED = false

export const PARTITION_SUM_TOLERANCE = 0.0001
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/

export const GRADE_BANDS = Object.freeze([
  'BAD',
  'ADEQUATE',
  'GOOD',
  'TOP_1_PCT',
  'UNKNOWN_LEGACY_UNINSTRUMENTED',
])

export const NUMERIC_GRADE_BANDS = Object.freeze([
  'BAD',
  'ADEQUATE',
  'GOOD',
  'TOP_1_PCT',
])

export const GRADE_META = Object.freeze({
  BAD: Object.freeze({
    code: 'BAD',
    rank: 0,
    tone: 'danger',
    pinPct: 12.5,
    vi: 'Xấu',
    en: 'Bad',
  }),
  ADEQUATE: Object.freeze({
    code: 'ADEQUATE',
    rank: 1,
    tone: 'warning',
    pinPct: 37.5,
    vi: 'Đủ dùng',
    en: 'Adequate',
  }),
  GOOD: Object.freeze({
    code: 'GOOD',
    rank: 2,
    tone: 'success',
    pinPct: 62.5,
    vi: 'Tốt',
    en: 'Good',
  }),
  TOP_1_PCT: Object.freeze({
    code: 'TOP_1_PCT',
    rank: 3,
    tone: 'info',
    pinPct: 87.5,
    vi: 'Top 1% thực tế',
    en: 'Top 1% Realistic',
  }),
  UNKNOWN_LEGACY_UNINSTRUMENTED: Object.freeze({
    code: 'UNKNOWN_LEGACY_UNINSTRUMENTED',
    rank: -1,
    tone: 'neutral',
    pinPct: null,
    vi: 'Chưa tách số liệu (Đợt cũ)',
    en: 'Unknown (Legacy Uninstrumented)',
  }),
})

export const DOMAIN_TIERS = Object.freeze([
  'T1_CFD_PROP',
  'T2_CME_FUTURES',
  'T3_MULTI_ASSET_OWNBOOK',
  'T4_LIVE_OPS',
])

export const EVAL_SCOPES = Object.freeze([
  'SINGLE_TICKET',
  'MULTI_ACCOUNT_FLEET',
])

export const PRICING_REGIMES = Object.freeze([
  'ALL_REGULAR_SSOT',
  'BLACK_FRIDAY_PROMO',
])

export const EVIDENCE_STAGES = Object.freeze([
  'DEV_IS',
  'DEV_BLIND_OOS',
  'DEV_CONSUMED_OOS',
  'HOLDOUT_SEALED_ONCE',
  'SHADOW_DEMO',
  'LIVE_REAL',
])

export const DATA_RESOLUTIONS = Object.freeze([
  'TICK_REAL',
  'M1_BID_ASK',
  'M1_BID_SPREAD',
  'M1_SINGLE_SIDE',
  'APPROX_DAILY',
])

export const RISK_SPECTRUM_TIERS = Object.freeze([
  'T1_ULTRA_SAFE',
  'T2_CONSERVATIVE',
  'T3_BALANCED',
  'T4_AGGRESSIVE_SPRINT',
  'T5_MAX_THROTTLE_YOLO',
])

export const EVAL_PHASES = Object.freeze([
  'p1',
  'p2',
  'pass_eval',
  'funded_12m',
])

export const ALL_PHASES_WITH_OVERALL = Object.freeze([
  ...EVAL_PHASES,
  'overall_36m',
])

export const PRESENTATION_AVAILABILITY = Object.freeze([
  'loading',
  'ready',
  'empty',
  'unavailable',
  'error',
  'denied',
])

export const PRESENTATION_FRESHNESS = Object.freeze([
  'current',
  'stale',
  'partial',
  'unknown',
])

export const PRESENTATION_CERTAINTY = Object.freeze([
  'known',
  'uncertain',
  'unknown',
])

export const PRESENTATION_REASON_CODE_RE = /^[a-z][a-z0-9_.-]*$/

export const PRESENTATION_LABEL_REQUIRED_FRESHNESS = Object.freeze([
  'stale',
  'partial',
  'unknown',
])

export const PRESENTATION_LABEL_REQUIRED_AVAILABILITY = Object.freeze([
  'loading',
  'empty',
  'unavailable',
  'error',
  'denied',
])

export const T5_MANDATORY_WARNING_TAGS = Object.freeze([
  'RESEARCH_BOUNDARY_ONLY',
  'FTMO_GAMBLING_ALLIN_RISK',
])

export const LEGACY_W4_P1_P2_LABEL_VI = 'Chưa tách riêng P1/P2 ở dữ liệu Đợt 4'
export const LEGACY_W4_P1_P2_LABEL_EN = 'P1/P2 not instrumented separately in Wave 4 baseline'

export const BOTTLENECK_META = Object.freeze({
  PAYOUT_1_SLOW: Object.freeze({
    metric_id: 'payout_1_cal_days',
    phase: 'overall_36m',
    vi: 'Thời gian chờ trung vị tới lần rút tiền đầu tiên còn dài',
    en: 'Median calendar days to first payout remain above target',
  }),
  P_LE_ZERO_24M_HIGH: Object.freeze({
    metric_id: 'p_le_zero_24m',
    phase: 'overall_36m',
    vi: 'Xác suất lỗ hoặc hòa vốn sau 24 tháng còn cao',
    en: '24-month non-positive net probability remains above target',
  }),
  PASS_EVAL_RATE_LOW: Object.freeze({
    metric_id: 'pass_eval_rate',
    phase: 'pass_eval',
    vi: 'Tỷ lệ vượt đủ vòng thi vào Funded còn thấp',
    en: 'Combined P1+P2 evaluation pass rate remains below target',
  }),
  FUNDED_12M_BLOWUP_HIGH: Object.freeze({
    metric_id: 'funded_12m_blowup',
    phase: 'funded_12m',
    vi: 'Tỷ lệ cháy tài khoản Funded trong 12 tháng vượt ngưỡng an toàn',
    en: '12-month Funded account blowup rate exceeds safety threshold',
  }),
  EV_PER_FEE_BELOW_TARGET: Object.freeze({
    metric_id: 'ev_per_fee',
    phase: 'overall_36m',
    vi: 'Kỳ vọng lãi trên 1 đồng phí thi quỹ còn dưới mục tiêu',
    en: 'Expected value per 1 unit of challenge fee is below target',
  }),
  EVIDENCE_STAGE_DEV_ONLY: Object.freeze({
    metric_id: 'evidence_stage',
    phase: 'overall_36m',
    vi: 'Bằng chứng mới ở mức quá khứ Dev, chưa qua Holdout mù và Demo/Live',
    en: 'Evidence is Dev-only; sealed Holdout and Demo/Live validation still pending',
  }),
  RUIN_36M_HIGH: Object.freeze({
    metric_id: 'ruin_36m',
    phase: 'overall_36m',
    vi: 'Xác suất cạn ngân sách thi quỹ 36 tháng vượt ngưỡng',
    en: '36-month bankroll ruin probability exceeds threshold',
  }),
  P1_PASS_RATE_LOW: Object.freeze({
    metric_id: 'p1_pass_rate',
    phase: 'p1',
    vi: 'Tỷ lệ đậu Vòng 1 (P1) còn dưới ngưỡng mục tiêu',
    en: 'Phase 1 pass rate remains below target',
  }),
  P2_PASS_RATE_LOW: Object.freeze({
    metric_id: 'p2_pass_rate',
    phase: 'p2',
    vi: 'Tỷ lệ đậu Vòng 2 (P2) còn dưới ngưỡng mục tiêu',
    en: 'Phase 2 pass rate remains below target',
  }),
  P1_UNINSTRUMENTED_LEGACY: Object.freeze({
    metric_id: 'p1_pass_rate',
    phase: 'p1',
    vi: LEGACY_W4_P1_P2_LABEL_VI,
    en: LEGACY_W4_P1_P2_LABEL_EN,
  }),
  P2_UNINSTRUMENTED_LEGACY: Object.freeze({
    metric_id: 'p2_pass_rate',
    phase: 'p2',
    vi: LEGACY_W4_P1_P2_LABEL_VI,
    en: LEGACY_W4_P1_P2_LABEL_EN,
  }),
})

export const SCHEDULE_DISPLAY_META = Object.freeze({
  T1_ULTRA_SAFE: Object.freeze({
    short: 'T1',
    tier: 'T1_ULTRA_SAFE',
    vi: 'T1 Siêu an toàn (2.5x / 1.75x / 1.0x)',
    en: 'T1 Ultra Safe (2.5x / 1.75x / 1.0x)',
    p1_mult: 2.5,
    p2_mult: 1.75,
    funded_mult: 1.0,
    is_primary_spectrum: true,
  }),
  T2_SAFE_C00: Object.freeze({
    short: 'T2',
    tier: 'T2_CONSERVATIVE',
    vi: 'T2 Thận trọng (3.5x / 2.25x / 1.0x)',
    en: 'T2 Conservative (3.5x / 2.25x / 1.0x)',
    p1_mult: 3.5,
    p2_mult: 2.25,
    funded_mult: 1.0,
    is_primary_spectrum: true,
  }),
  T3_BALANCED_EV: Object.freeze({
    short: 'T3',
    tier: 'T3_BALANCED',
    vi: 'T3 Cân bằng Pareto (4.5x / 3.5x / 1.0x)',
    en: 'T3 Balanced Pareto (4.5x / 3.5x / 1.0x)',
    p1_mult: 4.5,
    p2_mult: 3.5,
    funded_mult: 1.0,
    is_primary_spectrum: true,
  }),
  T4_TURBO_FAST: Object.freeze({
    short: 'T4',
    tier: 'T4_AGGRESSIVE_SPRINT',
    vi: 'T4 Tăng tốc vượt vòng (6.0x / 4.75x / 1.0x)',
    en: 'T4 Turbo Sprint (6.0x / 4.75x / 1.0x)',
    p1_mult: 6.0,
    p2_mult: 4.75,
    funded_mult: 1.0,
    is_primary_spectrum: true,
  }),
  T5_MAX_THROTTLE_YOLO: Object.freeze({
    short: 'T5',
    tier: 'T5_MAX_THROTTLE_YOLO',
    vi: 'T5 Biên cực đại (8.5x / 6.5x · Ranh giới nghiên cứu)',
    en: 'T5 Max Throttle (8.5x / 6.5x · Research Boundary)',
    p1_mult: 8.5,
    p2_mult: 6.5,
    funded_mult: 1.0,
    is_primary_spectrum: true,
  }),
  BELLMAN_DP_6TIER: Object.freeze({
    short: 'DP-6T',
    tier: 'T1_ULTRA_SAFE',
    vi: 'Bellman DP 6 bậc chống gồng lỗ (2.5x / 2.0x / 1.0x)',
    en: 'Bellman DP 6-Tier Anti-Martingale (2.5x / 2.0x / 1.0x)',
    p1_mult: 2.5,
    p2_mult: 2.0,
    funded_mult: 1.0,
    is_primary_spectrum: true,
  }),
  C00: Object.freeze({
    short: 'C00',
    tier: 'T2_CONSERVATIVE',
    vi: 'C00 Chuẩn đối chứng (Tin đỏ tắt · Fn 1.0x)',
    en: 'C00 Baseline Reference (News Off · Fn 1.0x)',
    p1_mult: 3.5,
    p2_mult: 2.5,
    funded_mult: 1.0,
    is_primary_spectrum: false,
  }),
  C10_NEWS_ON: Object.freeze({
    short: 'C10',
    tier: 'T2_CONSERVATIVE',
    vi: 'C10 Đối chứng Đợt 4 (Tin đỏ bật · Fn 1.25x)',
    en: 'C10 Wave 4 Reference (News On · Fn 1.25x)',
    p1_mult: 4.0,
    p2_mult: 3.5,
    funded_mult: 1.25,
    is_primary_spectrum: false,
  }),
  V103_SPRINT: Object.freeze({
    short: 'Sprint',
    tier: 'T3_BALANCED',
    vi: 'v1.03 Sprint chuẩn (4.5x / 3.5x / 1.0x)',
    en: 'v1.03 Standard Sprint (4.5x / 3.5x / 1.0x)',
    p1_mult: 4.5,
    p2_mult: 3.5,
    funded_mult: 1.0,
    is_primary_spectrum: false,
  }),
})

// ---------------------------------------------------------------------------
// Strict Primitive Validators (Fail-Closed: Zero bool / NaN / Infinity)
// ---------------------------------------------------------------------------
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isStrictFiniteReal(value, { min = null, max = null } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (min !== null && value < min) return false
  if (max !== null && value > max) return false
  return true
}

export function isStrictNonNegativeInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// ---------------------------------------------------------------------------
// 100.0% Pass / Fail / Pending Partition Validator
// ---------------------------------------------------------------------------
export function validateHorizonPartition(partition, tolerance = PARTITION_SUM_TOLERANCE) {
  if (!isPlainObject(partition)) {
    return { ok: false, code: 'INVALID_PARTITION_OBJECT', message: 'Partition must be an object.' }
  }
  const { pass_pct: passPct, fail_pct: failPct, pending_pct: pendingPct } = partition
  if (
    !isStrictFiniteReal(passPct, { min: 0, max: 100 })
    || !isStrictFiniteReal(failPct, { min: 0, max: 100 })
    || !isStrictFiniteReal(pendingPct, { min: 0, max: 100 })
  ) {
    return {
      ok: false,
      code: 'POISONED_PARTITION_VALUE',
      message: 'Partition pass_pct, fail_pct, and pending_pct must be finite numbers in [0, 100] (no bool/NaN/Infinity).',
    }
  }
  const sum = passPct + failPct + pendingPct
  if (!Number.isFinite(sum) || Math.abs(sum - 100) > tolerance) {
    return {
      ok: false,
      code: 'INVALID_PARTITION_SUM',
      message: `Partition sum must equal 100.0% (+/- ${tolerance}), got ${sum.toFixed(4)}%.`,
    }
  }
  return { ok: true, sum: Number(sum.toFixed(4)) }
}

// ---------------------------------------------------------------------------
// presentation-state@1.0.0 Validator
// ---------------------------------------------------------------------------
export function validatePresentationState(ps, { requireLabel = false } = {}) {
  if (!isPlainObject(ps)) {
    return { ok: false, code: 'INVALID_PRESENTATION_STATE', message: 'presentation_state must be an object.' }
  }
  if (!PRESENTATION_AVAILABILITY.includes(ps.availability)) {
    return {
      ok: false,
      code: 'INVALID_PRESENTATION_AVAILABILITY',
      message: `Unknown presentation_state.availability: ${String(ps.availability)}.`,
    }
  }
  if (ps.freshness !== undefined && ps.freshness !== null && !PRESENTATION_FRESHNESS.includes(ps.freshness)) {
    return {
      ok: false,
      code: 'INVALID_PRESENTATION_FRESHNESS',
      message: `Unknown presentation_state.freshness: ${String(ps.freshness)}.`,
    }
  }
  if (ps.certainty !== undefined && ps.certainty !== null && !PRESENTATION_CERTAINTY.includes(ps.certainty)) {
    return {
      ok: false,
      code: 'INVALID_PRESENTATION_CERTAINTY',
      message: `Unknown presentation_state.certainty: ${String(ps.certainty)}.`,
    }
  }
  if (ps.reasonCode !== undefined && ps.reasonCode !== null) {
    if (typeof ps.reasonCode !== 'string' || !PRESENTATION_REASON_CODE_RE.test(ps.reasonCode)) {
      return {
        ok: false,
        code: 'INVALID_PRESENTATION_REASON_CODE',
        message: `presentation_state.reasonCode must match /^[a-z][a-z0-9_.-]*$/, got ${String(ps.reasonCode)}.`,
      }
    }
  }
  if (ps.availability === 'ready') {
    if (!PRESENTATION_FRESHNESS.includes(ps.freshness) || !PRESENTATION_CERTAINTY.includes(ps.certainty)) {
      return {
        ok: false,
        code: 'MISSING_PRESENTATION_READY_METADATA',
        message: 'presentation_state with availability="ready" requires valid freshness and certainty.',
      }
    }
  }
  if (ps.availability === 'error' || ps.availability === 'denied') {
    if (typeof ps.reasonCode !== 'string' || !PRESENTATION_REASON_CODE_RE.test(ps.reasonCode)) {
      return {
        ok: false,
        code: 'MISSING_PRESENTATION_REASON_CODE',
        message: `presentation_state with availability="${ps.availability}" requires a valid lowercase reasonCode.`,
      }
    }
  }
  const needsLabel = (
    requireLabel
    || ps.certainty === 'unknown'
    || PRESENTATION_LABEL_REQUIRED_FRESHNESS.includes(ps.freshness)
    || PRESENTATION_LABEL_REQUIRED_AVAILABILITY.includes(ps.availability)
  )
  if (needsLabel && !isNonEmptyString(ps.label)) {
    return {
      ok: false,
      code: 'MISSING_PRESENTATION_LABEL',
      message: 'presentation_state requires a non-empty plain-language label for unknown/degraded/non-ready states.',
    }
  }
  if (ps.label !== undefined && ps.label !== null && !isNonEmptyString(ps.label)) {
    return {
      ok: false,
      code: 'INVALID_PRESENTATION_LABEL',
      message: 'presentation_state.label must be a non-empty trimmed string when provided.',
    }
  }
  if (ps.ariaLabel !== undefined && ps.ariaLabel !== null && !isNonEmptyString(ps.ariaLabel)) {
    return {
      ok: false,
      code: 'INVALID_PRESENTATION_ARIA_LABEL',
      message: 'presentation_state.ariaLabel must be a non-empty trimmed string when provided.',
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// evaluation-scorecard@1.0.0 Validator
// ---------------------------------------------------------------------------
export function validateEvaluationScorecard(card) {
  if (!isPlainObject(card)) {
    return { ok: false, code: 'INVALID_SCORECARD_OBJECT', message: 'EvaluationScorecard must be an object.' }
  }
  if (card.schema_version !== WAVE5_SCORECARD_SCHEMA) {
    return { ok: false, code: 'INVALID_SCHEMA_VERSION', message: `Expected ${WAVE5_SCORECARD_SCHEMA}.` }
  }
  if (card.contract_version !== WAVE5_CONTRACT_VERSION) {
    return { ok: false, code: 'INVALID_CONTRACT_VERSION', message: `Expected contract_version ${WAVE5_CONTRACT_VERSION}.` }
  }
  if (card.execution_capability !== false) {
    return { ok: false, code: 'EXECUTION_CAPABILITY_TAMPER', message: 'HARD REJECT: execution_capability must be strictly false.' }
  }
  if (!isStrictNonNegativeInt(card.order_send_count) || card.order_send_count !== 0) {
    return { ok: false, code: 'ORDER_SEND_COUNT_TAMPER', message: 'HARD REJECT: order_send_count must be strictly 0.' }
  }
  if (!isStrictNonNegativeInt(card.holdout_rows_analysed) || card.holdout_rows_analysed !== 0) {
    return { ok: false, code: 'HOLDOUT_LEAK_DETECTED', message: 'HARD REJECT: holdout_rows_analysed must be strictly 0.' }
  }
  if (!isNonEmptyString(card.record_id) || !isNonEmptyString(card.taxonomy_version) || !SHA256_HEX_RE.test(String(card.taxonomy_sha256 || ''))) {
    return { ok: false, code: 'MISSING_PROVENANCE_METADATA', message: 'Scorecard missing record_id, taxonomy_version, or valid taxonomy_sha256.' }
  }
  if (!DOMAIN_TIERS.includes(card.domain_tier)) {
    return { ok: false, code: 'INVALID_DOMAIN_TIER', message: `Unknown domain_tier: ${String(card.domain_tier)}.` }
  }
  if (!EVAL_SCOPES.includes(card.eval_scope)) {
    return { ok: false, code: 'INVALID_EVAL_SCOPE', message: `Unknown eval_scope: ${String(card.eval_scope)}.` }
  }
  if (!PRICING_REGIMES.includes(card.pricing_regime)) {
    return { ok: false, code: 'INVALID_PRICING_REGIME', message: `Unknown pricing_regime: ${String(card.pricing_regime)}.` }
  }
  if (!EVIDENCE_STAGES.includes(card.evidence_stage)) {
    return { ok: false, code: 'INVALID_EVIDENCE_STAGE', message: `Unknown evidence_stage: ${String(card.evidence_stage)}.` }
  }
  if (!DATA_RESOLUTIONS.includes(card.data_resolution)) {
    return { ok: false, code: 'INVALID_DATA_RESOLUTION', message: `Unknown data_resolution: ${String(card.data_resolution)}.` }
  }
  if (!isNonEmptyString(card.resolution_label_vi) || !isNonEmptyString(card.execution_status)) {
    return { ok: false, code: 'MISSING_RESOLUTION_OR_EXECUTION_LABEL', message: 'resolution_label_vi and execution_status must be non-empty.' }
  }
  if (card.risk_spectrum_tier !== null && card.risk_spectrum_tier !== undefined && !RISK_SPECTRUM_TIERS.includes(card.risk_spectrum_tier)) {
    return { ok: false, code: 'INVALID_RISK_SPECTRUM_TIER', message: `Unknown risk_spectrum_tier: ${String(card.risk_spectrum_tier)}.` }
  }
  if (!GRADE_BANDS.includes(card.unified_grade_code) || !GRADE_BANDS.includes(card.overall_grade)) {
    return { ok: false, code: 'INVALID_GRADE_BAND', message: 'Invalid unified_grade_code or overall_grade.' }
  }
  if (!isNonEmptyString(card.overall_grade_vi) || !isNonEmptyString(card.gap_to_top_1_pct_vi)) {
    return { ok: false, code: 'MISSING_GRADE_EXPLANATION', message: 'overall_grade_vi and gap_to_top_1_pct_vi must be non-empty.' }
  }
  const rootPs = validatePresentationState(card.presentation_state, {
    requireLabel: card.overall_grade === 'UNKNOWN_LEGACY_UNINSTRUMENTED',
  })
  if (!rootPs.ok) return rootPs

  if (!isPlainObject(card.phase_grades)) {
    return { ok: false, code: 'INVALID_PHASE_GRADES', message: 'phase_grades must be an object.' }
  }
  for (const [phaseKey, detail] of Object.entries(card.phase_grades)) {
    if (!EVAL_PHASES.includes(phaseKey)) {
      return { ok: false, code: 'UNKNOWN_PHASE_KEY', message: `Unknown phase key: ${phaseKey}.` }
    }
    if (!isPlainObject(detail) || detail.phase !== phaseKey) {
      return { ok: false, code: 'INVALID_PHASE_DETAIL', message: `Phase detail mismatch for ${phaseKey}.` }
    }
    if (!GRADE_BANDS.includes(detail.grade) || !isNonEmptyString(detail.grade_vi)) {
      return { ok: false, code: 'INVALID_PHASE_GRADE', message: `Invalid grade for phase ${phaseKey}.` }
    }
    const psCheck = validatePresentationState(detail.presentation_state, {
      requireLabel: detail.grade === 'UNKNOWN_LEGACY_UNINSTRUMENTED',
    })
    if (!psCheck.ok) return psCheck
    if (detail.grade === 'UNKNOWN_LEGACY_UNINSTRUMENTED' && detail.presentation_state.certainty !== 'unknown') {
      return {
        ok: false,
        code: 'LEGACY_UNINSTRUMENTED_CERTAINTY_MISMATCH',
        message: `Phase ${phaseKey} UNKNOWN_LEGACY_UNINSTRUMENTED must declare certainty="unknown".`,
      }
    }
    const rates = [detail.pass_rate_pct, detail.fail_rate_pct, detail.pending_rate_pct]
    const anyRate = rates.some(r => r !== null && r !== undefined)
    if (anyRate) {
      for (const r of rates) {
        if (r !== null && r !== undefined && !isStrictFiniteReal(r, { min: 0, max: 100 })) {
          return { ok: false, code: 'POISONED_PHASE_RATE', message: `Phase ${phaseKey} has non-finite or boolean rate.` }
        }
      }
      if (rates.every(r => r !== null && r !== undefined)) {
        const pCheck = validateHorizonPartition({
          pass_pct: detail.pass_rate_pct,
          fail_pct: detail.fail_rate_pct,
          pending_pct: detail.pending_rate_pct,
        })
        if (!pCheck.ok) return pCheck
      }
    }
  }

  if (!isPlainObject(card.metric_grades) || !isPlainObject(card.metric_pass_map)) {
    return { ok: false, code: 'INVALID_METRIC_MAPS', message: 'metric_grades and metric_pass_map must be objects.' }
  }
  for (const [metricId, grade] of Object.entries(card.metric_grades)) {
    if (!GRADE_BANDS.includes(grade)) {
      return { ok: false, code: 'INVALID_METRIC_GRADE', message: `Invalid metric grade on ${metricId}.` }
    }
  }
  for (const [metricId, passed] of Object.entries(card.metric_pass_map)) {
    if (typeof passed !== 'boolean') {
      return { ok: false, code: 'INVALID_METRIC_PASS_FLAG', message: `metric_pass_map.${metricId} must be boolean.` }
    }
  }

  if (!Array.isArray(card.exact_bottlenecks)) {
    return { ok: false, code: 'INVALID_BOTTLENECKS_LIST', message: 'exact_bottlenecks must be an array.' }
  }
  for (let i = 0; i < card.exact_bottlenecks.length; i += 1) {
    const bn = card.exact_bottlenecks[i]
    if (!isPlainObject(bn)) {
      return { ok: false, code: 'INVALID_BOTTLENECK_ITEM', message: `Bottleneck[${i}] must be an object.` }
    }
    if (!isNonEmptyString(bn.code) || !isNonEmptyString(bn.metric_id) || !isNonEmptyString(bn.label_vi)) {
      return { ok: false, code: 'MISSING_BOTTLENECK_FIELDS', message: `Bottleneck[${i}] missing code, metric_id, or label_vi.` }
    }
    if (!ALL_PHASES_WITH_OVERALL.includes(bn.phase) || !GRADE_BANDS.includes(bn.target_grade)) {
      return { ok: false, code: 'INVALID_BOTTLENECK_ENUM', message: `Bottleneck[${i}] has invalid phase or target_grade.` }
    }
    if (!isStrictNonNegativeInt(bn.severity_rank) || bn.severity_rank < 1) {
      return { ok: false, code: 'INVALID_BOTTLENECK_RANK', message: `Bottleneck[${i}].severity_rank must be an integer >= 1.` }
    }
    if (bn.current_value !== null && bn.current_value !== undefined && !isStrictFiniteReal(bn.current_value)) {
      return { ok: false, code: 'POISONED_BOTTLENECK_VALUE', message: `Bottleneck[${i}].current_value must be finite real or null.` }
    }
    if (bn.target_threshold !== null && bn.target_threshold !== undefined && !isStrictFiniteReal(bn.target_threshold)) {
      return { ok: false, code: 'POISONED_BOTTLENECK_THRESHOLD', message: `Bottleneck[${i}].target_threshold must be finite real or null.` }
    }
  }

  if (card.monthly_pass_fail_pending !== null && card.monthly_pass_fail_pending !== undefined) {
    if (!isPlainObject(card.monthly_pass_fail_pending)) {
      return { ok: false, code: 'INVALID_MONTHLY_PARTITIONS', message: 'monthly_pass_fail_pending must be an object or null.' }
    }
    for (const [horizon, part] of Object.entries(card.monthly_pass_fail_pending)) {
      const check = validateHorizonPartition(part)
      if (!check.ok) {
        return { ok: false, code: check.code, message: `Horizon "${horizon}": ${check.message}` }
      }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// T5 Gambling / Research-Boundary Warning Inspector & Spectrum Row Validator
// ---------------------------------------------------------------------------
export function inspectT5Warning(row) {
  const isT5 = row?.schedule_id === 'T5_MAX_THROTTLE_YOLO'
  const tags = Array.isArray(row?.mandatory_tags) ? row.mandatory_tags.filter(t => typeof t === 'string') : []
  const missingMandatoryTags = isT5
    ? T5_MANDATORY_WARNING_TAGS.filter(tag => !tags.includes(tag))
    : []
  return {
    isT5Boundary: isT5,
    hasGamblingTag: tags.includes('FTMO_GAMBLING_ALLIN_RISK'),
    hasResearchBoundaryTag: tags.includes('RESEARCH_BOUNDARY_ONLY'),
    exceedsShieldACap: tags.includes('EXCEEDS_V103_SHIELD_A_3PCT_EVAL_CAP_RESEARCH_ONLY'),
    missingMandatoryTags,
    valid: missingMandatoryTags.length === 0,
  }
}

export function validateSpectrumRow(row) {
  if (!isPlainObject(row)) {
    return { ok: false, code: 'INVALID_SPECTRUM_ROW', message: 'Spectrum row must be an object.' }
  }
  if (!isNonEmptyString(row.contract_id) || !isNonEmptyString(row.schedule_id)) {
    return { ok: false, code: 'MISSING_SPECTRUM_KEYS', message: 'Spectrum row missing contract_id or schedule_id.' }
  }
  if (!isStrictFiniteReal(row.friction_mult, { min: 0.5, max: 5 })) {
    return { ok: false, code: 'INVALID_FRICTION_MULT', message: 'friction_mult must be a finite real number in [0.5, 5].' }
  }
  if (!GRADE_BANDS.includes(row.overall_grade)) {
    return { ok: false, code: 'INVALID_OVERALL_GRADE', message: `Unknown overall_grade: ${String(row.overall_grade)}.` }
  }
  if (!isPlainObject(row.phase_grades)) {
    return { ok: false, code: 'MISSING_PHASE_GRADES', message: 'phase_grades missing.' }
  }
  for (const ph of EVAL_PHASES) {
    if (!GRADE_BANDS.includes(row.phase_grades[ph])) {
      return { ok: false, code: 'INVALID_PHASE_GRADE', message: `Invalid phase_grades.${ph}.` }
    }
  }
  const numericFields = [
    'fn12_blowup_pct', 'uncond_med_pay1_cap730', 'cond_med_pay1_days',
    'ev_per_fee_npv24', 'ev_npv_24m_vnd', 'p_npv24_le_0_pct',
    'winrate_pct', 'avg_rr', 'pf', 'max_dd_pct', 'sharpe', 'calmar',
  ]
  for (const field of numericFields) {
    if (!isStrictFiniteReal(row[field])) {
      return { ok: false, code: 'POISONED_NUMERIC_METRIC', message: `Metric ${field} must be a finite real number.` }
    }
  }
  const p1Check = validateHorizonPartition({
    pass_pct: row.p1_pass_12m_pct,
    fail_pct: row.p1_fail_12m_pct,
    pending_pct: row.p1_pending_12m_pct,
  })
  if (!p1Check.ok) return { ok: false, code: p1Check.code, message: `P1 partition: ${p1Check.message}` }

  const p2Check = validateHorizonPartition({
    pass_pct: row.p2_pass_12m_pct,
    fail_pct: row.p2_fail_12m_pct,
    pending_pct: row.p2_pending_12m_pct,
  })
  if (!p2Check.ok) return { ok: false, code: p2Check.code, message: `P2 partition: ${p2Check.message}` }

  const evalCheck = validateHorizonPartition({
    pass_pct: row.pass_eval_12m_pct,
    fail_pct: row.fail_eval_12m_pct,
    pending_pct: row.pending_eval_12m_pct,
  })
  if (!evalCheck.ok) return { ok: false, code: evalCheck.code, message: `Eval P1+P2 partition: ${evalCheck.message}` }

  const t5Check = inspectT5Warning(row)
  if (!t5Check.valid) {
    return {
      ok: false,
      code: 'T5_MANDATORY_WARNING_MISSING',
      message: `T5_MAX_THROTTLE_YOLO missing mandatory warning tags: ${t5Check.missingMandatoryTags.join(', ')}.`,
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Build Schema-Valid evaluation-scorecard@1.0.0 from a Spectrum Row
// ---------------------------------------------------------------------------
export function buildScorecardFromSpectrumRow(row, meta = {}) {
  const checked = validateSpectrumRow(row)
  if (!checked.ok) return { ok: false, code: checked.code, message: checked.message }

  const schedMeta = SCHEDULE_DISPLAY_META[row.schedule_id] || { tier: null }
  const overallMeta = GRADE_META[row.overall_grade] || GRADE_META.BAD
  const readyPs = { availability: 'ready', freshness: 'current', certainty: 'known', label: null, ariaLabel: null, reasonCode: null }

  const makePhase = (phase, grade, passPct = null, failPct = null, pendingPct = null) => {
    const gMeta = GRADE_META[grade] || GRADE_META.BAD
    const isUnknown = grade === 'UNKNOWN_LEGACY_UNINSTRUMENTED'
    return {
      phase,
      grade,
      grade_vi: gMeta.vi,
      presentation_state: isUnknown
        ? {
            availability: 'ready',
            freshness: 'partial',
            certainty: 'unknown',
            reasonCode: 'legacy_uninstrumented',
            label: LEGACY_W4_P1_P2_LABEL_VI,
            ariaLabel: LEGACY_W4_P1_P2_LABEL_VI,
          }
        : readyPs,
      metric_grades: {},
      pass_rate_pct: passPct,
      fail_rate_pct: failPct,
      pending_rate_pct: pendingPct,
      bottlenecks: [],
    }
  }

  const bottlenecks = (Array.isArray(row.top_bottlenecks) ? row.top_bottlenecks : []).map((code, idx) => {
    const bnMeta = BOTTLENECK_META[code] || { metric_id: 'overall', phase: 'overall_36m', vi: code, en: code }
    let currentValue = null
    if (code === 'PAYOUT_1_SLOW') currentValue = row.uncond_med_pay1_cap730
    else if (code === 'P_LE_ZERO_24M_HIGH') currentValue = row.p_npv24_le_0_pct
    else if (code === 'PASS_EVAL_RATE_LOW') currentValue = row.pass_eval_12m_pct
    else if (code === 'FUNDED_12M_BLOWUP_HIGH') currentValue = row.fn12_blowup_pct
    else if (code === 'EV_PER_FEE_BELOW_TARGET') currentValue = row.ev_per_fee_npv24
    return {
      code,
      metric_id: bnMeta.metric_id,
      phase: bnMeta.phase,
      current_value: currentValue,
      target_threshold: null,
      target_grade: 'TOP_1_PCT',
      severity_rank: idx + 1,
      label_vi: bnMeta.vi,
    }
  })

  const gapText = bottlenecks.length
    ? bottlenecks.map(b => `${b.code}: ${b.label_vi}`).join(' · ')
    : 'Cần xác thực thêm trên Holdout 2025+ niêm phong và Demo/Live thực địa.'

  const card = {
    schema_version: WAVE5_SCORECARD_SCHEMA,
    contract_version: WAVE5_CONTRACT_VERSION,
    taxonomy_version: meta.taxonomy_version || 'naqex-ssot-evaluation-taxonomy-v1',
    taxonomy_sha256: meta.taxonomy_sha256 || '2cda67d72328d1e7f136dc1650c77e07082050497b2a9acb1a1af49ebc8209ff',
    record_id: `${row.contract_id}__${row.schedule_id}__${row.friction_mult}x`,
    domain_tier: 'T1_CFD_PROP',
    eval_scope: 'SINGLE_TICKET',
    pricing_regime: 'ALL_REGULAR_SSOT',
    evidence_stage: 'DEV_CONSUMED_OOS',
    data_resolution: 'APPROX_DAILY',
    resolution_label_vi: 'XẤP XỈ CẤP NGÀY',
    execution_status: 'TERMS_VERIFIED_EXECUTION_UNMEASURED',
    risk_spectrum_tier: schedMeta.tier || null,
    legacy_grade_code: null,
    unified_grade_code: row.overall_grade,
    overall_grade: row.overall_grade,
    overall_grade_vi: overallMeta.vi,
    presentation_state: readyPs,
    phase_grades: {
      p1: makePhase('p1', row.phase_grades.p1, row.p1_pass_12m_pct, row.p1_fail_12m_pct, row.p1_pending_12m_pct),
      p2: makePhase('p2', row.phase_grades.p2, row.p2_pass_12m_pct, row.p2_fail_12m_pct, row.p2_pending_12m_pct),
      pass_eval: makePhase('pass_eval', row.phase_grades.pass_eval, row.pass_eval_12m_pct, row.fail_eval_12m_pct, row.pending_eval_12m_pct),
      funded_12m: makePhase('funded_12m', row.phase_grades.funded_12m),
    },
    metric_grades: {
      p1_pass_rate: row.phase_grades.p1,
      p2_pass_rate: row.phase_grades.p2,
      pass_eval_rate: row.phase_grades.pass_eval,
      funded_12m_blowup: row.phase_grades.funded_12m,
    },
    metric_pass_map: {
      p1_pass_rate: row.phase_grades.p1 === 'GOOD' || row.phase_grades.p1 === 'TOP_1_PCT',
      p2_pass_rate: row.phase_grades.p2 === 'GOOD' || row.phase_grades.p2 === 'TOP_1_PCT',
      pass_eval_rate: row.phase_grades.pass_eval === 'GOOD' || row.phase_grades.pass_eval === 'TOP_1_PCT',
      funded_12m_blowup: row.phase_grades.funded_12m === 'GOOD' || row.phase_grades.funded_12m === 'TOP_1_PCT',
    },
    exact_bottlenecks: bottlenecks,
    monthly_pass_fail_pending: {
      p1_12m: { pass_pct: row.p1_pass_12m_pct, fail_pct: row.p1_fail_12m_pct, pending_pct: row.p1_pending_12m_pct },
      p2_12m: { pass_pct: row.p2_pass_12m_pct, fail_pct: row.p2_fail_12m_pct, pending_pct: row.p2_pending_12m_pct },
      eval_12m: { pass_pct: row.pass_eval_12m_pct, fail_pct: row.fail_eval_12m_pct, pending_pct: row.pending_eval_12m_pct },
    },
    gap_to_top_1_pct_vi: gapText,
    holdout_rows_analysed: WAVE5_HOLDOUT_ROWS_ANALYSED,
    order_send_count: WAVE5_ORDER_SEND_COUNT,
    execution_capability: WAVE5_EXECUTION_CAPABILITY,
  }

  const cardCheck = validateEvaluationScorecard(card)
  if (!cardCheck.ok) return cardCheck
  return { ok: true, scorecard: card }
}

// ---------------------------------------------------------------------------
// Alpha Factory & Alpha Bench Fail-Closed Snapshot Validator
// ---------------------------------------------------------------------------
export function validateAlphaBenchSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) {
    return { ok: false, code: 'INVALID_ALPHA_SNAPSHOT', message: 'Alpha Bench snapshot must be an object.' }
  }
  const inv = snapshot.hard_invariants
  if (!isPlainObject(inv)) {
    return { ok: false, code: 'MISSING_HARD_INVARIANTS', message: 'Missing hard_invariants.' }
  }
  if (inv.execution_capability !== false || inv.order_send_capable !== false || inv.order_send_count !== 0) {
    return { ok: false, code: 'ORDER_SEND_CAPABLE_TAMPER', message: 'HARD REJECT: execution/order_send locks must remain false/0.' }
  }
  if (inv.auto_deploy_permitted !== false) {
    return { ok: false, code: 'AUTO_DEPLOY_LOCK_VIOLATION', message: 'HARD REJECT: auto_deploy_permitted must be strictly false.' }
  }
  if (!isStrictNonNegativeInt(inv.holdout_rows_analysed) || inv.holdout_rows_analysed !== 0) {
    return { ok: false, code: 'HOLDOUT_LEAK_DETECTED', message: 'HARD REJECT: holdout_rows_analysed must be strictly 0.' }
  }
  if (!Array.isArray(snapshot.core_7e_engines) || snapshot.core_7e_engines.length !== 7) {
    return { ok: false, code: 'INVALID_CORE7_COUNT', message: 'Expected exactly 7 active PORT_7E core engines.' }
  }
  for (const eng of snapshot.core_7e_engines) {
    if (
      !isStrictFiniteReal(eng.base_risk_pct, { min: 0, max: 10 })
      || !isStrictFiniteReal(eng.cluster_b_sharpe)
      || !isStrictFiniteReal(eng.drill3_cusum_cur_neg)
      || !isStrictFiniteReal(eng.drill3_cone_pct_rank, { min: 0, max: 100 })
    ) {
      return { ok: false, code: 'POISONED_ENGINE_TELEMETRY', message: `Engine ${String(eng?.engine_id)} has invalid numeric telemetry.` }
    }
  }
  if (!Array.isArray(snapshot.e2e_drills) || snapshot.e2e_drills.length !== 5) {
    return { ok: false, code: 'INVALID_DRILL_COUNT', message: 'Expected exactly 5 Alpha Factory E2E drills.' }
  }
  if (!Array.isArray(snapshot.proposals) || snapshot.proposals.length < 1) {
    return { ok: false, code: 'MISSING_PROPOSAL_PREVIEW', message: 'Expected at least 1 read-only governance proposal preview.' }
  }
  for (const prop of snapshot.proposals) {
    if (prop.auto_deploy_permitted !== false || prop.auto_deployed !== false || prop.approval_required !== true || prop.order_send_count !== 0) {
      return { ok: false, code: 'PROPOSAL_AUTO_DEPLOY_TAMPER', message: `Proposal ${String(prop?.proposal_id)} violated auto_deploy=false governance lock.` }
    }
    if (prop.draft_set_diff?.dry_run_locked_true !== true || prop.draft_set_diff?.guard_dry_run_locked_true !== true) {
      return { ok: false, code: 'DRY_RUN_LOCK_VIOLATION', message: `Proposal ${String(prop?.proposal_id)} must keep InpDryRunLogOnly=true and InpGuardDryRunLogOnly=true.` }
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Formatting Helpers (Zero bare dollar '$', strict '—' on null/NaN/bool)
// ---------------------------------------------------------------------------
export function formatWave5Pct(value, digits = 2) {
  if (!isStrictFiniteReal(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function formatWave5Number(value, digits = 2) {
  if (!isStrictFiniteReal(value)) return '—'
  return value.toFixed(digits)
}

export function formatWave5Usd(value, locale = 'vi-VN', digits = 0) {
  if (!isStrictFiniteReal(value)) return '—'
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
  return `${formatted} USD`
}

export function formatWave5Vnd(value, locale = 'vi-VN') {
  if (!isStrictFiniteReal(value)) return '—'
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(Math.round(value))
  return `${formatted} VND`
}

export function formatWave5CompactVnd(value, language = 'vi') {
  if (!isStrictFiniteReal(value)) return '—'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e9) {
    const unit = language === 'en' ? 'B VND' : 'tỷ VND'
    return `${sign}${(abs / 1e9).toFixed(2)} ${unit}`
  }
  if (abs >= 1e6) {
    const unit = language === 'en' ? 'M VND' : 'tr VND'
    return `${sign}${(abs / 1e6).toFixed(1)} ${unit}`
  }
  return `${sign}${Math.round(abs)} VND`
}

export function gradeTone(grade) {
  return (GRADE_META[grade] || GRADE_META.UNKNOWN_LEGACY_UNINSTRUMENTED).tone
}

export function gradePinPercent(grade) {
  return (GRADE_META[grade] || GRADE_META.UNKNOWN_LEGACY_UNINSTRUMENTED).pinPct
}

export function gradeLabel(grade, language = 'vi') {
  const meta = GRADE_META[grade] || GRADE_META.UNKNOWN_LEGACY_UNINSTRUMENTED
  return language === 'en' ? meta.en : meta.vi
}

export function bottleneckLabel(code, language = 'vi') {
  const meta = BOTTLENECK_META[code]
  if (!meta) return String(code || '—')
  return language === 'en' ? meta.en : meta.vi
}
