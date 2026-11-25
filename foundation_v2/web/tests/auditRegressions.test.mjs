import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { shouldShowManualRetry } from '../src/readRecovery.js'

const srcDir = path.resolve(process.cwd(), 'src')
const readSrc = name => fs.readFileSync(path.join(srcDir, name), 'utf8')

test('shouldShowManualRetry keeps Retry visible when recovery is idle, exhausted, or offline, and hides it only during active retry countdown', () => {
  const retry = () => {}
  assert.equal(shouldShowManualRetry(null, undefined), false)
  assert.equal(shouldShowManualRetry(retry, undefined), true)
  assert.equal(shouldShowManualRetry(retry, { retryAt: null, seconds: null, offline: false, exhausted: false }), true)
  assert.equal(shouldShowManualRetry(retry, { retryAt: null, seconds: null, offline: false, exhausted: true }), true)
  assert.equal(shouldShowManualRetry(retry, { retryAt: null, seconds: null, offline: true, exhausted: false }), true)
  assert.equal(shouldShowManualRetry(retry, { retryAt: Date.now() + 5000, seconds: 5, offline: false, exhausted: false }), false)
  assert.equal(shouldShowManualRetry(retry, { retryAt: Date.now() + 5000, seconds: 5, offline: false, exhausted: true }), true)
})

test('TestingReadState delegates retry visibility to shouldShowManualRetry', () => {
  const source = readSrc('TestingReadState.jsx')
  assert.match(source, /shouldShowManualRetry\(onRetry,\s*recovery\)/)
  assert.doesNotMatch(source, /onRetry\s*&&\s*!recovery\s*&&/)
})

test('ReplayWorkspace memoizes priceLevels, guards focus dataset reload, and avoids hidden advanced-chart crosshair churn', () => {
  const replaySrc = readSrc('ReplayWorkspace.jsx')
  const tvSrc = readSrc('TradingViewReplayChart.jsx')
  assert.match(replaySrc, /const priceLevels = useMemo\(\(\) => \(order\.active \? orderLevels\(/)
  assert.match(replaySrc, /if \(datasetState\.status !== 'ready' && datasetState\.status !== 'loading'\) loadDatasets\(\)/)
  const tvStart = replaySrc.indexOf('<TradingViewReplayChart')
  const tvEnd = replaySrc.indexOf('<ReplayChart', tvStart)
  assert.ok(tvStart > 0 && tvEnd > tvStart, 'TradingViewReplayChart JSX tag must exist before ReplayChart fallback')
  assert.doesNotMatch(replaySrc.slice(tvStart, tvEnd), /\bonCrosshair=/)
  assert.match(tvSrc, /if \(!latest\.current\.onCrosshair\) return/)
  assert.match(tvSrc, /Object\.is\(key,\s*lastCrosshairTime\)/)
})
