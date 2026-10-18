export function replayResolution(seconds) {
  const value = Number(seconds)
  if (!Number.isInteger(value) || value < 1 || (value >= 60 && value % 60)) throw new Error('Timeframe dataset không được Advanced Charts hỗ trợ.')
  return value % 86400 === 0 ? `${value / 86400}D` : value < 60 ? `${value}S` : String(value / 60)
}

export function resolutionSeconds(resolution) {
  const text = String(resolution)
  if (text.endsWith('D')) return Number(text.slice(0, -1) || 1) * 86400
  if (text.endsWith('W')) return Number(text.slice(0, -1) || 1) * 604800
  return text.endsWith('S') ? Number(text.slice(0, -1)) : Number(text) * 60
}

function bucketTime(timestamp, period) {
  if (period === '1M') {
    const date = new Date(timestamp * 1000)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  }
  if (period === '1W') {
    const day = Math.floor(timestamp / 86400)
    return (day - (new Date(timestamp * 1000).getUTCDay() + 6) % 7) * 86400000
  }
  const seconds = typeof period === 'number' ? period : resolutionSeconds(period)
  return Math.floor(timestamp / seconds) * seconds * 1000
}

const periodOf = resolution => resolution.endsWith('S') || /^\d+$/.test(resolution) ? resolutionSeconds(resolution) : resolution
const sameRow = (left, right) => left === right || ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'tick_volume'].every(key => left?.[key] === right?.[key])

function verifiedTail(tail, previousCutoff, nextCutoff, rows) {
  if (!tail || tail.baseCutoff !== previousCutoff || tail.cutoff !== Number(nextCutoff)
      || !Array.isArray(tail.rows) || !tail.rows.length || tail.rows.length > 1000 || tail.rows.length > rows.length) return null
  let timestamp = previousCutoff
  for (let index = 0; index < tail.rows.length; index += 1) {
    const row = tail.rows[index]
    if (!Number.isSafeInteger(row.timestamp) || row.timestamp <= timestamp
        || !['open', 'high', 'low', 'close'].every(key => Number.isFinite(row[key]))
        || !sameRow(row, rows[rows.length - tail.rows.length + index])) return null
    timestamp = row.timestamp
  }
  return timestamp === Number(nextCutoff) ? tail.rows : null
}

function tailBars(last, rows, cutoff, resolution) {
  const bars = replayBars(rows, cutoff, periodOf(resolution))
  if (last && bars[0]?.time === last.time) {
    const first = bars[0]
    bars[0] = { ...first, open: last.open, high: Math.max(last.high, first.high), low: Math.min(last.low, first.low) }
    if (last.volume != null && first.volume != null) bars[0].volume = last.volume + first.volume
    else delete bars[0].volume
  }
  return bars
}

