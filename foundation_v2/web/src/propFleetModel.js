/**
 * Pure client-side Prop Fleet Lifecycle FSM (`S0..S7`), Fleet Guards (`E1..E6`),
 * fail-closed JSON Import/Export, and `localStorage` draft persistence.
 *
 * HARD SAFETY INVARIANTS:
 * - Zero broker/API/network calls (`ORDER_SEND_CAPABLE === false`, `ORDER_SEND_COUNT === 0`)
 * - Holdout 2025+ sealed (`HOLDOUT_CUTOFF_DATE === '2024-12-31'`, `HOLDOUT_ROWS_ANALYSED === 0`)
 * - Fail-closed on bool/NaN/Infinity/negative numerics, Eval `.set` on Funded `S4->S5`,
 *   non-zero `open_positions` on flat handoffs, and tampered imports.
 */

export const SCHEMA_VERSION = 'naqex-prop-fleet-ledger-v1'
export const PARETO_SUMMARY_SCHEMAS = Object.freeze([
  'naqex-wave4-pareto-summary-v1',
  'naqex-wave4-pareto-81cases-10k-v1',
])

export const ORDER_SEND_CAPABLE = false
export const ORDER_SEND_COUNT = 0
export const HOLDOUT_CUTOFF_DATE = '2024-12-31'
export const HOLDOUT_ROWS_ANALYSED = 0

export const GENESIS_EVENT_SHA256 = '0'.repeat(64)
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/
export const EVAL_PRESET_NAME_RE = /(?:^|[_\-\s.])(EVAL|P1|P2|PHASE1|PHASE2|SPRINT|CHALLENGE|VERIFY|VERIFICATION)(?:$|[_\-\s.])/i

export const PRESET_MODE_NONE = 'NONE'
export const PRESET_MODE_EVAL_P1_SPRINT = 'EVAL_P1_SPRINT_4_5X'
export const PRESET_MODE_EVAL_P2_SPRINT = 'EVAL_P2_SPRINT_3_5X'
export const PRESET_MODE_FUNDED_1X = 'FUNDED_1X'

export const VALID_EVAL_P1_PRESET_MODES = Object.freeze([
  'EVAL_P1_SPRINT_4_5X',
  'EVAL_P1_SPRINT_4X',
  'EVAL_P1_BALANCED_3X',
])
export const VALID_EVAL_P2_PRESET_MODES = Object.freeze([
  'EVAL_P2_SPRINT_3_5X',
  'EVAL_P2_VERIFY_2X',
])
export const VALID_PRESET_MODES = Object.freeze([
  PRESET_MODE_NONE,
  PRESET_MODE_FUNDED_1X,
  ...VALID_EVAL_P1_PRESET_MODES,
  ...VALID_EVAL_P2_PRESET_MODES,
])
export const VALID_TRAFFIC_LIGHTS = Object.freeze(['GREEN', 'AMBER', 'RED'])
export const VALID_OPS6_BREACH_CLASSES = Object.freeze(['BOT_BUG', 'SLIPPAGE', 'VARIANCE'])

export const FTMO_MAX_ACTIVE_FUNDED_USD = 400000
export const FTMO_MAX_SINGLE_CHALLENGE_USD = 200000
export const FTMO_SCALING_PLAN = Object.freeze({
  step_pct: 25,
  min_months: 4,
  min_net_return_pct: 10,
  min_payout_cycles: 2,
  max_allocation_usd: 2000000,
  upgraded_split_frac: 0.9,
})

export const E1_WINDOW_DAYS = 30
export const E1_BLOCK_FAILS = 2
export const E2_AMBER_DD_PCT = 3.5
export const E2_RED_DD_PCT = 6.0
export const E6_INACTIVITY_AMBER_DAYS = 21
export const E6_INACTIVITY_RED_DAYS = 27
export const E6_INACTIVITY_LOCK_DAYS = 30
export const E6_NTP_MAX_OFFSET_MS = 1000
export const E6_MAX_HEARTBEAT_AGE_SEC = 180
export const VPS_DEFAULT_BUDGET = Object.freeze({
  max_cpu_util_pct: 75,
  min_free_ram_gb: 2.0,
  max_mt5_terminals: 6,
  min_disk_c_free_gb: 20.0,
})

export const CANONICAL_STATES = Object.freeze([
  'S0_PRE_CHALLENGE',
  'S1_CHALLENGE_P1',
  'S2_PASS_P1_HANDOFF',
  'S3_CHALLENGE_P2',
  'S4_PASS_P2_TO_FUNDED_LOCK',
  'S5_FUNDED_ACTIVE',
  'S6_PAYOUT_AUDIT_AND_HARVEST',
  'S7_AFTER_PAYOUT_ALLOCATOR',
])

export const INCIDENT_TERMINAL_STATES = Object.freeze([
  'E1_EVAL_FAIL_COOLDOWN',
  'E2_FUNDED_DD_FREEZE',
  'E3_FUNDED_BREACH_POSTMORTEM',
  'CLOSED_ARCHIVED',
])

export const ALL_STATES = Object.freeze([...CANONICAL_STATES, ...INCIDENT_TERMINAL_STATES])

export const FORWARD_TRANSITIONS = Object.freeze([
  ['S0_PRE_CHALLENGE', 'S1_CHALLENGE_P1'],
  ['S1_CHALLENGE_P1', 'S2_PASS_P1_HANDOFF'],
  ['S2_PASS_P1_HANDOFF', 'S3_CHALLENGE_P2'],
  ['S3_CHALLENGE_P2', 'S4_PASS_P2_TO_FUNDED_LOCK'],
  ['S4_PASS_P2_TO_FUNDED_LOCK', 'S5_FUNDED_ACTIVE'],
  ['S5_FUNDED_ACTIVE', 'S6_PAYOUT_AUDIT_AND_HARVEST'],
  ['S6_PAYOUT_AUDIT_AND_HARVEST', 'S7_AFTER_PAYOUT_ALLOCATOR'],
])

export const ALLOWED_TRANSITIONS = Object.freeze({
  S0_PRE_CHALLENGE: Object.freeze(['S1_CHALLENGE_P1', 'CLOSED_ARCHIVED']),
  S1_CHALLENGE_P1: Object.freeze(['S2_PASS_P1_HANDOFF', 'E1_EVAL_FAIL_COOLDOWN']),
  S2_PASS_P1_HANDOFF: Object.freeze(['S3_CHALLENGE_P2', 'CLOSED_ARCHIVED']),
  S3_CHALLENGE_P2: Object.freeze(['S4_PASS_P2_TO_FUNDED_LOCK', 'E1_EVAL_FAIL_COOLDOWN']),
  S4_PASS_P2_TO_FUNDED_LOCK: Object.freeze(['S5_FUNDED_ACTIVE', 'CLOSED_ARCHIVED']),
  S5_FUNDED_ACTIVE: Object.freeze(['S6_PAYOUT_AUDIT_AND_HARVEST', 'E2_FUNDED_DD_FREEZE', 'E3_FUNDED_BREACH_POSTMORTEM']),
  S6_PAYOUT_AUDIT_AND_HARVEST: Object.freeze(['S7_AFTER_PAYOUT_ALLOCATOR', 'E2_FUNDED_DD_FREEZE', 'E3_FUNDED_BREACH_POSTMORTEM']),
  S7_AFTER_PAYOUT_ALLOCATOR: Object.freeze(['S5_FUNDED_ACTIVE', 'S0_PRE_CHALLENGE', 'CLOSED_ARCHIVED']),
  E1_EVAL_FAIL_COOLDOWN: Object.freeze(['S0_PRE_CHALLENGE', 'CLOSED_ARCHIVED']),
  E2_FUNDED_DD_FREEZE: Object.freeze(['S5_FUNDED_ACTIVE', 'E3_FUNDED_BREACH_POSTMORTEM', 'CLOSED_ARCHIVED']),
  E3_FUNDED_BREACH_POSTMORTEM: Object.freeze(['CLOSED_ARCHIVED']),
  CLOSED_ARCHIVED: Object.freeze([]),
})

export const FLAT_REQUIRED_EDGES = new Set([
  'S1_CHALLENGE_P1->S2_PASS_P1_HANDOFF',
  'S2_PASS_P1_HANDOFF->S3_CHALLENGE_P2',
  'S3_CHALLENGE_P2->S4_PASS_P2_TO_FUNDED_LOCK',
  'S4_PASS_P2_TO_FUNDED_LOCK->S5_FUNDED_ACTIVE',
  'S5_FUNDED_ACTIVE->S6_PAYOUT_AUDIT_AND_HARVEST',
  'S6_PAYOUT_AUDIT_AND_HARVEST->S7_AFTER_PAYOUT_ALLOCATOR',
  'S7_AFTER_PAYOUT_ALLOCATOR->S5_FUNDED_ACTIVE',
  'S7_AFTER_PAYOUT_ALLOCATOR->S0_PRE_CHALLENGE',
  'E2_FUNDED_DD_FREEZE->S5_FUNDED_ACTIVE',
])

export const FUNDED_ENTRY_EDGES = new Set([
  'S4_PASS_P2_TO_FUNDED_LOCK->S5_FUNDED_ACTIVE',
  'S7_AFTER_PAYOUT_ALLOCATOR->S5_FUNDED_ACTIVE',
  'E2_FUNDED_DD_FREEZE->S5_FUNDED_ACTIVE',
])

export const STATE_TONES = Object.freeze({
  S0_PRE_CHALLENGE: 'neutral',
  S1_CHALLENGE_P1: 'info',
  S2_PASS_P1_HANDOFF: 'info',
  S3_CHALLENGE_P2: 'info',
  S4_PASS_P2_TO_FUNDED_LOCK: 'warning',
  S5_FUNDED_ACTIVE: 'success',
  S6_PAYOUT_AUDIT_AND_HARVEST: 'info',
  S7_AFTER_PAYOUT_ALLOCATOR: 'success',
  E1_EVAL_FAIL_COOLDOWN: 'warning',
  E2_FUNDED_DD_FREEZE: 'danger',
  E3_FUNDED_BREACH_POSTMORTEM: 'danger',
  CLOSED_ARCHIVED: 'neutral',
})

