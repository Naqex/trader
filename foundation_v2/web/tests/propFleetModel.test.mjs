import test from 'node:test'
import assert from 'node:assert/strict'
import { createBundledFleetLedger, createBundledParetoPreview } from '../src/propFleetFixture.js'
import {
  ALLOWED_TRANSITIONS,
  CANONICAL_STATES,
  FORWARD_TRANSITIONS,
  GENESIS_EVENT_SHA256,
  HOLDOUT_CUTOFF_DATE,
  ORDER_SEND_CAPABLE,
  ORDER_SEND_COUNT,
  PRESET_MODE_EVAL_P1_SPRINT,
  PRESET_MODE_EVAL_P2_SPRINT,
  PRESET_MODE_FUNDED_1X,
  SCHEMA_VERSION,
  applyDraftTransition,
  buildExportLedger,
  clearWorkspaceDraft,
  deriveFleetKpis,
  draftStorageKey,
  evaluateFleetGuards,
  loadWorkspaceDraft,
  saveWorkspaceDraft,
  sha256Hex,
  validateFleetLedger,
  validateParetoImport,
} from '../src/propFleetModel.js'

const VALID_SHA_A = 'a'.repeat(64)
const VALID_SHA_B = 'b'.repeat(64)
const VALID_SHA_C = 'c'.repeat(64)
const VALID_SHA_D = 'd'.repeat(64)

test('FIPS 180-4 pure-JS sha256Hex matches canonical NIST test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('bundled sample fixture validates cleanly and matches hard safety invariants', () => {
  assert.equal(ORDER_SEND_CAPABLE, false)
  assert.equal(ORDER_SEND_COUNT, 0)
  assert.equal(HOLDOUT_CUTOFF_DATE, '2024-12-31')
  assert.equal(CANONICAL_STATES.length, 8)
  assert.equal(FORWARD_TRANSITIONS.length, 7)

  const ledger = createBundledFleetLedger()
  const checked = validateFleetLedger(ledger)
  assert.equal(checked.ok, true)
  assert.equal(checked.ledger.schema_version, SCHEMA_VERSION)
  assert.equal(checked.ledger.accounts.length, 4)
  assert.equal(checked.ledger.transitions.length, 13)
  assert.equal(checked.ledger.transitions[0].prev_event_sha256, GENESIS_EVENT_SHA256)

  const guards = evaluateFleetGuards(checked.ledger)
  assert.equal(guards.fleetRiskState, 'GREEN')
  assert.equal(guards.fleetScaleFactor, 1.0)
  assert.equal(guards.newChallengeAllowed, true)
  assert.equal(guards.guards.length, 6)

  const kpis = deriveFleetKpis(checked.ledger, guards)
  assert.equal(kpis.activeFundedNominalUsd, 10000)
  assert.equal(kpis.settledPayoutsNetUsd, 486.08)
  assert.equal(kpis.houseMoneyUsd, 166.43)
  assert.equal(kpis.upgradeChallengeUsd, 166.43)
  assert.equal(kpis.ownBookUsd, 221.91)
})

