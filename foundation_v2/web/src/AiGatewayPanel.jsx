import { useEffect, useState } from 'react'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { aiErrorCopy } from './aiProvider.js'

const managementUrl = 'http://127.0.0.1:17852/management.html'

export default function AiGatewayPanel({ workspace, language, active }) {
  const { buildHref } = useFxReplayContext()
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [attempt, setAttempt] = useState(0), [state, setState] = useState(null)
  const [documentVersion, setDocumentVersion] = useState(null)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    async function read() {
      try {
        const response = await fetch('/api/v2/ai/assistant/connections/local-gateway', {
          headers: { 'X-Workspace-Id': workspace }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        })
        const value = await response.json()
        if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : '')
        if (!controller.signal.aborted) {
          setState({ value })
          if (value.runtime?.management_url === managementUrl) setDocumentVersion(attempt)
        }
      } catch (error) {
        if (!controller.signal.aborted) setState({ error: error.message || 'ai_gateway_unavailable' })
      }
    }
    void read()
    return () => controller.abort()
  }, [workspace, attempt, active])

  const available = state?.value?.runtime?.management_url === managementUrl
  const runtime = state?.value?.runtime
  return <>
    {documentVersion !== null && <iframe key={documentVersion} className="ai-gateway-frame" hidden={!available} title={say('Trang quản trị CLIProxyAPI', 'CLIProxyAPI management')}
      src={managementUrl} referrerPolicy="no-referrer" allow="clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" />}
    {!available && <section className="ai-gateway-state" role={state?.error ? 'alert' : 'status'} aria-busy={!state}>
    <h1>CLIProxyAPI</h1>
    <p>{!state ? say('Đang mở trang quản trị…', 'Opening management…')
      : state.error ? aiErrorCopy(state.error, en)
        : runtime?.management_available && !runtime.running ? say('Bật kết nối để mở trang quản trị.', 'Start the connection to open management.')
          : say('Trang quản trị chưa sẵn sàng.', 'Management is not available yet.')}</p>
    {state && <div>
      <a className="wm-button" href={buildHref('ai', { area: 'ai', section: 'connections' })}>{say('Kết nối', 'Connections')}</a>
      <button className="wm-button" type="button" onClick={() => setAttempt(value => value + 1)}>{say('Thử lại', 'Retry')}</button>
    </div>}
    </section>}
  </>
}