export const STATE_SHORT_META = Object.freeze({
  S0_PRE_CHALLENGE: { code: 'S0', vi: 'Chờ mở vé', en: 'Pre-Challenge' },
  S1_CHALLENGE_P1: { code: 'S1', vi: 'Thi P1', en: 'Phase 1' },
  S2_PASS_P1_HANDOFF: { code: 'S2', vi: 'Đậu P1', en: 'P1 Handoff' },
  S3_CHALLENGE_P2: { code: 'S3', vi: 'Thi P2', en: 'Phase 2' },
  S4_PASS_P2_TO_FUNDED_LOCK: { code: 'S4', vi: 'Khóa Funded', en: 'Funded Lock' },
  S5_FUNDED_ACTIVE: { code: 'S5', vi: 'Funded 1.0x', en: 'Funded Active' },
  S6_PAYOUT_AUDIT_AND_HARVEST: { code: 'S6', vi: 'Kiểm toán rút', en: 'Payout Audit' },
  S7_AFTER_PAYOUT_ALLOCATOR: { code: 'S7', vi: 'Phân bổ 3 giỏ', en: '3-Bucket Alloc' },
  E1_EVAL_FAIL_COOLDOWN: { code: 'E1', vi: 'Rớt Eval', en: 'Eval Cooldown' },
  E2_FUNDED_DD_FREEZE: { code: 'E2', vi: 'Đóng băng DD', en: 'DD Freeze' },
  E3_FUNDED_BREACH_POSTMORTEM: { code: 'E3', vi: 'Vi phạm Funded', en: 'Breach Audit' },
  CLOSED_ARCHIVED: { code: 'CL', vi: 'Đã lưu trữ', en: 'Archived' },
})

const ACTIVE_EVAL_STATES = new Set(['S1_CHALLENGE_P1', 'S3_CHALLENGE_P2'])
const ACTIVE_FUNDED_STATES = new Set(['S5_FUNDED_ACTIVE', 'S6_PAYOUT_AUDIT_AND_HARVEST', 'S7_AFTER_PAYOUT_ALLOCATOR'])
const COMMITTED_FUNDED_CAP_STATES = new Set(['S4_PASS_P2_TO_FUNDED_LOCK', 'S5_FUNDED_ACTIVE', 'S6_PAYOUT_AUDIT_AND_HARVEST', 'S7_AFTER_PAYOUT_ALLOCATOR', 'E2_FUNDED_DD_FREEZE'])
const LIVE_RUNNING_STATES = new Set(['S1_CHALLENGE_P1', 'S3_CHALLENGE_P2', 'S5_FUNDED_ACTIVE', 'S6_PAYOUT_AUDIT_AND_HARVEST'])
const OCCUPYING_SLOT_STATES = new Set(['S1_CHALLENGE_P1', 'S2_PASS_P1_HANDOFF', 'S3_CHALLENGE_P2', 'S4_PASS_P2_TO_FUNDED_LOCK', 'S5_FUNDED_ACTIVE', 'S6_PAYOUT_AUDIT_AND_HARVEST', 'S7_AFTER_PAYOUT_ALLOCATOR', 'E2_FUNDED_DD_FREEZE'])

// ---------------------------------------------------------------------------
// Deterministic Pure-JS SHA-256 (FIPS 180-4, zero external dependencies)
// ---------------------------------------------------------------------------
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input))
  const bitLen = bytes.length * 8
  const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6)
  const buf = new Uint8Array(paddedLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(n => n.toString(16).padStart(8, '0')).join('')
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

export function canonicalPayloadSha256(payload) {
  const clone = { ...payload }
  delete clone.report_sha256
  return sha256Hex(canonicalJson(clone))
}

// ---------------------------------------------------------------------------
// Strict Primitive Validators (Zero bool/NaN/Infinity/negative Fail-Open)
// ---------------------------------------------------------------------------
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isStrictFiniteNumber(value, { min = null, max = null, strictlyPositive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (strictlyPositive && value <= 0) return false
  if (min !== null && value < min) return false
  if (max !== null && value > max) return false
  return true
}

export function isStrictNonNegativeInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function isValidSha256Hex(value) {
  return typeof value === 'string' && SHA256_HEX_RE.test(value)
}

export function computeInactivityStatus(days) {
  if (!isStrictFiniteNumber(days, { min: 0 })) return 'UNKNOWN'
  if (days >= E6_INACTIVITY_LOCK_DAYS) return 'EXPIRED'
  if (days >= E6_INACTIVITY_RED_DAYS) return 'RED'
  if (days >= E6_INACTIVITY_AMBER_DAYS) return 'AMBER'
  return 'GREEN'
}

export function normalizeFirmKey(firm) {
  const raw = String(firm || '').trim().toLowerCase()
  if (raw.startsWith('ftmo')) return 'ftmo'
  if (raw.includes('5ers') || raw.includes('the5ers')) return 'the5ers'
  if (raw.includes('ic_funded') || raw.includes('icfunded') || raw.includes('ic funded')) return 'ic_funded'
  return raw
}

function normalizeSymbolRoot(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(CASH|PRO|RAW|ECN|M|MICRO|STD)$/, '')
}

function normalizeDirection(value) {
  if (typeof value === 'boolean' || value == null) return null
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return value > 0 ? 'BUY' : 'SELL'
  if (typeof value === 'string') {
    const up = value.trim().toUpperCase()
    if (['BUY', 'LONG', '+1', '1', 'B'].includes(up)) return 'BUY'
    if (['SELL', 'SHORT', '-1', 'S'].includes(up)) return 'SELL'
  }
  return null
}

function normalizePortableDir(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let norm = trimmed.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  if (norm.length > 3) norm = norm.replace(/\\+$/, '')
  return norm.toLowerCase()
}

function formatUtcIso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (!Number.isFinite(d.getTime())) return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parseUtcMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

// ---------------------------------------------------------------------------
// Fail-Closed Ledger Validator (Import & localStorage Draft Verification)
// ---------------------------------------------------------------------------
export function validateFleetLedger(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'INVALID_JSON_OBJECT', message: 'Ledger payload must be a JSON object.' }
  }
  if (raw.schema_version !== SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'INVALID_SCHEMA_VERSION',
      message: `Expected schema_version "${SCHEMA_VERSION}", got "${String(raw.schema_version)}".`,
    }
  }
  if (raw.order_send_capable !== false) {
    return {
      ok: false,
      code: 'ORDER_SEND_CAPABLE_TAMPER',
      message: 'HARD REJECT: order_send_capable must be strictly false.',
    }
  }
  if (!isStrictNonNegativeInt(raw.order_send_count) || raw.order_send_count !== 0) {
    return {
      ok: false,
      code: 'ORDER_SEND_CAPABLE_TAMPER',
      message: 'HARD REJECT: order_send_count must be strictly 0.',
    }
  }
  if (!isStrictNonNegativeInt(raw.holdout_rows_analysed) || raw.holdout_rows_analysed !== 0) {
    return {
      ok: false,
      code: 'HOLDOUT_LEAK_DETECTED',
      message: 'HARD REJECT: holdout_rows_analysed must be strictly 0 (Holdout 2025+ sealed).',
    }
  }
  if (!Array.isArray(raw.accounts)) {
    return { ok: false, code: 'INVALID_ACCOUNTS_LIST', message: 'accounts must be an array.' }
  }
  if (!Array.isArray(raw.transitions)) {
    return { ok: false, code: 'INVALID_TRANSITIONS_LIST', message: 'transitions must be an array.' }
  }

  const seenIds = new Set()
  const stateSet = new Set(ALL_STATES)
  for (let i = 0; i < raw.accounts.length; i += 1) {
    const acct = raw.accounts[i]
    if (!isPlainObject(acct)) {
      return { ok: false, code: 'INVALID_ACCOUNT_RECORD', message: `Account at index ${i} must be an object.` }
    }
    const id = typeof acct.account_id === 'string' ? acct.account_id.trim() : ''
    if (!id) {
      return { ok: false, code: 'MISSING_ACCOUNT_ID', message: `Account at index ${i} is missing account_id.` }
    }
    if (seenIds.has(id)) {
      return { ok: false, code: 'DUPLICATE_ACCOUNT_ID', message: `Duplicate account_id detected: ${id}.` }
    }
    seenIds.add(id)

    if (!stateSet.has(acct.state)) {
      return { ok: false, code: 'UNKNOWN_ACCOUNT_STATE', message: `Account ${id} has unknown state: ${String(acct.state)}.` }
    }
    if (!isStrictFiniteNumber(acct.capital_usd, { strictlyPositive: true })) {
      return { ok: false, code: 'INVALID_NUMERIC_FIELD', message: `Account ${id} has invalid capital_usd.` }
    }
    for (const field of ['equity_usd', 'balance_usd', 'ticket_fee_usd']) {
      if (!isStrictFiniteNumber(acct[field], { min: 0 })) {
        return { ok: false, code: 'INVALID_NUMERIC_FIELD', message: `Account ${id} has invalid ${field}.` }
      }
    }
    for (const field of ['daily_dd_pct', 'static_dd_pct']) {
      if (!isStrictFiniteNumber(acct[field], { min: 0, max: 100 })) {
        return { ok: false, code: 'INVALID_NUMERIC_FIELD', message: `Account ${id} has invalid ${field}.` }
      }
    }
    if (!isStrictNonNegativeInt(acct.open_positions)) {
      return { ok: false, code: 'INVALID_OPEN_POSITIONS', message: `Account ${id} open_positions must be a non-negative integer.` }
    }
    if (typeof acct.ops2_preflight_pass !== 'boolean') {
      return { ok: false, code: 'INVALID_OPS2_PREFLIGHT_FLAG', message: `Account ${id} ops2_preflight_pass must be boolean.` }
    }
    if (acct.state === 'S5_FUNDED_ACTIVE') {
      if (acct.preset_mode !== PRESET_MODE_FUNDED_1X) {
        return { ok: false, code: 'EVAL_PRESET_FORBIDDEN_ON_FUNDED', message: `Funded account ${id} must use preset_mode="FUNDED_1X".` }
      }
      if (acct.preset_name && EVAL_PRESET_NAME_RE.test(String(acct.preset_name))) {
        return { ok: false, code: 'EVAL_PRESET_FORBIDDEN_ON_FUNDED', message: `Funded account ${id} cannot attach Eval preset "${acct.preset_name}".` }
      }
      if (acct.ops2_preflight_pass !== true) {
        return { ok: false, code: 'OPS2_PREFLIGHT_NOT_PASSED', message: `Funded account ${id} must have ops2_preflight_pass=true.` }
      }
      if (!isValidSha256Hex(acct.preset_sha256)) {
        return { ok: false, code: 'PRESET_SHA256_MISSING_OR_INVALID', message: `Funded account ${id} must have a valid 64-hex preset_sha256.` }
      }
    }
  }

  let expectedPrev = GENESIS_EVENT_SHA256
  for (let i = 0; i < raw.transitions.length; i += 1) {
    const ev = raw.transitions[i]
    if (!isPlainObject(ev)) {
      return { ok: false, code: 'INVALID_TRANSITION_RECORD', message: `Transition at index ${i} must be an object.` }
    }
    if (!isStrictNonNegativeInt(ev.seq) || ev.seq !== i + 1) {
      return { ok: false, code: 'TRANSITION_SEQ_GAP', message: `Transition seq mismatch at index ${i}: expected ${i + 1}, got ${String(ev.seq)}.` }
    }
    if (ev.order_send_capable !== false) {
      return { ok: false, code: 'ORDER_SEND_CAPABLE_TAMPER', message: `Transition #${ev.seq} violated order_send_capable === false.` }
    }
    if (!isValidSha256Hex(ev.prev_event_sha256) || ev.prev_event_sha256 !== expectedPrev) {
      return { ok: false, code: 'HASH_CHAIN_BROKEN', message: `Transition #${ev.seq} prev_event_sha256 chain mismatch.` }
    }
    if (!isValidSha256Hex(ev.event_sha256)) {
      return { ok: false, code: 'INVALID_EVENT_SHA256', message: `Transition #${ev.seq} event_sha256 must be 64 lowercase hex chars.` }
    }
    expectedPrev = ev.event_sha256
  }

  return { ok: true, ledger: structuredClone(raw) }
}

