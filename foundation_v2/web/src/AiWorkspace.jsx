import { lazy, Suspense } from 'react'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import AiSparkles from './AiSparkles.jsx'
import { TestingPageSkeleton } from './TestingPageState.jsx'
import './settings.css'
import './ai-workspace.css'

const AiProviderSettings = lazy(() => import('./AiProviderSettings.jsx'))

export default function AiWorkspace({ workspace, query }) {
  const { appearance, openAi } = useFxReplayContext()
  const en = appearance?.language === 'en'
  const say = (vi, english) => en ? english : vi
  const section = query.get('section') || 'assistant'
  const connectionsHref = buildWorkspaceHref('ai', workspace, query, { area: 'ai', section: 'connections', demo: null })

  return <main className="ai-workspace settings-shell wm-page" data-testid="ai-workspace" data-section={section}>
    {section === 'connections' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang đọc kết nối…', 'Checking connection…')} />}>
      <AiProviderSettings workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'automation' ? <>
      <header className="wm-page-header"><h1>{say('Tự động hóa', 'Automation')}</h1></header>
      <div className="ai-automation-list">
        {[
          [say('Bot giao dịch', 'Trading bots'), say('Thực hiện chiến lược theo quy tắc.', 'Execute rule-based strategies.')],
          [say('AI giao dịch', 'AI trading'), say('Sử dụng model AI trong chiến lược giao dịch.', 'Use AI models in trading strategies.')],
        ].map(([name, description]) => <section className="ai-automation-row" key={name}>
          <div><h2>{name}</h2><p>{description}</p></div>
          <span className="ai-unavailable">{say('Chưa khả dụng', 'Not available yet')}</span>
        </section>)}
      </div>
    </> : <section className="ai-assistant-home">
      <div className="ai-assistant-symbol" aria-hidden="true"><AiSparkles /></div>
      <h1>Mentor</h1>
      <p>{say('Cùng tìm hiểu trading, backtest và WMREPLAY.', 'Explore trading, backtesting and WMREPLAY.')}</p>
      <div className="ai-assistant-actions">
        <button type="button" className="wm-button is-primary" onClick={openAi}>{say('Mở trò chuyện', 'Open chat')}</button>
        <a className="wm-button" href={connectionsHref}>{say('Kết nối AI', 'AI connections')}</a>
      </div>
    </section>}
  </main>
}
