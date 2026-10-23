import { useEffect, useRef, useState } from 'react'
import { uploadDocument, documentSize } from './aiDocuments.js'
import { aiErrorCopy } from './aiProvider.js'

export default function AiDocuments({ workspace, language }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [items, setItems] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [revision, reload] = useState(0), [deleting, setDeleting] = useState(null)
  const input = useRef(null), operation = useRef(null), generation = useRef(0)
  useEffect(() => {
    const abort = new AbortController(), version = ++generation.current; setLoading(true); setError(''); setBusy(false); setDeleting(null)
    fetch('/api/v2/ai/assistant/documents', { headers: { 'X-Workspace-Id': workspace }, signal: abort.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.detail)
      if (!abort.signal.aborted) setItems(body.items)
    }).catch(failure => { if (!abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) }).finally(() => { if (version === generation.current && !abort.signal.aborted) setLoading(false) })
    return () => { abort.abort(); operation.current?.abort(); generation.current++ }
  }, [workspace, en, revision])
  async function mutate(action) {
    if (busy) return
    const abort = new AbortController(), version = generation.current; operation.current = abort; setBusy(true); setError('')
    try { await action(abort.signal); if (version === generation.current) { setDeleting(null); reload(n => n + 1) } }
    catch (failure) { if (!abort.signal.aborted && version === generation.current) setError(aiErrorCopy(failure.message, en)) }
    finally { if (version === generation.current) setBusy(false) }
  }
  async function download(item) {
    await mutate(async signal => {
      const response = await fetch(`/api/v2/ai/assistant/documents/${item.id}`, { headers: { 'X-Workspace-Id': workspace }, signal })
      if (!response.ok) throw new Error((await response.json()).detail)
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = item.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }
  return <section aria-labelledby="ai-documents-title" aria-busy={busy || loading}>
    <header className="ai-page-heading"><div><h1 id="ai-documents-title">{say('Tài liệu', 'Documents')}</h1><p>{say('Tài liệu tham khảo dùng lại cho các agent. TXT, Markdown · 10 MB mỗi tệp.', 'Reusable agent knowledge. TXT, Markdown · 10 MB per file.')}</p></div><button type="button" className="wm-button" disabled={busy} onClick={() => input.current?.click()}>＋ {say('Tải lên', 'Upload')}</button></header>
    <input type="file" ref={input} hidden accept=".txt,.md,text/plain,text/markdown" onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) void mutate(signal => uploadDocument(workspace, file, signal)) }} />
    {error && <p className="ai-inline-error" role="alert">{error} <button className="wm-button" type="button" disabled={busy} onClick={() => reload(n => n + 1)}>{say('Tải lại', 'Reload')}</button></p>}
    {loading ? <p role="status">{say('Đang tải…', 'Loading…')}</p> : !items.length ? <p className="ai-detail-note">{say('Chưa có tài liệu. Tải lên tại đây hoặc khi tạo agent.', 'No documents yet. Upload here or when creating an agent.')}</p> : <ul className="ai-document-list">{items.map(item => <li key={item.id}><div><strong>{item.name}</strong><small>{documentSize(item.bytes)}</small></div><div className="ai-row-actions"><button type="button" className="wm-button" disabled={busy} onClick={() => void download(item)}>{say('Tải về', 'Download')}</button>{deleting === item.id ? <><button type="button" className="wm-button" disabled={busy} onClick={() => void mutate(async signal => { const response = await fetch(`/api/v2/ai/assistant/documents/${item.id}`, { method: 'DELETE', headers: { 'X-Workspace-Id': workspace }, signal }); if (!response.ok) throw new Error((await response.json()).detail) })}>{say('Xác nhận xóa', 'Confirm delete')}</button><button type="button" className="wm-button" disabled={busy} onClick={() => setDeleting(null)}>{say('Hủy', 'Cancel')}</button></> : <button type="button" className="wm-button" disabled={busy} onClick={() => setDeleting(item.id)}>{say('Xóa', 'Delete')}</button>}</div></li>)}</ul>}
    <p className="ai-detail-note">{say('Tệp gốc được lưu riêng. Mỗi lượt AI chỉ nhận các đoạn liên quan. Tài liệu đang gắn với agent cần được gỡ khỏi agent trước khi xóa.', 'Originals are stored separately; each AI run receives relevant excerpts. Unlink documents from agents before deleting them.')}</p>
  </section>
}