// ---------------------------------------------------------------------------
// Fleet Summary Re-computation
// ---------------------------------------------------------------------------
export function recomputeFleetSummary(ledger) {
  const accounts = Array.isArray(ledger.accounts) ? ledger.accounts : []
  const rate = isStrictFiniteNumber(ledger.usd_vnd_rate, { strictlyPositive: true }) ? ledger.usd_vnd_rate : 25765.94
  const counts = Object.fromEntries(ALL_STATES.map(s => [s, 0]))
  let activeEval = 0
  let activeFunded = 0
  let frozenOrBreached = 0
  let fundedNominalUsd = 0
  let totalEquityUsd = 0
  let totalNetPayoutUsd = 0
  const inactivityAlerts = []
  const nextActions = []

  for (const acct of accounts) {
    if (acct.state in counts) counts[acct.state] += 1
    if (ACTIVE_EVAL_STATES.has(acct.state)) activeEval += 1
    if (ACTIVE_FUNDED_STATES.has(acct.state)) {
      activeFunded += 1
      fundedNominalUsd += Number(acct.capital_usd || 0)
    }
    if (acct.state === 'E2_FUNDED_DD_FREEZE' || acct.state === 'E3_FUNDED_BREACH_POSTMORTEM') frozenOrBreached += 1
    totalEquityUsd += Number(acct.equity_usd || 0)
    totalNetPayoutUsd += Number(acct.cumulative_net_payout_usd || 0)

    const inact = computeInactivityStatus(acct.days_since_last_trade)
    if (LIVE_RUNNING_STATES.has(acct.state) && inact !== 'GREEN' && inact !== 'UNKNOWN') {
      inactivityAlerts.push({ account_id: acct.account_id, days_since_last_trade: acct.days_since_last_trade, status: inact })
    }
    if (acct.state === 'S0_PRE_CHALLENGE') {
      nextActions.push({
        account_id: acct.account_id,
        state: acct.state,
        action_code: 'VERIFY_PREFLIGHT_AND_OPEN_P1',
        label_vi: 'Kiểm tra cổng tiền kiểm vốn đệm & OPS-2 trước khi mở vé P1',
      })
    } else if (acct.state === 'S4_PASS_P2_TO_FUNDED_LOCK') {
      nextActions.push({
        account_id: acct.account_id,
        state: acct.state,
        action_code: 'RUN_OPS2_AND_ATTACH_FUNDED_1X_PRESET',
        label_vi: 'Chạy OPS-2 preflight & nạp .set Funded 1.0x (KS 8%) trước khi mở S5',
      })
    }
  }

  const totalFees = Array.isArray(ledger.treasury_events)
    ? round2(ledger.treasury_events.filter(e => e.event_type === 'CHALLENGE_FEE').reduce((s, e) => s + Number(e.amount_usd || 0), 0))
    : Number(ledger.fleet_summary?.total_fees_spent_usd || 0)

  const settledNetUsd = isStrictFiniteNumber(ledger.treasury_snapshot?.settled_cash_summary?.settled_payouts_net_usd, { min: 0 })
    ? ledger.treasury_snapshot.settled_cash_summary.settled_payouts_net_usd
    : round2(totalNetPayoutUsd)

  return {
    total_accounts: accounts.length,
    counts_by_state: counts,
    active_eval_count: activeEval,
    active_funded_count: activeFunded,
    frozen_or_breached_count: frozenOrBreached,
    total_funded_nominal_usd: round2(fundedNominalUsd),
    total_funded_nominal_vnd: Math.round(fundedNominalUsd * rate),
    total_equity_usd: round2(totalEquityUsd),
    total_equity_vnd: Math.round(totalEquityUsd * rate),
    total_fees_spent_usd: totalFees,
    total_settled_payouts_net_usd: round2(settledNetUsd),
    total_settled_payouts_net_vnd: Math.round(settledNetUsd * rate),
    inactivity_alerts: inactivityAlerts,
    next_actions: nextActions,
  }
}

