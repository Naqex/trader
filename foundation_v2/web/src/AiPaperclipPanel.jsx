import { useEffect, useRef, useState } from 'react'
import { PAPERCLIP_HEALTH_PATH, PAPERCLIP_ORIGIN } from '../paperclipBridge.mjs'
import { AiPanelState } from './AiStudio.jsx'
import StudioWorkflows from './StudioWorkflows.jsx'

export default function AiPaperclipPanel({ active, language }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [attempt, setAttempt] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [state, setState] = useState('loading')
  const [workflows, setWorkflows] = useState(false)
  const [frameUrl, setFrameUrl] = useState(`${PAPERCLIP_ORIGIN}/issues`)
  const frame = useRef(null)
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage({ type: 'naqex:preferences', version: 1, language: en ? 'en' : 'vi' }, PAPERCLIP_ORIGIN)
    const receive = event => {
      if (event.origin === PAPERCLIP_ORIGIN && event.source === frame.current?.contentWindow
        && event.data?.type === 'paperclip:ready' && event.data.version === 1) send()
    }
    send()
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [en, loaded])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    async function read() {
      try {
        const response = await fetch(PAPERCLIP_HEALTH_PATH, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]), cache: 'no-store' })
        const health = await response.json()
        if (!response.ok || health.status !== 'ok') throw new Error('unavailable')
        if (!controller.signal.aborted) { setMounted(true); setState('ready') }
      } catch {
        if (!controller.signal.aborted) setState('unavailable')
      }
    }
    void read()
    return () => controller.abort()
  }, [active, attempt])
  useEffect(() => {
    if (!active || !mounted || loaded || state !== 'ready') return
    const timeout = setTimeout(() => setState('unavailable'), 25000)
    return () => clearTimeout(timeout)
  }, [active, mounted, loaded, state, attempt])
  const retry = () => { setLoaded(false); setState('loading'); setAttempt(value => value + 1) }
  return <div className="ai-paperclip-panel" data-testid="paperclip-panel">
    {state === 'ready' && <div className="studio-workflow-toolbar"><button type="button" className="wm-button" onClick={() => setWorkflows(true)}>{say('Quy trình', 'Workflows')}</button></div>}
    {mounted && <iframe ref={frame} key={attempt} className="ai-gateway-frame" hidden={state !== 'ready'}
      title={say('Điều hành AI · Paperclip', 'AI operations · Paperclip')} src={frameUrl}
      referrerPolicy="no-referrer" allow="clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      onLoad={() => setLoaded(true)} onError={() => setState('unavailable')} />}
    {(state !== 'ready' || !loaded) && <AiPanelState className="ai-paperclip-state" icon="sparkles" title={say('Đội AI', 'AI team')}
      alert={state === 'unavailable'} busy={state !== 'unavailable'}
      message={state === 'unavailable' ? say('Chưa kết nối được Paperclip.', 'Paperclip is unavailable.') : say('Đang mở Paperclip…', 'Opening Paperclip…')}>
      {state === 'unavailable' && <>
        <button type="button" className="wm-button is-primary" onClick={retry}>{say('Thử lại', 'Retry')}</button>
        <a className="wm-button" href={PAPERCLIP_ORIGIN} target="_blank" rel="noopener noreferrer">{say('Mở riêng', 'Open separately')}</a>
      </>}
    </AiPanelState>}
    {active && workflows && <StudioWorkflows language={language} onClose={() => setWorkflows(false)} onNavigate={id => {
      const url = `${PAPERCLIP_ORIGIN}/issues/${id}`
      if (url !== frameUrl) { setLoaded(false); setFrameUrl(url) }
    }} />}
  </div>
}
