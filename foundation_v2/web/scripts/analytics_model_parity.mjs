import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as candidate from '../src/analyticsViewModel.js'
import { DEMO_SESSIONS, demoDashboardAnalytics } from '../src/demoFixtures.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const revision = process.argv[2]
assert.match(revision || '', /^[a-f\d]{40}$/)
const source = execFileSync('git', ['show', `${revision}:foundation_v2/web/src/AnalyticsWorkspace.jsx`], { cwd: root, encoding: 'utf8' })
const modelSource = source.slice(source.indexOf('function finite(value)'), source.indexOf('function analyticsViewStatus(view)'))
assert.ok(modelSource.includes('export function buildAnalyticsModel'))
const original = await import('data:text/javascript;base64,' + Buffer.from(`import { displayDate } from '${new URL('../src/dateFormat.js', import.meta.url)}';\n${modelSource}`).toString('base64'))
const cases = [null, {}, { ledger: [] }, { ledger: [{ net_pnl: null }] }, { ledger: [{ net_pnl: -4 }, { net_pnl: 6 }], multi_session: true }, { metrics: { closed_trade_balance_curve: [{ closed_trade_balance: 100 }, { closed_trade_balance: 96 }, { closed_trade_balance: 104 }], net_pnl: 4, starting_balance: 100 }, ledger: [{ net_pnl: 4, open_time_utc: 1790812800, close_time_utc: '2026-10-01T01:00:00Z' }] }]
for (const item of DEMO_SESSIONS) {
  const view = demoDashboardAnalytics(item, 'tenant-a')
  assert.deepEqual(candidate.analyticsViewResult(view), original.analyticsViewResult(view))
  cases.push(original.analyticsViewResult(view))
}
for (const input of cases) {
  const snapshot = structuredClone(input)
  for (const kind of ['app', 'prop', 'research']) assert.deepEqual(candidate.buildAnalyticsModel(input, kind), original.buildAnalyticsModel(input, kind))
  assert.deepEqual(input, snapshot)
}
for (const query of ['', 'side=SELL&from=2026-10-01&to=2026-10-17', 'outcome=LOSS&from_close_utc=2026-10-01T01%3A00%3A00Z']) {
  const filters = original.readAnalyticsFilters(new URLSearchParams(query))
  assert.deepEqual(candidate.readAnalyticsFilters(new URLSearchParams(query)), filters)
  assert.equal(candidate.analyticsQuery(filters).toString(), original.analyticsQuery(filters).toString())
}
const result = { scope: 'Exact original model functions versus extracted candidate; financial fixture equality, report kinds, null and immutable-input semantics', revision, modelCases: cases.length * 3, projectionCases: DEMO_SESSIONS.length, filterCases: 3, status: 'PASS' }
await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