// ---------------------------------------------------------------------------
// Fail-Closed FSM Draft Transition Engine (`S0..S7` + `E1..E3` + `CLOSED_ARCHIVED`)
// ---------------------------------------------------------------------------
export function applyDraftTransition(ledger, rawInput) {
  const input = isPlainObject(rawInput) ? rawInput : {}
  if (input.order_send_capable !== undefined && input.order_send_capable !== false) {
    return { ok: false, code: 'ORDER_SEND_CAPABLE_TAMPER', reasonCodes: ['ORDER_SEND_CAPABLE_TAMPER'], message: 'HARD REJECT: order_send_capable must remain strictly false.' }
  }
  const baseCheck = validateFleetLedger(ledger)
  if (!baseCheck.ok) {
    return { ok: false, code: baseCheck.code, reasonCodes: [baseCheck.code], message: baseCheck.message }
  }

  const nextLedger = structuredClone(baseCheck.ledger)
  const accountId = String(input.account_id || '').trim()
  const acct = nextLedger.accounts.find(item => item.account_id === accountId)
  if (!acct) {
    return { ok: false, code: 'UNKNOWN_ACCOUNT_ID', reasonCodes: ['UNKNOWN_ACCOUNT_ID'], message: `Account "${accountId}" not found in ledger.` }
  }

  const fromState = acct.state
  const toState = String(input.to_state || '').trim()
  const allowedTargets = ALLOWED_TRANSITIONS[fromState] || []
  if (!allowedTargets.includes(toState)) {
    return {
      ok: false,
      code: 'INVALID_STATE_TRANSITION',
      reasonCodes: ['INVALID_STATE_TRANSITION'],
      message: `Transition ${fromState} -> ${toState} is forbidden. Allowed: ${allowedTargets.join(', ') || 'none'}.`,
    }
  }

  const openPositions = input.open_positions
  if (!isStrictNonNegativeInt(openPositions)) {
    return {
      ok: false,
      code: 'INVALID_OPEN_POSITIONS',
      reasonCodes: ['INVALID_OPEN_POSITIONS'],
      message: 'open_positions must be a strict non-negative integer (0, 1, 2, ...).',
    }
  }

  const ops2Pass = input.ops2_preflight_pass !== undefined ? input.ops2_preflight_pass : acct.ops2_preflight_pass
  if (typeof ops2Pass !== 'boolean') {
    return {
      ok: false,
      code: 'INVALID_OPS2_PREFLIGHT_FLAG',
      reasonCodes: ['INVALID_OPS2_PREFLIGHT_FLAG'],
      message: 'ops2_preflight_pass must be a strict boolean.',
    }
  }

  const edge = `${fromState}->${toState}`
  if (FLAT_REQUIRED_EDGES.has(edge) && openPositions !== 0) {
    return {
      ok: false,
      code: 'OPEN_POSITIONS_NONZERO_HANDOFF',
      reasonCodes: ['OPEN_POSITIONS_NONZERO_HANDOFF'],
      message: `Transition ${fromState} -> ${toState} requires open_positions == 0 (flat handoff), observed ${openPositions}.`,
    }
  }

  const presetMode = input.preset_mode !== undefined ? String(input.preset_mode).trim() : String(acct.preset_mode || PRESET_MODE_NONE)
  const presetName = input.preset_name !== undefined ? String(input.preset_name).trim() : String(acct.preset_name || '')
  const presetSha = input.preset_sha256 !== undefined ? String(input.preset_sha256).trim().toLowerCase() : String(acct.preset_sha256 || '').toLowerCase()
  const expectedSha = input.expected_preset_sha256 !== undefined ? String(input.expected_preset_sha256).trim().toLowerCase() : String(acct.expected_preset_sha256 || '').toLowerCase()
  const ops4Light = input.ops4_traffic_light !== undefined ? String(input.ops4_traffic_light).trim() : String(acct.ops4_traffic_light || 'GREEN')
  const ops5Sha = input.ops5_audit_bundle_sha256 !== undefined ? String(input.ops5_audit_bundle_sha256).trim().toLowerCase() : String(acct.ops5_audit_bundle_sha256 || '').toLowerCase()

  if (!VALID_TRAFFIC_LIGHTS.includes(ops4Light)) {
    return { ok: false, code: 'INVALID_OPS4_TRAFFIC_LIGHT', reasonCodes: ['INVALID_OPS4_TRAFFIC_LIGHT'], message: `Invalid ops4_traffic_light: ${ops4Light}.` }
  }

  const effEquity = input.equity_usd !== undefined ? input.equity_usd : acct.equity_usd
  if (!isStrictFiniteNumber(effEquity, { min: 0 })) {
    return { ok: false, code: 'INVALID_EQUITY_USD', reasonCodes: ['INVALID_EQUITY_USD'], message: 'equity_usd must be a finite non-negative number.' }
  }
  const effTradingDays = input.trading_days_completed !== undefined ? input.trading_days_completed : acct.trading_days_completed
  if (!isStrictNonNegativeInt(effTradingDays)) {
    return { ok: false, code: 'INVALID_TRADING_DAYS', reasonCodes: ['INVALID_TRADING_DAYS'], message: 'trading_days_completed must be a non-negative integer.' }
  }
  const effInactDays = input.days_since_last_trade !== undefined ? input.days_since_last_trade : acct.days_since_last_trade
  if (!isStrictFiniteNumber(effInactDays, { min: 0 })) {
    return { ok: false, code: 'INVALID_INACTIVITY_DAYS', reasonCodes: ['INVALID_INACTIVITY_DAYS'], message: 'days_since_last_trade must be a finite non-negative number.' }
  }

  const autoReasons = []
  let allocationResult = null
  const utcTs = formatUtcIso(input.utc_ts || new Date())
  const rate = isStrictFiniteNumber(nextLedger.usd_vnd_rate, { strictlyPositive: true }) ? nextLedger.usd_vnd_rate : 25765.94

  if (edge === 'S0_PRE_CHALLENGE->S1_CHALLENGE_P1') {
    if (acct.available_vn !== true) {
      return { ok: false, code: 'CONTRACT_UNAVAILABLE_VN', reasonCodes: ['CONTRACT_UNAVAILABLE_VN'], message: `Contract ${acct.contract_id} is not available in Vietnam.` }
    }
    if (ops2Pass !== true) {
      return { ok: false, code: 'OPS2_PREFLIGHT_NOT_PASSED', reasonCodes: ['OPS2_PREFLIGHT_NOT_PASSED'], message: 'S0->S1 requires ops2_preflight_pass === true.' }
    }
    if (!VALID_EVAL_P1_PRESET_MODES.includes(presetMode)) {
      return { ok: false, code: 'INVALID_P1_PRESET_MODE', reasonCodes: ['INVALID_P1_PRESET_MODE'], message: `S0->S1 requires a P1 Eval preset mode, got "${presetMode}".` }
    }
    if (!isValidSha256Hex(presetSha)) {
      return { ok: false, code: 'PRESET_SHA256_MISSING_OR_INVALID', reasonCodes: ['PRESET_SHA256_MISSING_OR_INVALID'], message: 'S0->S1 requires a valid 64-hex preset_sha256.' }
    }
    if (expectedSha && presetSha !== expectedSha) {
      return { ok: false, code: 'PRESET_SHA256_DRIFT', reasonCodes: ['PRESET_SHA256_DRIFT'], message: 'Observed preset_sha256 does not match expected_preset_sha256.' }
    }
    autoReasons.push('P1_PREFLIGHT_PASS', 'P1_TICKET_OPENED')
  } else if (edge === 'S1_CHALLENGE_P1->S2_PASS_P1_HANDOFF') {
    const gainFrac = (effEquity - acct.capital_usd) / acct.capital_usd
    if (gainFrac + 1e-9 < (acct.p1_target_frac ?? 0.1)) {
      return { ok: false, code: 'P1_TARGET_NOT_MET', reasonCodes: ['P1_TARGET_NOT_MET'], message: `S1->S2 requires P1 profit >= ${Math.round((acct.p1_target_frac ?? 0.1) * 100)}%.` }
    }
    if (effTradingDays < (acct.min_trading_days ?? 4)) {
      return { ok: false, code: 'MIN_TRADING_DAYS_NOT_MET', reasonCodes: ['MIN_TRADING_DAYS_NOT_MET'], message: `S1->S2 requires >= ${acct.min_trading_days ?? 4} trading days.` }
    }
    autoReasons.push('P1_PASSED_FLAT_VERIFIED', 'P1_LOG_SEALED')
  } else if (edge === 'S2_PASS_P1_HANDOFF->S3_CHALLENGE_P2') {
    if (ops2Pass !== true) {
      return { ok: false, code: 'OPS2_PREFLIGHT_NOT_PASSED', reasonCodes: ['OPS2_PREFLIGHT_NOT_PASSED'], message: 'S2->S3 requires ops2_preflight_pass === true.' }
    }
    if (!VALID_EVAL_P2_PRESET_MODES.includes(presetMode)) {
      return { ok: false, code: 'INVALID_P2_PRESET_MODE', reasonCodes: ['INVALID_P2_PRESET_MODE'], message: `S2->S3 requires a P2 Eval preset mode, got "${presetMode}".` }
    }
    if (!isValidSha256Hex(presetSha)) {
      return { ok: false, code: 'PRESET_SHA256_MISSING_OR_INVALID', reasonCodes: ['PRESET_SHA256_MISSING_OR_INVALID'], message: 'S2->S3 requires a valid 64-hex preset_sha256.' }
    }
    if (expectedSha && presetSha !== expectedSha) {
      return { ok: false, code: 'PRESET_SHA256_DRIFT', reasonCodes: ['PRESET_SHA256_DRIFT'], message: 'Observed preset_sha256 does not match expected_preset_sha256.' }
    }
    autoReasons.push('P2_PREFLIGHT_PASS', 'P2_STARTED')
  } else if (edge === 'S3_CHALLENGE_P2->S4_PASS_P2_TO_FUNDED_LOCK') {
    const gainFrac = (effEquity - acct.capital_usd) / acct.capital_usd
    if (gainFrac + 1e-9 < (acct.p2_target_frac ?? 0.05)) {
      return { ok: false, code: 'P2_TARGET_NOT_MET', reasonCodes: ['P2_TARGET_NOT_MET'], message: `S3->S4 requires P2 profit >= ${Math.round((acct.p2_target_frac ?? 0.05) * 100)}%.` }
    }
    if (effTradingDays < (acct.min_trading_days ?? 4)) {
      return { ok: false, code: 'MIN_TRADING_DAYS_NOT_MET', reasonCodes: ['MIN_TRADING_DAYS_NOT_MET'], message: `S3->S4 requires >= ${acct.min_trading_days ?? 4} trading days.` }
    }
    autoReasons.push('P2_PASSED_FLAT_VERIFIED', 'FUNDED_LOCK_GATE_ENTERED')
  } else if (FUNDED_ENTRY_EDGES.has(edge)) {
    // CỔNG 2 KHÓA BẮT BUỘC (S4->S5, S7->S5, E2->S5)
    if (presetMode !== PRESET_MODE_FUNDED_1X) {
      const code = /EVAL|SPRINT/i.test(presetMode) ? 'EVAL_PRESET_FORBIDDEN_ON_FUNDED' : 'FUNDED_PRESET_MODE_REQUIRED'
      return {
        ok: false,
        code,
        reasonCodes: [code],
        message: `HARD REJECT: Funded entry (${edge}) requires preset_mode="FUNDED_1X", got "${presetMode}".`,
      }
    }
    if (presetName && EVAL_PRESET_NAME_RE.test(presetName)) {
      return {
        ok: false,
        code: 'EVAL_PRESET_FORBIDDEN_ON_FUNDED',
        reasonCodes: ['EVAL_PRESET_FORBIDDEN_ON_FUNDED'],
        message: `HARD REJECT: Eval/Sprint preset filename "${presetName}" is forbidden on Funded accounts.`,
      }
    }
    if (ops2Pass !== true) {
      return {
        ok: false,
        code: 'OPS2_PREFLIGHT_NOT_PASSED',
        reasonCodes: ['OPS2_PREFLIGHT_NOT_PASSED'],
        message: `Funded entry (${edge}) requires ops2_preflight_pass === true.`,
      }
    }
    if (!isValidSha256Hex(presetSha)) {
      return {
        ok: false,
        code: 'PRESET_SHA256_MISSING_OR_INVALID',
        reasonCodes: ['PRESET_SHA256_MISSING_OR_INVALID'],
        message: 'Funded entry requires a valid 64-hex preset_sha256.',
      }
    }
    if (expectedSha) {
      if (!isValidSha256Hex(expectedSha)) {
        return { ok: false, code: 'EXPECTED_PRESET_SHA256_INVALID', reasonCodes: ['EXPECTED_PRESET_SHA256_INVALID'], message: 'expected_preset_sha256 is malformed.' }
      }
      if (presetSha !== expectedSha) {
        return { ok: false, code: 'PRESET_SHA256_DRIFT', reasonCodes: ['PRESET_SHA256_DRIFT'], message: 'PRESET_SHA256_DRIFT: observed preset_sha256 != expected_preset_sha256.' }
      }
      autoReasons.push('PRESET_SHA256_VERIFIED')
    }
    if (edge === 'E2_FUNDED_DD_FREEZE->S5_FUNDED_ACTIVE' && ops4Light === 'RED') {
      return { ok: false, code: 'OPS4_RED_BLOCKS_UNFREEZE', reasonCodes: ['OPS4_RED_BLOCKS_UNFREEZE'], message: 'Cannot unfreeze Funded account while ops4_traffic_light === RED.' }
    }
    autoReasons.push('FUNDED_DUAL_LOCK_PASS', 'OPS2_PREFLIGHT_PASS', 'FLAT_HANDOFF_VERIFIED')
  } else if (edge === 'S5_FUNDED_ACTIVE->S6_PAYOUT_AUDIT_AND_HARVEST') {
    if (ops4Light === 'RED') {
      return { ok: false, code: 'OPS4_RED_BLOCKS_PAYOUT', reasonCodes: ['OPS4_RED_BLOCKS_PAYOUT'], message: 'OPS-4 RED blocks payout harvest; freeze to E2 first.' }
    }
    if (computeInactivityStatus(effInactDays) === 'EXPIRED') {
      return { ok: false, code: 'INACTIVITY_LIMIT_BREACHED', reasonCodes: ['INACTIVITY_LIMIT_BREACHED'], message: `Inactivity ${effInactDays}d >= 30d blocks payout.` }
    }
    if (!isValidSha256Hex(ops5Sha)) {
      return { ok: false, code: 'OPS5_AUDIT_BUNDLE_MISSING_OR_INVALID', reasonCodes: ['OPS5_AUDIT_BUNDLE_MISSING_OR_INVALID'], message: 'S5->S6 requires a valid 64-hex ops5_audit_bundle_sha256.' }
    }
    autoReasons.push('PAYOUT_ELIGIBLE', 'FLAT_HANDOFF_VERIFIED', 'OPS5_WHITEBOX_SHA256_VERIFIED')
  } else if (edge === 'S6_PAYOUT_AUDIT_AND_HARVEST->S7_AFTER_PAYOUT_ALLOCATOR') {
    const gross = input.payout_gross_usd !== undefined ? input.payout_gross_usd : Math.max(0, effEquity - acct.capital_usd)
    const wFee = input.withdrawal_fee_usd ?? 0
    const fxFee = input.fx_bank_fee_usd ?? 0
    const refund = input.fee_refund_usd ?? 0
    if (!isStrictFiniteNumber(gross, { strictlyPositive: true })) {
      return { ok: false, code: 'INVALID_PAYOUT_AMOUNT', reasonCodes: ['INVALID_PAYOUT_AMOUNT'], message: 'S6->S7 requires payout_gross_usd > 0.' }
    }
    if (!isStrictFiniteNumber(wFee, { min: 0 }) || !isStrictFiniteNumber(fxFee, { min: 0 }) || !isStrictFiniteNumber(refund, { min: 0 })) {
      return { ok: false, code: 'INVALID_PAYOUT_FEE', reasonCodes: ['INVALID_PAYOUT_FEE'], message: 'Payout fees and fee refund must be finite non-negative numbers.' }
    }
    const split = acct.payout_split_frac ?? 0.8
    const netBeforeRails = round2(gross * split)
    const netSettledPayout = round2(Math.max(0, netBeforeRails - wFee - fxFee))
    const cashRefund = round2(refund * (acct.fee_refund_external_cash_frac ?? 1.0))
    const hubRefund = round2(refund * (acct.fee_refund_hub_credit_frac ?? 0.0))
    const totalSettledCash = round2(netSettledPayout + cashRefund)
    const allocPol = nextLedger.allocation_policy || { policy_name: 'PARETO_3_BUCKET_DEFAULT', house_money_pct: 0.3, upgrade_challenge_pct: 0.3, own_book_pct: 0.4, reserve_cap_tickets: 5, reference_ticket_usd: 109.69 }
    const snap = nextLedger.treasury_snapshot || (nextLedger.treasury_snapshot = { house_money_usd: 0, upgrade_challenge_usd: 0, own_book_usd: 0 })
    const reserveCap = (allocPol.reserve_cap_tickets || 5) * Math.max(acct.ticket_fee_usd || 0, allocPol.reference_ticket_usd || 109.69)
    const rawHouse = totalSettledCash * (allocPol.house_money_pct ?? 0.3)
    const rawUpgrade = totalSettledCash * (allocPol.upgrade_challenge_pct ?? 0.3)
    const rawOwn = totalSettledCash * (allocPol.own_book_pct ?? 0.4)
    const upgradeRoom = Math.max(0, reserveCap - Number(snap.upgrade_challenge_usd || 0))
    const allocUpgrade = Math.min(rawUpgrade, upgradeRoom)
    const overflowToOwn = rawUpgrade - allocUpgrade
    const allocOwn = rawOwn + overflowToOwn
    const allocHouse = rawHouse

    snap.house_money_usd = round2(Number(snap.house_money_usd || 0) + allocHouse)
    snap.upgrade_challenge_usd = round2(Number(snap.upgrade_challenge_usd || 0) + allocUpgrade)
    snap.own_book_usd = round2(Number(snap.own_book_usd || 0) + allocOwn)
    snap.house_money_vnd = Math.round(snap.house_money_usd * rate)
    snap.upgrade_challenge_vnd = Math.round(snap.upgrade_challenge_usd * rate)
    snap.own_book_vnd = Math.round(snap.own_book_usd * rate)
    if (snap.settled_cash_summary) {
      snap.settled_cash_summary.settled_payouts_net_usd = round2(Number(snap.settled_cash_summary.settled_payouts_net_usd || 0) + netSettledPayout)
      snap.settled_cash_summary.external_cash_refunds_settled_usd = round2(Number(snap.settled_cash_summary.external_cash_refunds_settled_usd || 0) + cashRefund)
      snap.settled_cash_summary.net_settled_cash_usd = round2(Number(snap.settled_cash_summary.net_settled_cash_usd || 0) + totalSettledCash)
      snap.settled_cash_summary.net_settled_cash_vnd = Math.round(snap.settled_cash_summary.net_settled_cash_usd * rate)
    }

    acct.payout_cycles_completed = (acct.payout_cycles_completed || 0) + 1
    acct.cumulative_gross_payout_usd = round2((acct.cumulative_gross_payout_usd || 0) + gross)
    acct.cumulative_net_payout_usd = round2((acct.cumulative_net_payout_usd || 0) + netSettledPayout)
    if (refund > 0) {
      acct.fee_refunded = true
      acct.fee_refund_usd = round2((acct.fee_refund_usd || 0) + refund)
    }
    const cycleId = `${acct.account_id}-PAYOUT-${String(acct.payout_cycles_completed).padStart(2, '0')}`
    allocationResult = {
      cycle_id: cycleId,
      policy_name: allocPol.policy_name || 'PARETO_3_BUCKET_DEFAULT',
      gross_payout_usd: round2(gross),
      split_frac: split,
      net_before_rails_usd: netBeforeRails,
      withdrawal_and_fx_fees_usd: round2(wFee + fxFee),
      net_settled_payout_usd: netSettledPayout,
      cash_fee_refund_usd: cashRefund,
      hub_credit_refund_usd: hubRefund,
      total_settled_cash_usd: totalSettledCash,
      total_settled_cash_vnd: Math.round(totalSettledCash * rate),
      buckets_usd: {
        house_money_usd: round2(allocHouse),
        upgrade_challenge_usd: round2(allocUpgrade),
        own_book_usd: round2(allocOwn),
        overflow_to_own_book_usd: round2(overflowToOwn),
      },
      buckets_vnd: {
        house_money_vnd: Math.round(allocHouse * rate),
        upgrade_challenge_vnd: Math.round(allocUpgrade * rate),
        own_book_vnd: Math.round(allocOwn * rate),
      },
      can_fund_next_s0_ticket: snap.upgrade_challenge_usd >= (acct.ticket_fee_usd || 0),
    }
    autoReasons.push('PAYOUT_SETTLED', 'THREE_BUCKET_ALLOCATED')
  } else if (toState === 'E1_EVAL_FAIL_COOLDOWN') {
    autoReasons.push('EVAL_FAIL_COOLDOWN_ENTERED')
  } else if (toState === 'E2_FUNDED_DD_FREEZE') {
    autoReasons.push('FUNDED_DD_FREEZE_ENTERED')
  } else if (toState === 'E3_FUNDED_BREACH_POSTMORTEM') {
    autoReasons.push('FUNDED_BREACH_POSTMORTEM_REQUIRED')
  } else if (toState === 'CLOSED_ARCHIVED') {
    autoReasons.push('ACCOUNT_CLOSED_ARCHIVED')
  } else if (toState === 'S0_PRE_CHALLENGE') {
    autoReasons.push('RETURNED_TO_PRE_CHALLENGE')
  }

  // Apply validated mutations to cloned account
  acct.state = toState
  acct.open_positions = openPositions
  acct.ops2_preflight_pass = ops2Pass
  acct.ops4_traffic_light = ops4Light
  acct.preset_mode = ['S4_PASS_P2_TO_FUNDED_LOCK', 'S7_AFTER_PAYOUT_ALLOCATOR', 'E1_EVAL_FAIL_COOLDOWN', 'E2_FUNDED_DD_FREEZE', 'E3_FUNDED_BREACH_POSTMORTEM', 'CLOSED_ARCHIVED'].includes(toState)
    ? PRESET_MODE_NONE
    : presetMode
  acct.preset_name = acct.preset_mode === PRESET_MODE_NONE ? '' : presetName
  acct.preset_sha256 = acct.preset_mode === PRESET_MODE_NONE ? '' : presetSha
  if (acct.preset_mode !== PRESET_MODE_NONE && presetSha) {
    acct.expected_preset_sha256 = expectedSha || presetSha
  }
  if (ops5Sha) acct.ops5_audit_bundle_sha256 = ops5Sha
  acct.equity_usd = toState === 'S5_FUNDED_ACTIVE' && fromState === 'S4_PASS_P2_TO_FUNDED_LOCK' ? acct.capital_usd : round2(effEquity)
  acct.balance_usd = acct.equity_usd
  acct.peak_equity_usd = Math.max(Number(acct.peak_equity_usd || 0), acct.equity_usd)
  acct.trading_days_completed = (toState === 'S3_CHALLENGE_P2' || toState === 'S5_FUNDED_ACTIVE') && fromState !== toState ? 0 : effTradingDays
  acct.days_since_last_trade = effInactDays
  acct.inactivity_status = computeInactivityStatus(effInactDays)
  acct.last_transition_utc = utcTs
  if (typeof input.notes === 'string' && input.notes.trim()) acct.notes = input.notes.trim()

  const prevEvent = nextLedger.transitions.at(-1)
  const seq = nextLedger.transitions.length + 1
  const prevSha = prevEvent ? prevEvent.event_sha256 : GENESIS_EVENT_SHA256
  const eventBase = {
    event_id: `EVT-${String(seq).padStart(6, '0')}`,
    seq,
    utc_ts: utcTs,
    account_id: acct.account_id,
    from_state: fromState,
    to_state: toState,
    actor: String(input.actor || 'browser-draft').trim() || 'browser-draft',
    ops2_preflight_pass: ops2Pass,
    open_positions: openPositions,
    preset_mode: presetMode,
    preset_sha256: presetSha,
    reason_codes: [...new Set([...autoReasons, ...(Array.isArray(input.reason_codes) ? input.reason_codes : [])])],
    order_send_capable: false,
    metrics_snapshot: {
      equity_usd: acct.equity_usd,
      balance_usd: acct.balance_usd,
      daily_dd_pct: acct.daily_dd_pct,
      static_dd_pct: acct.static_dd_pct,
      trading_days_completed: acct.trading_days_completed,
      cycle_days_elapsed: acct.cycle_days_elapsed,
      days_since_last_trade: acct.days_since_last_trade,
      inactivity_status: acct.inactivity_status,
      ops4_traffic_light: acct.ops4_traffic_light,
    },
    allocation_result: allocationResult,
    prev_event_sha256: prevSha,
  }
  const event = {
    ...eventBase,
    event_sha256: sha256Hex(canonicalJson(eventBase)),
  }

  nextLedger.transitions.push(event)
  nextLedger.updated_utc = utcTs
  nextLedger.order_send_capable = false
  nextLedger.order_send_count = 0
  nextLedger.holdout_cutoff_date = HOLDOUT_CUTOFF_DATE
  nextLedger.holdout_rows_analysed = 0
  nextLedger.fleet_summary = recomputeFleetSummary(nextLedger)
  nextLedger.report_sha256 = canonicalPayloadSha256(nextLedger)

  return { ok: true, ledger: nextLedger, event }
}

