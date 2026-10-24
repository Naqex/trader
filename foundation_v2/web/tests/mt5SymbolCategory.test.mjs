import test from 'node:test'
import assert from 'node:assert/strict'
import { mt5SymbolCategory } from '../src/mt5SymbolCategory.js'

test('recognizes currency pairs and common broker suffixes for display',()=>{
  for(const symbol of ['EURUSD','EURUSDm','GBPJPY.pro','USDTHB','audnzd.raw','EURUSD-ECN'])assert.equal(mt5SymbolCategory(symbol),'fx',symbol)
  for(const symbol of ['XAUUSDm','XAGUSD','XPTUSD.raw'])assert.equal(mt5SymbolCategory(symbol),'metal',symbol)
  for(const symbol of ['BTCUSDm','ETHUSD','DOGEUSD.pro'])assert.equal(mt5SymbolCategory(symbol),'crypto',symbol)
})
test('opaque stocks, indices, energies and unknown names are never guessed as Forex',()=>{
  for(const symbol of ['AAPLm','US30m','USOILm','MYSTERY','EURUSDunknown','USDUSD','USDUSDT','XAUFAK',''])assert.equal(mt5SymbolCategory(symbol),'',symbol)
})
