import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// The oracle is arithmetic on the generated trend, not the retained single-asset Python service.
export async function verifyNativePortfolioRules({ request, datasets, template, cases }) {
  const initial = 10000, count = 20, expectedLeg = 2
  const cost = { version: 'replay-fixture-cost-v1', spread_basis: 'bid_ask_embedded', commission_per_side_account: '0', minimum_fee_account: '0', slippage_price_per_side: '0', financing_account: '0', quote_to_account_rate: '1', account_ccy: 'USD', rounding_decimals: 2 }
  const identity = 'native-aggregate-'
  for (const outcome of ['target', 'loss']) {
    const id = identity + outcome, attemptId = id + '-attempt'
    const session = structuredClone(template.session), attempt = structuredClone(template.attempt), phase = structuredClone(template.phase)
    const spec = session.profile.phases[0]
    spec.profit_target = { threshold: { amount: outcome === 'target' ? '3' : '1000', percent: null, percent_base: 'initial_capital' }, basis: 'balance', comparator: 'gte' }
    spec.daily_loss = { threshold: { amount: outcome === 'loss' ? '3' : '1000', percent: null, percent_base: 'initial_capital' }, basis: 'balance', comparator: 'lt' }
    spec.overall_drawdown = { ...spec.overall_drawdown, threshold: { amount: '1000', percent: null, percent_base: 'initial_capital' }, basis: 'balance' }
    spec.min_qualifying_days = 1
    if (outcome === 'target') session.profile.phases.push({ ...structuredClone(spec), phase_index: 2, initial_capital: '20000' })
    delete session.profile.profile_hash
    const profileHash = 'sha256:' + createHash('sha256').update(JSON.stringify(session.profile)).digest('hex')
    session.profile.profile_hash = profileHash
    Object.assign(session, { session_id: id, revision: 1, status: 'running' })
    Object.assign(attempt, { session_id: id, attempt_id: attemptId, profile_hash: profileHash, revision: 1, status: 'running', data_version: datasets[0].artifact_sha256, parent_attempt_id: null })
    Object.assign(phase, { session_id: id, attempt_id: attemptId, profile_hash: profileHash, initial_balance: String(initial), balance: String(initial), equity: String(initial), floating_pl: '0', high_water_mark: String(initial), daily_anchor: String(initial), last_event_sequence: 0, qualifying_days: 0, open_positions: 0, pending_orders: 0, virtual_time_utc: attempt.virtual_start_utc, evaluation_quality: 'full_for_declared_model' })
    const resume = { cursor: { bar_index: 0, timestamp_utc: attempt.virtual_start_utc }, open_positions: [], pending_orders: [], setup_metadata: { dataset_ids: datasets.map(d => d.dataset_id) } }
    let prop = await request('POST', '/api/v2/prop/session-bundles', { session, attempt, phase, resume_state: resume }, 201)
    const attemptPath = `/api/v2/prop/sessions/${id}/attempts/${attemptId}`
    const createBody = { dataset_id: datasets[0].dataset_id, dataset_ids: datasets.map(d => d.dataset_id), starting_balance: String(initial), name: id, prop_session_id: id, prop_attempt_id: attemptId, start_timestamp: datasets[0].first_timestamp }
    let record = await request('POST', '/api/v2/replay/sessions', createBody, 201)
    const path = `/api/v2/replay/sessions/${record.record_id}`, feedPath = `${path}/prop/sessions/${id}/attempts/${attemptId}/feed`
    const mutate = async (route, body, status = 200) => {
      const result = await request('POST', `${path}/${route}`, { expected_revision: record.revision, ...body }, status)
      if (status === 200) record = result
      return result
    }
    const eventBody = sequence => ({ replay_event_sequence: sequence, expected_prop_revision: prop.attempt.revision, prop_event_sequence: prop.phase.last_event_sequence + 1 })
    async function flush() {
      const after = prop.resume_state.replay_binding?.last_replay_event_sequence || 0
      for (const event of record.payload.portfolio_execution.ledger.filter(event => event.kind === 'price_mark' && event.sequence > after)) {
        if (prop.attempt.status !== 'running') break
        prop = await request('POST', feedPath, eventBody(event.sequence))
      }
      if (prop.phase.evaluation_quality === 'full_for_declared_model') {
        assert.equal(Number(prop.phase.balance), Number(record.portfolio_account.balance))
        assert.equal(Number(prop.phase.equity), Number(record.portfolio_account.equity))
      } else assert.equal(prop.objectives.technical_status, 'blocked_by_data')
    }
    const init = dataset => ({ instrument_spec: dataset.instrument_spec, cost_model: cost, spread_price: '0', timeframe_seconds: 60, starting_balance: String(initial) })
    const positions = []
    for (let asset = 0; asset < 2; asset++) {
      if (asset) await mutate('asset', { dataset_id: datasets[asset].dataset_id })
      await mutate('orders/quick', { ...init(datasets[asset]), operation_id: `${id}-open-${asset}`, side: (asset === 0) === (outcome === 'target') ? 'BUY' : 'SELL', quantity: '0.01', stop_loss: null, take_profit: null, execution_timing: 'current_quote' })
      positions.push(record.payload.execution.position.position_id)
      await flush()
    }
    assert.equal(record.portfolio_account.open_position_count, 2)
    assert.equal(Number(record.portfolio_account.balance), initial)
    assert.equal(prop.phase.qualifying_days, 1, 'two asset fills on the same local date count as one qualifying day')
    let aggregate = record.payload.portfolio_execution
    assert.ok(aggregate.ledger.length >= 2)
    assert.deepEqual(aggregate.ledger.map(event => event.sequence), aggregate.ledger.map((_, index) => index + 1))
    assert.deepEqual(new Set(aggregate.dataset_pins.map(pin => pin.dataset_id)), new Set(datasets.map(dataset => dataset.dataset_id)))
    assert.equal(aggregate.primary_dataset_sha256, datasets[0].artifact_sha256)
    const beforeStale = await request('GET', path)
    await request('POST', `${path}/orders/protection`, { expected_revision: record.revision - 1, operation_id: id + '-stale', target_id: positions[1], stop_loss: null, take_profit: null }, 409)
    assert.deepEqual(await request('GET', path), beforeStale, 'stale replay mutation cannot change the account')
    await flush()
    const { prop_session_id: _session, prop_attempt_id: _attempt, ...foreignBody } = createBody
    const other = await request('POST', '/api/v2/replay/sessions', foreignBody, 201)
    await request('POST', `${replayPath(other)}/orders/quick`, { expected_revision: other.revision, ...init(datasets[0]), operation_id: id + '-foreign', side: 'BUY', quantity: '0.01', stop_loss: null, take_profit: null, execution_timing: 'current_quote' })
    await request('POST', `${replayPath(other)}/prop/sessions/${id}/attempts/${attemptId}/feed`, eventBody(1), 422)
    await request('GET', path, undefined, 403, 'tenant-b')
    const preserved = await request('GET', path)
    await mutate('orders/close', { target_id: 'not-this-asset', operation_id: id + '-invalid-target' }, 422)
    assert.deepEqual(await request('GET', path), preserved, 'foreign target cannot alter any asset')
    const acknowledged = prop.resume_state.replay_binding.last_replay_event_sequence
    await mutate('step', { steps: count })
    const unacknowledged = await request('GET', path)
    await mutate('orders/close', { target_id: positions[1], operation_id: id + '-unacknowledged-close' }, 409)
    assert.deepEqual(await request('GET', path), unacknowledged, 'financial write waits for Prop acknowledgement without saving a second operation')
    aggregate = { ledger: record.payload.portfolio_execution.ledger.filter(event => event.sequence > acknowledged) }
    const before = await request('GET', attemptPath)
    await request('POST', feedPath, eventBody(aggregate.ledger[1].sequence), 422)
    await request('POST', feedPath, { ...eventBody(aggregate.ledger[0].sequence), expected_prop_revision: prop.attempt.revision - 1 }, 409)
    assert.deepEqual(await request('GET', attemptPath), before, 'skipped/stale feeds do not modify Prop')
    const firstBody = eventBody(aggregate.ledger[0].sequence)
    const first = await request('POST', feedPath, firstBody)
    prop = first
    const retry = await request('POST', feedPath, firstBody)
    assert.equal(retry.duplicate, true)
    assert.deepEqual(retry.phase, first.phase)
    assert.equal(retry.attempt.revision, first.attempt.revision)
    await flush()
    const beforeDelayedRetry = await request('GET', attemptPath)
    assert.equal((await request('POST', feedPath, firstBody)).duplicate, true)
    assert.deepEqual(await request('GET', attemptPath), beforeDelayedRetry, 'delayed idempotent feed cannot rewind aggregate state')

    assert.equal(Number(record.portfolio_account.floating_pl), (outcome === 'target' ? 1 : -1) * expectedLeg * 2)
    assert.equal(record.portfolio_account.open_position_count, 2)
    assert.equal(prop.attempt.status, 'running', 'floating profit/loss does not cross a frozen balance-based rule')
    await mutate('asset', { dataset_id: datasets[0].dataset_id })
    await mutate('orders/close', { target_id: positions[0], operation_id: id + '-close-a' })
    await flush()
    assert.equal(prop.attempt.status, 'running', 'one realized leg alone does not cross the aggregate rule')
    await mutate('asset', { dataset_id: datasets[1].dataset_id })
    await mutate('orders/close', { target_id: positions[1], operation_id: id + '-close-b' })
    await flush()
    assert.equal(prop.attempt.status, outcome === 'target' ? 'phase_passed' : 'failed_breach')
    assert.equal(Number(prop.phase.balance), initial + (outcome === 'target' ? 1 : -1) * expectedLeg * 2)
    assert.equal(prop.phase.open_positions, 0)
    assert.equal(prop.resume_state.replay_binding.last_replay_event_sequence, record.payload.portfolio_execution.event_sequence)
    const loaded = await request('GET', attemptPath)
    assert.deepEqual(loaded.phase, prop.phase)
    const finalRevision = record.revision
    await request('GET', `${path}?cursor_index=0`)
    assert.equal((await request('GET', path)).revision, finalRevision, 'historical read does not rewrite canonical account')
    if (outcome === 'target') {
      const transitionBody = { workspace_id: 'tenant-a', session_id: id, attempt_id: attemptId, profile_hash: profileHash, intent_id: id + '-next-phase', expected_revision: prop.attempt.revision, event_sequence: prop.phase.last_event_sequence, action: 'next_phase' }
      const transitioned = await request('POST', attemptPath + '/transitions', transitionBody)
      const next = await request('GET', path)
      assert.equal(transitioned.phase.phase_index, 2)
      assert.equal(Number(transitioned.phase.balance), 20000)
      assert.equal(Number(next.portfolio_account.balance), 20000, 'phase reset capital applied once to whole portfolio')
      assert.equal(Number(next.payload.portfolio_execution.balance), 20000)
      assert.equal(next.payload.portfolio_execution.phase_index, 2)
      assert.equal(transitioned.resume_state.replay_binding.last_replay_event_sequence, next.payload.portfolio_execution.event_sequence)
      assert.equal((await request('POST', attemptPath + '/transitions', transitionBody)).duplicate, true)
      assert.equal((await request('GET', path)).revision, next.revision, 'transition retry never funds portfolio twice')
      cases.push('native multiasset phase reset funds 20000 USD once, freezes both assets and retries without double funding')
    }
    cases.push(`native ${outcome}: independent 2 USD per-leg oracle; 4 USD aggregate result crosses 3 USD rule, ordered/idempotent feeds, stale/foreign rejection and persisted resume`)
  }
}

