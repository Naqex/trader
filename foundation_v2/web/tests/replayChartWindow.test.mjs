import test from 'node:test'
import assert from 'node:assert/strict'
import { createReplayChartWindowReader, replayChartTail } from '../src/replayChartWindow.js'
import { createAdvancedReplayDatafeed, replayBars } from '../src/advancedReplayDatafeed.js'
import { startFrontendPerformance } from '../src/frontendPerformance.js'

const bar = { time: 60000, open: 1, high: 2, low: .5, close: 1.5 }
const options = { workspace: 'w', sessionId: 'session', datasetId: 'dataset', datasetSha256: 'sha' }
const request = { resolution: '1', countBack: 5, cursorIndex: 9, cutoff: 60, to: 120 }
const payload = { schema_version: 'replay-chart-window-v1', workspace_id: 'w', session_id: 'session', dataset_id: 'dataset',
  dataset_sha256: 'sha', cursor_index: 9, cutoff_timestamp: 60, resolution: '1', bars: [bar] }

test('historical forward windows reuse only verified immutable overlap, including the 2000-row boundary', () => {
  const rows = Array.from({ length: 2010 }, (_, i) => ({ timestamp: 60 + 60 * i, open: 1, high: 2, low: .5, close: 1.5, volume: i }))
  const view = cursor => ({ record_id: 'session', revision: 9, dataset_sha256: 'sha', payload: { dataset_id: 'dataset' },
    view_cursor_index: cursor, visible_row_start: Math.max(0, cursor - 1999), cutoff_timestamp: rows[cursor].timestamp,
    visible_rows: rows.slice(Math.max(0, cursor - 1999), cursor + 1) })
  for (const [before, after] of [[4, 5], [1999, 2002]]) {
    assert.deepEqual(replayChartTail(view(before), view(after)), { baseCutoff: rows[before].timestamp, cutoff: rows[after].timestamp, rows: rows.slice(before + 1, after + 1) })
  }
  const previous = view(2002)
  for (const next of [view(2001), previous, { ...view(2003), record_id: 'other' }, { ...view(2003), revision: 10 },
    { ...view(2003), dataset_sha256: 'other' }, { ...view(2003), visible_row_start: 5 },
    { ...view(2003), cutoff_timestamp: 0 }, { ...view(2003), payload: { dataset_id: 'other' } }]) assert.equal(replayChartTail(previous, next), undefined)
  for (const index of [0, 1999]) {
    const changed = structuredClone(view(2003)); changed.visible_rows[index].close = 9
    assert.equal(replayChartTail(previous, changed), undefined, 'Changed overlap or malformed appended candle cannot be reused')
  }
})

test('window cache deduplicates, returns independent candles, binds query and stays bounded', async () => {
  let calls = 0
  const reader = createReplayChartWindowReader({ ...options, fetchImpl: async (url, init) => {
    calls++
    assert.equal(init.headers['X-Workspace-Id'], 'w')
    assert.match(url, /dataset_sha256=sha/)
    assert.match(url, /count_back=5/)
    return { ok: true, json: async () => payload }
  } })
  const [first, second] = await Promise.all([reader.read(request), reader.read(request)])
  assert.equal(calls, 1)
  first[0].close = 999
  assert.equal(second[0].close, 1.5)
  for (let index = 0; index < 9; index++) await reader.read({ ...request, to: 200 + index })
  await reader.read(request)
  assert.equal(calls, 11, 'Eight cached windows should evict the oldest')
  reader.dispose()
})

test('reader rejects scope, future, duplicate and unbounded data', async () => {
  for (const invalid of [ { workspace_id: 'other' }, { dataset_sha256: 'another' }, { cursor_index: 10 },
    { cutoff_timestamp: 120 }, { bars: [{ ...bar, time: 61000 }] }, { bars: [bar, bar] },
    { bars: [{ ...bar, high: null }] }, { bars: Array(6).fill(bar) } ]) {
    const reader = createReplayChartWindowReader({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ ...payload, ...invalid }) }) })
    await assert.rejects(reader.read(request))
    reader.dispose()
  }
})

test('rewind/dispose aborts old requests and does not cache late bodies', async () => {
  let finish, signal
  const reader = createReplayChartWindowReader({ ...options, fetchImpl: async (url, init) => {
    signal = init.signal
    return { ok: true, json: () => new Promise(resolve => { finish = resolve }) }
  } })
  const pending = reader.read(request)
  await new Promise(resolve => setImmediate(resolve))
  reader.reset()
  assert.equal(signal.aborted, true)
  finish(payload)
  await assert.rejects(pending, { name: 'AbortError' })
  reader.dispose()
  await assert.rejects(reader.read(request))
})

