import { Fragment } from 'react'
import FxSelect from './FxSelect.jsx'
import { filterValues } from './tradingAnalyticsModel.js'
import { useTestingLocale } from './testingLocale.jsx'

export default function TagFilterControls({ values, draft, onChange }) {
  const { t } = useTestingLocale()
  return <>{['Include', 'Exclude'].map((name,index) => {
    const key = name === 'Include' ? 'tagInclude' : 'tagExclude', mode = `${key}Mode`
    return <Fragment key={key}>{index > 0 && <div className="fxl-tag-separator">{t('AND')}</div>}<div className="fxl-tag-heading"><span>{t(name)}</span><div role="group" aria-label={t('Cách kết hợp {name}',{name:t(name)})}>{['AND','OR'].map(value => <button type="button" key={value} aria-pressed={draft[mode] === value} onClick={() => onChange({[mode]:value})}>{value}</button>)}</div></div><FxSelect className="is-field" localizeOptions={false} label={`${t(name)} ${t('Tags')}`} triggerContent={filterValues(draft[key]).length ? filterValues(draft[key]).join(', ') : t('Select tags')} multiple searchable value={filterValues(draft[key])} options={values.map(value => ({value,label:value}))} onChange={value => onChange({[key]:value.length ? JSON.stringify(value) : ''})} /></Fragment>
  })}</>
}
