import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionDate, sessionRemainingDays, sessionRange, sessionSettingsFacts } from '../src/sessionSettingsModel.js'

test('remaining range uses canonical cutoff, preserving weekends and ignoring trade close times', () => {
  const dataset = { first_timestamp: 1783285500, last_timestamp: 1791174360 }
  const payload = { provenance: { cutoff_timestamp: 1791000000 } }
  assert.equal(sessionRemainingDays(dataset, payload, { cutoff_timestamp: 1783315500 }), 91)
  assert.deepEqual(sessionRange({}, dataset, payload, { cutoff_timestamp: 1783315500 }), { first: 1783285500, last: 1791174360, days: 91 })
  assert.equal(sessionRemainingDays(dataset, {}), null)
  assert.equal(sessionRemainingDays(dataset, { cutoff_timestamp: dataset.last_timestamp + 100 }), 0)
})

test('unknown balances and range stay unknown, numeric zero remains visible', () => {
  assert.equal(sessionDate(null), '-')
  assert.equal(sessionDate(''), '-')
  assert.equal(sessionSettingsFacts({ instrument_id: 'EURUSDm' }, {}, {}, null).balance, null)
  assert.equal(sessionSettingsFacts({}, {}, {}, null, { payload: { execution: { balance: 0, starting_balance: 10000 } } }).balance, 0)
  assert.equal(sessionSettingsFacts({}, {}, {}, null, { payload: { execution: { balance: 0, starting_balance: 10000 } } }).startingBalance, 10000)
  const configured = sessionSettingsFacts({}, {}, {}, null, { payload: { starting_balance: '25000.75', starting_balance_ccy: 'EUR' } })
  assert.equal(configured.balance, '25000.75')
  assert.equal(configured.startingBalance, '25000.75')
  assert.equal(configured.currency, 'EUR')
})

test('saved asset settings keep the correct symbol after server JSON key sorting', () => {
  const item = {dataset_ids:['z-eur','a-gold'],instrument_ids:['EUR/USD','XAU/USD']}
  const record = {payload:{trading_options:{assets:{'a-gold':{},'z-eur':{}}}}}
  const facts = sessionSettingsFacts(item,{},null,null,record)
  assert.deepEqual(facts.tradingAssets.map(asset=>[asset.dataset_id,asset.instrument_id]),[['a-gold','XAU/USD'],['z-eur','EUR/USD']])
})

test('initial and current balances keep their independent portfolio facts and zero values', () => {
 const facts=sessionSettingsFacts({}, {}, {}, {startBalance:100,endingBalance:80}, {
  portfolio_account:{starting_balance:'100000',balance:'99997.72'},
  payload:{starting_balance:'50000',execution:{starting_balance:'25000',balance:'24000'}},
 })
 assert.equal(facts.startingBalance,'100000')
 assert.equal(facts.balance,'99997.72')
 const fallback=sessionSettingsFacts({}, {}, {}, {startBalance:100,endingBalance:80}, {payload:{starting_balance:100}})
 assert.equal(fallback.balance,80)
 assert.equal(fallback.startingBalance,100)
 const zero=sessionSettingsFacts({}, {}, {}, null, {portfolio_account:{starting_balance:0,balance:0}})
 assert.equal(zero.startingBalance,0)
 assert.equal(zero.balance,0)
})
