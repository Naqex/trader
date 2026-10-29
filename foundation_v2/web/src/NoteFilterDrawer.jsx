import { useState } from 'react'
import FilterDrawer from './FilterDrawer.jsx'
import FxSelect from './FxSelect.jsx'
import TagFilterControls from './TagFilterControls.jsx'
import ProjectDateInput from './ProjectDateInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { EMPTY_NOTE_FILTERS } from './liveNoteModel.js'

export default function NoteFilterDrawer({ filters, accounts, tags, onApply, onClose }) {
  const { t } = useTestingLocale()
  const [draft,setDraft] = useState(filters)
  const change = patch => setDraft(current => ({...current,...patch}))
  return <FilterDrawer sections={[
    ['Accounts',<FxSelect label="Accounts" multiple searchable value={draft.accounts} localizeOptions={false} onChange={accounts => change({accounts})} options={[{value:'general',label:t('Ghi chú chung')},...accounts.map(item => ({value:item.record_id,label:item.name}))]} />],
    ['Ngày cập nhật',<div className="fxl-fields">{[['from','Từ ngày'],['to','Đến ngày']].map(([key,label]) => <label className="fxl-field" key={key}>{t(label)}<ProjectDateInput clearable type="date" aria-label={t(label)} value={draft[key]} onChange={event => change({[key]:event.target.value})} /></label>)}</div>],
  ]} tags={<TagFilterControls values={tags} draft={draft} onChange={change} />} onClose={onClose} onClear={() => setDraft({...EMPTY_NOTE_FILTERS})} onApply={() => {onApply(draft);onClose()}} invalid={Boolean(draft.from && draft.to && draft.from > draft.to)} />
}
