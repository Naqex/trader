import { lazy, Suspense } from 'react'
import { useFxReplayContext } from './FxReplayShell.jsx'
import AiSparkles from './AiSparkles.jsx'
import { TestingPageSkeleton } from './TestingPageState.jsx'
import './settings.css'
import './ai-workspace.css'

const AiProviderSettings = lazy(() => import('./AiProviderSettings.jsx'))
const AiModelProfiles = lazy(() => import('./AiModelProfiles.jsx'))
const AiGatewayPanel = lazy(() => import('./AiGatewayPanel.jsx'))

export default function AiWorkspace({ workspace, query }) {
  const { appearance } = useFxReplayContext()
  const en = appearance?.language === 'en'
  const say = (vi, english) => en ? english : vi
  const section = query.get('section') || 'connections'

  return <main className={`ai-workspace settings-shell wm-page${section === 'gateway' ? ' is-gateway' : ''}`} data-testid="ai-workspace" data-section={section}>
    {section === 'connections' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang đọc kết nối…', 'Checking connection…')} />}>
      <AiProviderSettings workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'gateway' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang mở CLIProxyAPI…', 'Opening CLIProxyAPI…')} />}>
      <AiGatewayPanel key={workspace} workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'models' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang tải model…', 'Loading models…')} />}>
      <AiModelProfiles workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'automation' ? <>
      <header className="ai-page-heading"><h1>{say('Bot', 'Bots')}</h1></header>
      <section className="ai-bots-empty"><AiSparkles /><h2>{say('Chưa hỗ trợ chạy bot', 'Bot execution is not available yet')}</h2><p>{say('Bot theo quy tắc và bot dùng AI sẽ được quản lý tại đây.', 'Rule-based bots and AI bots will be managed here.')}</p></section>
    </> : null}
  </main>
}
