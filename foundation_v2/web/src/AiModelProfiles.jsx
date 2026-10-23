import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { aiErrorCopy, aiEffortName } from './aiProvider.js'

const key = (provider, model) => `${provider}::${model}`
const providerName = provider => provider === 'local-gateway' ? 'CLIProxyAPI' : 'ChatGPT Web'

export default function AiModelProfiles({ workspace, language }) {
  const { buildHref } = useFxReplayContext()
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [profiles, setProfiles] = useState([]), [models, setModels] = useState([]), [fallback, setFallback] = useState(null)
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const submitting = useRef(false), generation = useRef(0), request = useRef(null)
  async function load() {
    request.current?.abort()
    const abort = new AbortController(), version = ++generation.current
    request.current = abort; setLoading(true); setError('')
    try {
      const values = await Promise.all(['profiles', 'catalog', 'account'].map(async path => {
        const response = await fetch(`/api/v2/ai/assistant/${path}`, { headers: { 'X-Workspace-Id': workspace }, signal: abort.signal })
        const value = await response.json()
        if (!response.ok) throw new Error(value.detail)
        return value
      }))
      if (version === generation.current && !abort.signal.aborted) {
        setProfiles(values[0].items)
        setModels(values[1].routes.flatMap(route => route.models.map(model => ({ ...model, provider: route.provider }))))
        setFallback(values[2].selection ? { provider: values[2].provider, ...values[2].selection } : null)
      }
    } catch (failure) { if (!abort.signal.aborted && version === generation.current) setError(aiErrorCopy(failure.message, en)) }
    finally { if (!abort.signal.aborted && version === generation.current) setLoading(false) }
  }
  useEffect(() => {
    setProfiles([]); setModels([]); setFallback(null); setSaving(false); submitting.current = false
    void load()
    const refresh = event => {
      if (event.detail?.workspace !== workspace) return
      if (event.detail.error) { generation.current++; request.current?.abort(); setLoading(false); setError(aiErrorCopy(event.detail.error, en)) }
      else void load()
    }
    window.addEventListener('wm-ai-provider-change', refresh)
    return () => { generation.current++; request.current?.abort(); window.removeEventListener('wm-ai-provider-change', refresh) }
  }, [workspace, en])
  async function save(feature, role, selection) {
    if (loading || submitting.current) return
    const profile = profiles.find(p => p.feature === feature && p.role === role)
    if (!profile && selection === null) return
    const version = generation.current
    submitting.current = true; setSaving(true); setError('')
    try {
      const response = await fetch(`/api/v2/ai/assistant/profiles/${feature}/${role}`, { method: 'PUT', headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: profile?.revision || 0, selection }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.detail)
      if (version !== generation.current) return
      setProfiles(previous => previous.filter(p => p.feature !== feature || p.role !== role).concat(selection ? [{ feature, role, selection, revision: value.revision }] : []))
      window.dispatchEvent(new CustomEvent('wm-ai-profile-change', { detail: { workspace } }))
    } catch (failure) { if (version === generation.current) setError(aiErrorCopy(failure.message, en)) }
    finally { if (version === generation.current) { submitting.current = false; setSaving(false) } }
  }
  const find = (feature, role) => profiles.find(profile => profile.feature === feature && profile.role === role)?.selection
  const system = find('system', 'default') || fallback
  function row(feature, role, label, systemRow = false) {
    const selection = find(feature, role), inherited = systemRow ? fallback : (role !== 'default' && find(feature, 'default')) || system
    const effective = selection || inherited
    const selectedKey = selection ? key(selection.provider, selection.model) : ''
    const model = models.find(item => key(item.provider, item.id) === selectedKey)
    const inheritedName = inherited ? models.find(item => key(item.provider, item.id) === key(inherited.provider, inherited.model))?.name || inherited.model : say('Chưa cấu hình', 'Not configured')
    const options = [{ value: '', label: systemRow ? `${say('Cấu hình kết nối', 'Connection setting')} · ${inheritedName}` : `${say('Mặc định', 'Default')} · ${inheritedName}`, localize: false }, ...models.map(item => ({ value: key(item.provider, item.id), label: item.name, detail: providerName(item.provider), localize: false }))]
    if (selection && !model) options.push({ value: selectedKey, label: selection.model, detail: say('Chưa khả dụng', 'Unavailable'), disabled: true, localize: false })
    return <div className="ai-model-profile-row" key={`${feature}:${role}`} data-profile={`${feature}/${role}`}>
      <div className="ai-profile-name"><span>{label}</span><small>{effective ? providerName(effective.provider) : say('Chưa cấu hình', 'Not configured')}</small></div>
      <div className="ai-profile-controls"><FxSelect label={label} value={selectedKey} options={options} disabled={loading || saving || !!error} searchable
        onChange={value => { const item = models.find(m => key(m.provider, m.id) === value); void save(feature, role, item ? { provider: item.provider, model: item.id, effort: item.efforts.includes('high') ? 'high' : item.efforts[0] || null } : null) }} />
        {model?.efforts.length > 0 && <FxSelect label={`${label} · ${say('Mức suy luận', 'Reasoning effort')}`} value={selection.effort || ''} disabled={loading || saving || !!error}
          options={[...(model.provider === 'local-gateway' ? [{ value: '', label: say('Mặc định', 'Default'), localize: false }] : []), ...model.efforts.map(effort => ({ value: effort, label: aiEffortName(effort, en), localize: false }))]} onChange={effort => void save(feature, role, { ...selection, effort: effort || null })} />}
      </div>
    </div>
  }
  return <section className="ai-model-profiles" aria-labelledby="ai-profiles-title" aria-busy={loading || saving}>
    <header className="ai-page-heading"><div><h1 id="ai-profiles-title">{say('Model', 'Models')}</h1><p>{say('Áp dụng cho tác vụ mới. Trong chat, bạn vẫn có thể chọn model riêng.', 'Applies to new runs. You can choose a different model in each chat.')}</p></div></header>
    {error && <div className="ai-inline-error" role="alert">{error} <button type="button" className="wm-button" disabled={loading || saving} onClick={() => void load()}>{say('Tải lại', 'Reload')}</button></div>}
    {!loading && !error && !models.length && <p className="ai-detail-note">{say('Chưa có model khả dụng.', 'No models available.')} <a href={buildHref('ai', { area: 'ai', section: 'connections' })}>{say('Mở Kết nối', 'Open Connections')} →</a></p>}
    <div className="ai-profile-group"><h2>{say('Mặc định', 'Default')}</h2>{row('system', 'default', say('Model hệ thống', 'System model'), true)}</div>
    <div className="ai-profile-group"><h2>{say('Theo tính năng', 'By feature')}</h2>{row('chat', 'default', say('Trò chuyện', 'Chat'))}
      <details className="ai-workflow-profiles"><summary><span>{say('Đánh giá dữ liệu', 'Evidence review')}<small>{say('2 vai trò · Thử nghiệm', '2 roles · Experimental')}</small></span><span aria-hidden="true">⌄</span></summary>
        {row('evidence-review', 'analyst', say('Phân tích', 'Analyst'))}
        {row('evidence-review', 'reviewer', say('Tổng hợp', 'Reviewer'))}
      </details>
    </div>
    {saving && <p className="ai-save-status" role="status">{say('Đang lưu…', 'Saving…')}</p>}
  </section>
}