test('full S0->S1->S2->S3->S4->S5->S6->S7 lifecycle succeeds with hash-chained events and 3-bucket allocation', () => {
  let ledger = createBundledFleetLedger()
  const id = 'FTMO-STD25K-004'

  // S0 -> S1
  let res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S1_CHALLENGE_P1',
    open_positions: 0,
    ops2_preflight_pass: true,
    preset_mode: PRESET_MODE_EVAL_P1_SPRINT,
    preset_name: 'FTMO_Std25K_P1_Sprint_4_5x.set',
    preset_sha256: VALID_SHA_A,
    utc_ts: '2026-11-28T08:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger

  // S1 -> S2
  res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S2_PASS_P1_HANDOFF',
    open_positions: 0,
    ops2_preflight_pass: true,
    equity_usd: 27600,
    trading_days_completed: 5,
    utc_ts: '2026-12-08T16:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger

  // S2 -> S3
  res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S3_CHALLENGE_P2',
    open_positions: 0,
    ops2_preflight_pass: true,
    preset_mode: PRESET_MODE_EVAL_P2_SPRINT,
    preset_name: 'FTMO_Std25K_P2_Sprint_3_5x.set',
    preset_sha256: VALID_SHA_B,
    expected_preset_sha256: VALID_SHA_B,
    utc_ts: '2026-12-09T08:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger

  // S3 -> S4
  res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S4_PASS_P2_TO_FUNDED_LOCK',
    open_positions: 0,
    ops2_preflight_pass: true,
    equity_usd: 26300,
    trading_days_completed: 4,
    utc_ts: '2026-12-18T16:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger

  // S4 -> S5 (Dual-Lock Gate)
  res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S5_FUNDED_ACTIVE',
    open_positions: 0,
    ops2_preflight_pass: true,
    preset_mode: PRESET_MODE_FUNDED_1X,
    preset_name: 'FTMO_Std25K_Funded_Safe_1x.set',
    preset_sha256: VALID_SHA_C,
    expected_preset_sha256: VALID_SHA_C,
    utc_ts: '2026-12-19T08:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger
  assert.equal(ledger.fleet_summary.total_funded_nominal_usd, 35000)

  // S5 -> S6
  res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S6_PAYOUT_AUDIT_AND_HARVEST',
    open_positions: 0,
    ops2_preflight_pass: true,
    ops5_audit_bundle_sha256: VALID_SHA_D,
    equity_usd: 26250,
    utc_ts: '2027-01-03T16:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger

  // S6 -> S7
  res = applyDraftTransition(ledger, {
    account_id: id,
    to_state: 'S7_AFTER_PAYOUT_ALLOCATOR',
    open_positions: 0,
    ops2_preflight_pass: true,
    payout_gross_usd: 1250,
    withdrawal_fee_usd: 15,
    fx_bank_fee_usd: 5,
    fee_refund_usd: 220.5,
    utc_ts: '2027-01-05T10:00:00Z',
  })
  assert.equal(res.ok, true, res.message)
  ledger = res.ledger
  assert.equal(res.event.allocation_result.net_settled_payout_usd, 980)
  assert.equal(res.event.allocation_result.total_settled_cash_usd, 1200.5)
  assert.equal(ledger.transitions.length, 20)
  assert.equal(validateFleetLedger(ledger).ok, true)
})

