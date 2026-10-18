import assert from 'node:assert/strict'
import test from 'node:test'
import { assetTradingDefaults, buildTradingOptions, sessionExecutionConfig, tradingOptionsError, tradingOptionsMatch } from '../src/sessionTradingOptions.js'
import { marketQuotes } from '../src/replayOrderModel.js'
import { createPropChartSession } from '../src/propSessionCreation.js'

const assets = [{ dataset_id:'eur', instrument_id:'EUR/USD' }, { dataset_id:'gold', instrument_id:'XAU/USD' }]
test('default costs are explicitly off for every selected asset, with no inherited fixture fees', () => {
  const options = buildTradingOptions({ costs_enabled:false, assets:{} }, assets)
  const config = sessionExecutionConfig({ payload:{ trading_options:options, dataset_id:'eur' } }, { account_ccy:'USD' })
  assert.equal(config.spread, '0')
  assert.equal(config.costModel.commission_per_lot_account, '0')
  assert.equal(config.costModel.slippage_price_per_side, '0')
  assert.equal(config.costModel.version, 'session-cost-v1')
  assert.deepEqual(Object.keys(options.assets), ['eur','gold'])
})
test('options preserve independent assets, fee units and charge convention; deselected drafts are not persisted', () => {
  const options = buildTradingOptions({ costs_enabled:true, assets:{ eur:{...assetTradingDefaults(),spread_price:'0.00010',commission_per_lot:'7'}, gold:{...assetTradingDefaults(),spread_price:'0.20',commission_per_lot:'3',commission_charge:'per_side',slippage_price:'0.01'}, removed:{spread_price:'bad'} } }, assets)
  const replay = { payload:{ trading_options:options, dataset_id:'gold' } }
  const config = sessionExecutionConfig(replay, {account_ccy:'USD'})
  assert.equal(config.spread,'0.20')
  assert.equal(config.costModel.commission_per_lot_account,'3')
  assert.equal(config.costModel.commission_charge,'per_side')
  assert.equal(config.costModel.slippage_price_per_side,'0.01')
  assert.equal(options.assets.removed,undefined)
  const off = buildTradingOptions({...options,costs_enabled:false},assets)
  assert.equal(off.assets.gold.commission_per_lot,'0')
  assert.equal(off.assets.gold.slippage_price,'0.01','slippage is an independent explicit assumption')
})
test('empty, negative, nonfinite, overprecise and excessive active fees are rejected without treating them as zero', () => {
  for (const invalid of ['', '-1','Infinity','1e999','0.1234567890123','1000000000001']) {
    const options = {costs_enabled:true,assets:{eur:{...assetTradingDefaults(),spread_price:invalid}}}
    assert.ok(tradingOptionsError(options,assets))
    assert.throws(()=>buildTradingOptions(options,assets))
  }
  assert.equal(tradingOptionsError({costs_enabled:false,assets:{eur:{...assetTradingDefaults(),spread_price:''}}},assets),null)
  assert.equal(sessionExecutionConfig({payload:{}},{}),null,'legacy sessions are not converted')
})
test('zero-cost market quotes exactly equal chart close, including sub-tick input; spread-on keeps modeled quotes', () => {
  const replay = {payload:{execution:{cost_model:{version:'session-cost-v1'},spread_price:'0',instrument_spec:{tick_size:'0.00001'}}},visible_rows:[{close:1.120445}]}
  assert.deepEqual(marketQuotes(replay), {bid:1.120445,ask:1.120445})
  replay.payload.execution.spread_price='0.0002'
  replay.visible_rows[0].close=1.12044
  assert.deepEqual(marketQuotes(replay), {bid:1.12034,ask:1.12054})
})
test('creation response must retain the chosen costs, allowing server decimal normalization', () => {
  const requested = buildTradingOptions({costs_enabled:true,assets:{eur:{...assetTradingDefaults(),spread_price:'0.00010'}}},assets)
  const saved = structuredClone(requested)
  saved.assets.eur.spread_price='0.0001'
  assert.equal(tradingOptionsMatch(saved,requested),true)
  assert.equal(tradingOptionsMatch(undefined,requested),false,'old API cannot silently drop configuration')
  saved.assets.eur.commission_per_lot='1'
  assert.equal(tradingOptionsMatch(saved,requested),false,'server must not apply hidden charges')
})
test('Prop freezes the same options and cost pin through bundle and replay creation', async t => {
  let savedBundle, savedReplay
  t.mock.method(globalThis,'fetch',async (url,options) => {
    if (url.endsWith('/prop/session-bundles')) { savedBundle=JSON.parse(options.body); return Response.json(savedBundle) }
    if (options.method==='POST') { savedReplay=JSON.parse(options.body); return Response.json({record_id:'qa',payload:savedReplay}) }
    return Response.json({items:[]})
  })
  const datasets=[{dataset_id:'eur',artifact_sha256:'hash',first_timestamp:1577836800,last_timestamp:1583020800}]
  const options=buildTradingOptions({costs_enabled:false,assets:{}},datasets)
  await createPropChartSession('qa',{name:'Costs',profileKind:'generic',initialCapital:'10000',currency:'USD',targetPercent:'10',dailyLoss:'500',overallLoss:'1000',startUtc:'2020-01-02T00:00',datasetVersion:'eur',tradingOptions:options},datasets)
  assert.equal(savedBundle.attempt.cost_version,'session-cost-v1')
  assert.deepEqual(savedBundle.resume_state.setup_metadata.trading_options,options)
  assert.deepEqual(savedReplay.trading_options,options)
})