test('datafeed backfills remote candles beyond the local window, keeps monthly buckets whole, cancels rewind', async () => {
  const rows = Array.from({ length: 3000 }, (_, index) => ({ timestamp: 1704067200 + index * 60,
    open: index, high: index + 2, low: index - 1, close: index + 1, volume: 1 }))
  let cursor = 2999, release, stale = false
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(-2000), cutoff: rows[cursor].timestamp,
    readHistory: (resolution, period) => {
      const full = replayBars(rows, rows[cursor].timestamp, resolution === '1M' ? '1M' : 60)
      return full.filter(bar => !period.to || bar.time < period.to * 1000).slice(-(period.countBack || 300))
    } })
  const get = (resolution, period) => new Promise((resolve, reject) => item.datafeed.getBars({ ticker: 'EURUSD' }, resolution, period, resolve, reject))
  assert.equal((await get('1', { to: rows[100].timestamp, countBack: 20 }))[0].open, 80)
  const month = await get('1M', { countBack: 20 })
  assert.equal(month[0].open, 0, 'Monthly OHLC must not start at the local window boundary')
  assert.equal(month[0].volume, 3000)
  item.dispose()
  const waiting = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows, cutoff: rows[cursor].timestamp,
    readHistory: () => new Promise(resolve => { release = resolve }) })
  waiting.datafeed.getBars({ ticker: 'EURUSD' }, '1', {}, () => { stale = true }, assert.fail)
  await new Promise(resolve => setImmediate(resolve))
  cursor = 1
  assert.equal(waiting.update(rows.slice(0, 2), rows[1].timestamp), false)
  release([bar])
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(stale, false)
  waiting.dispose()
})

test('remote realtime starts at last visible candle and never replays older bars during initial request race', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ timestamp: 1704067200 + index * 60,
    open: index, high: index + 2, low: index - 1, close: index + 1, volume: 1 }))
  let cursor = 5
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(0, 6), cutoff: rows[cursor].timestamp,
    readHistory: async () => replayBars(rows, rows[cursor].timestamp, 60) })
  const seen = []
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1', bar => seen.push(bar.time), 'first', assert.fail)
  cursor = 8
  item.update(rows.slice(0, 9), rows[cursor].timestamp)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(seen, rows.slice(6, 9).map(row => row.timestamp * 1000))
  item.dispose()
})

test('history timings are opt-in and deduplicated; cache hit records no request or business context', async () => {
  const metrics = startFrontendPerformance({ enabled: true })
  const reader = createReplayChartWindowReader({ ...options, fetchImpl: async () => ({ ok: true, json: async () => payload }) })
  await Promise.all([reader.read(request), reader.read(request)])
  await reader.read(request)
  const records = metrics.snapshot().records
  assert.equal(records.length, 1)
  assert.equal(records[0].label, 'chart-history')
  assert.equal(records[0].status, 'ready')
  assert.equal(records[0].payloadBytes, undefined)
  assert.equal(JSON.stringify(records).includes('session'), false)
  reader.dispose(); metrics.stop()
})

test('verified step tails match full OHLC across simultaneous resolutions without realtime history fetches', async () => {
  const start = Date.UTC(2024, 0, 27) / 1000
  const rows = Array.from({ length: 7600 }, (_, index) => ({ timestamp: start + index * 60,
    open: 100 + index % 19, high: 130 + index % 17, low: 80 - index % 13, close: 105 + index % 11, volume: index % 7 }))
  let cursor = 6500, requests = 0, resets = 0
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(cursor - 1999, cursor + 1), cutoff: rows[cursor].timestamp,
    readHistory: (resolution, period) => {
      requests++
      return replayBars(rows, rows[cursor].timestamp, resolution).slice(-(period.countBack || 300))
    } })
  const seen = new Map()
  for (const resolution of ['1', '5', '1D', '1W', '1M']) {
    seen.set(resolution, [])
    item.datafeed.subscribeBars({ ticker: 'EURUSD' }, resolution, value => seen.get(resolution).push(value), resolution, () => { resets++ })
  }
  await new Promise(resolve => setImmediate(resolve))
  const seededRequests = requests
  for (const count of [1000, 99]) {
    const previous = cursor
    const delivered = new Map([...seen].map(([resolution, values]) => [resolution, values.length]))
    cursor += count
    const tail = rows.slice(previous + 1, cursor + 1)
    assert.equal(item.update(rows.slice(cursor - 1999, cursor + 1), rows[cursor].timestamp,
      { baseCutoff: rows[previous].timestamp, cutoff: rows[cursor].timestamp, rows: tail }), true)
    await new Promise(resolve => setImmediate(resolve))
    for (const resolution of seen.keys()) {
      const tailBars = seen.get(resolution).slice(delivered.get(resolution))
      const expected = replayBars(rows, rows[cursor].timestamp, resolution).filter(bar => bar.time >= tailBars[0]?.time)
      assert.ok(tailBars.length > 0)
      assert.deepEqual(tailBars, expected, resolution)
      const times = seen.get(resolution).map(value => value.time)
      assert.ok(times.every((time, index) => index === 0 || time >= times[index - 1]))
    }
  }
  assert.equal(requests, seededRequests)
  assert.equal(resets, 0)
  item.dispose()
})

