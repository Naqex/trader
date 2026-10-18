import assert from 'node:assert/strict'

// Faults alter only this disposable browser's transport. The delayed/successful
// feeds still execute the real native HTTP path and PostgreSQL transaction.
export async function runPropStepJourney({ page, context, api, workspace, dataset, origin,
  configuration, fixture, report, ready, browserHistoryReads }) {
  const prop = { scope: 'Real Prop HTTP/domain/SQL fixture; explicit gated feed, synthetic pre-upstream 503, and stale expected_prop_revision injection. Recovery uses page reload followed by one new step.', feeds: [], steps: [], checks: [] }
  report.prop = prop
  const request = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(api + path, { method, headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    const value = await response.json(); assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`); return value
  }
  const attemptPath = `/api/v2/prop/sessions/${fixture.sessionId}/attempts/${fixture.attemptId}`
  let bundle = await request(attemptPath)
  const created = await request('/api/v2/replay/sessions', { dataset_id: dataset,
    prop_session_id: fixture.sessionId, prop_attempt_id: fixture.attemptId,
    starting_balance: '100000', name: 'Disposable Prop step publication' })
  const base = `/api/v2/replay/sessions/${created.record_id}`
  report.propSessionPath = base
  prop.session = created.record_id; prop.propSession = fixture.sessionId; prop.propAttempt = fixture.attemptId
  await request(base + '/execution?response_view=mutation-v1', { ...configuration,
    starting_balance: '100000', expected_revision: created.revision })
  let replay = await request(base)
  assert.equal(replay.step_view_version, 'replay-step-v1')
  const binding = { replay_session_id: replay.record_id, branch_id: replay.payload.branch_id,
    dataset_id: dataset, dataset_sha256: replay.dataset_sha256,
    last_replay_event_sequence: replay.payload.execution.event_sequence }
  bundle = await request(attemptPath + '/resume', {
    attempt: { ...bundle.attempt, revision: bundle.attempt.revision + 1 },
    phase: { ...bundle.phase, virtual_time_utc: new Date(replay.cutoff_timestamp * 1000).toISOString() },
    expected_revision: bundle.attempt.revision, operation_id: 'step-prop-fixture-binding',
    resume_state: { ...bundle.resume_state,
      cursor: { bar_index: replay.canonical_cursor_index, timestamp_utc: new Date(replay.cutoff_timestamp * 1000).toISOString() },
      replay_binding: binding },
  }, 'PUT')
  prop.initialAttemptRevision = bundle.attempt.revision
  const initialSequence = binding.last_replay_event_sequence
  assert.equal(initialSequence, 0)
  const feedPath = base + `/prop/sessions/${fixture.sessionId}/attempts/${fixture.attemptId}/feed`
  let fault = null, release = null, entered = null
  await context.route('**' + feedPath, async route => {
    const body = route.request().postDataJSON(), record = { body, mode: fault || 'normal', interceptedAt: performance.now() }
    prop.feeds.push(record)
    const selected = fault; fault = null
    if (selected === 'delay') {
      const gate = new Promise(resolve => { release = resolve })
      entered(); await gate
      record.forwardedAfterRelease = true
    }
    if (selected === 'failure503') {
      record.status = 503; record.artificialBeforeUpstream = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'owned-prop-feed-fault-injection' }) }); return
    }
    const response = await route.fetch(selected === 'stale409'
      ? { postData: { ...body, expected_prop_revision: body.expected_prop_revision - 1 } } : {})
    record.status = response.status(); record.response = await response.json()
    record.responseAt = performance.now()
    await route.fulfill({ response })
  })
  let stepPosts = 0
  page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === base + '/step') stepPosts++ })
  const url = `${origin}/?workspace=${workspace}&view=replay&surface=workspace&mode=Practice&session=${replay.record_id}&prop_session=${fixture.sessionId}&prop_attempt=${fixture.attemptId}`
  const open = async () => { await page.goto(url); await ready(); await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled) }
  await open()
  await page.evaluate(() => new Promise(resolve => window.__qaChart.setResolution('1', resolve))); await ready()
  const sync = page.getByRole('switch', { name: 'Đồng bộ khung replay với khung chart', exact: true })
  if (!(await sync.isChecked())) await sync.check()
  const beforeFirst = await request(base), beforeProp = await request(attemptPath)
  const markPaint = async (count, cutoff) => {
    await page.waitForFunction(({ count, cutoff }) => window.__qa.bars.slice(count).some(item => item.paint)
      && Number(document.querySelector('[data-testid="replay-chart"]').dataset.cutoff) === cutoff, { count, cutoff })
    return page.evaluate(count => window.__qa.bars.slice(count), count)
  }
  const step = async label => {
    const before = await request(base), barCount = await page.evaluate(() => window.__qa.bars.length)
    const response = page.waitForResponse(res => new URL(res.url()).pathname === base + '/step')
    await page.getByTestId('step-1').click(); const confirmed = await response
    assert.equal(confirmed.status(), 200); assert.equal(new URL(confirmed.url()).searchParams.get('response_view'), 'step-v1')
    const delta = await confirmed.json(); assert.equal(delta.schema_version, 'replay-step-v1')
    const committed = await request(base)
    assert.equal(committed.revision, before.revision + 1)
    assert.equal(committed.canonical_cursor_index, before.canonical_cursor_index + 1)
    const bars = await markPaint(barCount, committed.cutoff_timestamp)
    prop.steps.push({ label, baseRevision: before.revision, revision: committed.revision,
      cursor: committed.canonical_cursor_index, sequence: committed.payload.execution.event_sequence,
      deliveredBars: bars.map(item => ({ bar: item.bar, paint: item.paint, click: item.click })) })
    return committed
  }
  fault = 'delay'
  const gateEntered = new Promise(resolve => { entered = resolve })
  const first = await step('gated-feed')
  await gateEntered
  assert.equal((await request(attemptPath)).attempt.revision, beforeProp.attempt.revision)
  assert.equal((await request(base)).revision, first.revision)
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  assert.equal(await page.locator('button.buy').isDisabled(), true)
  assert.equal(await page.locator('button.sell').isDisabled(), true)
  const postsDuringGate = stepPosts
  await page.keyboard.press('ArrowRight')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(stepPosts, postsDuringGate)
  prop.delay = { artificial: true, chartPublishedAtCursor: first.canonical_cursor_index,
    replayCommittedRevision: first.revision, propStillAtRevision: beforeProp.attempt.revision,
    stepAndTradingDisabled: true, keyboardNoExtraWrite: true,
    releasedAfterPublication: true, previousCursor: beforeFirst.canonical_cursor_index }
  release()
  await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled)
  assert.equal((await request(attemptPath)).resume_state.replay_binding.last_replay_event_sequence, first.payload.execution.event_sequence)
  prop.checks.push('Committed replay chart publishes before gated Prop feed; subsequent step/trade writes remain locked until real feed settles')

  await page.getByLabel('Điều chỉnh tốc độ replay', { exact: true }).press('Home')
  const playStart = stepPosts, playFeedStart = prop.feeds.length, reads = browserHistoryReads()
  await page.getByTestId('play-toggle').click()
  await page.waitForFunction(() => window.__qa.bars.length >= 4)
  // Wait on actual successful HTTP feeds, not just timer ticks or chart callbacks.
  const deadline = Date.now() + 15000
  while (prop.feeds.slice(playFeedStart).filter(item => item.status === 200).length < 3) {
    assert.ok(Date.now() < deadline, 'Prop Play did not settle three real feeds')
    await page.waitForTimeout(25)
  }
  await page.getByTestId('play-toggle').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled)
  replay = await request(base); bundle = await request(attemptPath)
  assert.ok(stepPosts - playStart >= 3)
  assert.equal(bundle.resume_state.replay_binding.last_replay_event_sequence, replay.payload.execution.event_sequence)
  assert.equal(browserHistoryReads(), reads)
  prop.play = { actualSteps: stepPosts - playStart, successfulFeeds: prop.feeds.slice(playFeedStart).filter(item => item.status === 200).length, cursor: replay.canonical_cursor_index, historyReads: 0 }

  for (const failure of ['failure503', 'stale409']) {
    const before = await request(base), bindingBefore = await request(attemptPath), feedsBefore = prop.feeds.length
    fault = failure
    const committed = await step(failure)
    const deadline = Date.now() + 10000
    while (!prop.feeds.slice(feedsBefore).some(item => item.status === (failure === 'failure503' ? 503 : 409))) {
      assert.ok(Date.now() < deadline); await page.waitForTimeout(20)
    }
    await page.waitForFunction(() => document.querySelector('[data-testid="step-1"]').disabled)
    assert.equal((await request(attemptPath)).attempt.revision, bindingBefore.attempt.revision)
    assert.equal((await request(base)).revision, committed.revision)
    const postsBeforeReload = stepPosts
    await open()
    assert.equal(stepPosts, postsBeforeReload, 'Reload retried the already-committed replay step')
    assert.equal((await request(base)).revision, committed.revision)
    const successfulBeforeRecovery = prop.feeds.filter(item => item.status === 200).length
    const recovered = await step('recovery-' + failure)
    await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled)
    const recoveryFeeds = prop.feeds.filter(item => item.status === 200).slice(successfulBeforeRecovery)
    assert.deepEqual(recoveryFeeds.map(item => item.body.replay_event_sequence), [committed.payload.execution.event_sequence, recovered.payload.execution.event_sequence])
    assert.equal(recovered.revision, before.revision + 2)
    assert.equal(stepPosts, postsBeforeReload + 1)
    assert.equal((await request(attemptPath)).resume_state.replay_binding.last_replay_event_sequence, recovered.payload.execution.event_sequence)
    prop.checks.push(`${failure}: committed replay retained; reload has no POST; one new step feeds old backlog and new mark once in sequence`)
  }
  replay = await request(base); bundle = await request(attemptPath)
  const marks = replay.payload.execution.ledger.filter(item => item.kind === 'price_mark')
  const successes = prop.feeds.filter(item => item.status === 200)
  assert.deepEqual(successes.map(item => item.body.replay_event_sequence), marks.map(item => item.sequence))
  assert.ok(successes.every(item => item.response.duplicate === false))
  assert.deepEqual(successes.map(item => item.response.replay_event), marks)
  assert.equal(new Set(successes.map(item => item.response.prop_event.operation_id)).size, marks.length)
  prop.final = { replayRevision: replay.revision, replaySequence: replay.payload.execution.event_sequence,
    cursor: replay.canonical_cursor_index, attemptRevision: bundle.attempt.revision,
    phaseSequence: bundle.phase.last_event_sequence, binding: bundle.resume_state.replay_binding,
    ledgerMarks: marks, successfulOperationIds: successes.map(item => item.response.prop_event.operation_id),
    phase: bundle.phase, resumeState: bundle.resume_state }
  prop.status = 'PASS'
}