// ---------------------------------------------------------------------------
// Fleet Guards E1..E6 + FTMO Scaling Plan Tracker
// ---------------------------------------------------------------------------
function validateOps6EvalReceipt(receipt, latestFailMs, nowMs) {
  if (!isPlainObject(receipt)) return false
  if (!String(receipt.receipt_id || '').trim() || !String(receipt.signed_by || '').trim()) return false
  if (receipt.approved_to_resume !== true) return false
  if (!isValidSha256Hex(receipt.report_sha256 || receipt.receipt_sha256)) return false
  const signedMs = parseUtcMs(receipt.signed_utc)
  if (signedMs === null || signedMs < latestFailMs || signedMs > nowMs + 5000) return false
  const rawCls = receipt.root_cause_class ?? receipt.classification
  if (rawCls !== undefined && rawCls !== null) {
    const cls = typeof rawCls === 'string' ? rawCls.trim().toUpperCase() : ''
    if (!VALID_OPS6_BREACH_CLASSES.includes(cls)) return false
    if (cls === 'BOT_BUG' && receipt.fix_verified !== true) return 'E1_OPS6_BOT_BUG_FIX_UNVERIFIED'
  }
  return true
}

function validateOps6Postmortem(pm, accountId, breachMs, nowMs) {
  if (!isPlainObject(pm)) return false
  if (String(pm.account_id || '').trim() !== accountId) return false
  const rawCls = 'classification' in pm ? pm.classification : pm.root_cause_class
  const cls = typeof rawCls === 'string' ? rawCls.trim().toUpperCase() : ''
  if (!VALID_OPS6_BREACH_CLASSES.includes(cls)) return false
  if (!String(pm.signed_by || '').trim()) return false
  if ('signed' in pm && pm.signed !== true) return false
  if (!isValidSha256Hex(pm.report_sha256 || pm.postmortem_sha256)) return false
  const signedMs = parseUtcMs(pm.signed_utc)
  if (signedMs === null || signedMs > nowMs + 5000) return false
  if (breachMs !== null && signedMs < breachMs) return false
  if (cls === 'BOT_BUG' && pm.fix_verified !== true) return 'E3_OPS6_BOT_BUG_FIX_UNVERIFIED'
  return true
}

