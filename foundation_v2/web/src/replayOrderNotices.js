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