test('S4->S5 fails closed on Eval .set mode, Eval filename, open_positions != 0, ops2_preflight_pass=false, or SHA drift', () => {
  const ledger = createBundledFleetLedger()
  const base = {
    account_id: 'FTMO-SWING10K-002',
    to_state: 'S5_FUNDED_ACTIVE',
    open_positions: 0,
    ops2_preflight_pass: true,
    preset_mode: PRESET_MODE_FUNDED_1X,
    preset_name: 'FTMO_Swing10K_Funded_Safe_1x.set',
    preset_sha256: VALID_SHA_A,
  }

  // Eval preset mode blocked
  let res = applyDraftTransition(ledger, { ...base, preset_mode: PRESET_MODE_EVAL_P1_SPRINT })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EVAL_PRESET_FORBIDDEN_ON_FUNDED')

  // Eval preset filename blocked even when mode is FUNDED_1X
  res = applyDraftTransition(ledger, { ...base, preset_name: 'FTMO_Swing10K_P1_Sprint_4_5x.set' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'EVAL_PRESET_FORBIDDEN_ON_FUNDED')

  // Non-zero open_positions blocked
  res = applyDraftTransition(ledger, { ...base, open_positions: 1 })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'OPEN_POSITIONS_NONZERO_HANDOFF')

  // Poisoned open_positions types (bool, NaN, float, negative) blocked
  for (const bad of [true, false, NaN, -1, 0.5, null, '0']) {
    res = applyDraftTransition(ledger, { ...base, open_positions: bad })
    assert.equal(res.ok, false)
    assert.equal(res.code, 'INVALID_OPEN_POSITIONS')
  }

  // ops2_preflight_pass=false blocked
  res = applyDraftTransition(ledger, { ...base, ops2_preflight_pass: false })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'OPS2_PREFLIGHT_NOT_PASSED')

  // Missing / drifted preset_sha256 blocked
  res = applyDraftTransition(ledger, { ...base, preset_sha256: 'not-a-sha' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PRESET_SHA256_MISSING_OR_INVALID')

  res = applyDraftTransition(ledger, { ...base, preset_sha256: VALID_SHA_A, expected_preset_sha256: VALID_SHA_B })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PRESET_SHA256_DRIFT')

  // Phase skip S0->S5 blocked
  res = applyDraftTransition(ledger, { ...base, account_id: 'FTMO-STD25K-004' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'INVALID_STATE_TRANSITION')
  assert.deepEqual(ALLOWED_TRANSITIONS.CLOSED_ARCHIVED, [])

  // Original ledger must remain completely unmutated
  const swing = ledger.accounts.find(a => a.account_id === 'FTMO-SWING10K-002')
  assert.equal(swing.state, 'S4_PASS_P2_TO_FUNDED_LOCK')
})

test('E1..E6 fleet guards trigger deterministically across failure boundaries', () => {
  // E1: >= 2 trailing 30d eval fails blocks without OPS-6 receipt
  const e1Ledger = createBundledFleetLedger()
  const lastSha = e1Ledger.transitions.at(-1).event_sha256
  e1Ledger.transitions.push(
    { event_id: 'EVT-000014', seq: 14, utc_ts: '2026-11-20T08:00:00Z', account_id: 'A1', from_state: 'S1_CHALLENGE_P1', to_state: 'E1_EVAL_FAIL_COOLDOWN', actor: 'ops', ops2_preflight_pass: true, open_positions: 0, preset_mode: 'NONE', preset_sha256: '', reason_codes: [], order_send_capable: false, metrics_snapshot: {}, allocation_result: null, prev_event_sha256: lastSha, event_sha256: VALID_SHA_A },
    { event_id: 'EVT-000015', seq: 15, utc_ts: '2026-11-25T08:00:00Z', account_id: 'A2', from_state: 'S1_CHALLENGE_P1', to_state: 'E1_EVAL_FAIL_COOLDOWN', actor: 'ops', ops2_preflight_pass: true, open_positions: 0, preset_mode: 'NONE', preset_sha256: '', reason_codes: [], order_send_capable: false, metrics_snapshot: {}, allocation_result: null, prev_event_sha256: VALID_SHA_A, event_sha256: VALID_SHA_B },
  )
  let evalRes = evaluateFleetGuards(e1Ledger, { nowUtc: '2026-11-27T08:00:00Z' })
  assert.equal(evalRes.guards.find(g => g.code === 'E1').status, 'BLOCK')
  assert.equal(evalRes.newChallengeAllowed, false)

  // E2: Amber (>=3.5% -> 0.5x) & Red (>=6.0% -> 0.0x)
  const e2Amber = createBundledFleetLedger()
  e2Amber.accounts[0].static_dd_pct = 3.8
  evalRes = evaluateFleetGuards(e2Amber)
  assert.equal(evalRes.guards.find(g => g.code === 'E2').regime, 'AMBER')
  assert.equal(evalRes.fleetScaleFactor, 0.5)
  assert.equal(evalRes.fleetRiskState, 'AMBER')

  const e2Red = createBundledFleetLedger()
  e2Red.accounts[0].static_dd_pct = 6.2
  evalRes = evaluateFleetGuards(e2Red)
  assert.equal(evalRes.guards.find(g => g.code === 'E2').regime, 'RED')
  assert.equal(evalRes.fleetScaleFactor, 0.0)
  assert.equal(evalRes.fleetRiskState, 'RED')

  // E3: Breached Funded account without signed OPS-6 postmortem blocks
  const e3Ledger = createBundledFleetLedger()
  e3Ledger.accounts[0].state = 'E3_FUNDED_BREACH_POSTMORTEM'
  evalRes = evaluateFleetGuards(e3Ledger)
  assert.equal(evalRes.guards.find(g => g.code === 'E3').status, 'BLOCK')

  // E4: FTMO > 400K Funded cap blocks
  const e4Ledger = createBundledFleetLedger()
  e4Ledger.accounts[0].capital_usd = 450000
  evalRes = evaluateFleetGuards(e4Ledger)
  assert.equal(evalRes.guards.find(g => g.code === 'E4').status, 'BLOCK')
  assert.ok(evalRes.guards.find(g => g.code === 'E4').reasons.includes('E4_FTMO_400K_FUNDED_CAP_EXCEEDED'))

  // E5: Duplicate MagicNumber + Same-firm opposite hedge blocks
  const e5Ledger = createBundledFleetLedger()
  e5Ledger.accounts[0].magic_number = 777001
  e5Ledger.accounts[2].magic_number = 777001
  evalRes = evaluateFleetGuards(e5Ledger, {
    activeSignals: [
      { firm: 'FTMO', account_id: 'FTMO-STD10K-001', symbol: 'EURUSD.pro', direction: 'BUY' },
      { firm: 'FTMO', account_id: 'FTMO-SWING10K-002', symbol: 'EURUSD', direction: 'SELL' },
    ],
  })
  const g5 = evalRes.guards.find(g => g.code === 'E5')
  assert.equal(g5.status, 'BLOCK')
  assert.ok(g5.reasons.includes('E5_DUPLICATE_MAGIC_NUMBER'))
  assert.ok(g5.reasons.includes('E5_SAME_FIRM_OPPOSITE_HEDGE'))

  // E6: Inactivity 21d / 27d / 30d + PRESET_SHA256_DRIFT
  const e6Warn = createBundledFleetLedger()
  e6Warn.accounts[0].days_since_last_trade = 22
  assert.equal(evaluateFleetGuards(e6Warn).guards.find(g => g.code === 'E6').status, 'WARNING')

  const e6Urgent = createBundledFleetLedger()
  e6Urgent.accounts[0].days_since_last_trade = 28
  assert.equal(evaluateFleetGuards(e6Urgent).guards.find(g => g.code === 'E6').status, 'URGENT')

  const e6Lock = createBundledFleetLedger()
  e6Lock.accounts[0].days_since_last_trade = 30
  e6Lock.accounts[0].preset_sha256 = VALID_SHA_A
  const g6 = evaluateFleetGuards(e6Lock).guards.find(g => g.code === 'E6')
  assert.equal(g6.status, 'BLOCK')
  assert.ok(g6.reasons.includes('E6_INACTIVITY_30D_LOCK'))
  assert.ok(g6.reasons.includes('PRESET_SHA256_DRIFT'))
})

test('validateFleetLedger rejects tampered imports fail-closed and buildExportLedger round-trips cleanly', () => {
  const ledger = createBundledFleetLedger()

  // Tampered order_send_capable
  const tamperOrder = { ...structuredClone(ledger), order_send_capable: true }
  assert.equal(validateFleetLedger(tamperOrder).code, 'ORDER_SEND_CAPABLE_TAMPER')

  // Tampered holdout_rows_analysed
  const tamperHoldout = { ...structuredClone(ledger), holdout_rows_analysed: 5 }
  assert.equal(validateFleetLedger(tamperHoldout).code, 'HOLDOUT_LEAK_DETECTED')

  // Broken hash chain
  const brokenChain = structuredClone(ledger)
  brokenChain.transitions[2].prev_event_sha256 = VALID_SHA_D
  assert.equal(validateFleetLedger(brokenChain).code, 'HASH_CHAIN_BROKEN')

  // Funded account with Eval preset rejected on import
  const evalOnFunded = structuredClone(ledger)
  evalOnFunded.accounts[0].preset_mode = PRESET_MODE_EVAL_P1_SPRINT
  assert.equal(validateFleetLedger(evalOnFunded).code, 'EVAL_PRESET_FORBIDDEN_ON_FUNDED')

  // Export & re-import round-trip
  const exported = buildExportLedger(ledger, '2026-11-28T02:00:00Z')
  assert.equal(exported.schema_version, SCHEMA_VERSION)
  assert.equal(exported.order_send_capable, false)
  assert.equal(exported.order_send_count, 0)
  assert.equal(exported.holdout_rows_analysed, 0)
  const reimported = validateFleetLedger(JSON.parse(JSON.stringify(exported)))
  assert.equal(reimported.ok, true)
  assert.equal(reimported.ledger.accounts.length, 4)
  assert.equal(reimported.ledger.transitions.length, 13)
})

test('localStorage draft persistence & Pareto preview validation work fail-closed', () => {
  const store = new Map()
  const mockStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  }
  assert.equal(draftStorageKey('ws-alpha'), 'naqex.prop-fleet.draft.v1:ws-alpha')
  const ledger = createBundledFleetLedger()
  assert.equal(saveWorkspaceDraft('ws-alpha', ledger, 'local_draft', mockStorage).ok, true)
  const loaded = loadWorkspaceDraft('ws-alpha', mockStorage)
  assert.equal(loaded.status, 'ok')
  assert.equal(loaded.ledger.accounts.length, 4)
  clearWorkspaceDraft('ws-alpha', mockStorage)
  assert.equal(loadWorkspaceDraft('ws-alpha', mockStorage).status, 'empty')

  const pareto = createBundledParetoPreview()
  assert.equal(pareto.tiers.length, 9)
  assert.equal(validateParetoImport(pareto).ok, true)
  assert.equal(validateParetoImport({ ...pareto, order_send_capable: true }).code, 'ORDER_SEND_CAPABLE_TAMPER')
})

test('P0-01: E1 fails closed when OPS-6 BOT_BUG receipt omits or falsifies fix_verified', () => {
  const ledger = createBundledFleetLedger()
  const lastSha = ledger.transitions.at(-1).event_sha256
  ledger.transitions.push(
    { event_id: 'EVT-000014', seq: 14, utc_ts: '2026-11-20T08:00:00Z', account_id: 'A1', from_state: 'S1_CHALLENGE_P1', to_state: 'E1_EVAL_FAIL_COOLDOWN', actor: 'ops', ops2_preflight_pass: true, open_positions: 0, preset_mode: 'NONE', preset_sha256: '', reason_codes: [], order_send_capable: false, metrics_snapshot: {}, allocation_result: null, prev_event_sha256: lastSha, event_sha256: VALID_SHA_A },
    { event_id: 'EVT-000015', seq: 15, utc_ts: '2026-11-25T08:00:00Z', account_id: 'A2', from_state: 'S1_CHALLENGE_P1', to_state: 'E1_EVAL_FAIL_COOLDOWN', actor: 'ops', ops2_preflight_pass: true, open_positions: 0, preset_mode: 'NONE', preset_sha256: '', reason_codes: [], order_send_capable: false, metrics_snapshot: {}, allocation_result: null, prev_event_sha256: VALID_SHA_A, event_sha256: VALID_SHA_B },
  )
  const baseReceipt = {
    receipt_id: 'OPS6-E1-20261126',
    signed_by: 'owner',
    signed_utc: '2026-11-26T10:00:00Z',
    approved_to_resume: true,
    report_sha256: VALID_SHA_C,
    root_cause_class: 'BOT_BUG',
  }

  // Omitted fix_verified on BOT_BUG MUST block fail-closed
  let evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6EvalReceipt: baseReceipt })
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.newChallengeAllowed, false)
  let g1 = evalRes.guards.find(g => g.code === 'E1')
  assert.equal(g1.status, 'BLOCK')
  assert.equal(g1.blocking, true)
  assert.ok(g1.reasons.includes('E1_OPS6_BOT_BUG_FIX_UNVERIFIED'))

  // Alternate classification field omitting fix_verified MUST also block fail-closed
  const { root_cause_class: _drop, ...altBase } = baseReceipt
  evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6EvalReceipt: { ...altBase, classification: 'BOT_BUG' } })
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.guards.find(g => g.code === 'E1').status, 'BLOCK')

  // Poisoned / non-true fix_verified values MUST block fail-closed
  for (const badFix of [false, null, 1, 'true', 0]) {
    evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6EvalReceipt: { ...baseReceipt, fix_verified: badFix } })
    assert.equal(evalRes.allowed, false)
    assert.equal(evalRes.guards.find(g => g.code === 'E1').blocking, true)
  }

  // Strict fix_verified === true clears E1 cooldown
  evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6EvalReceipt: { ...baseReceipt, fix_verified: true } })
  assert.equal(evalRes.allowed, true)
  assert.equal(evalRes.newChallengeAllowed, true)
  g1 = evalRes.guards.find(g => g.code === 'E1')
  assert.equal(g1.blocking, false)
  assert.equal(g1.status, 'WARNING')
  assert.ok(g1.reasons.includes('E1_COOLDOWN_CLEARED_BY_OPS6_RECEIPT'))

  // Non-BOT_BUG classification (VARIANCE) without fix_verified clears E1 cooldown
  evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6EvalReceipt: { ...baseReceipt, root_cause_class: 'VARIANCE' } })
  assert.equal(evalRes.allowed, true)
  assert.equal(evalRes.guards.find(g => g.code === 'E1').blocking, false)
})

