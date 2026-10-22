// MT5 navigation never carries replay identifiers or simulation settings forward.
export function liveTradingHref(workspace, query, { chart = false, symbol, timeframe } = {}) {
  const params = new URLSearchParams({ workspace, view:'live', area:'live', section:'terminal' })
  for (const key of ['lang','chart_engine','live_account','mt5_connection']) if (query.get(key)) params.set(key,query.get(key))
  if (chart) params.set('surface','workspace')
  if (symbol || query.get('mt5_symbol')) params.set('mt5_symbol',symbol || query.get('mt5_symbol'))
  if (timeframe || query.get('mt5_timeframe')) params.set('mt5_timeframe',timeframe || query.get('mt5_timeframe'))
  return `/?${params}`
}
