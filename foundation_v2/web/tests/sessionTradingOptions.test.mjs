import assert from 'node:assert/strict'
import test from 'node:test'
import { assetTradingDefaults, assetSlippageUnit, buildTradingOptions, sessionExecutionConfig, slippageAllowance, tradingOptionsError, tradingOptionsMatch, slippageGroups, updateGroupSlippage } from '../src/sessionTradingOptions.js'
import { marketQuotes } from '../src/replayOrderModel.js'
import { createPropChartSession } from '../src/propSessionCreation.js'

const assets = [{ dataset_id:'eur', instrument_id:'EUR/USD',instrument_spec:{asset_class:'fx',pip_size:'0.0001',tick_size:'0.00001'} }, { dataset_id:'gold', instrument_id:'XAU/USD',instrument_spec:{asset_class:'metal',pip_size:'0.1',tick_size:'0.01'} }]

test('slippage categories combine aliases and apply a shared mode without changing other assets or fees', () => {
  const yen = {dataset_id:'yen',instrument_id:'USD/JPY',replay_instrument_spec:{asset_class:'forex',pip_size:'0.01'}}
  const selected = [assets[0],yen,assets[1]]
  const before = {costs_enabled:true,assets:{eur:{...assetTradingDefaults(),spread_price:'0.0002'},gold:{...assetTradingDefaults(),slippage:{mode:'light'}}}}
  const groups = slippageGroups(selected,before)
  assert.deepEqual(groups.map(group => [group.category,group.assets.length]),[['fx',2],['metal',1]])
  const after = updateGroupSlippage(before,groups[0].assets,{mode:'fixed',fixed_steps:'3'})
  const saved = buildTradingOptions(after,selected)
  assert.deepEqual(saved.assets.eur.slippage,{mode:'fixed',fixed_steps:3})
  assert.deepEqual(saved.assets.yen.slippage,{mode:'fixed',fixed_steps:3})
  assert.equal(saved.assets.eur.spread_price,'0.0002')
  assert.deepEqual(saved.assets.gold.slippage,{mode:'light'})
  assert.equal(sessionExecutionConfig({payload:{trading_options:saved,dataset_id:'yen'}},yen.replay_instrument_spec).costModel.slippage_model.unit_price,'0.01')
  assert.equal(before.assets.yen,undefined,'editing a group must not mutate the original draft')
})

test('mixed preset assumptions remain explicit; incomplete group specs cannot enable slippage', () => {
  const other = {...assets[0],dataset_id:'other',instrument_id:'GBP/USD'}
  const options = {costs_enabled:false,assets:{eur:{...assetTradingDefaults(),slippage:{mode:'fixed',fixed_steps:2}},other:{...assetTradingDefaults(),slippage:{mode:'fixed',fixed_steps:'3'}}}}
  const snapshot = structuredClone(options)
  assert.equal(slippageGroups([assets[0],other],options)[0].mixed,true)
  options.assets.other.slippage.fixed_steps='2'
  assert.equal(slippageGroups([assets[0],other],options)[0].mixed,false,'numeric and form-string values agree')
  const incomplete = {...other,instrument_spec:{asset_class:'fx'}}
  assert.equal(slippageGroups([assets[0],incomplete],options)[0].available,false)
  assert.equal(snapshot.assets.other.slippage.fixed_steps,'3')
})
test('default costs are explicitly off for every selected asset, with no inherited fixture fees', () => {
  const options = buildTradingOptions({ costs_enabled:false, assets:{} }, assets)
  const config = sessionExecutionConfig({ payload:{ trading_options:options, dataset_id:'eur' } }, { account_ccy:'USD' })
  assert.equal(config.spread, '0')
  assert.equal(config.costModel.commission_per_lot_account, '0')
  assert.equal(config.costModel.slippage_price_per_side, '0')
  assert.equal(config.costModel.version, 'session-cost-v2')
  assert.deepEqual(Object.keys(options.assets), ['eur','gold'])
})
test('options preserve independent assets, fee units and charge convention; deselected drafts are not persisted', () => {
  const options = buildTradingOptions({ costs_enabled:true, assets:{ eur:{...assetTradingDefaults(),spread_price:'0.00010',commission_per_lot:'7'}, gold:{...assetTradingDefaults(),spread_price:'0.20',commission_per_lot:'3',commission_charge:'per_side',slippage:{mode:'fixed',fixed_steps:'2'}}, removed:{spread_price:'bad'} } }, assets)
  const replay = { payload:{ trading_options:options, dataset_id:'gold' } }
  const config = sessionExecutionConfig(replay, {account_ccy:'USD'})
  assert.equal(config.spread,'0.20')
  assert.equal(config.costModel.commission_per_lot_account,'3')
  assert.equal(config.costModel.commission_charge,'per_side')
  assert.deepEqual(options.assets.gold.slippage,{mode:'fixed',fixed_steps:2})
  assert.equal(options.assets.removed,undefined)
  const off = buildTradingOptions({...options,costs_enabled:false},assets)
  assert.equal(off.assets.gold.commission_per_lot,'0')
  assert.deepEqual(off.assets.gold.slippage,{mode:'fixed',fixed_steps:2},'slippage is an independent explicit assumption')
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
  assert.equal(savedBundle.attempt.cost_version,'session-cost-v2')
  assert.deepEqual(savedBundle.resume_state.setup_metadata.trading_options,options)
  assert.deepEqual(savedReplay.trading_options,options)
})

