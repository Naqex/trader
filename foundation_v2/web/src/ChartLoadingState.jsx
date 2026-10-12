import { useTestingLocale } from './testingLocale.jsx'
import './chart-loading-state.css'

export default function ChartLoadingState({ viewport = false }) {
  const { t } = useTestingLocale()
  const Container = viewport ? 'main' : 'div'
  return <Container className={`wm-chart-loading ${viewport ? 'is-viewport' : 'is-overlay'}`} aria-busy="true" data-testid="chart-loading">
    <div role="status"><span className="wm-chart-loading-spinner" aria-hidden="true" /><p>{t('Đang chuẩn bị biểu đồ…')}</p></div>
  </Container>
}
