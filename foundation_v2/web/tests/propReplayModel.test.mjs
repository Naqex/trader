import assert from 'node:assert/strict'
import test from 'node:test'
import { propReplayRuleView } from '../src/propReplayModel.js'

const state = () => ({
  session: { profile: { phases: [{ phase_index: 1, currency: 'USD', profit_target: { threshold: { percent: '10' }, basis: 'balance' }, daily_loss: { threshold: { amount: '500' }, basis: 'equity' }, overall_drawdown: { threshold: { percent: '10' }, basis: 'equity', kind: 'static' }, reset_local_time: '00:00:00', reset_timezone: 'UTC', position_policy: 'must_be_flat', min_qualifying_days: 1, max_calendar_days: 30 }] } },
  attempt: { status: 'running' },
  phase: { phase_index: 1, initial_balance: '10000', balance: '10100', equity: '9900', daily_anchor: '10200', high_water_mark: '10500', qualifying_days: 0 },
})

test('rules distinguish realized profit from equity loss and the daily anchor', () => {
  const rules = propReplayRuleView(state())
  assert.equal(rules.profitTarget.current, 100)
  assert.equal(rules.profitTarget.target, 1000)
  assert.equal(rules.dailyLoss.used, 300)
  assert.equal(rules.dailyLoss.limit, 500)
  assert.equal(rules.overallDrawdown.used, 100)
  assert.equal(rules.overallDrawdown.limit, 1000)
  assert.deepEqual(rules.dailyReset, { time: '00:00:00', timezone: 'UTC' })
  assert.equal(rules.positionPolicy, 'must_be_flat')
})

test('trailing drawdown follows its high water mark rather than starting capital', () => {
  const input = state()
  input.session.profile.phases[0].overall_drawdown.kind = 'trailing'
  assert.equal(propReplayRuleView(input).overallDrawdown.used, 600)
})

test('missing money remains unknown instead of appearing as zero profit or loss', () => {
  const input = state()
  input.phase.balance = null; input.phase.equity = null
  const rules = propReplayRuleView(input)
  assert.equal(rules.profitTarget.current, null)
  assert.equal(rules.dailyLoss.used, null)
  assert.equal(rules.overallDrawdown.used, null)
})