test('P0-01: E3 fails closed when OPS-6 BOT_BUG postmortem omits or falsifies fix_verified', () => {
  const ledger = createBundledFleetLedger()
  ledger.accounts[0].state = 'E3_FUNDED_BREACH_POSTMORTEM'
  ledger.accounts[0].last_transition_utc = '2026-11-25T10:00:00Z'
  const basePm = {
    account_id: ledger.accounts[0].account_id,
    classification: 'BOT_BUG',
    signed_by: 'owner',
    signed: true,
    signed_utc: '2026-11-26T12:00:00Z',
    report_sha256: VALID_SHA_D,
  }

  // Omitted fix_verified on BOT_BUG postmortem MUST block fail-closed
  let evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6Postmortems: [basePm] })
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.newChallengeAllowed, false)
  let g3 = evalRes.guards.find(g => g.code === 'E3')
  assert.equal(g3.status, 'BLOCK')
  assert.equal(g3.blocking, true)
  assert.ok(g3.reasons.includes('E3_OPS6_BOT_BUG_FIX_UNVERIFIED'))

  // Inline account ops6_postmortem with root_cause_class='BOT_BUG' omitting fix_verified MUST also block
  const inlineLedger = structuredClone(ledger)
  inlineLedger.accounts[0].ops6_postmortem = {
    root_cause_class: 'BOT_BUG',
    signed_by: 'owner',
    signed_utc: '2026-11-26T12:00:00Z',
    postmortem_sha256: VALID_SHA_D,
  }
  evalRes = evaluateFleetGuards(inlineLedger, { nowUtc: '2026-11-27T08:00:00Z' })
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.guards.find(g => g.code === 'E3').status, 'BLOCK')

  // Poisoned / non-true fix_verified values MUST block fail-closed
  for (const badFix of [false, null, 1, 'true', 0]) {
    evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6Postmortems: [{ ...basePm, fix_verified: badFix }] })
    assert.equal(evalRes.allowed, false)
    assert.equal(evalRes.guards.find(g => g.code === 'E3').blocking, true)
  }

  // Strict fix_verified === true resolves E3 postmortem
  evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6Postmortems: [{ ...basePm, fix_verified: true }] })
  assert.equal(evalRes.allowed, true)
  assert.equal(evalRes.newChallengeAllowed, true)
  g3 = evalRes.guards.find(g => g.code === 'E3')
  assert.equal(g3.status, 'PASS')
  assert.equal(g3.blocking, false)

  // SLIPPAGE classification omitting fix_verified resolves E3 postmortem
  evalRes = evaluateFleetGuards(ledger, { nowUtc: '2026-11-27T08:00:00Z', ops6Postmortems: [{ ...basePm, classification: 'SLIPPAGE' }] })
  assert.equal(evalRes.allowed, true)
  assert.equal(evalRes.guards.find(g => g.code === 'E3').status, 'PASS')
})

