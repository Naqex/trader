import test from 'node:test'
import assert from 'node:assert/strict'
import { mt5SymbolCategory, mt5SymbolOptions } from '../src/mt5SymbolCategory.js'

test('recognizes currency pairs and common broker suffixes for display',()=>{
  for(const symbol of ['EURUSD','EURUSDm','GBPJPY.pro','USDTHB','audnzd.raw','EURUSD-ECN'])assert.equal(mt5SymbolCategory(symbol),'fx',symbol)
  for(const symbol of ['XAUUSDm','XAGUSD','XPTUSD.raw'])assert.equal(mt5SymbolCategory(symbol),'metal',symbol)
  for(const symbol of ['BTCUSDm','ETHUSD','DOGEUSD.pro'])assert.equal(mt5SymbolCategory(symbol),'crypto',symbol)
})
test('opaque stocks, indices, energies and unknown names are never guessed as Forex',()=>{
  for(const symbol of ['AAPLm','US30m','USOILm','MYSTERY','EURUSDunknown','USDUSD','USDUSDT','XAUFAK',''])assert.equal(mt5SymbolCategory(symbol),'',symbol)
})

test('broker catalog classifies opaque assets, supports search and keeps unknown categories explicit',()=>{
  const catalog=[{symbol:'OPAQUE',source:'mt5_sdk',category:'Crypto',description:'Bitcoin vs US Dollar'},
    {symbol:'US30m',source:'mt5_sdk',path:'CFD\\Indices\\US'},
    {symbol:'AAPLm',source:'mt5_sdk',category:'Stocks'},
    {symbol:'EURUSDm',source:'mt5_sdk',category:'Unmapped Group',path:'Unknown'},
    {symbol:'USOILm',source:'mt5_sdk',category:'Energy'},
    {symbol:'XAUUSDm',source:'untrusted',category:'Stocks'}]
  const rows=mt5SymbolOptions(['OPAQUE','US30m','AAPLm','EURUSDm','USOILm','XAUUSDm'],catalog)
  assert.deepEqual(rows.map(r=>r.category),['crypto','index','stock','','energy','metal'])
  assert.ok(rows[0].search.includes('bitcoin'))
  assert.equal(mt5SymbolCategory('MYSTERY',{source:'mt5_sdk',trade_calc_mode:0,currency_base:'EUR',currency_profit:'USD'}),'fx')
  assert.deepEqual(mt5SymbolOptions(['EURUSDm'],[]).map(r=>r.category),['fx'])
})
