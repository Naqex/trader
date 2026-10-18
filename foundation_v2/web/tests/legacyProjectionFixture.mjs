// Frozen pre-optimization projection is the behavior oracle for this experiment.
export function previousClosedChartTrades(execution) {
  const ledger = execution?.ledger || []
  return ledger.filter(event => ['protective_fill', 'manual_close'].includes(event.kind)).map(event => {
    const details = event.details || {}, entry = ledger.find(item => item.kind === 'market_fill' && item.details?.position_id === details.position_id)
    return { ...details.closed_position, key: event.sequence, position_id: details.position_id, side: details.side || entry?.details.side, quantity: details.quantity || entry?.details.quantity,
      opened_time_utc: entry?.virtual_time_utc, closed_time_utc: event.virtual_time_utc, entry: entry?.details.fill_price, exit: details.fill_price, realized: details.net_pnl, commission: details.cost_breakdown?.commission_account }
  })
}

export function projectionFixture(eventCount, closeEvery = 100) {
  const ledger = []
  for (let index = 0; index < eventCount; index += 1) {
    const offset = index % closeEvery, trade = Math.floor(index / closeEvery), position_id = `position-${trade}`
    const event = { sequence: index + 1, virtual_time_utc: 1700000000 + index, kind: 'price_mark', details: {} }
    if (offset === closeEvery - 2) {
      event.kind = 'market_fill'
      event.details = { position_id, side: trade % 2 ? 'BUY' : 'SELL', quantity: trade % 2 ? '0.01' : '2.5', fill_price: '1.12345' }
    } else if (offset === closeEvery - 1) {
      event.kind = trade % 2 ? 'manual_close' : 'protective_fill'
      event.details = { position_id, fill_price: '1.12400', net_pnl: trade % 2 ? '4.13' : '-2.71' }
      if (event.kind === 'manual_close') Object.assign(event.details, {
        side: 'BUY', quantity: '0.01', closed_position: { position_id, side: 'BUY', quantity: '0.01', stop_loss: '1.12', take_profit: '1.13' }, cost_breakdown: { commission_account: '0.07' },
      })
    }
    ledger.push(event)
  }
  return { ledger, instrument_spec: { instrument_id: 'EURUSD', asset_class: 'fx' }, cost_model: { account_ccy: 'USD' } }
}