test('P1-01: E2 triggers Funded DD freeze on S7_AFTER_PAYOUT_ALLOCATOR for DD >= 3.5%, DD >= 6.0%, and OPS-4 RED', () => {
  // Amber DD >= 3.5% on S7 blocks new admission at 0.5x scale
  const s7Amber = createBundledFleetLedger()
  s7Amber.accounts[0].state = 'S7_AFTER_PAYOUT_ALLOCATOR'
  s7Amber.accounts[0].static_dd_pct = 3.5
  s7Amber.accounts[0].daily_dd_pct = 0.0
  s7Amber.accounts[0].ops4_traffic_light = 'GREEN'
  let evalRes = evaluateFleetGuards(s7Amber)
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.newChallengeAllowed, false)
  let g2 = evalRes.guards.find(g => g.code === 'E2')
  assert.equal(g2.blocking, true)
  assert.equal(g2.regime, 'AMBER')
  assert.equal(evalRes.fleetScaleFactor, 0.5)
  assert.ok(g2.reasons.includes('E2_FUNDED_DD_AMBER_FREEZE'))

  // Red DD >= 6.0% on S7 blocks new admission at 0.0x scale
  const s7RedDd = createBundledFleetLedger()
  s7RedDd.accounts[0].state = 'S7_AFTER_PAYOUT_ALLOCATOR'
  s7RedDd.accounts[0].static_dd_pct = 7.0
  s7RedDd.accounts[0].daily_dd_pct = 0.0
  s7RedDd.accounts[0].ops4_traffic_light = 'GREEN'
  evalRes = evaluateFleetGuards(s7RedDd)
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.newChallengeAllowed, false)
  g2 = evalRes.guards.find(g => g.code === 'E2')
  assert.equal(g2.blocking, true)
  assert.equal(g2.status, 'BLOCK')
  assert.equal(g2.regime, 'RED')
  assert.equal(evalRes.fleetScaleFactor, 0.0)
  assert.ok(g2.reasons.includes('E2_FUNDED_DD_RED_FREEZE'))

  // OPS-4 RED on S7 blocks new admission at 0.0x scale even when DD < 3.5%
  const s7Ops4Red = createBundledFleetLedger()
  s7Ops4Red.accounts[0].state = 'S7_AFTER_PAYOUT_ALLOCATOR'
  s7Ops4Red.accounts[0].static_dd_pct = 0.5
  s7Ops4Red.accounts[0].daily_dd_pct = 0.2
  s7Ops4Red.accounts[0].ops4_traffic_light = 'RED'
  evalRes = evaluateFleetGuards(s7Ops4Red)
  assert.equal(evalRes.allowed, false)
  assert.equal(evalRes.newChallengeAllowed, false)
  g2 = evalRes.guards.find(g => g.code === 'E2')
  assert.equal(g2.blocking, true)
  assert.equal(g2.status, 'BLOCK')
  assert.equal(g2.regime, 'RED')
  assert.equal(evalRes.fleetScaleFactor, 0.0)
  assert.ok(g2.reasons.includes('E2_FUNDED_DD_RED_FREEZE'))

  // Clean S7 account (DD < 3.5% & OPS-4 GREEN) passes E2 at 1.0x scale
  const s7Clean = createBundledFleetLedger()
  s7Clean.accounts[0].state = 'S7_AFTER_PAYOUT_ALLOCATOR'
  s7Clean.accounts[0].static_dd_pct = 1.0
  s7Clean.accounts[0].daily_dd_pct = 0.5
  s7Clean.accounts[0].ops4_traffic_light = 'GREEN'
  evalRes = evaluateFleetGuards(s7Clean)
  assert.equal(evalRes.allowed, true)
  assert.equal(evalRes.guards.find(g => g.code === 'E2').status, 'PASS')
  assert.equal(evalRes.fleetScaleFactor, 1.0)
})