export function replayBars(rows, cutoff, period) {
  const buckets = new Map()
  for (const row of rows) {
    const timestamp = Number(row.timestamp)
    if (!Number.isFinite(timestamp) || timestamp > Number(cutoff)) continue
    const time = bucketTime(timestamp, period)
    const next = { time, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) }
    const volume = row.volume ?? row.tick_volume
    if (volume != null && Number.isFinite(Number(volume))) next.volume = Number(volume)
    if (![next.open, next.high, next.low, next.close].every(Number.isFinite)) continue
    const previous = buckets.get(time)
    if (!previous) buckets.set(time, next)
    else {
      const bucket = { ...previous, high: Math.max(previous.high, next.high), low: Math.min(previous.low, next.low), close: next.close }
      if (previous.volume != null && next.volume != null) bucket.volume = previous.volume + next.volume
      else delete bucket.volume
      buckets.set(time, bucket)
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

// Native windows and scoped backend history are the only sources. No provider/CDN requests.
export function createAdvancedReplayDatafeed({ symbol, seconds, tickSize, rows, cutoff, assetClass = 'fx', readHistory }) {
  const interval = replayResolution(seconds)
  const calendar = seconds <= 86400 && 86400 % seconds === 0 ? ['1D', '1W', '1M'] : []
  const supported = [...new Set([interval, ...[1, 3, 5, 15, 30, 60, 120, 240].filter(minutes => minutes * 60 >= seconds && minutes * 60 % seconds === 0).map(String), ...calendar])]
  const precision = tickSize > 0 ? Math.min(8, String(Number(tickSize).toFixed(8)).replace(/0+$/, '').split('.')[1]?.length || 0) : 5
  const pricescale = 10 ** precision
  const type = { fx: 'forex', crypto: 'crypto', equity: 'stock', futures: 'futures' }[assetClass] || 'spread'
  let visible = rows, limit = cutoff, alive = true, generation = 0, updateGeneration = 0
  const subscriptions = new Map()
  const historyCache = new Map()
  const history = resolution => {
    if (!supported.includes(resolution)) throw new Error('Resolution không thuộc dataset hiện tại.')
    if (!historyCache.has(resolution)) historyCache.set(resolution,
      replayBars(visible, limit, resolution.endsWith('S') || /^\d+$/.test(resolution) ? resolutionSeconds(resolution) : resolution))
    return historyCache.get(resolution)
  }
  const defer = callback => setTimeout(callback, 0)
  const datafeed = {
    onReady(callback) { defer(() => alive && callback({ supported_resolutions: supported, supports_marks: false, supports_timescale_marks: false, supports_time: false })) },
    searchSymbols(input, exchange, symbolType, callback) { defer(() => alive && callback(symbol.toLowerCase().includes(input.toLowerCase()) ? [{ symbol, full_name: symbol, description: symbol, exchange: 'Replay', ticker: symbol, type }] : [])) },
    resolveSymbol(name, callback, error) { defer(() => {
      if (!alive) return
      if (name !== symbol) { error('Chỉ symbol của dataset đã chọn được phép hiển thị.'); return }
      callback({ name: symbol, ticker: symbol, description: `${symbol} · Paper replay`, type, format: 'price', session: '24x7', timezone: 'Etc/UTC', exchange: 'Replay', listed_exchange: 'Replay',
        minmov: Math.max(1, Math.round(Number(tickSize || 1 / pricescale) * pricescale)), pricescale, has_intraday: seconds < 86400, has_seconds: seconds < 60,
        seconds_multipliers: seconds < 60 ? [String(seconds)] : [], intraday_multipliers: supported.filter(value => /^\d+$/.test(value)),
        supported_resolutions: supported, has_daily: supported.some(value => value.endsWith('D')), daily_multipliers: [String(seconds >= 86400 ? seconds / 86400 : 1)],
        has_weekly_and_monthly: calendar.includes('1W'), weekly_multipliers: ['1'], monthly_multipliers: ['1'], volume_precision: 0, data_status: 'streaming' })
    }) },
    getBars(info, resolution, period, callback, error) {
      const requestedGeneration = generation
      if (readHistory) {
        if (info.ticker !== symbol || !supported.includes(resolution)) {
          defer(() => alive && requestedGeneration === generation && error('Symbol hoặc resolution khác dataset.')); return
        }
        Promise.resolve().then(() => readHistory(resolution, period)).then(bars => {
          if (!alive || requestedGeneration !== generation) return
          defer(() => alive && requestedGeneration === generation && callback(bars.map(bar => ({ ...bar })), { noData: bars.length === 0 }))
        }).catch(cause => defer(() => alive && requestedGeneration === generation && error(cause.message)))
        return
      }
      let bars
      try {
        if (info.ticker !== symbol) throw new Error('Symbol khác dataset.')
        const allowed = history(resolution).filter(bar => bar.time < period.to * 1000)
        const fromIndex = allowed.findIndex(bar => bar.time >= period.from * 1000)
        const start = Math.min(fromIndex < 0 ? allowed.length : fromIndex, Math.max(0, allowed.length - (period.countBack || 0)))
        bars = allowed.slice(start).map(bar => ({ ...bar }))
      } catch (cause) { defer(() => alive && requestedGeneration === generation && error(cause.message)); return }
      defer(() => alive && requestedGeneration === generation && callback(bars, { noData: bars.length === 0 }))
    },
    subscribeBars(info, resolution, callback, id, reset) {
      if (info.ticker !== symbol || !supported.includes(resolution)) return
      subscriptions.set(id, { resolution, callback, reset, last: history(resolution).at(-1), seedCutoff: readHistory ? null : Number(limit) })
      if (readHistory) {
        const item = subscriptions.get(id), requestedGeneration = generation, requestedUpdate = updateGeneration, requestedCutoff = Number(limit)
        Promise.resolve().then(() => readHistory(resolution, { countBack: 1 })).then(bars => {
          if (alive && requestedGeneration === generation && requestedUpdate === updateGeneration && subscriptions.get(id) === item) {
            item.last = bars.at(-1)
            item.seedCutoff = item.last?.time === bucketTime(requestedCutoff, periodOf(resolution)) ? requestedCutoff : null
          }
        }).catch(() => { if (alive && requestedGeneration === generation && requestedUpdate === updateGeneration && subscriptions.get(id) === item) reset() })
      }
    },
    unsubscribeBars(id) { subscriptions.delete(id) },
  }
  return {
    datafeed, interval, supported,
    update(nextRows, nextCutoff, stepTail) {
      if (nextRows === visible && Number(nextCutoff) === Number(limit)) return true
      // Order mutations return a new JSON window with the same immutable bars.
      // They must not republish candles or fetch history at an unchanged cutoff.
      if (Number(nextCutoff) === Number(limit) && nextRows.length === visible.length
          && nextRows.every((row, i) => sameRow(row, visible[i]))) {
        visible = nextRows
        return true
      }
      const rewind = Number(nextCutoff) < Number(limit) || nextRows.length < visible.length
      const previousCutoff = Number(limit)
      const appended = verifiedTail(stepTail, previousCutoff, nextCutoff, nextRows)
      visible = nextRows; limit = nextCutoff
      historyCache.clear()
      if (rewind) { generation += 1; subscriptions.forEach(item => { item.last = history(item.resolution).at(-1); item.seedCutoff = null; item.reset() }); return false }
      updateGeneration += 1
      const advanced = new Set()
      if (appended) {
        subscriptions.forEach(item => {
          // Calendar candles may begin before the 2000-row local window. Only
          // an authoritative aggregate at the exact base cutoff can seed them.
          if (item.seedCutoff !== previousCutoff || item.last?.time !== bucketTime(previousCutoff, periodOf(item.resolution))) return
          const bars = tailBars(item.last, appended, Number(nextCutoff), item.resolution)
          for (const bar of bars) { item.last = { ...bar }; item.callback({ ...bar }) }
          item.seedCutoff = Number(nextCutoff)
          advanced.add(item)
        })
      }
      if (readHistory) {
        const requestedGeneration = generation, requestedUpdate = updateGeneration
        const pending = new Map()
        subscriptions.forEach(item => {
          if (advanced.has(item)) return
          const period = periodOf(item.resolution)
          // Superseded history requests never publish their bars. Catch up from
          // this subscription's delivered candle, even after several fast steps.
          const oldBucket = Math.min(item.last?.time ?? Infinity, bucketTime(previousCutoff, period))
          const newBucket = bucketTime(Number(nextCutoff), period)
          let countBack = 1
          if (newBucket > oldBucket) {
            if (period === '1M') {
              const from = new Date(oldBucket), to = new Date(newBucket)
              countBack += (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth()
            } else countBack += Math.ceil((newBucket - oldBucket) / (resolutionSeconds(item.resolution) * 1000))
          }
          if (countBack > 2000) { item.last = history(item.resolution).at(-1); item.seedCutoff = null; item.reset(); return }
          const requestKey = `${item.resolution}:${countBack}`
          if (!pending.has(requestKey)) pending.set(requestKey, Promise.resolve().then(() => readHistory(item.resolution, { countBack })))
          pending.get(requestKey).then(bars => {
            if (!alive || requestedGeneration !== generation || requestedUpdate !== updateGeneration || ![...subscriptions.values()].includes(item)) return
            for (const bar of bars) {
              if (!item.last || bar.time > item.last.time || (bar.time === item.last.time && JSON.stringify(bar) !== JSON.stringify(item.last))) {
                item.last = { ...bar }; item.callback({ ...bar })
              }
            }
            item.seedCutoff = item.last?.time === newBucket ? Number(nextCutoff) : null
          }).catch(() => { if (alive && requestedGeneration === generation && requestedUpdate === updateGeneration && [...subscriptions.values()].includes(item)) item.reset() })
        })
        return true
      }
      subscriptions.forEach(item => {
        if (advanced.has(item)) return
        const bars = history(item.resolution)
        for (const bar of bars) {
          if (!item.last || bar.time > item.last.time || (bar.time === item.last.time && JSON.stringify(bar) !== JSON.stringify(item.last))) {
            item.last = { ...bar }; item.callback({ ...bar })
          }
        }
        item.seedCutoff = Number(nextCutoff)
      })
      return true
    },
    dispose() { alive = false; generation += 1; subscriptions.clear() },
  }
}
