import { useEffect, useState } from 'react'
import { PAPERCLIP_HEALTH_PATH, PAPERCLIP_ORIGIN } from '../paperclipBridge.mjs'

export default function AiPaperclipPanel({ active, language }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [attempt, setAttempt] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [state, setState] = useState('loading')
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
    {mounted && <iframe key={attempt} className="ai-gateway-frame" hidden={state !== 'ready'}
      title={say('Điều hành AI · Paperclip', 'AI operations · Paperclip')} src={`${PAPERCLIP_ORIGIN}/issues`}
      referrerPolicy="no-referrer" allow="clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      onLoad={() => setLoaded(true)} onError={() => setState('unavailable')} />}
    {(state !== 'ready' || !loaded) && <div className="ai-gateway-state ai-paperclip-state" role={state === 'unavailable' ? 'alert' : 'status'}>
      <h1>Paperclip</h1>
      <p>{state === 'unavailable' ? say('Chưa kết nối được Paperclip.', 'Paperclip is unavailable.') : say('Đang mở Paperclip…', 'Opening Paperclip…')}</p>
      {state === 'unavailable' && <div>
        <button type="button" className="wm-button" onClick={retry}>{say('Thử lại', 'Retry')}</button>
        <a className="wm-button" href={PAPERCLIP_ORIGIN} target="_blank" rel="noopener noreferrer">{say('Mở riêng', 'Open separately')}</a>
      </div>}
    </div>}
  </div>
}
