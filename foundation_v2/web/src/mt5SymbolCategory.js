const currencies=new Set('USD EUR GBP JPY CHF CAD AUD NZD SEK NOK DKK SGD HKD CNH CNY ZAR TRY MXN PLN HUF CZK THB ILS RUB BRL'.split(' '))
const metals=new Set(['XAU','XAG','XPT','XPD'])
const crypto=new Set(['BTC','ETH','LTC','BCH','XRP','ADA','DOT','SOL','DOGE','BNB'])

// Display grouping only. Unknown broker names stay unclassified; never use this for pricing or orders.
export function mt5SymbolCategory(symbol) {
  const match=/^([A-Z]{3}|[A-Z]{4})([A-Z]{3})(?:m|[._-][A-Z0-9]+)?$/i.exec(symbol)
  if(!match)return ''
  const base=match[1].toUpperCase(),quote=match[2].toUpperCase()
  if(!currencies.has(quote))return ''
  if(metals.has(base))return 'metal'
  if(crypto.has(base))return 'crypto'
  return currencies.has(base)&&base!==quote?'fx':''
}
