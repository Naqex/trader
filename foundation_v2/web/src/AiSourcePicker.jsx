import { useEffect, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { aiErrorCopy } from './aiProvider.js'
import './ai-workspace.css'

export default function AiSourcePicker({ workspace, value, onChange, en, disabled = false }) {
  const [items, setItems] = useState([]), [error, setError] = useState(''), [revision, refresh] = useState(0)
  const say = (vi, english) => en ? english : vi
  useEffect(() => {
    const abort = new AbortController(); setItems([]); setError('')
    fetch('/api/v2/ai/assistant/sources', { headers: { 'X-Workspace-Id': workspace }, signal: abort.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.detail); if (!abort.signal.aborted) setItems(body.items) })
      .catch(failure => { if (!abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) })
    return () => abort.abort()
  }, [workspace, en, revision])
  const label = { replay: say('Chart', 'Chart'), journal: say('Nhật ký', 'Journal'), research: say('Quant', 'Quant') }
  const key = item => `${item.kind}:${item.id}`
  const options = [{ value: '', label: say('Không đính kèm dữ liệu', 'No data attached'), localize: false }, ...items.map(item => ({ value: key(item), label: item.name, detail: `${label[item.kind]} · ${item.id}`, localize: false }))]
  if (value && !items.some(item => key(item) === key(value))) options.push({ value: key(value), label: value.id, detail: say('Chưa xác minh nguồn', 'Source not verified'), localize: false })
  return <div className="ai-source-picker">
    <FxSelect label={say('Nguồn dữ liệu chỉ đọc', 'Read-only data source')} value={value ? key(value) : ''} options={options} searchable disabled={disabled} onChange={selected => { const item = items.find(item => key(item) === selected); onChange(item ? { kind: item.kind, id: item.id } : null) }} />
    <button className="wm-button" type="button" disabled={disabled} onClick={() => refresh(n => n + 1)} aria-label={say('Tải lại nguồn dữ liệu', 'Refresh data sources')}>↻</button>
    {error && <p className="ai-inline-error" role="alert">{error}</p>}
    {value && <small>{say('Chụp dữ liệu khi gửi · chỉ đọc', 'Snapshot on send · read only')}</small>}
  </div>
}

export function AiSourceProvenance({ source, en }) {
  if (!source) return null
  return <small className="ai-source-provenance" title={`SHA256 ${source.sha256 || ''}`}>{source.kind === 'research' ? 'Quant' : source.kind === 'journal' ? en ? 'Journal' : 'Nhật ký' : 'Chart'} · {source.id}{source.revision != null ? ` · r${source.revision}` : ''}{source.cursor_index != null ? ` · ${en ? 'bar' : 'nến'} ${source.cursor_index}` : ''}{source.cutoff_timestamp != null ? ` · ${new Date(source.cutoff_timestamp * 1000).toISOString()}` : ''}</small>
}
