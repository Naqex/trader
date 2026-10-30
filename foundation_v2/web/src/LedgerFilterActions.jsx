import { useTestingLocale } from './testingLocale.jsx'
import TestingIcon from './TestingIcon.jsx'
import './ledger-filter-actions.css'

export default function LedgerFilterActions({ columnControl, activeTab, onOpen, secondaryLabel = 'Tags', settingsHref, settingsLabel = 'Cài đặt nhãn' }) {
  const { t } = useTestingLocale()
  return <div className="fxa-filter-actions">{columnControl}{columnControl && <span className="fxa-filter-divider" aria-hidden="true" />}<div className="fxa-filter-group"><span className="fxa-filter-label">{t('Filter by')}</span>{['Basic', secondaryLabel].map(tab => <button key={tab} className="fxa-button" type="button" aria-haspopup="dialog" aria-expanded={activeTab === tab} onClick={() => onOpen(tab)}>{t(tab)}</button>)}{settingsHref && <><span className="fxa-filter-divider" aria-hidden="true" /><a className="fxa-button fxa-icon-button fxa-filter-settings" href={settingsHref} aria-label={t(settingsLabel)} data-tooltip={t(settingsLabel)}><TestingIcon kind="settings" size={16} /></a></>}</div></div>
}
