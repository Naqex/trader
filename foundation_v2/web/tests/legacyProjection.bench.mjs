import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { closedChartTrades } from '../src/legacyChartTrades.js'
import { previousClosedChartTrades, projectionFixture } from './legacyProjectionFixture.mjs'

const output = process.argv[2]
if (!output) throw Error('Usage: node tests/legacyProjection.bench.mjs <output.json>')
const count = 7, report = { scope: 'Synthetic closed-trade projection only; full retained ledger; not browser/API latency', node: process.version, cpu: os.cpus()[0].model, platform: process.platform, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), samplesPerCandidate: count, warmupPerCandidate: 1, cases: [] }
let consumed = 0
const percentile = (samples, ratio) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * ratio) - 1]
function measure(fn, input) { const started = performance.now(); const result = fn(input); const elapsed = performance.now() - started; consumed += result.length; return elapsed }
for (const eventCount of [10000, 100000]) for (const closeEvery of [1000, 100, 10]) {
  const input = projectionFixture(eventCount, closeEvery)
  assert.deepEqual(closedChartTrades(input), previousClosedChartTrades(input))
  measure(previousClosedChartTrades, input); measure(closedChartTrades, input)
  const baselineMs = [], indexedMs = []
  for (let sample = 0; sample < count; sample += 1) {
    const candidates = sample % 2 ? [[closedChartTrades, indexedMs], [previousClosedChartTrades, baselineMs]] : [[previousClosedChartTrades, baselineMs], [closedChartTrades, indexedMs]]
    for (const [fn, samples] of candidates) samples.push(measure(fn, input))
  }
  const baselineMedianMs = percentile(baselineMs, .5), indexedMedianMs = percentile(indexedMs, .5)
  const result = { eventCount, closedTrades: eventCount / closeEvery, closeEvery, parity: true, baselineMs, indexedMs, baselineMedianMs, indexedMedianMs, baselineSampleP95Ms: percentile(baselineMs, .95), indexedSampleP95Ms: percentile(indexedMs, .95), speedup: baselineMedianMs / indexedMedianMs }
  report.cases.push(result)
  console.log(JSON.stringify({ eventCount, closedTrades: result.closedTrades, baselineMedianMs, indexedMedianMs, speedup: result.speedup }))
}
report.consumedRows = consumed
await mkdir(path.dirname(path.resolve(output)), { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
