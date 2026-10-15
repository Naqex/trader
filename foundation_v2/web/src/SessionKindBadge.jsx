import './session-kind.css'

export default function SessionKindBadge({ item }) {
  return <span className="session-kind-badge">{item?.session_kind === 'prop' ? 'Prop Firm' : 'Backtest'}</span>
}