export function evaluateFleetGuards(ledger, options = {}) {
  const accounts = Array.isArray(ledger?.accounts) ? ledger.accounts : []
  const transitions = Array.isArray(ledger?.transitions) ? ledger.transitions : []
  const policy = isPlainObject(ledger?.fleet_policy) ? ledger.fleet_policy : {}
  const nowMs = parseUtcMs(options.nowUtc || ledger?.updated_utc) ?? Date.now()
  const windowMs = E1_WINDOW_DAYS * 86400 * 1000

  // E1: Eval Fail Cooldown (trailing 30 days >= 2 fails -> BLOCK unless OPS-6 receipt)
  const e1FailKeys = new Set()
  let e1LatestMs = 0
  for (const ev of transitions) {
    if (ev.to_state !== 'E1_EVAL_FAIL_COOLDOWN') continue
    const ts = parseUtcMs(ev.utc_ts)
    if (ts !== null && nowMs - ts <= windowMs && ts <= nowMs + 5000) {
      e1FailKeys.add(`${ev.account_id}|${ev.utc_ts}`)
      if (ts > e1LatestMs) e1LatestMs = ts
    }
  }
  for (const acct of accounts) {
    if (acct.state !== 'E1_EVAL_FAIL_COOLDOWN') continue
    const seen = [...e1FailKeys].some(k => k.startsWith(`${acct.account_id}|`))
    if (seen) continue
    const ts = parseUtcMs(acct.last_transition_utc)
    if (ts !== null && nowMs - ts <= windowMs && ts <= nowMs + 5000) {
      e1FailKeys.add(`${acct.account_id}|${acct.last_transition_utc}`)
      if (ts > e1LatestMs) e1LatestMs = ts
    }
  }
  const e1Count = e1FailKeys.size
  const e1Res = e1Count >= E1_BLOCK_FAILS
    ? validateOps6EvalReceipt(options.ops6EvalReceipt || ledger?.ops6_eval_receipt || ledger?.ops6_forensic_review_receipt, e1LatestMs, nowMs)
    : false
  const e1Cleared = e1Res === true
  const e1Blocking = e1Count >= E1_BLOCK_FAILS && !e1Cleared
  const e1Warn = !e1Blocking && (e1Count === 1 || e1Cleared)
  const guardE1 = {
    code: 'E1',
    id: 'E1_EVAL_FAIL_COOLDOWN',
    status: e1Blocking ? 'BLOCK' : e1Warn ? 'WARNING' : 'PASS',
    tone: e1Blocking ? 'danger' : e1Warn ? 'warning' : 'success',
    blocking: e1Blocking,
    reasons: e1Blocking
      ? (typeof e1Res === 'string' ? ['E1_EVAL_FAIL_COOLDOWN_BLOCKED', e1Res] : ['E1_EVAL_FAIL_COOLDOWN_BLOCKED'])
      : e1Cleared
        ? ['E1_COOLDOWN_CLEARED_BY_OPS6_RECEIPT']
        : e1Count === 1
          ? ['E1_SINGLE_EVAL_FAIL_IN_30D_WATCH']
          : [],
    metric: `${e1Count}/${E1_BLOCK_FAILS} (30d)`,
  }

  // E2: Funded DD Freeze (S5/S6/S7/E2; Amber >= 3.5% -> 0.5x | Red >= 6.0% or OPS-4 RED or E2 -> 0.0x)
  let e2Regime = 'GREEN'
  let e2Scale = 1.0
  let e2MaxDd = 0
  const e2Reasons = []
  for (const acct of accounts) {
    if (!ACTIVE_FUNDED_STATES.has(acct.state) && acct.state !== 'E2_FUNDED_DD_FREEZE') continue
    if (acct.state === 'E2_FUNDED_DD_FREEZE') {
      e2Regime = 'RED'
      e2Scale = 0.0
      e2Reasons.push('E2_FUNDED_ACCOUNT_FROZEN_IN_E2')
    }
    if (!isStrictFiniteNumber(acct.static_dd_pct, { min: 0, max: 100 }) || !isStrictFiniteNumber(acct.daily_dd_pct, { min: 0, max: 100 })) {
      e2Regime = 'RED'
      e2Scale = 0.0
      e2Reasons.push('E2_POISONED_FUNDED_DD_INPUT')
      continue
    }
    const traffic = acct.ops4_traffic_light === undefined ? 'GREEN' : acct.ops4_traffic_light
    if (typeof traffic !== 'string' || !VALID_TRAFFIC_LIGHTS.includes(traffic)) {
      e2Regime = 'RED'
      e2Scale = 0.0
      e2Reasons.push('E2_POISONED_OPS4_TRAFFIC_LIGHT')
      continue
    }
    const effDd = Math.max(acct.static_dd_pct, acct.daily_dd_pct)
    if (effDd > e2MaxDd) e2MaxDd = effDd
    if (effDd >= E2_RED_DD_PCT || traffic === 'RED') {
      e2Regime = 'RED'
      e2Scale = 0.0
      e2Reasons.push('E2_FUNDED_DD_RED_FREEZE')
    } else if (effDd >= E2_AMBER_DD_PCT || traffic === 'AMBER') {
      if (e2Regime !== 'RED') {
        e2Regime = 'AMBER'
        e2Scale = 0.5
      }
      e2Reasons.push('E2_FUNDED_DD_AMBER_FREEZE')
    }
  }
  const e2Blocking = e2Reasons.length > 0
  const guardE2 = {
    code: 'E2',
    id: 'E2_FUNDED_DD_FREEZE',
    status: e2Regime === 'RED' ? 'BLOCK' : e2Regime === 'AMBER' ? 'WARNING' : 'PASS',
    tone: e2Regime === 'RED' ? 'danger' : e2Regime === 'AMBER' ? 'warning' : 'success',
    blocking: e2Blocking,
    regime: e2Regime,
    scale_factor: e2Scale,
    reasons: [...new Set(e2Reasons)],
    metric: `${e2MaxDd.toFixed(1)}% · ${e2Scale.toFixed(1)}x`,
  }

  // E3: Funded Breach Postmortem (OPS-6 signed BOT_BUG | SLIPPAGE | VARIANCE)
  const e3Breaches = new Map()
  for (const ev of transitions) {
    if (ev.to_state !== 'E3_FUNDED_BREACH_POSTMORTEM') continue
    const ts = parseUtcMs(ev.utc_ts)
    const prev = e3Breaches.get(ev.account_id)
    if (prev === undefined || (ts !== null && (prev === null || ts > prev))) e3Breaches.set(ev.account_id, ts)
  }
  for (const acct of accounts) {
    if (acct.state !== 'E3_FUNDED_BREACH_POSTMORTEM') continue
    const ts = parseUtcMs(acct.last_transition_utc)
    if (!e3Breaches.has(acct.account_id)) e3Breaches.set(acct.account_id, ts)
  }
  const rawPms = options.ops6Postmortems || ledger?.ops6_postmortems || []
  const pmList = Array.isArray(rawPms) ? rawPms : isPlainObject(rawPms) ? Object.entries(rawPms).map(([k, v]) => ({ account_id: k, ...v })) : []
  const unresolvedE3 = []
  const e3Extra = []
  for (const [aid, breachMs] of e3Breaches.entries()) {
    const acct = accounts.find(a => a.account_id === aid)
    const candidates = [...pmList.filter(p => p?.account_id === aid), ...(acct?.ops6_postmortem ? [{ account_id: aid, ...acct.ops6_postmortem }] : [])]
    let resolved = false
    let extra = ''
    for (const cand of candidates) {
      const res = validateOps6Postmortem(cand, aid, breachMs, nowMs)
      if (res === true) {
        resolved = true
        break
      }
      if (typeof res === 'string') extra = res
    }
    if (!resolved) {
      unresolvedE3.push(aid)
      if (extra) e3Extra.push(extra)
    }
  }
  const e3Blocking = unresolvedE3.length > 0
  const guardE3 = {
    code: 'E3',
    id: 'E3_FUNDED_BREACH_POSTMORTEM',
    status: e3Blocking ? 'BLOCK' : 'PASS',
    tone: e3Blocking ? 'danger' : 'success',
    blocking: e3Blocking,
    reasons: e3Blocking ? [...new Set(['E3_FUNDED_BREACH_UNRESOLVED_POSTMORTEM', ...e3Extra])] : [],
    metric: e3Blocking ? `${unresolvedE3.length} open` : '0 breaches',
  }

  // E4: Cap (FTMO $400K Funded / $200K Challenge), Concurrency & VPS Budget
  let ftmoCommittedUsd = 0
  let activeEvals = 0
  let activeFunded = 0
  const firmCounts = new Map()
  const e4Reasons = []
  const e4Warnings = []
  for (const acct of accounts) {
    const firm = normalizeFirmKey(acct.firm_id || acct.firm_profile)
    const baseCap = Number(acct.base_capital_usd ?? acct.capital_usd ?? 0)
    if (ACTIVE_EVAL_STATES.has(acct.state)) activeEvals += 1
    if (ACTIVE_FUNDED_STATES.has(acct.state)) activeFunded += 1
    if (OCCUPYING_SLOT_STATES.has(acct.state)) {
      firmCounts.set(firm, (firmCounts.get(firm) || 0) + 1)
    }
    if (firm === 'ftmo' && COMMITTED_FUNDED_CAP_STATES.has(acct.state)) ftmoCommittedUsd += baseCap
    if (firm === 'ftmo' && ACTIVE_EVAL_STATES.has(acct.state) && baseCap > FTMO_MAX_SINGLE_CHALLENGE_USD) {
      e4Reasons.push('E4_FTMO_SINGLE_CHALLENGE_200K_CAP_EXCEEDED')
    }
  }
  const maxEvals = isStrictNonNegativeInt(policy.max_concurrent_evals) ? policy.max_concurrent_evals : 2
  const maxFunded = isStrictNonNegativeInt(policy.max_concurrent_funded) ? policy.max_concurrent_funded : 4
  const maxPerFirm = isStrictNonNegativeInt(policy.max_accounts_per_firm) ? policy.max_accounts_per_firm : 3

  if (ftmoCommittedUsd > FTMO_MAX_ACTIVE_FUNDED_USD) e4Reasons.push('E4_FTMO_400K_FUNDED_CAP_EXCEEDED')
  else if (ftmoCommittedUsd >= FTMO_MAX_ACTIVE_FUNDED_USD * 0.8) e4Warnings.push('E4_FTMO_CAP_NEAR_LIMIT')
  if (activeEvals > maxEvals) e4Reasons.push('E4_MAX_CONCURRENT_EVALS_EXCEEDED')
  if (activeFunded > maxFunded) e4Reasons.push('E4_MAX_CONCURRENT_FUNDED_EXCEEDED')
  for (const count of firmCounts.values()) {
    if (count > maxPerFirm) e4Reasons.push('E4_FIRM_SLOT_LIMIT_EXCEEDED')
  }
  const vps = options.vpsTelemetry || ledger?.vps_telemetry
  if (isPlainObject(vps)) {
    if (isStrictFiniteNumber(vps.cpu_util_pct) && vps.cpu_util_pct > VPS_DEFAULT_BUDGET.max_cpu_util_pct) e4Reasons.push('E4_VPS_CPU_OVERFLOW')
    if (isStrictFiniteNumber(vps.free_ram_gb) && vps.free_ram_gb < VPS_DEFAULT_BUDGET.min_free_ram_gb) e4Reasons.push('E4_VPS_RAM_OVERFLOW')
    if (isStrictNonNegativeInt(vps.active_mt5_terminals) && vps.active_mt5_terminals > VPS_DEFAULT_BUDGET.max_mt5_terminals) e4Reasons.push('E4_VPS_MAX_MT5_TERMINALS_EXCEEDED')
  }
  const e4Blocking = e4Reasons.length > 0
  const e4Warn = !e4Blocking && e4Warnings.length > 0
  const guardE4 = {
    code: 'E4',
    id: 'E4_CAP_OR_VPS_OVERFLOW',
    status: e4Blocking ? 'BLOCK' : e4Warn ? 'WARNING' : 'PASS',
    tone: e4Blocking ? 'danger' : e4Warn ? 'warning' : 'success',
    blocking: e4Blocking,
    reasons: [...new Set([...e4Reasons, ...e4Warnings])],
    metric: `$${Math.round(ftmoCommittedUsd / 1000)}K / $400K`,
  }

  // E5: Cross-Account Opposite Hedge, Duplicate Magic Ranges & Portable Dirs
  const e5Reasons = []
  const activeRoster = accounts.filter(a => !['CLOSED_ARCHIVED', 'E1_EVAL_FAIL_COOLDOWN'].includes(a.state))
  const seenMagic = new Map()
  const seenRanges = []
  const seenDirs = new Map()
  const signals = Array.isArray(options.activeSignals) ? [...options.activeSignals] : Array.isArray(ledger?.active_signals) ? [...ledger.active_signals] : []

  for (const acct of activeRoster) {
    const aid = acct.account_id
    const firm = normalizeFirmKey(acct.firm_id || acct.firm_profile)
    for (const k of ['magic_number', 'magic']) {
      if (acct[k] != null) {
        const m = acct[k]
        if (!isStrictNonNegativeInt(m) || m < 1) e5Reasons.push('E5_INVALID_MAGIC_SPEC')
        else if (seenMagic.has(m) && seenMagic.get(m) !== aid) e5Reasons.push('E5_DUPLICATE_MAGIC_NUMBER')
        else seenMagic.set(m, aid)
      }
    }
    if (Array.isArray(acct.magic_range) && acct.magic_range.length === 2) {
      const [lo, hi] = acct.magic_range
      if (!isStrictNonNegativeInt(lo) || !isStrictNonNegativeInt(hi) || lo < 1 || lo > hi) {
        e5Reasons.push('E5_INVALID_MAGIC_RANGE')
      } else {
        for (const [pLo, pHi, pAid] of seenRanges) {
          if (pAid !== aid && !(hi < pLo || lo > pHi)) e5Reasons.push('E5_MAGIC_RANGE_COLLISION')
        }
        seenRanges.push([lo, hi, aid])
      }
    }
    const rawDir = acct.mt5_portable_dir ?? acct.portable_dir ?? acct.terminal_dir
    if (rawDir !== undefined) {
      const normDir = normalizePortableDir(rawDir)
      if (!normDir) e5Reasons.push('E5_INVALID_PORTABLE_DIR')
      else {
        if (normDir.startsWith('e:\\') || normDir === 'e:') e5Reasons.push('E5_FORBIDDEN_PORTABLE_DRIVE_E')
        if (seenDirs.has(normDir) && seenDirs.get(normDir) !== aid) e5Reasons.push('E5_DUPLICATE_PORTABLE_DIR')
        else seenDirs.set(normDir, aid)
      }
    }
    for (const key of ['active_positions', 'active_signals', 'open_exposures']) {
      if (Array.isArray(acct[key])) {
        for (const sig of acct[key]) {
          signals.push({ ...sig, firm: sig.firm || sig.firm_id || firm, account_id: sig.account_id || aid })
        }
      }
    }
  }
  for (const [m, aid] of seenMagic.entries()) {
    for (const [lo, hi, rngAid] of seenRanges) {
      if (rngAid !== aid && m >= lo && m <= hi) e5Reasons.push('E5_MAGIC_RANGE_COLLISION')
    }
  }
  const byFirmSym = new Map()
  for (const sig of signals) {
    const firm = normalizeFirmKey(sig?.firm || sig?.firm_id || sig?.firm_profile)
    const root = normalizeSymbolRoot(sig?.symbol)
    const dir = normalizeDirection(sig?.direction ?? sig?.side)
    const aid = String(sig?.account_id || sig?.account_login || '')
    if (!firm || !root || !dir || !aid) continue
    const key = `${firm}|${root}`
    if (!byFirmSym.has(key)) byFirmSym.set(key, [])
    byFirmSym.get(key).push({ aid, dir })
  }
  for (const entries of byFirmSym.values()) {
    const hasBuy = entries.some(e => e.dir === 'BUY')
    const hasSell = entries.some(e => e.dir === 'SELL')
    const uniqueAccts = new Set(entries.map(e => e.aid))
    if (hasBuy && hasSell && uniqueAccts.size >= 2) e5Reasons.push('E5_SAME_FIRM_OPPOSITE_HEDGE')
  }
  const e5Blocking = e5Reasons.length > 0
  const guardE5 = {
    code: 'E5',
    id: 'E5_CROSS_ACCOUNT_OPPOSITE_HEDGE',
    status: e5Blocking ? 'BLOCK' : 'PASS',
    tone: e5Blocking ? 'danger' : 'success',
    blocking: e5Blocking,
    reasons: [...new Set(e5Reasons)],
    metric: e5Blocking ? `${new Set(e5Reasons).size} conflict` : '0 conflicts',
  }

  // E6: Inactivity (21d/27d/30d), Preset SHA-256 Drift & Heartbeat/NTP
  const e6Reasons = []
  const e6Warnings = []
  let maxInactDays = 0
  let urgent27 = false
  for (const acct of accounts) {
    if (!LIVE_RUNNING_STATES.has(acct.state)) continue
    const days = acct.days_since_last_trade
    if (!isStrictFiniteNumber(days, { min: 0 })) {
      e6Reasons.push('E6_POISONED_INACTIVITY_DAYS')
    } else {
      if (days > maxInactDays) maxInactDays = days
      if (days >= E6_INACTIVITY_LOCK_DAYS) e6Reasons.push('E6_INACTIVITY_30D_LOCK')
      else if (days >= E6_INACTIVITY_RED_DAYS) {
        urgent27 = true
        e6Warnings.push('E6_INACTIVITY_27D_URGENT')
      } else if (days >= E6_INACTIVITY_AMBER_DAYS) {
        e6Warnings.push('E6_INACTIVITY_21D_WARNING')
      }
    }
    if (!isValidSha256Hex(acct.preset_sha256)) {
      e6Reasons.push('E6_PRESET_SHA256_MISSING_OR_INVALID')
    } else if (acct.expected_preset_sha256 && acct.preset_sha256 !== acct.expected_preset_sha256) {
      e6Reasons.push('PRESET_SHA256_DRIFT')
    }
  }
  if (isPlainObject(vps)) {
    if (isStrictFiniteNumber(vps.ntp_offset_ms) && Math.abs(vps.ntp_offset_ms) >= E6_NTP_MAX_OFFSET_MS) {
      e6Reasons.push('E6_NTP_OFFSET_EXCEEDED')
    }
    if (vps.heartbeat_utc) {
      const hbMs = parseUtcMs(vps.heartbeat_utc)
      if (hbMs === null || (nowMs - hbMs) / 1000 > E6_MAX_HEARTBEAT_AGE_SEC) e6Reasons.push('E6_HEARTBEAT_STALE')
    }
  }
  const e6Blocking = e6Reasons.length > 0
  const guardE6 = {
    code: 'E6',
    id: 'E6_INACTIVITY_OR_FEED_STALE_LOCK',
    status: e6Blocking ? 'BLOCK' : urgent27 ? 'URGENT' : e6Warnings.length > 0 ? 'WARNING' : 'PASS',
    tone: e6Blocking || urgent27 ? 'danger' : e6Warnings.length > 0 ? 'warning' : 'success',
    blocking: e6Blocking,
    reasons: [...new Set([...e6Reasons, ...e6Warnings])],
    metric: `${maxInactDays.toFixed(0)}d / 30d`,
  }

  const guards = [guardE1, guardE2, guardE3, guardE4, guardE5, guardE6]
  const activeBlockingGuards = guards.filter(g => g.blocking)
  const activeWarnings = guards.filter(g => !g.blocking && g.status !== 'PASS')

  let fleetRiskState = 'GREEN'
  if (e2Regime === 'RED' || activeBlockingGuards.some(g => g.tone === 'danger')) fleetRiskState = 'RED'
  else if (e2Regime === 'AMBER' || activeBlockingGuards.length > 0 || activeWarnings.length > 0) fleetRiskState = 'AMBER'

  // FTMO Scaling Plan tracker (+25% every 4m if >= 10% net & >= 2 payouts, cap $2M)
  const scalingAccounts = accounts
    .filter(a => normalizeFirmKey(a.firm_id || a.firm_profile) === 'ftmo' && ACTIVE_FUNDED_STATES.has(a.state))
    .map(a => {
      const openedMs = parseUtcMs(a.opened_utc)
      const elapsedDays = openedMs !== null ? Math.max(0, (nowMs - openedMs) / 86400000) : 0
      const elapsedMonths = elapsedDays / 30
      const netProfitPct = a.capital_usd > 0 ? ((Number(a.cumulative_gross_payout_usd || 0) + Math.max(0, Number(a.equity_usd || 0) - a.capital_usd)) / a.capital_usd) * 100 : 0
      const payouts = Number(a.payout_cycles_completed || 0)
      const eligible = elapsedMonths >= FTMO_SCALING_PLAN.min_months && netProfitPct >= FTMO_SCALING_PLAN.min_net_return_pct && payouts >= FTMO_SCALING_PLAN.min_payout_cycles && a.capital_usd < FTMO_SCALING_PLAN.max_allocation_usd
      const nextCap = Math.min(FTMO_SCALING_PLAN.max_allocation_usd, round2(a.capital_usd * (1 + FTMO_SCALING_PLAN.step_pct / 100)))
      return {
        account_id: a.account_id,
        current_capital_usd: a.capital_usd,
        next_capital_usd: nextCap,
        elapsed_months: round2(elapsedMonths),
        net_profit_pct: round2(netProfitPct),
        payout_cycles_completed: payouts,
        eligible,
      }
    })

  return {
    fleetRiskState,
    fleetScaleFactor: e2Scale,
    allowed: activeBlockingGuards.length === 0,
    newChallengeAllowed: activeBlockingGuards.length === 0,
    guards,
    activeBlockingGuards,
    activeWarnings,
    ftmoCommittedUsd: round2(ftmoCommittedUsd),
    scalingAccounts,
  }
}

