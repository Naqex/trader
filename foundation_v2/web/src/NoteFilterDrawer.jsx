import { useState } from 'react'
import FilterDrawer from './FilterDrawer.jsx'
import FxSelect from './FxSelect.jsx'
import { DateFilter } from './AnalyticsFilterControls.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { EMPTY_NOTE_FILTERS, NOTE_TYPES, noteCalendarYears } from './liveNoteModel.js'

export default function NoteFilterDrawer({ filters, notes, types, onApply, onClose }) {
  const { t,locale,timezone } = useTestingLocale()
  const [draft,setDraft] = useState(filters)
  const [validDate,setValidDate] = useState(true)
  const [dateReset,setDateReset] = useState(0)
  const change = patch => setDraft(current => ({...current,...patch}))
  const years = [...new Set([...noteCalendarYears(notes,timezone),...draft.years])].sort().reverse()
  const multi = (key,label,placeholder,options) => <FxSelect className="is-field" label={label} multiple showSelectAll={false} value={draft[key]} triggerContent={draft[key].length ? options.filter(option => draft[key].includes(option.value)).map(option => option.localize === false ? option.label : t(option.label)).join(', ') : t(placeholder)} options={options} onChange={value => change({[key]:value})}/>
  const days = [1,2,3,4,5,6,0].map(day => ({value:String(day),label:new Intl.DateTimeFormat(locale,{weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,10,1+day))),localize:false}))
  const months = Array.from({length:12},(_,index) => ({value:String(index+1),label:new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,index,1))),localize:false}))
  return <FilterDrawer showTabs={false} sections={[
    ['Note type',multi('types','Note type','Select note type',types ? types.filter(item=>!item.archived || draft.types.includes(item.id) || notes.some(note=>note.payload.note_type===item.id)).map(item=>({value:item.id,label:item.name,localize:!item.id.startsWith('custom_')})) : NOTE_TYPES.map(([value,label]) => ({value,label})))],
    ['Date range',<DateFilter key={dateReset} inline value={draft} timezone={timezone} onChange={change} onValidityChange={setValidDate} label="Date range"/>],
    ['Days',multi('days','Days','Select day',days)],
    ['Month',multi('months','Month','Select month',months)],
    ['Year',multi('years','Year','Select year',years.map(value => ({value,label:value,localize:false})))],
  ]} onClose={onClose} onClear={() => {setDraft({...EMPTY_NOTE_FILTERS});setDateReset(n=>n+1)}} onApply={() => {onApply(draft);onClose()}} invalid={!validDate || Boolean(draft.from && draft.to && draft.from > draft.to)} />
}
