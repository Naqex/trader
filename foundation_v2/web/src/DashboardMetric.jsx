import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function DashboardMetric({ title, value, detail, tooltip, icon, children }) {
  const { t } = useTestingLocale()
  return <div className="fx-dashboard-metric"><span data-tooltip={tooltip || detail || undefined}><span className="fx-dashboard-metric-icon" aria-hidden="true"><TestingIcon kind={icon} /></span>{t(title)}</span><strong>{value}</strong>{children}{detail && <small>{t(detail)}</small>}</div>
}
