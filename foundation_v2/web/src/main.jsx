import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
const LearnWorkspace = lazy(() => import('./LearnWorkspace.jsx'))
const PropAnalytics = lazy(() => import('./PropAnalytics.jsx'))
const ReplayWorkspace = lazy(() => import('./ReplayWorkspace.jsx'))
import FxReplayShell from './FxReplayShell.jsx'
const AnalyticsWorkspace = lazy(() => import('./AnalyticsWorkspace.jsx'))
const JournalWorkspace = lazy(() => import('./JournalWorkspace.jsx'))
const SettingsWorkspace = lazy(() => import('./SettingsWorkspace.jsx'))
const DataDeskWorkspace = lazy(() => import('./DataDeskWorkspace.jsx'))
const ResearchWorkspaceV2 = lazy(() => import('./ResearchWorkspace.jsx'))
const TradeWorkspace = lazy(() => import('./TradeWorkspace.jsx'))
const RiskWorkspace = lazy(() => import('./RiskWorkspace.jsx'))
const PlaybookWorkspace = lazy(() => import('./PlaybookWorkspace.jsx'))
const LiveWorkspace = lazy(() => import('./LiveWorkspace.jsx'))
const SessionPicker = lazy(() => import('./SessionPicker.jsx'))
const SessionReports = lazy(() => import('./SessionReports.jsx'))
const DashboardSessions = lazy(() => import('./DashboardSessions.jsx'))
const TestingComponentReference = lazy(() => import('./TestingComponentReference.jsx'))
import { canPreviewDemo, previewMode, previewStateHref } from './demoMode.js'
import ViewStatePreview, { ViewStateSelect } from './ViewStatePreview.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import { navigate, navigationScope, navigationSearch, navigationSnapshot, subscribeNavigation } from './clientNavigation.js'
import './styles.css'
import './dashboard.css'
import './workspace-pattern.css'
import './page-layout.css'
import './component-interactions.css'
import './testing-standard.css'
import './compact-system.css'
import WorkspaceQueryProvider from './WorkspaceQueryProvider.jsx'
import WorkspaceConnectionNote from './WorkspaceConnectionNote.jsx'
import { startFrontendPerformance } from './frontendPerformance.js'
import { TestingRouteBoundary } from './TestingReadState.jsx'
import { TestingEmptyState, TestingPageSkeleton } from './TestingPageState.jsx'
import ChartLoadingState from './ChartLoadingState.jsx'
import ProjectTooltipLayer from './ProjectTooltipLayer.jsx'

function WorkspaceOverview({ workspace, query }) {
  return <section className="fx-dashboard" aria-label="Dashboard"><div className="fx-dashboard-inner"><DashboardSessions key={workspace} workspace={workspace} query={query} /></div></section>
}

function UnavailableWorkspace({ title, eyebrow, description, next, href }) {
  return (
    <section className="fx-unavailable wm-page" aria-labelledby="unavailable-title">
      <span className="fx-eyebrow">{eyebrow}</span>
      <h1 id="unavailable-title">{title}</h1>
      <p>{description}</p>
      <div className="fx-unavailable-state"><span className="fx-state-mark">—</span><span><strong>Chưa có dữ liệu để hiển thị</strong><small>{next}</small></span></div>
      {href && <a className="fx-secondary-button" href={href}>Mở Practice để tiếp tục</a>}
    </section>
  )
}