test('new subscription during a step uses authoritative fallback and ignores its stale seed', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ timestamp: 1704067200 + index * 60, open: 1, high: 3, low: .5, close: 2, volume: 1 }))
  let cursor = 5, releaseSeed, requests = 0, resets = 0
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(0, 6), cutoff: rows[5].timestamp,
    readHistory: (resolution, period) => {
      requests++
      if (requests === 1) return new Promise(resolve => { releaseSeed = resolve })
      return replayBars(rows, rows[cursor].timestamp, resolution).slice(-period.countBack)
    } })
  const seen = []
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '5', value => seen.push(value), 'race', () => { resets++ })
  await new Promise(resolve => setImmediate(resolve))
  cursor = 8
  item.update(rows.slice(0, 9), rows[8].timestamp, { baseCutoff: rows[5].timestamp, cutoff: rows[8].timestamp, rows: rows.slice(6, 9) })
  await new Promise(resolve => setImmediate(resolve))
  const prior = requests
  releaseSeed(replayBars(rows, rows[5].timestamp, '5'))
  await new Promise(resolve => setImmediate(resolve))
  cursor = 9
  item.update(rows.slice(0, 10), rows[9].timestamp, { baseCutoff: rows[8].timestamp, cutoff: rows[9].timestamp, rows: rows.slice(9, 10) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, prior)
  assert.deepEqual(seen.at(-1), replayBars(rows, rows[9].timestamp, '5').at(-1))
  assert.equal(resets, 0)
  item.dispose()
})

test('wrong-base or mismatched tail falls back to history; old fallback errors cannot reset a newer update', async () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ timestamp: 1704067200 + index * 60, open: 1, high: 3, low: .5, close: 2 }))
  let cursor = 5, requests = 0, rejectOld, resets = 0
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(0, 6), cutoff: rows[5].timestamp,
    readHistory: (resolution, period) => {
      requests++
      if (requests === 2) return new Promise((resolve, reject) => { rejectOld = reject })
      return replayBars(rows, rows[cursor].timestamp, resolution).slice(-period.countBack)
    } })
  const seen = []
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1', value => seen.push(value), 'id', () => { resets++ })
  await new Promise(resolve => setImmediate(resolve))
  cursor = 6
  item.update(rows.slice(0, 7), rows[6].timestamp, { baseCutoff: rows[4].timestamp, cutoff: rows[6].timestamp, rows: [rows[6]] })
  await new Promise(resolve => setImmediate(resolve))
  cursor = 7
  item.update(rows.slice(0, 8), rows[7].timestamp, { baseCutoff: rows[6].timestamp, cutoff: rows[7].timestamp, rows: [{ ...rows[7], close: 999 }] })
  await new Promise(resolve => setImmediate(resolve))
  rejectOld(new Error('late failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, 3)
  assert.equal(resets, 0)
  assert.deepEqual(seen.at(-1), replayBars(rows, rows[7].timestamp, '1').at(-1))
  item.dispose()
})