function replayPath(record) { return `/api/v2/replay/sessions/${record.record_id}` }

export async function verifyNativePortfolioCalendar({ request, datasets, template, cases }) {
  const sparse = [], base = 1577923200
  for (let index = 0; index < 2; index++) {
    const original = datasets[index], price = index ? 1.5 : 1.1
    const result = await request('POST', '/api/v2/data/csv/import', {
      csv_text: 'time,open,high,low,close,volume\n' + [0, 60, 86460].map((offset, i) => {
        const value = price + (index ? -1 : 1) * i * .0001
        return `${base + offset},${value.toFixed(5)},${(value + .00004).toFixed(5)},${(value - .00004).toFixed(5)},${value.toFixed(5)},10`
      }).join('\n'),
      source: { ...original.source, source_id: `native-sparse-${index}`, provider: 'fixture', license_use: 'qa-only', retrieved_at_utc: '2026-10-18T00:00:00Z', export_settings: 'generated sparse reset fixture' },
      instrument: original.instrument_spec, timeframe_seconds: 60, holdout_policy: { mode: 'none' },
    }, 201)
    sparse.push(result.dataset)
  }
  for (const kind of ['blocked-equity-reset', 'calendar-expiry']) {
    const id = 'native-' + kind, attemptId = id + '-attempt'
    const session = structuredClone(template.session), attempt = structuredClone(template.attempt), phase = structuredClone(template.phase)
    const spec = session.profile.phases[0]
    spec.min_qualifying_days = 0
    spec.max_calendar_days = kind === 'calendar-expiry' ? 1 : null
    delete session.profile.profile_hash
    const hash = 'sha256:' + createHash('sha256').update(JSON.stringify(session.profile)).digest('hex')
    session.profile.profile_hash = hash
    Object.assign(session, { session_id: id, revision: 1, status: 'running' })
    Object.assign(attempt, { session_id: id, attempt_id: attemptId, profile_hash: hash, revision: 1, status: 'running', data_version: sparse[0].artifact_sha256, virtual_start_utc: new Date(base * 1000).toISOString(), virtual_cutoff_utc: new Date((base + 86520) * 1000).toISOString() })
    Object.assign(phase, { session_id: id, attempt_id: attemptId, profile_hash: hash, initial_balance: '10000', balance: '10000', equity: '10000', floating_pl: '0', high_water_mark: '10000', daily_anchor: '10000', last_event_sequence: 0, qualifying_days: 0, open_positions: 0, pending_orders: 0, virtual_time_utc: attempt.virtual_start_utc, evaluation_quality: 'full_for_declared_model' })
    const resume = { cursor: { bar_index: 0, timestamp_utc: attempt.virtual_start_utc }, open_positions: [], pending_orders: [], setup_metadata: { dataset_ids: sparse.map(d => d.dataset_id) } }
    let prop = await request('POST', '/api/v2/prop/session-bundles', { session, attempt, phase, resume_state: resume }, 201)
    let record = await request('POST', '/api/v2/replay/sessions', { dataset_id: sparse[0].dataset_id, dataset_ids: sparse.map(d => d.dataset_id), starting_balance: '10000', name: id, prop_session_id: id, prop_attempt_id: attemptId }, 201)
    const path = replayPath(record), attemptPath = `/api/v2/prop/sessions/${id}/attempts/${attemptId}`, feedPath = `${path}/prop/sessions/${id}/attempts/${attemptId}/feed`
    const mutate = async (route, body) => { record = await request('POST', `${path}/${route}`, { expected_revision: record.revision, ...body }) }
    let lastFeedBody
    async function flush() {
      for (const event of record.payload.portfolio_execution.ledger.filter(e => e.sequence > (prop.resume_state.replay_binding?.last_replay_event_sequence || 0))) {
        if (prop.attempt.status !== 'running') break
        lastFeedBody = { replay_event_sequence: event.sequence, expected_prop_revision: prop.attempt.revision, prop_event_sequence: prop.phase.last_event_sequence + 1 }
        prop = await request('POST', feedPath, lastFeedBody)
      }
    }
    for (let index = 0; index < 2; index++) {
      if (index) await mutate('asset', { dataset_id: sparse[index].dataset_id })
      const init = { instrument_spec: sparse[index].instrument_spec, cost_model: { version: 'replay-fixture-cost-v1', spread_basis: 'bid_ask_embedded', commission_per_side_account: '0', minimum_fee_account: '0', slippage_price_per_side: '0', financing_account: '0', quote_to_account_rate: '1', account_ccy: 'USD', rounding_decimals: 2 }, spread_price: '0', timeframe_seconds: 60, starting_balance: '10000' }
      if (kind === 'blocked-equity-reset') await mutate('orders/quick', { ...init, operation_id: id + '-open-' + index, side: index ? 'SELL' : 'BUY', quantity: '0.01', stop_loss: null, take_profit: null, execution_timing: 'current_quote' })
      else await mutate('execution', init)
      await flush()
    }
    await flush()
    await mutate('step', { steps: 1 })
    await flush()
    const priorEquity = Number(record.portfolio_account.equity)
    await mutate('step', { steps: 1 })
    await flush()
    if (kind === 'blocked-equity-reset') {
      assert.equal(prop.resume_state.replay_binding.last_replay_event_sequence, record.payload.portfolio_execution.event_sequence, 'daily reset acknowledges the canonical account mark')
      assert.equal(prop.attempt.status, 'running')
      assert.equal(prop.objectives.technical_status, 'blocked_by_data')
      assert.equal(Number(prop.phase.daily_anchor), priorEquity, 'daily anchor uses last canonical mark at the reset boundary')
      assert.equal(Number(prop.phase.equity), Number(record.portfolio_account.equity))
      assert.equal(Number(prop.phase.high_water_mark), Number(record.portfolio_account.equity), 'known marks still update HWM while terminal evaluation is blocked')
    } else {
      assert.equal(prop.attempt.status, 'expired')
      assert.equal(prop.terminal_boundary.requested_replay_event_sequence, record.payload.portfolio_execution.event_sequence)
      assert.equal(prop.terminal_boundary.acknowledged_replay_event_sequence, prop.resume_state.replay_binding.last_replay_event_sequence)
      assert.ok(prop.terminal_boundary.acknowledged_replay_event_sequence < prop.terminal_boundary.requested_replay_event_sequence, 'expiry occurs before the future price mark and never claims it was consumed')
      assert.ok(Date.parse(prop.terminal_boundary.virtual_time_utc) <= Number(prop.replay_event.virtual_time_utc) * 1000)
      const beforeRetry = await request('GET', attemptPath)
      const retry = await request('POST', feedPath, lastFeedBody)
      assert.equal(retry.duplicate, true)
      assert.deepEqual(await request('GET', attemptPath), beforeRetry, 'terminal boundary retry cannot change the account')
    }
    assert.deepEqual((await request('GET', attemptPath)).phase, prop.phase)
    cases.push(`native ${kind}: sparse shared clock processes midnight, canonical account acknowledgement and persisted phase`)
  }
}