function App() {
  const route = useSyncExternalStore(subscribeNavigation, navigationSnapshot)
  const query = useMemo(() => new URLSearchParams(navigationSearch()), [route])
  const performanceEnabled = query.get('perf') === '1'
  useLayoutEffect(() => {
    if (!performanceEnabled) return
    const collector = startFrontendPerformance({ enabled: true })
    return () => collector.stop()
  }, [performanceEnabled])
  const workspace = query.get('workspace') || 'tenant-a'
  const requestedView = query.get('view')
  useLayoutEffect(() => {
    if (requestedView === 'testing' || requestedView === 'prop') navigate(buildWorkspaceHref('overview', workspace, query, { create: 'prop', session: null, dataset: null, cursor: null, cutoff: null }), { replace: true })
  }, [requestedView, workspace])
  // Preserve deep links emitted by the research/learn flows while keeping a bare root on the overview.
  const activeView = requestedView === 'data' ? 'market-data' : requestedView || (query.has('job') ? 'research' : query.has('session') || query.has('dataset') ? 'replay' : 'overview')
  if (activeView === 'market-data') {
    query.set('area', 'testing')
    query.set('section', 'market-data')
  }
  const scope = navigationScope(query, activeView)
  useEffect(() => {
    for (const content of document.querySelectorAll('.fx-main, .fx-content')) {
      content.scrollTop = 0; content.scrollLeft = 0
    }
  }, [scope, query.get('section'), query.get('surface')])
  // Trading tabs open persisted reports. Order entry is an explicit chart action.
  const showSessionPicker = query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
  const loadingFallback = activeView === 'replay' && !showSessionPicker ? <ChartLoadingState viewport /> : <TestingPageSkeleton view={activeView} />
  const showTradeLedger = query.get('intent') !== 'order'
  const showSessionAnalytics = query.get('surface') !== 'workspace' && !query.get('job') && !query.get('job_id')
  const isLearn = activeView === 'learn'
  const isProp = requestedView === 'testing' || requestedView === 'prop'
  let content
  let mode = query.get('mode') || (activeView === 'research' ? 'Research' : activeView === 'learn' ? 'Learn' : 'Replay')

  if (isLearn) {
    content = <LearnWorkspace workspace={workspace} query={query} />
    mode = 'Read only'
  } else if (isProp) {
    content = <TestingPageSkeleton view="overview" />
    mode = 'Practice'
  } else if (activeView === 'replay') {
    content = showSessionPicker ? <SessionPicker kind="replay" workspace={workspace} query={query} /> : <ReplayWorkspace workspace={workspace} query={query} />
  } else if (activeView === 'research') {
    content = <ResearchWorkspaceV2 workspace={workspace} query={query} />
  } else if (activeView === 'market-data') {
    content = <DataDeskWorkspace key={workspace} workspace={workspace} query={query} />
    mode = 'Data'
  } else if (activeView === 'overview') {
    content = <WorkspaceOverview workspace={workspace} query={query} />
  } else if (activeView === 'journal') {
    content = <JournalWorkspace workspace={workspace} query={query} />
    mode = 'Journal'
  } else if (activeView === 'analytics') {
    content = query.get('analytics_source') === 'prop' ? <PropAnalytics workspace={workspace} query={query} /> : showSessionAnalytics ? <SessionReports workspace={workspace} query={query} /> : <AnalyticsWorkspace workspace={workspace} query={query} />
    mode = 'Analytics'
  } else if (activeView === 'trade') {
    content = showTradeLedger ? <SessionReports ledgerOnly workspace={workspace} query={query} /> : <TradeWorkspace workspace={workspace} query={query} />
    mode = 'Simulator'
  } else if (activeView === 'risk') {
    content = <RiskWorkspace workspace={workspace} query={query} />
    mode = 'Risk lab'
  } else if (activeView === 'playbook') {
    content = <PlaybookWorkspace workspace={workspace} query={query} />
    mode = 'Playbook'
  } else if (activeView === 'live') {
    content = <LiveWorkspace workspace={workspace} query={query} />
    mode = 'Read only'
  } else if (activeView === 'settings') {
    content = <SettingsWorkspace workspace={workspace} query={query} />
    mode = 'Workspace'
  } else {
    const copy = {
      journal: ['JOURNAL / DECISION LOG', 'Journal', 'Ghi chú phải gắn với replay session và trade ID để không tách khỏi context.', 'Mở một replay session trước khi ghi journal.'],
      analytics: ['ANALYTICS / SESSION METRICS', 'Analytics', 'Analytics sẽ đọc từ session, trade ledger và research result có provenance.', 'Chưa có session hoặc result để tính số liệu.'],
      trade: ['TRADE DESK / DEMO ONLY', 'Trade desk', 'Trade draft chỉ có ý nghĩa khi được tạo từ chart tại một decision cutoff cụ thể.', 'Broker send đang khóa; hãy bắt đầu từ Practice.'],
    }[activeView] || ['WORKSPACE', 'Khu vực chưa chọn', 'Chọn một khu vực trong rail để tiếp tục.', 'Mở Practice để bắt đầu.']
    content = <UnavailableWorkspace eyebrow={copy[0]} title={copy[1]} description={copy[2]} next={copy[3]} href={buildWorkspaceHref('replay', workspace, query)} />
  }

  const demoAvailable = canPreviewDemo(activeView, query)
  const visualMode = previewMode(query, activeView)
  const changePreview = value => {
    navigate(previewStateHref(window.location.href, value))
  }
  // Unmount real data readers during preview; fixtures never reach mutation handlers.
  if (visualMode !== 'real') content = <ViewStatePreview key={`${activeView}:${query.get('analytics_source')}:${query.get('section')}:${visualMode}`} state={visualMode} view={activeView} workspace={workspace} query={query} onChange={changePreview} />
  if (query.get('ui_reference') === '1') content = <TestingComponentReference />
  const topbarAction = query.get('ui_reference') !== '1' && <><WorkspaceConnectionNote key={workspace} workspace={workspace} enabled={visualMode === 'real'} previewState={visualMode} /><ViewStateSelect value={visualMode} view={activeView} disabled={!demoAvailable} onChange={changePreview} /></>
  return <FxReplayShell workspace={workspace} query={query} activeView={activeView} mode={mode} topbarAction={topbarAction}><WorkspaceQueryProvider key={workspace} workspace={workspace} eventsEnabled={visualMode === 'real' && query.get('ui_reference') !== '1'}><TestingRouteBoundary key={scope} fallback={<TestingEmptyState kind="page-error" viewport />}><Suspense fallback={loadingFallback}>{content}</Suspense></TestingRouteBoundary></WorkspaceQueryProvider></FxReplayShell>
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Trading Workspace root element is missing')

// Vite can re-evaluate this entry module during HMR. Reuse the existing root
// so a hot update never calls createRoot twice on the same DOM container.
const rootStateKey = '__tradingWorkspaceReactRoot'
const appRoot = rootElement[rootStateKey] || createRoot(rootElement)
rootElement[rootStateKey] = appRoot
appRoot.render(<><App /><ProjectTooltipLayer /></>)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    appRoot.unmount()
    delete rootElement[rootStateKey]
  })
}
