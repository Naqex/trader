import { useTestingLocale } from './testingLocale.jsx'
import './ledger-filter-actions.css'

export default function LedgerFilterActions({ columnControl, activeTab, onOpen }) {
  const { t } = useTestingLocale()
  return <div className="fxa-filter-actions">{columnControl}{columnControl && <span className="fxa-filter-divider" aria-hidden="true" />}<div className="fxa-filter-group"><span className="fxa-filter-label">{t('Filter by')}</span>{['Basic', 'Tags'].map(tab => <button key={tab} className="fxa-button" type="button" aria-haspopup="dialog" aria-expanded={activeTab === tab} onClick={() => onOpen(tab)}>{t(tab)}</button>)}</div></div>
}
