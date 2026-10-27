import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'

const row = (day, net_pnl, extra = {}) => ({ session_id: 'a', tradeId: day, starting_balance: 100000, account_currency: 'USD', close_time_utc: `${day}T12:00:00Z`, report_time_utc: '2030-01-01T00:00:00Z', net_pnl, ...extra })
const source = ledger => ({ ledger, startBalance: 100000, curve: [], drawdown: [], result: { scope: { time_basis: 'market', active_filters: false, total_trade_count: ledger.length } } })
const run = (model, filters = {}) => advancedAnalytics(model, { timezone: 'UTC', ...filters }).calendar
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)

test('calendar initial and day-opening returns match the observed daily arithmetic, not the latest snapshot', () => {
  const model = source([row('2025-06-09', 3652.17), row('2025-06-11', 4390), row('2025-06-15', -460), row('2025-06-17', 916)])
  model.result.portfolio_account = { balance: 999999 }
  const days = run(model)
  for (const [index, capital] of [100000,103652.17,108042.17,107582.17].entries()) {
    near(days[index].profitPct, model.ledger[index].net_pnl / 100000 * 100)
    near(days[index].profitPctCurrent, model.ledger[index].net_pnl / capital * 100)
  }
  assert.deepEqual(days.map(day => day.label), model.ledger.map(row => row.close_time_utc.slice(0,10)))
})

test('local filters do not reset opening capital or compound intraday trades', () => {
  const model = source([row('2024-01-01', 1000, {symbol:'EURUSD'}),row('2024-01-02', 100, {symbol:'XAUUSD'}),row('2024-01-02', -50, {symbol:'EURUSD'})].reverse())
  near(run(model, {assets:'["XAUUSD"]'})[0].profitPctCurrent, 100 / 101000 * 100)
  near(run(model)[1].profitPctCurrent, 50 / 101000 * 100)
})

test('server-filtered, unverified, partial, truncated or undated history never fabricates opening capital', () => {
  for (const mutate of [
    m => {m.result.scope.active_filters = true},
    m => {delete m.result.scope.active_filters},
    m => {m.result.scope.total_trade_count++},
    m => {m.result.partial = true},
    m => {m.result.status = 'partial'},
    m => {m.ledger[0].close_time_utc = null},
  ]) {
    const model = source([row('2024-01-01', 100),row('2024-01-02', 100)])
    mutate(model)
    assert.ok(run(model).every(day => day.profitPctCurrent === null))
  }
})

test('missing past PnL taints later opening balances, but missing future PnL does not taint earlier days', () => {
  const days = run(source([row('2024-01-01', 100),row('2024-01-02', null),row('2024-01-03', 100)]))
  assert.equal(days[0].profitPctCurrent, .1)
  assert.equal(days[1].profitPctCurrent, null)
  assert.equal(days[2].profitPctCurrent, null)
})

test('multi-source daily return pools each source once and preserves missing and currency constraints', () => {
  const model = source([row('2024-01-01', 100, {starting_balance:1000}),row('2024-01-02', 100, {starting_balance:1000}),row('2024-01-01', 200, {session_id:'b', starting_balance:4000})])
  model.result.multi_session = true
  near(run(model)[0].profitPct, 300 / 5000 * 100)
  near(run(model)[1].profitPctCurrent, 100 / 5300 * 100)
  for (const capital of [null,0,-1,NaN]) {
    model.ledger[2].starting_balance = capital
    assert.ok(run(model).every(day => day.profitPct === null && day.profitPctCurrent === null))
  }
  model.ledger[2].starting_balance = 4000
  model.ledger[2].account_currency = 'EUR'
  assert.ok(run(model).every(day => day.profitPctCurrent === null))
})

test('nonpositive opening balance is N/A; known breakeven is zero; intraday movement does not redefine opening balance', () => {
  const model = source([row('2024-01-01',-100000),row('2024-01-02',10),row('2024-01-03',0)])
  const days = run(model)
  assert.equal(days[1].profitPctCurrent, null)
  assert.equal(days[2].profitPctCurrent, 0)
  const intraday = run(source([row('2024-01-01',-100001),row('2024-01-01',100002),row('2024-01-02',100)]))
  near(intraday[1].profitPctCurrent, 100 / 100001 * 100)
})

test('calendar R is a sum of each original-risk return, never an average or zero-fill', () => {
  const days = run(source([row('2024-01-01',100,{planned_risk_budget:50}),row('2024-01-01',-100,{planned_risk_budget:100}),row('2024-01-02',0,{planned_risk_budget:50}),row('2024-01-03',10)]))
  assert.equal(days[0].totalR,1)
  assert.equal(days[0].averageR,.5)
  assert.equal(days[1].totalR,0)
  assert.equal(days[2].totalR,null)
  assert.equal(days[2].rCount,0)
})

test('day-opening boundaries follow the chosen timezone, retaining chart time ownership', () => {
  const model = source([row('2024-01-01',100,{close_time_utc:'2024-01-01T23:30:00Z'}),row('2024-01-02',100,{close_time_utc:'2024-01-02T00:30:00Z'})])
  assert.equal(run(model).length,2)
  const days = run(model,{timezone:'Asia/Ho_Chi_Minh'})
  assert.equal(days.length,1)
  assert.equal(days[0].label,'2024-01-02')
  assert.equal(days[0].profitPctCurrent,.2)
})