test('four slippage modes preserve units and reject invalid fixed amounts before submission', () => {
  assert.deepEqual(assetSlippageUnit(assets[0]),{unit:'pip',price:'0.0001',available:true})
  assert.deepEqual(assetSlippageUnit(assets[1]),{unit:'tick',price:'0.01',available:true})
  for (const mode of ['off','light','medium','fixed']) {
    const draft = {costs_enabled:false,assets:{eur:{...assetTradingDefaults(),slippage:{mode,fixed_steps:'3'}}}}
    const saved = buildTradingOptions(draft,assets)
    assert.equal(saved.version,'session-trading-options-v2')
    assert.deepEqual(saved.assets.eur.slippage,mode==='fixed'?{mode,fixed_steps:3}:{mode})
    assert.equal(tradingOptionsMatch(structuredClone(saved),saved),true)
    const changed = structuredClone(saved); changed.assets.eur.slippage={mode:mode==='off'?'light':'off'}
    assert.equal(tradingOptionsMatch(changed,saved),false)
  }
  for (const fixed_steps of ['',0,21,'1.5','NaN','1e1']) assert.ok(tradingOptionsError({costs_enabled:false,assets:{eur:{...assetTradingDefaults(),slippage:{mode:'fixed',fixed_steps}}}},assets))
  assert.ok(tradingOptionsError({costs_enabled:false,assets:{missing:{...assetTradingDefaults(),slippage:{mode:'light'}}}},[{dataset_id:'missing'}]))
})

test('legacy frozen slippage costs remain separate from new adverse-fill modes', () => {
  const options={version:'session-trading-options-v1',costs_enabled:false,assets:{eur:{spread_price:'0',commission_per_lot:'0',commission_charge:'round_trip',slippage_price:'0.00002'}}}
  const saved=buildTradingOptions(options,[assets[0]])
  assert.deepEqual(saved,options)
  assert.equal(sessionExecutionConfig({payload:{trading_options:saved,dataset_id:'eur'}},{}).costModel.slippage_price_per_side,'0.00002')
  assert.equal(tradingOptionsMatch(saved,options),true)
})

test('pre-initialization risk previews include market and stop bounds but keep limit TP protected', () => {
  const model = (mode,fixed_steps) => ({version:'session-cost-v2',slippage_model:{mode,fixed_steps,unit_price:'0.0001'}})
  assert.deepEqual(slippageAllowance(model('off')),{risk:0,reward:0,variable:false})
  const light=slippageAllowance(model('light')), medium=slippageAllowance(model('medium'))
  assert.ok(Math.abs(light.risk-0.0003)<1e-12)
  assert.ok(Math.abs(medium.risk-0.0011)<1e-12)
  assert.ok(Math.abs(medium.reward-0.0003)<1e-12)
  assert.deepEqual(slippageAllowance(model('fixed',20)),{risk:0.004,reward:0.002,variable:false})
  assert.equal(slippageAllowance({...model('light'),slippage_model:{mode:'light'}}),null,'missing unit cannot look like zero risk')
  const options=buildTradingOptions({costs_enabled:false,assets:{eur:{...assetTradingDefaults(),slippage:{mode:'fixed',fixed_steps:'2'}}}},[assets[0]])
  const config=sessionExecutionConfig({payload:{trading_options:options,trading_options_seed:'saved-seed',dataset_id:'eur'}},assets[0].instrument_spec)
  assert.equal(config.costModel.slippage_model.seed,'saved-seed')
  assert.equal(config.costModel.slippage_model.unit,'pip')
  assert.equal(slippageAllowance(config.costModel).risk,0.0004)
  assert.deepEqual(slippageAllowance({version:'session-cost-v1',slippage_price_per_side:'0.0001'}),{risk:0.0002,reward:0.0002,variable:false})
})
