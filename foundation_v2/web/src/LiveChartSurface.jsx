import { useTestingLocale } from './testingLocale.jsx'
import './ReplayWorkspace.css'
import './ChartWorkbench.css'

export default function LiveChartSurface({ headerHeight = 38, children }) {
  const { t } = useTestingLocale()
  return <main className="replay-shell wm-chart-page has-replay is-legacy-chart live-trading"
    style={{'--legacy-header-height':`${headerHeight+4}px`}} aria-label={t('Giao dịch MT5')} data-testid="live-trading-workspace">
    {children}
  </main>
}