// ---------------------------------------------------------------------------
// Derived KPIs & Export Builder
// ---------------------------------------------------------------------------
export function deriveFleetKpis(ledger, guardEval) {
  const rate = isStrictFiniteNumber(ledger?.usd_vnd_rate, { strictlyPositive: true }) ? ledger.usd_vnd_rate : null
  const snap = ledger?.treasury_snapshot || {}
  const summary = ledger?.fleet_summary || recomputeFleetSummary(ledger || { accounts: [] })
  const houseUsd = isStrictFiniteNumber(snap.house_money_usd, { min: 0 }) ? snap.house_money_usd : null
  const upgradeUsd = isStrictFiniteNumber(snap.upgrade_challenge_usd, { min: 0 }) ? snap.upgrade_challenge_usd : null
  const ownBookUsd = isStrictFiniteNumber(snap.own_book_usd, { min: 0 }) ? snap.own_book_usd : null
  const totalReserveUsd = houseUsd !== null && upgradeUsd !== null && ownBookUsd !== null ? round2(houseUsd + upgradeUsd + ownBookUsd) : null
  const settledPayoutsUsd = isStrictFiniteNumber(snap.settled_cash_summary?.settled_payouts_net_usd, { min: 0 })
    ? snap.settled_cash_summary.settled_payouts_net_usd
    : isStrictFiniteNumber(summary.total_settled_payouts_net_usd, { min: 0 }) ? summary.total_settled_payouts_net_usd : null
  const activeFundedNominalUsd = isStrictFiniteNumber(summary.total_funded_nominal_usd, { min: 0 }) ? summary.total_funded_nominal_usd : null
  const capPct = activeFundedNominalUsd !== null ? round2((activeFundedNominalUsd / FTMO_MAX_ACTIVE_FUNDED_USD) * 100) : null

  return {
    usdVndRate: rate,
    houseMoneyUsd: houseUsd,
    upgradeChallengeUsd: upgradeUsd,
    ownBookUsd,
    totalReserveUsd,
    totalReserveVnd: totalReserveUsd !== null && rate !== null ? Math.round(totalReserveUsd * rate) : null,
    settledPayoutsNetUsd: settledPayoutsUsd,
    settledPayoutsNetVnd: settledPayoutsUsd !== null && rate !== null ? Math.round(settledPayoutsUsd * rate) : null,
    activeFundedNominalUsd,
    activeFundedNominalVnd: activeFundedNominalUsd !== null && rate !== null ? Math.round(activeFundedNominalUsd * rate) : null,
    ftmoCapUsd: FTMO_MAX_ACTIVE_FUNDED_USD,
    ftmoCapPct: capPct,
    activeFundedCount: summary.active_funded_count,
    activeEvalCount: summary.active_eval_count,
    totalAccounts: summary.total_accounts,
    transitionsCount: Array.isArray(ledger?.transitions) ? ledger.transitions.length : 0,
    fleetRiskState: guardEval?.fleetRiskState || 'GREEN',
    fleetScaleFactor: guardEval?.fleetScaleFactor ?? 1.0,
    blockingCount: guardEval?.activeBlockingGuards?.length ?? 0,
  }
}

