import { useEffect, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { aiErrorCopy } from './aiProvider.js'

const rows = [
  ['system', 'default', 'Mặc định hệ thống', 'System default'],
  ['chat', 'default', 'Trò chuyện', 'Chat'],
  ['evidence-review', 'analyst', 'Review dữ liệu · Phân tích', 'Evidence review · Analyst'],
  ['evidence-review', 'reviewer', 'Review dữ liệu · Tổng hợp', 'Evidence review · Reviewer'],
]
const key = (provider, model) => `${provider}::${model}`

export default function AiModelProfiles({ workspace, language }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [profiles, setProfiles] = useState([]), [models, setModels] = useState([]), [pending, setPending] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    async function load() {
      setPending(true); setError('')
      try {
        const values = await Promise.all(['profiles', 'catalog'].map(async path => {
          const response = await fetch(`/api/v2/ai/assistant/${path}`, { headers: { 'X-Workspace-Id': workspace }, signal: abort.signal })
          const value = await response.json()
          if (!response.ok) throw new Error(value.detail)
          return value
        }))
        if (!abort.signal.aborted) { setProfiles(values[0].items); setModels(values[1].routes.flatMap(r => r.models.map(m => ({ ...m, provider: r.provider })))) }
      } catch (failure) { if (!abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) }
      finally { if (!abort.signal.aborted) setPending(false) }
    }
    void load()
    window.addEventListener('wm-ai-provider-change', load)
    return () => { abort.abort(); window.removeEventListener('wm-ai-provider-change', load) }
  }, [workspace, en])
  async function save(feature, role, selection) {
    if (pending) return
    const profile = profiles.find(p => p.feature === feature && p.role === role)
    if (!profile && selection === null) return
    setPending(true); setError('')
    try {
      const response = await fetch(`/api/v2/ai/assistant/profiles/${feature}/${role}`, { method: 'PUT', headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: profile?.revision || 0, selection }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.detail)
      setProfiles(previous => previous.filter(p => p.feature !== feature || p.role !== role).concat(selection ? [{ feature, role, selection, revision: value.revision }] : []))
      window.dispatchEvent(new CustomEvent('wm-ai-profile-change', { detail: { workspace } }))
    } catch (failure) { setError(aiErrorCopy(failure.message, en)) }
    finally { setPending(false) }
  }
  return <section className="settings-chatgpt ai-model-profiles" aria-labelledby="ai-profiles-title">
    <div className="settings-heading"><div><h2 id="ai-profiles-title">{say('Model theo tính năng', 'Feature models')}</h2><p className="settings-note">{say('Thay đổi áp dụng cho tác vụ mới.', 'Changes apply to new runs.')}</p></div></div>
    {error && <p className="settings-message is-error" role="alert">{error}</p>}
    {rows.map(([feature, role, vi, english]) => {
      const profile = profiles.find(p => p.feature === feature && p.role === role)
      const selection = profile?.selection, selectedKey = selection ? key(selection.provider, selection.model) : ''
      const model = models.find(m => key(m.provider, m.id) === selectedKey)
      const options = [{ value: '', label: say('Theo mặc định', 'Use default'), localize: false }, ...models.map(m => ({ value: key(m.provider, m.id), label: m.name, detail: m.provider === 'local-gateway' ? 'CLIProxyAPI' : 'ChatGPT Web', localize: false }))]
      if (selection && !model) options.push({ value: selectedKey, label: selection.model, disabled: true, localize: false })
      return <div className="ai-model-profile-row" key={`${feature}:${role}`}>
        <span>{say(vi, english)}</span>
        <FxSelect label={say(vi, english)} value={selectedKey} options={options} disabled={pending} searchable
          onChange={value => { const m = models.find(m => key(m.provider, m.id) === value); void save(feature, role, m ? { provider: m.provider, model: m.id, effort: m.efforts.includes('high') ? 'high' : m.efforts[0] || null } : null) }} />
        {model?.efforts.length > 0 && <FxSelect label={`${say(vi, english)} · ${say('Mức suy luận', 'Reasoning effort')}`} value={selection.effort} disabled={pending}
          options={model.efforts.map(effort => ({ value: effort, label: effort, localize: false }))} onChange={effort => void save(feature, role, { ...selection, effort })} />}
      </div>
    })}
  </section>
}
