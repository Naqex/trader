import { useEffect, useRef, useState } from 'react'

export const strategySample = 'https://fx-replay.notion.site/Strategy-File-Sample-Template-3519db202074809d8e16fb0a20806912'

export default function AiAgentFields({ value, onChange, en, disabled }) {
  const fileInput = useRef(null), generation = useRef(0)
  const [fileError, setFileError] = useState('')
  useEffect(() => () => { generation.current++ }, [])
  const say = (vi, english) => en ? english : vi
  const update = patch => onChange(previous => ({ ...previous, ...patch, error: '' }))
  async function attach(files) {
    const version = ++generation.current
    update({ reading: true })
    try {
      if (files.length + value.knowledge.length > 5 || [...files].some(file => !/\.(txt|md)$/i.test(file.name) || file.size > 65536)) throw new Error('type')
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const added = await Promise.all([...files].map(async file => ({ name: file.name, text: decoder.decode(await file.arrayBuffer()) })))
      const knowledge = [...value.knowledge, ...added]
      if (knowledge.some(file => !file.text.trim() || file.text.includes('\0')) || knowledge.reduce((bytes, file) => bytes + new TextEncoder().encode(file.text).length, 0) > 65536) throw new Error('size')
      if (version === generation.current) { update({ knowledge }); setFileError('') }
    } catch { if (version === generation.current) setFileError(say('Chọn tối đa 5 tệp TXT/Markdown UTF-8, tổng dung lượng 64 KB, có nội dung văn bản.', 'Choose up to 5 nonempty UTF-8 TXT/Markdown files, up to 64 KB in total.')) }
    finally { if (version === generation.current) update({ reading: false }); if (fileInput.current) fileInput.current.value = '' }
  }
  return <fieldset className="wm-ai-agent-fields" disabled={disabled || value.reading}>
    <label>{say('Tên', 'Name')}<input autoFocus required maxLength={40} readOnly={value.builtin} value={value.name} onChange={event => update({ name: event.target.value })} /></label>
    <label>{say('Mô tả', 'Description')}<textarea aria-label={say('Mô tả', 'Description')} rows={2} maxLength={240} readOnly={value.builtin} value={value.description} onChange={event => update({ description: event.target.value })} /></label>
    <label>{say('Hướng dẫn trả lời', 'Instructions')}<textarea aria-label={say('Hướng dẫn trả lời', 'Instructions')} rows={value.builtin ? 7 : 4} maxLength={value.builtin ? undefined : 8000} readOnly={value.builtin} value={value.instructions} onChange={event => update({ instructions: event.target.value })} placeholder={say('Agent hỗ trợ việc gì, trả lời theo cách nào…', 'What should this agent help with, and how should it respond…')} /></label>
    {!value.builtin && <section className="wm-ai-knowledge" aria-label={say('Tài liệu tham khảo', 'Knowledge')}>
      <div className="wm-ai-knowledge-heading"><span>{say('Tài liệu tham khảo', 'Knowledge')}</span><a href={strategySample} target="_blank" rel="noreferrer">{say('Xem mẫu strategy', 'View strategy sample')} ↗</a></div>
      <p>{say('Mỗi tệp một chiến lược, khoảng 1–2 trang. TXT, Markdown · tối đa 5 tệp, tổng 64 KB.', 'One strategy per file, about 1–2 pages. TXT, Markdown · up to 5 files, 64 KB total.')}</p>
      <input className="wm-ai-sr" tabIndex={-1} ref={fileInput} type="file" multiple accept=".txt,.md,text/plain,text/markdown" aria-label={say('Tải tài liệu lên', 'Upload knowledge')} onChange={event => void attach(event.target.files)} />
      <button className="wm-ai-upload" type="button" onClick={() => fileInput.current?.click()}><span aria-hidden="true">＋</span>{say('Chọn tệp', 'Choose files')}</button>
      {value.knowledge.length > 0 && <ul>{value.knowledge.map((file, index) => <li key={index}><span>{file.name}</span><button type="button" aria-label={`${say('Gỡ tệp', 'Remove file')}: ${file.name}`} onClick={() => { generation.current++; update({ knowledge: value.knowledge.filter((_, i) => i !== index) }) }}>×</button></li>)}</ul>}
      {fileError && <p className="wm-ai-error" role="alert">{fileError}</p>}
    </section>}
  </fieldset>
}
