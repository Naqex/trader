import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function TableColumnControl({ columns, onChange, options }) {
  const { t } = useTestingLocale()
  return <><button type="button" className="fxa-button fxa-icon-button" aria-label={t('Reset table columns')} title={t('Reset table columns')} onClick={() => onChange(options.map(([key]) => key))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2 7M4 4v7h7" /></svg></button><FxSelect label={t('Cột hiển thị')} value={columns} onChange={onChange} options={options.map(([value, label]) => ({ value, label }))} multiple searchable icon="edit" iconOnly className="fxa-columns-control" /></>
}