test('P1-01: E2 fails closed on poisoned DD or invalid OPS-4 traffic light in S7_AFTER_PAYOUT_ALLOCATOR', () => {
  for (const badDd of [NaN, Infinity, -0.5, true, '2.0', null]) {
    const poisoned = createBundledFleetLedger()
    poisoned.accounts[0].state = 'S7_AFTER_PAYOUT_ALLOCATOR'
    poisoned.accounts[0].static_dd_pct = badDd
    const evalRes = evaluateFleetGuards(poisoned)
    assert.equal(evalRes.allowed, false)
    const g2 = evalRes.guards.find(g => g.code === 'E2')
    assert.equal(g2.blocking, true)
    assert.equal(g2.regime, 'RED')
    assert.equal(evalRes.fleetScaleFactor, 0.0)
    assert.ok(g2.reasons.includes('E2_POISONED_FUNDED_DD_INPUT'))
  }

  const badLight = createBundledFleetLedger()
  badLight.accounts[0].state = 'S7_AFTER_PAYOUT_ALLOCATOR'
  badLight.accounts[0].ops4_traffic_light = 'PURPLE'
  const evalRes = evaluateFleetGuards(badLight)
  assert.equal(evalRes.allowed, false)
  const g2 = evalRes.guards.find(g => g.code === 'E2')
  assert.equal(g2.blocking, true)
  assert.equal(g2.regime, 'RED')
  assert.equal(evalRes.fleetScaleFactor, 0.0)
  assert.ok(g2.reasons.includes('E2_POISONED_OPS4_TRAFFIC_LIGHT'))
})
