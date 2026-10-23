import { useEffect, useRef, useState } from 'react'
import { uploadDocument, documentSize } from './aiDocuments.js'
import { aiErrorCopy } from './aiProvider.js'

export const strategySample = 'https://fx-replay.notion.site/Strategy-File-Sample-Template-3519db202074809d8e16fb0a20806912'

export default function AiAgentFields({ workspace, value, onChange, en, disabled }) {
  const fileInput = useRef(null), generation = useRef(0), upload = useRef(null)
  const [fileError, setFileError] = useState('')
  const [library, setLibrary] = useState([]), [libraryError, setLibraryError] = useState(''), [libraryOpen, setLibraryOpen] = useState(false)
  useEffect(() => {
    if (value.builtin || !libraryOpen) return
    const abort = new AbortController(); setLibraryError('')
    fetch('/api/v2/ai/assistant/documents', { headers: { 'X-Workspace-Id': workspace }, signal: abort.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.detail); if (!abort.signal.aborted) setLibrary(body.items) }).catch(failure => { if (!abort.signal.aborted) setLibraryError(aiErrorCopy(failure.message, en)) })
    return () => abort.abort()
  }, [workspace, en, libraryOpen, value.builtin])
  useEffect(() => () => { generation.current++; upload.current?.abort() }, [])
  const say = (vi, english) => en ? english : vi
  const update = patch => onChange(previous => ({ ...previous, ...patch, error: '' }))
  async function attach(files) {
    const version = ++generation.current
    upload.current?.abort(); const abort = new AbortController(); upload.current = abort
    update({ reading: true })
    try {
      if (files.length + value.knowledge.length > 5) throw new Error('ai_document_count')
      for (const file of files) {
        const added = await uploadDocument(workspace, file, abort.signal)
        if (version !== generation.current) return
        onChange(previous => ({ ...previous, error: '', knowledge: previous.knowledge.some(v => v.id === added.id) ? previous.knowledge : [...previous.knowledge, added] }))
      }
      if (version === generation.current) setFileError('')
    } catch (failure) { if (version === generation.current && !abort.signal.aborted) setFileError(aiErrorCopy(failure.message, en)) }
    finally { if (version === generation.current) update({ reading: false }); if (fileInput.current) fileInput.current.value = '' }
  }
  return <fieldset className="wm-ai-agent-fields" disabled={disabled || value.reading}>
    <label>{say('Tên', 'Name')}<input autoFocus={!value.builtin} required maxLength={40} disabled={value.builtin} value={value.name} onChange={event => update({ name: event.target.value })} /></label>
    <label>{say('Mô tả', 'Description')}<textarea aria-label={say('Mô tả', 'Description')} rows={2} maxLength={240} disabled={value.builtin} value={value.description} onChange={event => update({ description: event.target.value })} /></label>
    {!value.builtin && <label>{say('Hướng dẫn trả lời', 'Instructions')}<textarea aria-label={say('Hướng dẫn trả lời', 'Instructions')} rows={4} maxLength={8000} value={value.instructions} onChange={event => update({ instructions: event.target.value })} placeholder={say('Agent hỗ trợ việc gì, trả lời theo cách nào…', 'What should this agent help with, and how should it respond…')} /></label>}
    {!value.builtin && <section className="wm-ai-knowledge" aria-label={say('Tài liệu tham khảo', 'Knowledge')}>
      <div className="wm-ai-knowledge-heading"><span>{say('Tài liệu tham khảo', 'Knowledge')}</span><a href={strategySample} target="_blank" rel="noreferrer">{say('Xem mẫu strategy', 'View strategy sample')} ↗</a></div>
      <p>{say('TXT, Markdown · tối đa 5 tệp, 10 MB mỗi tệp.', 'TXT, Markdown · up to 5 files, 10 MB each.')}</p>
      <input className="wm-ai-sr" tabIndex={-1} ref={fileInput} type="file" multiple accept=".txt,.md,text/plain,text/markdown" aria-label={say('Tải tài liệu lên', 'Upload knowledge')} onChange={event => void attach(event.target.files)} />
      <button className="wm-ai-upload" type="button" onClick={() => fileInput.current?.click()}><span aria-hidden="true">＋</span>{value.reading ? say('Đang tải…', 'Uploading…') : say('Chọn tệp', 'Choose files')}</button>
      <button className="wm-ai-upload" type="button" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(v => !v)}>{say('Thư viện', 'Library')}</button>
      {libraryOpen && <div className="wm-ai-library">{libraryError && <p role="alert">{libraryError}</p>}{!libraryError && !library.length && <p>{say('Chưa có tài liệu trong thư viện.', 'No library documents yet.')}</p>}{library.map(file => <button className="wm-ai-upload" type="button" key={file.id} disabled={value.knowledge.length >= 5 || value.knowledge.some(v => v.id === file.id)} onClick={() => onChange(previous => ({ ...previous, knowledge: previous.knowledge.length < 5 && !previous.knowledge.some(v => v.id === file.id) ? [...previous.knowledge, file] : previous.knowledge }))}>{file.name} · {documentSize(file.bytes)}</button>)}</div>}
      {value.knowledge.length > 0 && <ul>{value.knowledge.map((file, index) => <li key={index}><span>{file.name}{file.bytes != null && <small> · {documentSize(file.bytes)}</small>}</span><button type="button" aria-label={`${say('Gỡ tệp', 'Remove file')}: ${file.name}`} onClick={() => { generation.current++; update({ knowledge: value.knowledge.filter((_, i) => i !== index) }) }}>×</button></li>)}</ul>}
      {fileError && <p className="wm-ai-error" role="alert">{fileError}</p>}
    </section>}
  </fieldset>
}
