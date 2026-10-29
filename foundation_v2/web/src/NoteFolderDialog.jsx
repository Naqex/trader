import { useEffect, useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import SearchInput from './SearchInput.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { matchesSearch } from './searchText.js'
import { createNoteFolder } from './liveNoteFoldersApi.js'

export default function NoteFolderDialog({workspace, notes, folders, onCreated, onClose}) {
  const {t} = useTestingLocale()
  const [step,setStep] = useState(1), [search,setSearch] = useState(''), [selected,setSelected] = useState([]), [name,setName] = useState('')
  const [pending,setPending] = useState(false), [error,setError] = useState(''), [uncertain,setUncertain] = useState(false)
  const lock = useRef(false), input = useRef(null)
  useEffect(() => { input.current?.focus() },[step])
  const clean = name.trim(), duplicate = folders.some(folder => folder.name.toLocaleLowerCase() === clean.toLocaleLowerCase())
  const close = () => { if (!lock.current) onClose() }
  async function submit(event) {
    event.preventDefault()
    if (step === 1) { setStep(2); return }
    if (lock.current || uncertain || !clean || duplicate) return
    lock.current = true; setPending(true); setError('')
    try { onCreated(await createNoteFolder(workspace,clean,selected)) }
    catch (problem) { setUncertain(problem.outcomeKnown === false); setError(problem.outcomeKnown === false ? 'Chưa xác nhận kết quả lưu. Đóng và tải lại thư mục để kiểm tra.' : problem.message || 'Không lưu được thư mục. Thử lại sau.') }
    finally { lock.current = false; setPending(false) }
  }
  const visible = notes.filter(record => matchesSearch(`${record.payload.title} ${record.payload.note}`,search))
  return <LegacyModal className="live-folder-dialog" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={t('Create folder')} onClose={close}>
    <form className="live-folder-form" onSubmit={submit} aria-busy={pending}>
      {step === 1 ? <><p className="live-muted">{t('Choose the notes you want to add to this folder')}</p><label className="live-folder-search"><TestingIcon kind="search" size={16}/><SearchInput ref={input} aria-label={t('Tìm ghi chú')} placeholder={t('Tìm ghi chú…')} value={search} onChange={event => setSearch(event.target.value)}/></label>
        <div className="live-folder-notes">{visible.map(record => <label className="live-folder-note" key={record.record_id}><input type="checkbox" checked={selected.includes(record.record_id)} onChange={event => setSelected(current => event.target.checked ? [...current,record.record_id] : current.filter(id => id !== record.record_id))}/><span>{record.payload.title}</span></label>)}{!visible.length && <p className="live-muted">{t(search ? 'Không tìm thấy ghi chú' : 'No notes yet')}</p>}</div></> : <label className="live-folder-name">{t('Folder name')}<input ref={input} value={name} maxLength={80} disabled={pending || uncertain} onChange={event => setName(event.target.value)} aria-invalid={duplicate || undefined}/>{duplicate && <small role="alert">{t('Tên thư mục đã tồn tại.')}</small>}</label>}
      {error && <p role="alert" className="live-record-error">{t(error)}</p>}
      <footer className="live-dialog-footer">{step === 2 && <button type="button" className="fxa-button" disabled={pending || uncertain} onClick={() => setStep(1)}>{t('Back')}</button>}<button type="button" className="fxa-button" disabled={pending} onClick={close}>{t('Hủy')}</button><button type="submit" className="fxa-button is-primary" disabled={pending || uncertain || step === 2 && (!clean || duplicate)}>{t(pending ? 'Đang lưu…' : step === 1 ? 'Next' : 'Confirm')}</button></footer>
    </form>
  </LegacyModal>
}
