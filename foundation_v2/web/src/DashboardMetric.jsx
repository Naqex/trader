import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import ReportInfo from './ReportInfo.jsx'

export default function DashboardMetric({ title, value, detail, tooltip, icon, children }) {
  const { t } = useTestingLocale()
  return <div className="fx-dashboard-metric"><span>{icon && <span className="fx-dashboard-metric-icon" aria-hidden="true"><TestingIcon kind={icon} /></span>}{t(title)}{(tooltip || detail) && <ReportInfo title={title} text={tooltip || detail} />}</span><strong>{value}</strong>{children}{detail && <small>{t(detail)}</small>}</div>
}
