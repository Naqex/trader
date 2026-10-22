import test from 'node:test'
import assert from 'node:assert/strict'
import { liveTradingHref } from '../src/liveTradingNavigation.js'

test('MT5 overview and chart navigation discard all replay and prop authority',()=>{
  const query=new URLSearchParams('session=old&dataset=old&select=1&cursor=199&mode=Practice&prop=old&challenge=old&costs_enabled=false&mt5_symbol=EURUSD&mt5_timeframe=M5')
  const chart=new URL(liveTradingHref('tenant-a',query,{chart:true}),'http://localhost')
  assert.deepEqual(Object.fromEntries(chart.searchParams),{workspace:'tenant-a',view:'live',area:'live',section:'terminal',surface:'workspace',mt5_symbol:'EURUSD',mt5_timeframe:'M5'})
  const overview=new URL(liveTradingHref('tenant-a',chart.searchParams),'http://localhost')
  assert.equal(overview.searchParams.has('surface'),false)
  assert.equal(overview.searchParams.get('mt5_symbol'),'EURUSD')
})

test('opening a chart only chooses the broker symbol and timeframe',()=>{
  const url=new URL(liveTradingHref('tenant-b',new URLSearchParams(),{chart:true,symbol:'XAUUSD.m',timeframe:'H1'}),'http://localhost')
  assert.equal(url.searchParams.get('mt5_symbol'),'XAUUSD.m')
  assert.equal(url.searchParams.get('mt5_timeframe'),'H1')
  assert.equal(url.searchParams.get('workspace'),'tenant-b')
  assert.equal(url.searchParams.has('session'),false)
})


test('direct chart routing retains the selected broker connection',()=>{
 const query=new URLSearchParams('live_account=broker:fixture&mt5_connection=fixture&session=replay')
 const url=new URL(liveTradingHref('tenant-a',query,{chart:true}),'http://localhost')
 assert.equal(url.searchParams.get('mt5_connection'),'fixture')
 assert.equal(url.searchParams.get('live_account'),'broker:fixture')
 assert.equal(url.searchParams.has('session'),false)
})