test('tail aggregation propagates unknown volume and rewind still resets authoritative state', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ timestamp: 1704067200 + index * 60, open: 1, high: 3, low: .5, close: 2, tick_volume: 1 }))
  delete rows[3].tick_volume
  let cursor = 2, resets = 0
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(0, 3), cutoff: rows[2].timestamp,
    readHistory: (resolution, period) => replayBars(rows, rows[cursor].timestamp, resolution).slice(-period.countBack) })
  const seen = []
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '5', value => seen.push(value), 'volume', () => { resets++ })
  await new Promise(resolve => setImmediate(resolve))
  cursor = 3
  item.update(rows.slice(0, 4), rows[3].timestamp, { baseCutoff: rows[2].timestamp, cutoff: rows[3].timestamp, rows: [rows[3]] })
  assert.equal(Object.hasOwn(seen.at(-1), 'volume'), false)
  assert.deepEqual(seen.at(-1), replayBars(rows, rows[3].timestamp, '5').at(-1))
  cursor = 1
  assert.equal(item.update(rows.slice(0, 2), rows[1].timestamp), false)
  assert.equal(resets, 1)
  item.dispose()
})

for (const resolution of ['1', '1M']) {
  test(`delayed ${resolution} history catches every undelivered bucket after three steps`, async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      timestamp: resolution === '1M' ? Date.UTC(2024, index, 1) / 1000 : 1704067200 + index * 60,
      open: 10 + index, high: 12 + index, low: 9 + index, close: 11 + index, volume: index + 1,
    }))
    let cursor = 1, resets = 0
    const requests = [], seen = []
    const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60,
      rows: rows.slice(0, cursor + 1), cutoff: rows[cursor].timestamp,
      readHistory: (requestedResolution, period) => new Promise(resolve => {
        const bars = replayBars(rows, rows[cursor].timestamp, requestedResolution).slice(-period.countBack)
        requests.push({ bars, countBack: period.countBack, resolve })
      }) })
    item.datafeed.subscribeBars({ ticker: 'EURUSD' }, resolution, value => seen.push(value), 'slow', () => { resets++ })
    await new Promise(resolve => setImmediate(resolve))
    for (cursor = 2; cursor <= 4; cursor++) {
      item.update(rows.slice(0, cursor + 1), rows[cursor].timestamp,
        { baseCutoff: rows[cursor - 1].timestamp, cutoff: rows[cursor].timestamp, rows: [rows[cursor]] })
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal(requests.length, 4)
    assert.equal(requests.at(-1).countBack, 4)
    requests.at(-1).resolve(requests.at(-1).bars)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(seen, replayBars(rows, rows[4].timestamp, resolution).slice(2))
    const delivered = structuredClone(seen)
    for (const request of requests.slice(0, -1)) request.resolve(request.bars)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(seen, delivered, 'Superseded history must not publish again')
    const count = requests.length
    cursor = 5
    item.update(rows, rows[5].timestamp, { baseCutoff: rows[4].timestamp, cutoff: rows[5].timestamp, rows: [rows[5]] })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests.length, count, 'Recovered authoritative seed should resume the tail fastpath')
    assert.deepEqual(seen.at(-1), replayBars(rows, rows[5].timestamp, resolution).at(-1))
    assert.equal(resets, 0)
    item.dispose()
  })
}

test('same-resolution subscriptions catch up from their own last delivered candle', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ timestamp: 1704067200 + index * 60,
    open: index, high: index + 2, low: index - 1, close: index + 1, volume: 1 }))
  let cursor = 1
  const requests = [], early = [], late = []
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60,
    rows: rows.slice(0, 2), cutoff: rows[1].timestamp,
    readHistory: (resolution, period) => new Promise(resolve => {
      requests.push({ cursor, bars: replayBars(rows, rows[cursor].timestamp, resolution).slice(-period.countBack),
        countBack: period.countBack, resolve })
    }) })
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1', value => early.push(value), 'early', assert.fail)
  await new Promise(resolve => setImmediate(resolve))
  for (cursor = 2; cursor <= 4; cursor++) {
    item.update(rows.slice(0, cursor + 1), rows[cursor].timestamp,
      { baseCutoff: rows[cursor - 1].timestamp, cutoff: rows[cursor].timestamp, rows: [rows[cursor]] })
    if (cursor === 3) item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1', value => late.push(value), 'late', assert.fail)
    await new Promise(resolve => setImmediate(resolve))
  }
  const final = requests.filter(request => request.cursor === 4)
  assert.deepEqual(final.map(request => request.countBack), [4, 2])
  for (const request of final) request.resolve(request.bars)
  await new Promise(resolve => setImmediate(resolve))
  const expected = replayBars(rows, rows[4].timestamp, 60)
  assert.deepEqual(early, expected.slice(2))
  assert.deepEqual(late, expected.slice(4))
  for (const request of requests.filter(request => request.cursor !== 4)) request.resolve(request.bars)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(early, expected.slice(2))
  assert.deepEqual(late, expected.slice(4))
  item.dispose()
})
