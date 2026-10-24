const currencies=new Set('USD EUR GBP JPY CHF CAD AUD NZD SEK NOK DKK SGD HKD CNH CNY ZAR TRY MXN PLN HUF CZK THB ILS RUB BRL'.split(' '))
const metals=new Set(['XAU','XAG','XPT','XPD'])
const crypto=new Set(['BTC','ETH','LTC','BCH','XRP','ADA','DOT','SOL','DOGE','BNB'])

// Display grouping only. Unknown broker names stay unclassified; never use this for pricing or orders.
export function mt5SymbolCategory(symbol, metadata) {
  if(metadata?.source==='mt5_sdk') {
    const groups=[['metal',/\b(metals?|precious)\b/i],['crypto',/\b(crypto|cryptocurrencies|cryptocurrency)\b/i],['energy',/\b(energy|energies|oil|gas)\b/i],['index',/\b(indices|indexes|index)\b/i],['etf',/\betfs?\b/i],['stock',/\b(stocks?|equities|shares)\b/i],['bond',/\bbonds?\b/i],['agriculture',/\b(agriculture|agricultural|softs)\b/i],['futures',/\bfutures\b/i],['fx',/\b(forex|fx|majors?|minors?|exotics?)\b/i]]
    for(const text of [metadata.category,metadata.path]) {
      const found=groups.find(([,pattern])=>pattern.test(String(text||'').replaceAll('_',' ')))
      if(found)return found[0]
    }
    if(metals.has(metadata.currency_base))return 'metal'
    if(crypto.has(metadata.currency_base))return 'crypto'
    if([0,5].includes(metadata.trade_calc_mode)&&currencies.has(metadata.currency_base)&&currencies.has(metadata.currency_profit)&&metadata.currency_base!==metadata.currency_profit)return 'fx'
    if(metadata.category||metadata.path)return ''
  }
  const match=/^([A-Z]{3}|[A-Z]{4})([A-Z]{3})(?:m|[._-][A-Z0-9]+)?$/i.exec(symbol)
  if(!match)return ''
  const base=match[1].toUpperCase(),quote=match[2].toUpperCase()
  if(!currencies.has(quote))return ''
  if(metals.has(base))return 'metal'
  if(crypto.has(base))return 'crypto'
  return currencies.has(base)&&base!==quote?'fx':''
}

export function mt5SymbolOptions(symbols, catalog=[]) {
  const metadata=new Map(catalog.filter(item=>item?.source==='mt5_sdk'&&typeof item.symbol==='string').map(item=>[item.symbol,item]))
  return symbols.map(symbol=>{const item=metadata.get(symbol);return {symbol,category:mt5SymbolCategory(symbol,item),metadata:item,
    search:[symbol,item?.description,item?.category,item?.path,item?.currency_base,item?.currency_profit].filter(Boolean).join(' ').toLowerCase()}})
}