export function buildExportLedger(ledger, nowUtc) {
  const checked = validateFleetLedger(ledger)
  if (!checked.ok) {
    throw new Error(`${checked.code}: ${checked.message}`)
  }
  const out = structuredClone(checked.ledger)
  out.schema_version = SCHEMA_VERSION
  out.order_send_capable = false
  out.order_send_count = 0
  out.holdout_cutoff_date = HOLDOUT_CUTOFF_DATE
  out.holdout_rows_analysed = 0
  out.updated_utc = formatUtcIso(nowUtc || new Date())
  out.fleet_summary = recomputeFleetSummary(out)
  out.report_sha256 = canonicalPayloadSha256(out)
  return out
}

// ---------------------------------------------------------------------------
// localStorage Draft Persistence (`naqex.prop-fleet.draft.v1:${workspace}`)
// ---------------------------------------------------------------------------
export function draftStorageKey(workspace = 'tenant-a') {
  return `naqex.prop-fleet.draft.v1:${String(workspace || 'tenant-a').trim() || 'tenant-a'}`
}

export function loadWorkspaceDraft(workspace, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return { status: 'unavailable', ledger: null }
  try {
    const raw = storage.getItem(draftStorageKey(workspace))
    if (!raw) return { status: 'empty', ledger: null }
    const parsed = JSON.parse(raw)
    const candidate = isPlainObject(parsed) && isPlainObject(parsed.ledger) ? parsed.ledger : parsed
    const validated = validateFleetLedger(candidate)
    if (!validated.ok) return { status: 'invalid', code: validated.code, ledger: null }
    return {
      status: 'ok',
      ledger: validated.ledger,
      source: parsed?.source || 'local_draft',
      savedUtc: parsed?.savedUtc || validated.ledger.updated_utc,
    }
  } catch {
    return { status: 'storage_error', ledger: null }
  }
}

export function saveWorkspaceDraft(workspace, ledger, source = 'local_draft', storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return { ok: false, reason: 'storage_unavailable' }
  const checked = validateFleetLedger(ledger)
  if (!checked.ok) return { ok: false, reason: checked.code }
  try {
    storage.setItem(draftStorageKey(workspace), JSON.stringify({
      source,
      savedUtc: formatUtcIso(new Date()),
      ledger: checked.ledger,
    }))
    return { ok: true }
  } catch {
    return { ok: false, reason: 'storage_denied_or_quota' }
  }
}

export function clearWorkspaceDraft(workspace, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return { ok: false }
  try {
    storage.removeItem(draftStorageKey(workspace))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// ---------------------------------------------------------------------------
// Pareto Summary JSON Import Validator (`wave4_pareto_summary.json`)
// ---------------------------------------------------------------------------
export function validateParetoImport(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'INVALID_PARETO_JSON', message: 'Pareto summary must be a JSON object.' }
  }
  if (raw.order_send_capable === true || (raw.order_send_count !== undefined && raw.order_send_count !== 0)) {
    return { ok: false, code: 'ORDER_SEND_CAPABLE_TAMPER', message: 'HARD REJECT: Pareto artifact violated order_send_capable === false.' }
  }
  if (raw.holdout_rows_analysed !== undefined && raw.holdout_rows_analysed !== 0) {
    return { ok: false, code: 'HOLDOUT_LEAK_DETECTED', message: 'HARD REJECT: Pareto artifact violated holdout_rows_analysed === 0.' }
  }
  const rate = isStrictFiniteNumber(raw.usd_vnd_rate, { strictlyPositive: true }) ? raw.usd_vnd_rate : 25765.94

  // Support both compact summary (`tier_pareto_highlights` / `tiers`) and raw case lists
  let tiers = []
  if (Array.isArray(raw.tiers) && raw.tiers.length > 0) {
    tiers = raw.tiers
  } else if (isPlainObject(raw.tier_pareto_highlights)) {
    tiers = Object.entries(raw.tier_pareto_highlights).map(([tierKey, item]) => {
      const mVnd = Number(item?.bankroll_m_vnd ?? tierKey)
      const h12 = item?.horizons?.['12m'] || item?.horizon_12m || {}
      return {
        bankroll_m_vnd: mVnd,
        bankroll_usd: round2((mVnd * 1e6) / rate),
        concurrency_mode: item?.concurrency_mode || 'GATED_STAGGER',
        allocation_policy: item?.allocation_policy || 'P2_BALANCED_40_40_20',
        starter_ladder: item?.starter_ladder || item?.case_id || 'FTMO Ladder',
        max_base_funded_usd: Number(item?.max_active_base_funded_usd ?? item?.max_base_funded_usd ?? 0),
        pass_12m_pct: Number(h12.pass_pct ?? item?.pass_12m_pct ?? 0),
        fail_12m_pct: Number(h12.fail_pct ?? item?.fail_12m_pct ?? 0),
        pending_12m_pct: Number(h12.pending_pct ?? item?.pending_12m_pct ?? 0),
        ruin_36m_pct: Number(item?.ruin_36m_pct ?? item?.prob_ruin_pct ?? 0),
        median_net_36m_vnd: Math.round(Number(item?.median_net_36m_vnd ?? (Number(item?.median_net_36m_usd || 0) * rate))),
        own_book_crossover_month: item?.own_book_crossover_month ?? null,
        tier_note_vi: item?.tier_note_vi || 'Dữ liệu nhập từ báo cáo Pareto Wave 4.',
        tier_note_en: item?.tier_note_en || 'Imported from Wave 4 Pareto summary report.',
      }
    }).sort((a, b) => a.bankroll_m_vnd - b.bankroll_m_vnd)
  }

  if (!tiers.length) {
    return { ok: false, code: 'PARETO_TIERS_MISSING', message: 'No valid bankroll tiers found in imported Pareto JSON.' }
  }
  for (const row of tiers) {
    if (!isStrictFiniteNumber(row.bankroll_m_vnd, { strictlyPositive: true })) {
      return { ok: false, code: 'INVALID_PARETO_TIER', message: 'Every Pareto row must have positive bankroll_m_vnd.' }
    }
    const sum = Number(row.pass_12m_pct || 0) + Number(row.fail_12m_pct || 0) + Number(row.pending_12m_pct || 0)
    if (Math.abs(sum - 100) > 0.25) {
      return { ok: false, code: 'PARETO_PROB_SUM_MISMATCH', message: `Tier ${row.bankroll_m_vnd}tr Pass+Fail+Pending must sum to 100%, got ${sum.toFixed(2)}%.` }
    }
  }

  return {
    ok: true,
    pareto: {
      schema_version: String(raw.schema_version || 'naqex-wave4-pareto-summary-v1'),
      is_fixture_preview: Boolean(raw.is_fixture_preview),
      source_label: raw.is_fixture_preview ? 'FIXTURE_PREVIEW_BASELINE' : 'IMPORTED_PARETO_JSON',
      resolution_label_vi: raw.resolution_label_vi || 'XẤP XỈ CẤP NGÀY',
      resolution_tag: raw.resolution_tag || 'APPROX_DAILY_RESOLUTION',
      order_send_capable: false,
      order_send_count: 0,
      holdout_cutoff_date: HOLDOUT_CUTOFF_DATE,
      holdout_rows_analysed: 0,
      usd_vnd_rate: rate,
      tiers,
    },
  }
}
