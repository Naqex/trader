export function protectionNotice(previous, draft, tickSize, kind) {
  const fields = [['stop', 'stop_loss', 'stopLoss'], ['target', 'take_profit', 'takeProfit']]
  const changes = fields.filter(([type, saved, input]) => (!kind || kind === type) && Number(previous[saved] || 0) !== Number(draft[input] || 0))
  if (changes.length !== 1) return { kind: 'ok', title: 'Position Updated', message: 'TP/SL updated.' }
  const [type, saved, input] = changes[0]
  const target = type === 'target'
  if (!draft[input]) return { kind: 'ok', title: 'Position Updated', message: target ? 'Take profit removed!' : 'Stop loss removed!' }
  if (!(Number(previous[saved]) > 0)) return { kind: 'ok', title: 'Order Added', message: target ? 'Take profit added!' : 'Stop loss added!' }
  const tick = Number(tickSize)
  const digits = tick > 0 ? (tick.toFixed(8).replace(/0+$/, '').split('.')[1]?.length || 0) : 5
  const price = new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(draft[input]))
  return { kind: 'ok', title: 'Position Updated', message: target ? 'Take profit moved to {price}!' : 'Stop loss moved to {price}!', values: { price } }
}

export function closeNotice(previous, next, operationId, symbol) {
  const status = previous.position ? next.position ? 'partial_closed' : 'closed' : 'cancelled'
  const event = next.ledger?.findLast(event => ['manual_close', 'order_cancel'].includes(event.kind) && event.details?.command_operation_id === operationId)
  // Older responses without a matching receipt may confirm the state change,
  // but cannot supply an execution price for the detailed notification.
  if (!event) return { kind: 'ok', text: status === 'closed' ? 'Đã đóng vị thế.' : status === 'partial_closed' ? 'Đã đóng một phần vị thế.' : 'Đã hủy lệnh chờ.' }
  const details = event.details
  const position = details.closed_position || details.cancelled_order
  return { kind: 'ok', order: {
    status, operationId, symbol, side: position.side, quantity: String(position.quantity),
    price: status === 'cancelled' ? null : String(details.fill_price),
    ...(status !== 'cancelled' ? {
      detail: status === 'closed' ? '{quantity} closed from avg entry {entryPrice} · now flat' : '{quantity} closed from avg entry {entryPrice} · {remainingQuantity} remaining',
      values: { quantity: String(position.quantity), entryPrice: String(position.entry_fill), remainingQuantity: next.position?.quantity },
    } : {}),
  } }
}
