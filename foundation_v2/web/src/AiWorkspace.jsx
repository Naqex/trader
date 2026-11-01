import { lazy, Suspense } from 'react'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { TestingPageSkeleton } from './TestingPageState.jsx'
import './settings.css'
import './ai-workspace.css'

const AiProviderSettings = lazy(() => import('./AiProviderSettings.jsx'))
const AiModelProfiles = lazy(() => import('./AiModelProfiles.jsx'))
const AiWorkflows = lazy(() => import('./AiWorkflows.jsx'))
const AiResearchWorkspace = lazy(() => import('./AiResearchWorkspace.jsx'))

export default function AiWorkspace({ workspace, query }) {
  const { appearance } = useFxReplayContext()
  const en = appearance?.language === 'en'
  const say = (vi, english) => en ? english : vi
  const section = query.get('section') || 'connections'

  return <main className={`ai-workspace settings-shell wm-page${section === 'research' ? ' is-research-preview' : ''}`} data-testid="ai-workspace" data-section={section}>
    {section === 'connections' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang đọc kết nối…', 'Checking connection…')} />}>
      <AiProviderSettings workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'models' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang tải model…', 'Loading models…')} />}>
      <AiModelProfiles workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'workflows' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang tải…', 'Loading…')} />}>
      <AiWorkflows key={workspace} workspace={workspace} language={appearance?.language} />
    </Suspense> : section === 'research' ? <Suspense fallback={<TestingPageSkeleton label={say('Đang mở nghiên cứu…', 'Opening research…')} />}>
      <AiResearchWorkspace key={workspace} workspace={workspace} language={appearance?.language} theme={appearance?.theme} />
    </Suspense> : null}
  </main>
}
