import { liveTradingHref } from './liveTradingNavigation.js'
import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import './fx-shell-story.css'
import './fx-shell-preferences.css'
import { buildWorkspaceHref, readWorkspaceContext } from './workspaceContext.js'
import { navigate } from './clientNavigation.js'
import { TestingLocaleProvider, useTestingLocale } from './testingLocale.jsx'
import { NotificationProvider } from './Notifications.jsx'
import AiSparkles from './AiSparkles.jsx'
import './ai-chat.css'
import { TestingRouteBoundary } from './TestingReadState.jsx'
const AiChatPanel = lazy(() => import('./AiChatPanel.jsx'))

function AiPanelFallback({ open, modal, onClose, language, standalone, error = false }) {
  const close = useRef(null)
  useEffect(() => {
    if (!open) return
    close.current?.focus()
    const keydown = event => {
      if (event.key === 'Escape' && !standalone) { event.preventDefault(); onClose() }
      if (modal && event.key === 'Tab') { event.preventDefault(); close.current?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [open, modal, onClose, standalone])
  const en = language === 'en'
  return <aside id="wm-ai-chat" className={`wm-ai-chat ${standalone ? 'is-standalone' : ''}`} hidden={!open} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label="Mentor" aria-busy={!error}>
    <header className="wm-ai-header"><h2>Mentor</h2><span />{!standalone && <button type="button" className="wm-dialog-close" ref={close} onClick={onClose} aria-label={en ? 'Close AI chat' : 'Đóng chat AI'}>×</button>}</header>
    <div className="wm-ai-transcript" role={error ? 'alert' : 'status'}>{error ? en ? 'AI chat could not load. Reload the page to try again.' : 'Không tải được chat AI. Tải lại trang để thử lại.' : en ? 'Loading…' : 'Đang tải…'}</div>
  </aside>
}

export { buildWorkspaceHref, readWorkspaceContext }

const LANGUAGE_STORAGE_KEY = 'tw-language'
const THEME_STORAGE_KEY = 'tw-theme'
const RAIL_COLLAPSED_STORAGE_KEY = 'tw-shell-rail-collapsed'
const SHELL_COPY = {
  vi: {
    language: 'VI',
    switchLanguage: 'Chuyển ngôn ngữ sang English',
    themeDark: 'Đang dùng giao diện tối. Chuyển sang sáng',
    themeLight: 'Đang dùng giao diện sáng. Chuyển sang tối',
    themeDarkName: 'Giao diện tối',
    themeLightName: 'Giao diện sáng',
    themeDarkShort: 'Tối',
    themeLightShort: 'Sáng',
    expandNavigation: 'Mở rộng điều hướng',
    collapseNavigation: 'Thu gọn điều hướng',
    openNavigation: 'Mở điều hướng',
    closeNavigation: 'Đóng điều hướng',
    help: 'Mở phím tắt và trợ giúp',
    closeHelp: 'Đóng trợ giúp',
    shortcutsTitle: 'Phím tắt WMREPLAY',
    shortcutHelp: 'Mở trợ giúp',
    shortcutEscape: 'Đóng bảng trợ giúp',
    shortcutsHint: 'Các phím tắt chỉ điều khiển giao diện shell.',
    product: 'WMREPLAY',
    workspaceAria: 'Điều hướng chính WMREPLAY',
    contentAria: 'Nội dung WMREPLAY',
    primaryNavAria: 'Khu vực chính',
    utilityNavAria: 'Công cụ',
    subnavAria: 'Điều hướng workspace',
    analyticsSourcesAria: 'Nguồn Analytics',
    subnav: { overview: 'Dashboard', replay: 'Sessions', trade: 'Trades', analytics: 'Analytics' },
    nav: {
      testing: ['Testing', 'Không gian luyện tập'],
      sessions: ['Sessions', 'Chọn một phiên replay'],
      replay: ['Testing', 'Replay và backtest'],
      live: ['Live', 'Theo dõi thị trường và tài khoản'],
      calendar: ['Calendar', 'PnL giao dịch theo ngày'],
      liveTrades: ['Trades', 'Deal khớp lệnh đã đồng bộ'],
      liveTerminal: ['Tổng quan', 'Tài khoản và biểu đồ giao dịch MT5'],
      notes: ['Notes', 'Ghi chú thị trường'],
      tagAnalytics: ['Tag analytics', 'Phân tích theo tag'],
      tradingAccounts: ['Trading accounts', 'Tài khoản giao dịch'],
      strategies: ['Strategies', 'Quản lý chiến lược'],
      ai: ['AI and Bots', 'Trợ lý AI, kết nối model và bot giao dịch'],
      aiConnections: ['Kết nối', 'Tài khoản và dịch vụ AI'],
      aiModels: ['Model', 'Model mặc định và theo tính năng'],
      automation: ['Bot', 'Bot giao dịch và AI giao dịch'],
      myStrategies: ['My strategies', 'Chiến lược của tôi'],
      trade: ['Trades', 'Giao dịch trong phiên replay'],
      playbook: ['Strategies', 'Strategy và playbook'],
      learn: ['Education', 'Học giao dịch và thuật ngữ'],
      settings: ['Settings', 'Không gian làm việc và kết nối'],
      overview: ['Dashboard', 'Phiên đang làm và điểm tiếp theo'],
      data: ['Data desk', 'Dataset, provenance và QA'],
      marketData: ['Market Data', 'Assets và lịch sử cho Testing'],
      research: ['Research', 'Backtest và kết quả'],
      journal: ['Journal', 'Ghi chú theo phiên'],
      analytics: ['Analytics', 'Hiệu suất và thống kê'],
      risk: ['Risk', 'Giới hạn và mô phỏng rủi ro'],
    },
  },
  en: {
    language: 'EN',
    switchLanguage: 'Switch language to Vietnamese',
    themeDark: 'Dark theme is active. Switch to light',
    themeLight: 'Light theme is active. Switch to dark',
    themeDarkName: 'Dark theme',
    themeLightName: 'Light theme',
    themeDarkShort: 'Dark',
    themeLightShort: 'Light',
    expandNavigation: 'Expand navigation',
    collapseNavigation: 'Collapse navigation',
    openNavigation: 'Open navigation',
    closeNavigation: 'Close navigation',
    help: 'Open shortcuts and help',
    closeHelp: 'Close help',
    shortcutsTitle: 'WMREPLAY keyboard shortcuts',
    shortcutHelp: 'Open help',
    shortcutEscape: 'Close help panel',
    shortcutsHint: 'Shortcuts only control the workspace shell.',
    product: 'WMREPLAY',
    workspaceAria: 'WMREPLAY main navigation',
    contentAria: 'WMREPLAY content',
    primaryNavAria: 'Primary workspace',
    utilityNavAria: 'Utilities',
    subnavAria: 'Workspace navigation',
    analyticsSourcesAria: 'Analytics source',
    subnav: { overview: 'Dashboard', replay: 'Sessions', trade: 'Trades', analytics: 'Analytics' },
    nav: {
      testing: ['Testing', 'Backtesting workspace'],
      sessions: ['Sessions', 'Choose a replay session'],
      replay: ['Testing', 'Replay and backtesting'],
      live: ['Live', 'Market and account workspace'],
      calendar: ['Calendar', 'Daily deal PnL'],
      liveTrades: ['Trades', 'Synced broker deals'],
      liveTerminal: ['Dashboard', 'MT5 account and trading charts'],
      notes: ['Notes', 'Market notes'],
      tagAnalytics: ['Tag analytics', 'Tag-based analytics'],
      tradingAccounts: ['Trading accounts', 'Trading accounts'],
      strategies: ['Strategies', 'Strategy workspace'],
      ai: ['AI and Bots', 'AI assistant, model connections and trading bots'],
      aiConnections: ['Connections', 'AI accounts and services'],
      aiModels: ['Models', 'Default and feature models'],
      automation: ['Bots', 'Trading bots and AI trading'],
      myStrategies: ['My strategies', 'Your strategies'],
      trade: ['Trades', 'Trades in a replay session'],
      playbook: ['Strategies', 'Strategies and playbooks'],
      learn: ['Education', 'Course and glossary'],
      settings: ['Settings', 'Workspace and connections'],
      overview: ['Dashboard', 'Current session and next action'],
      data: ['Data desk', 'Dataset, provenance and QA'],
      marketData: ['Market Data', 'Assets and history for Testing'],
      research: ['Research', 'Backtest and results'],
      journal: ['Journal', 'Session notes'],
      analytics: ['Analytics', 'Performance and statistics'],
      risk: ['Risk', 'Limits and risk simulation'],
    },
  },
}

const SIDEBAR_SECTIONS = [
  {
    id: 'testing',
    copyKey: 'testing',
    icon: 'testing',
    defaultRoute: 'overview',
    defaultSection: 'dashboard',
    items: [
      { id: 'testing-dashboard', copyKey: 'overview', icon: 'dashboard', route: 'overview', activeViews: ['overview'], section: 'dashboard' },
      { id: 'testing-sessions', copyKey: 'sessions', icon: 'sessions', route: 'replay', picker: true, activeViews: ['replay'], section: 'sessions' },
      { id: 'testing-trades', copyKey: 'trade', icon: 'trades', route: 'trade', picker: true, activeViews: ['trade'], section: 'trades' },
      { id: 'testing-analytics', copyKey: 'analytics', icon: 'analytics', route: 'analytics', picker: true, activeViews: ['analytics'], section: 'analytics' },
      { id: 'testing-market-data', copyKey: 'marketData', icon: 'data', route: 'market-data', activeViews: ['market-data'], section: 'market-data' },
    ],
  },
  {
    id: 'live',
    copyKey: 'live',
    icon: 'live',
    defaultRoute: 'live',
    defaultSection: 'terminal',
    items: [
      { id: 'live-terminal', copyKey: 'liveTerminal', icon: 'dashboard', route: 'live', activeViews: ['live'], section: 'terminal' },
      { id: 'live-calendar', copyKey: 'calendar', icon: 'calendar', route: 'live', activeViews: ['live'], section: 'calendar' },
      { id: 'live-trades', copyKey: 'liveTrades', icon: 'trades', route: 'live', activeViews: ['live'], section: 'trades' },
      { id: 'live-notes', copyKey: 'notes', icon: 'notes', route: 'live', activeViews: ['live'], section: 'notes' },
      { id: 'live-tag-analytics', copyKey: 'tagAnalytics', icon: 'tags', route: 'live', activeViews: ['live'], section: 'tag-analytics' },
      { id: 'live-analytics', copyKey: 'analytics', icon: 'analytics', route: 'live', activeViews: ['live'], section: 'analytics' },
      { id: 'live-accounts', copyKey: 'tradingAccounts', icon: 'accounts', route: 'live', activeViews: ['live'], section: 'trading-accounts' },
    ],
  },
  {
    id: 'strategies',
    copyKey: 'strategies',
    icon: 'strategies',
    defaultRoute: 'playbook',
    defaultSection: 'my-strategies',
    items: [
      { id: 'my-strategies', copyKey: 'myStrategies', icon: 'my-strategies', route: 'playbook', activeViews: ['playbook'], section: 'my-strategies' },
    ],
  },
  {
    id: 'ai', copyKey: 'ai', icon: 'ai', defaultRoute: 'ai', defaultSection: 'connections',
    items: [
      { id: 'ai-connections', copyKey: 'aiConnections', icon: 'connections', route: 'ai', activeViews: ['ai'], section: 'connections' },
      { id: 'ai-models', copyKey: 'aiModels', icon: 'settings', route: 'ai', activeViews: ['ai'], section: 'models' },
      { id: 'ai-automation', copyKey: 'automation', icon: 'automation', route: 'ai', activeViews: ['ai'], section: 'automation' },
    ],
  },
  { id: 'education', copyKey: 'learn', icon: 'education', defaultRoute: 'learn', items: [] },
  { id: 'settings', copyKey: 'settings', icon: 'settings', defaultRoute: 'settings', items: [] },
]

const SUBNAV_GROUPS = {
  testing: SIDEBAR_SECTIONS[0].items,
  live: SIDEBAR_SECTIONS[1].items,
  strategies: SIDEBAR_SECTIONS[2].items,
  ai: SIDEBAR_SECTIONS[3].items,
}

function activeSectionId(activeView, query) {
  const area = query?.get('area')
  if (area && SIDEBAR_SECTIONS.some((section) => section.id === area)) return area
  if (['overview', 'replay', 'trade', 'analytics', 'market-data'].includes(activeView)) return 'testing'
  if (activeView === 'live') return 'live'
  if (activeView === 'playbook') return 'strategies'
  if (activeView === 'ai') return 'ai'
  if (activeView === 'learn') return 'education'
  if (activeView === 'settings') return 'settings'
  return ''
}

function isNavItemActive(item, activeView, query, sectionId) {
  if (!item.activeViews?.includes(activeView)) return false
  if (sectionId !== 'testing' && (query?.get('section') || (sectionId === 'live' ? 'calendar' : sectionId === 'ai' ? 'connections' : '')) !== item.section) return false
  if (sectionId === 'testing' && query?.get('area') === 'live') return false
  return !query?.get('section') || query.get('section') === item.section || sectionId === 'testing'
}

const FxReplayContext = createContext(null)

function WMReplayWordmark() {
  return (
    <svg className="fx-wordmark-svg" viewBox="0 0 242 30" role="img" aria-label="WMREPLAY" focusable="false">
      <use href="/brand/wmreplay.svg#wordmark" />
    </svg>
  )
}

export function useFxReplayContext() {
  return useContext(FxReplayContext) || { updateMarketContext: () => {} }
}

function hrefFor(id, workspace, query, overrides = {}) {
  return buildWorkspaceHref(id, workspace, query, overrides)
}

/*
 * The source reference uses small, high-contrast line icons in the rail. Keep
 * them inline so the shell does not depend on an icon font (which would make
 * the first paint and visual QA vary with the host machine's installed fonts).
 */
function RailIcon({ id }) {
  const common = {
    className: 'fx-nav-icon-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    focusable: 'false',
  }
  if (id === 'dashboard') return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
  if (id === 'sessions') return <svg {...common}><path d="M5 6h14M5 12h14M5 18h14" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
  if (id === 'trades') return <svg {...common}><path d="M5 8h12M15 5l3 3-3 3M19 16H7M9 13l-3 3 3 3" /></svg>
  if (id === 'analytics' || id === 'testing') return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M3 21h20" /></svg>
  if (id === 'live') return <svg {...common}><path d="M3 12h4l2-5 4 10 2-5h6" /><path d="M5 4a10 10 0 0 0 0 16M19 4a10 10 0 0 1 0 16" /></svg>
  if (id === 'calendar') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></svg>
  if (id === 'notes') return <svg {...common}><path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h6" /></svg>
  if (id === 'tags') return <svg {...common}><path d="m4 5 7-1 9 9-6 6-9-9 1-7Z" /><circle cx="8" cy="8" r="1.2" /></svg>
  if (id === 'accounts') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M16 14h3" /><circle cx="16" cy="14" r=".7" /></svg>
  if (id === 'strategies') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" /></svg>
  if (id === 'my-strategies') return <svg {...common}><path d="M5 6h14M5 12h14M5 18h9" /><path d="m17 16 2 2 3-4" /></svg>
  if (id === 'education' || id === 'learn') return <svg {...common}><path d="m3 9 9-4 9 4-9 4-9-4Z" /><path d="M7 11v4c2 2 8 2 10 0v-4M21 9v6" /></svg>
  if (id === 'trade') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M8 17h8" /></svg>
  if (id === 'playbook') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" /></svg>
  if (id === 'settings') return <svg {...common}><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /><circle cx="12" cy="12" r="3.3" /></svg>
  if (id === 'ai') return <AiSparkles className="fx-nav-icon-svg" />
  if (id === 'connections') return <svg {...common}><path d="m8 7 3-3a5 5 0 0 1 7 7l-3 3M16 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8" /></svg>
  if (id === 'automation') return <svg {...common}><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M1 12v4M23 12v4M9 16h6" /><circle cx="8" cy="12" r=".6" /><circle cx="16" cy="12" r=".6" /></svg>
  return <svg {...common}><path d="M4 17V7M10 17V4M16 17V9M22 17V2" /><path d="M3 20h20" /></svg>
}

function ShellRail({ activeView, workspace, query, copy, railId, drawerOpen, onClose, closeButtonRef, inert }) {
  const { t } = useTestingLocale()
  const activeArea = activeSectionId(activeView, query)
  const primary = SIDEBAR_SECTIONS.slice(0, 3)
  const utility = SIDEBAR_SECTIONS.slice(4)
  const renderSectionLink = (section) => {
    const [label, description] = copy.nav[section.copyKey] || [section.id, '']
    const active = activeArea === section.id
    return (
      <a
        className={`fx-rail-section-heading fx-rail-top-level-item ${active ? 'is-active' : ''}`}
        key={section.id}
        href={hrefFor(section.defaultRoute, workspace, query, {
          area: section.id,
          ...(section.defaultSection ? { section: section.defaultSection } : {}),
        })}
        aria-current={active ? 'page' : undefined}
        aria-label={`${t(label)}: ${description}`}
        data-tooltip={description}
        data-nav-label={t(label)}
        onClick={drawerOpen ? onClose : undefined}
      >
        <span className="fx-nav-icon" aria-hidden="true"><RailIcon id={section.icon} /></span>
        <span className="fx-rail-section-label">{t(label)}</span>
      </a>
    )
  }
  return (
    <aside className="fx-rail" id={railId} inert={inert} aria-label={copy.workspaceAria} role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen ? 'true' : undefined}>
      {drawerOpen && <div className="fx-mobile-nav-header">
        <span>{copy.product}</span>
        <button className="fx-shell-help-close" type="button" onClick={onClose} aria-label={copy.closeNavigation} ref={closeButtonRef}>×</button>
      </div>}
      <a className="fx-rail-workspace" href={hrefFor('settings', workspace, query, { area: 'settings', section: null })}
        aria-label={`${t('Workspace')}: ${workspace} · ${t('Settings')}`} data-tooltip={`${workspace} · ${t('Settings')}`} onClick={drawerOpen ? onClose : undefined}>
        <span className="fx-nav-icon" aria-hidden="true"><RailIcon id="accounts" /></span>
        <span className="fx-rail-workspace-copy"><small>{t('Workspace')}</small><strong>{workspace}</strong></span>
        <span className="fx-rail-workspace-settings" aria-hidden="true"><RailIcon id="settings" /></span>
      </a>
      <div className="fx-rail-primary">
        {primary.map(renderSectionLink)}
      </div>
      <div className="fx-rail-ai">{renderSectionLink(SIDEBAR_SECTIONS[3])}</div>
      <div className="fx-rail-spacer" />
      <div className="fx-rail-utility">
        {utility.map(renderSectionLink)}
      </div>
    </aside>
  )
}

function ShellSubnav({ activeView, workspace, query, copy, action }) {
  const { t } = useTestingLocale()
  const sectionId = activeSectionId(activeView, query)
  const items = SUBNAV_GROUPS[sectionId] || []
  const navRef = useRef(null)
  const selectedSection = query?.get('section')
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const revealSelected = () => (nav.querySelector('.fx-subsubnav a[aria-current="page"]') || nav.querySelector('.fx-subnav-primary a[aria-current="page"]'))?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealSelected()
    const observer = new ResizeObserver(revealSelected)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [activeView, sectionId, selectedSection, query.get('analytics_source')])
  if (items.length === 0 && !action) return null
  return (
    <nav className="fx-subnav" aria-label={copy.subnavAria} ref={navRef}>
      <div className="fx-subnav-primary">
      {items.map((item) => {
        const label = t(copy.nav[item.copyKey || item.id]?.[0] || item.id)
        const active = isNavItemActive(item, activeView, query, sectionId)
        return (
          <React.Fragment key={item.id}>
          <a
            className={`fx-subnav-link ${active ? 'is-active' : ''}`}
            href={hrefFor(item.route, workspace, query, {
              area: sectionId,
              section: item.section,
              ...(item.picker ? { select: '1' } : {}),
              ...(item.route === 'trade' ? { session: null, dataset: null, cursor: null, cutoff: null, mode: null, sessions: 'all' } : {}),
              ...(item.route === 'replay' && item.picker ? { session: null, dataset: null, cursor: null, cutoff: null } : {}),
            })}
            aria-current={active ? 'page' : undefined}
            key={item.id}
          >
            <span className="fx-subnav-icon" aria-hidden="true"><RailIcon id={item.icon} /></span>
            {label}
          </a>
          {item.route === 'analytics' && sectionId === 'testing' && activeView === 'analytics' && <nav className="fx-subsubnav" aria-label={copy.analyticsSourcesAria}>
            {[['sessions', 'Sessions'], ['prop', 'Prop firm']].map(([source, label]) => <a key={source}
              href={hrefFor('analytics', workspace, query, { select: '1', analytics_source: source, area: 'testing', section: 'analytics', prop_session: query.get('prop_session'), attempt: query.get('attempt') })}
              aria-current={(query.get('analytics_source') === 'prop' ? 'prop' : 'sessions') === source ? 'page' : undefined}>{t(label)}</a>)}
          </nav>}
          {item.section === 'trading-accounts' && sectionId === 'live' && active && <nav className="fx-subsubnav" aria-label={t('Account views')}>
            {[['connect', 'Connect'], ['transactions', 'Transactions']].map(([tab, label]) => <a key={tab} href={hrefFor('live', workspace, query, { area: 'live', section: 'trading-accounts', account_tab: tab })} aria-current={(query.get('account_tab') === 'transactions' ? 'transactions' : 'connect') === tab ? 'page' : undefined}>{t(label)}</a>)}
          </nav>}
          </React.Fragment>
        )
      })}
      </div>
      {action && <div className="fx-subnav-action">{action}</div>}
    </nav>
  )
}

function ThemeIcon({ theme }) {
  return <svg className="fx-theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></> : <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />}
  </svg>
}

function ShellTopbar({ copy, language, setLanguage, theme, setTheme, railCollapsed, onToggleRail, chartWorkspace, query, workspace, helpOpen, onToggleHelp, helpButtonRef, railId, mobileNavigation, drawerOpen, menuButtonRef, aiOpen, onToggleAi, aiButtonRef, aiModal, topbarAction }) {
  const navigationAction = mobileNavigation ? copy.openNavigation : railCollapsed ? copy.expandNavigation : copy.collapseNavigation
  const aiButton = <button type="button" className="fx-shell-toggle wm-ai-toggle" onClick={onToggleAi} ref={aiButtonRef} aria-label={language === 'en' ? 'AI chat' : 'Chat AI'} data-tooltip={language === 'en' ? 'AI chat' : 'Chat AI'} aria-expanded={aiOpen} aria-controls="wm-ai-chat" data-testid="ai-toggle"><AiSparkles /></button>
  if (chartWorkspace) {
    const liveChart = query.get('view') === 'live'
    const backHref = liveChart ? liveTradingHref(workspace,query) : buildWorkspaceHref('replay', workspace, query, { select: '1', surface: '' })
    return (
      <header className="fx-topbar fx-chart-topbar" inert={aiModal}>
        <div className="fx-chart-topbar-left">
          <a className="fx-chart-icon-button" href={backHref} aria-label={liveChart ? copy.nav.liveTerminal[0] : "Quay lại Sessions"} data-tooltip={liveChart ? copy.nav.liveTerminal[0] : "Quay lại Sessions"}>←</a>
          <span className="fx-chart-brand">{copy.product}</span>
        </div>
        <div id="replay-command-slot" />
        <div className="fx-chart-topbar-actions">
          <div className="fx-topbar-data">{topbarAction}</div>
          {aiButton}
          <button className="fx-shell-toggle fx-language-toggle" type="button" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')} aria-label={copy.switchLanguage} data-tooltip={copy.switchLanguage} data-testid="language-toggle">{language === 'vi' ? 'EN' : 'VI'}</button>
          <button className="fx-shell-toggle fx-theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label={theme === 'dark' ? copy.themeDark : copy.themeLight} data-tooltip={theme === 'dark' ? copy.themeDark : copy.themeLight} data-testid="theme-toggle"><ThemeIcon theme={theme} /></button>
          <button className="fx-shell-toggle fx-utility-icon" type="button" onClick={onToggleHelp} aria-expanded={helpOpen} aria-controls={helpOpen ? 'fx-shell-help' : undefined} aria-label={copy.help} data-tooltip={copy.help} data-testid="help-toggle" ref={helpButtonRef}>?</button>
        </div>
      </header>
    )
  }
  return (
    <header className="fx-topbar" inert={drawerOpen || aiModal}>
      <div className="fx-topbar-brand" data-tooltip={copy.product}>
        <button className="fx-menu-button" type="button" onClick={onToggleRail} aria-expanded={!railCollapsed} aria-controls={railId} aria-label={navigationAction} data-tooltip={navigationAction} ref={menuButtonRef}>
          <svg className="fx-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            {mobileNavigation ? <path d="M4 6h16M4 12h16M4 18h16" /> : <>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
              <path className="fx-menu-chevron" d={railCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
            </>}
          </svg>
        </button>
        <span className="fx-wordmark"><WMReplayWordmark /></span>
        <span className="fx-wordmark-compact" role="img" aria-label={copy.product}>
          <svg viewBox="0 0 60 30" aria-hidden="true" focusable="false"><use href="/brand/wmreplay.svg#wm" /></svg>
        </span>
      </div>
      <div className="fx-topbar-actions">
        <div className="fx-topbar-data">{topbarAction}</div>
        {aiButton}
        <button className="fx-shell-toggle fx-language-toggle" type="button" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')} aria-label={copy.switchLanguage} data-tooltip={copy.switchLanguage} data-testid="language-toggle">
          {language === 'vi' ? 'EN' : 'VI'}
        </button>
        <button className="fx-shell-toggle fx-theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label={theme === 'dark' ? copy.themeDark : copy.themeLight} data-tooltip={theme === 'dark' ? copy.themeDark : copy.themeLight} data-testid="theme-toggle">
          <ThemeIcon theme={theme} />
        </button>
        <button className="fx-shell-toggle fx-utility-icon" type="button" onClick={onToggleHelp} aria-expanded={helpOpen} aria-controls={helpOpen ? 'fx-shell-help' : undefined} aria-label={copy.help} data-tooltip={copy.help} data-testid="help-toggle" ref={helpButtonRef}>?</button>
      </div>
    </header>
  )
}

function ShellHelp({ copy, helpCloseRef, onClose }) {
  return (
    <div className="fx-shell-help-layer" onMouseDown={onClose}>
      <section className="fx-shell-help" id="fx-shell-help" role="dialog" aria-modal="true" aria-labelledby="fx-shell-help-title" aria-describedby="fx-shell-help-hint" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fx-shell-help-header">
          <h2 id="fx-shell-help-title">{copy.shortcutsTitle}</h2>
          <button className="fx-shell-help-close wm-dialog-close" type="button" onClick={onClose} aria-label={copy.closeHelp} data-tooltip={copy.closeHelp} data-testid="help-close" ref={helpCloseRef}>×</button>
        </div>
        <dl className="fx-shell-shortcuts">
          <div><dt><kbd>?</kbd></dt><dd>{copy.shortcutHelp}</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>{copy.shortcutEscape}</dd></div>
        </dl>
        <p className="fx-shell-help-hint" id="fx-shell-help-hint">{copy.shortcutsHint}</p>
      </section>
    </div>
  )
}

function currentQuery() {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
}

export default function FxReplayShell({ children, workspace, query = currentQuery(), activeView = 'overview', mode = 'Replay', subnavAction, topbarAction }) {
  const chartWorkspace = (activeView === 'live' && query.get('section') === 'terminal' && query.get('surface') === 'workspace') || (activeView === 'replay' && query.get('select') !== '1' && (query.get('surface') === 'workspace' || Boolean(query.get('session')) || Boolean(query.get('dataset'))))
  const chartRoute = chartWorkspace
  const routeContext = useMemo(() => readWorkspaceContext(query), [query])
  const [language, setLanguage] = useState(() => {
    const requested = query.get('lang')
    if (requested === 'vi' || requested === 'en') return requested
    try {
      return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'vi'
    } catch {
      return 'vi'
    }
  })
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') return saved
      // Trading review opens in the dark chart-oriented mode by default. The
      // explicit toggle remains the source of truth when a user prefers light.
      return 'dark'
    } catch {
      return 'dark'
    }
  })
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY)
      if (saved === 'true' || saved === 'false') return saved === 'true'
    } catch {
      // Private browsing can deny storage; use the responsive default below.
    }
    return window.matchMedia('(max-width: 1180px)').matches
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const aiPage = activeView === 'ai' && query.get('section') === 'assistant'
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMounted, setAiMounted] = useState(false)
  const [aiOverlay, setAiOverlay] = useState(() => window.matchMedia('(max-width: 1100px)').matches)
  const aiButtonRef = useRef(null)
  const closeAi = useCallback(() => { setAiOpen(false); requestAnimationFrame(() => aiButtonRef.current?.focus()) }, [])
  const toggleAi = useCallback(() => {
    if (aiPage) { document.getElementById('wm-ai-input')?.focus(); return }
    setAiMounted(true); setAiOpen(value => !value); setHelpOpen(false); setMobileNavigationOpen(false)
  }, [aiPage])
  const openAi = useCallback(() => {
    setAiMounted(true); setAiOpen(true); setHelpOpen(false); setMobileNavigationOpen(false)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)')
    const update = () => setAiOverlay(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const [mobileNavigation, setMobileNavigation] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const drawerOpen = mobileNavigation && mobileNavigationOpen && !chartWorkspace
  // Mobile navigation is transient; resizing must not rewrite the desktop preference.
  const displayedRailCollapsed = mobileNavigation ? !drawerOpen : railCollapsed
  const menuButtonRef = useRef(null)
  const navigationCloseRef = useRef(null)
  const helpButtonRef = useRef(null)
  const helpCloseRef = useRef(null)
  // Kept as a stable compatibility hook for workspaces that report market
  // context. The global header intentionally does not render that metadata.
  const updateMarketContext = useCallback(() => {}, [])
  const copy = SHELL_COPY[language]
  const handleLanguage = useCallback((next) => {
    setLanguage(next)
    const url = new URL(window.location.href)
    url.searchParams.set('lang', next)
    navigate(url.href, { replace: true })
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); return true } catch { return false }
  }, [])
  const requestedLanguage = query.get('lang')
  useEffect(() => {
    if (requestedLanguage === 'vi' || requestedLanguage === 'en') setLanguage(requestedLanguage)
  }, [requestedLanguage])
  const handleTheme = useCallback((next) => {
    setTheme(next)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); return true } catch { return false }
  }, [])
  const applyAppearance = useCallback((next) => {
    const themeSaved = handleTheme(next.theme)
    const languageSaved = handleLanguage(next.language)
    return themeSaved && languageSaved
  }, [handleLanguage, handleTheme])
  useEffect(() => {
    const syncAppearance = (event) => {
      if (event.storageArea !== window.localStorage) return
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        const value = window.localStorage.getItem(THEME_STORAGE_KEY)
        setTheme(value === 'light' ? 'light' : 'dark')
      }
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
        const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
        setLanguage(value === 'en' ? 'en' : 'vi')
      }
    }
    window.addEventListener('storage', syncAppearance)
    return () => window.removeEventListener('storage', syncAppearance)
  }, [])
  const contextValue = useMemo(() => ({
    updateMarketContext,
    routeContext,
    appearance: { theme, language },
    applyAppearance,
    openAi,
    buildHref: (view, overrides) => buildWorkspaceHref(view, workspace, query, overrides),
  }), [query, routeContext, updateMarketContext, workspace, theme, language, applyAppearance, openAi])
  const handleRail = useCallback(() => {
    if (mobileNavigation) {
      setHelpOpen(false)
      setMobileNavigationOpen((value) => !value)
      return
    }
    setRailCollapsed((value) => {
      const next = !value
      try { window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(next)) } catch { /* private browsing */ }
      return next
    })
  }, [mobileNavigation])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const onChange = () => {
      setMobileNavigation(media.matches)
      setMobileNavigationOpen(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const routeKey = query.toString()
  useEffect(() => { setMobileNavigationOpen(false) }, [activeView, routeKey])
  const wasDrawerOpen = useRef(false)
  useEffect(() => {
    if (drawerOpen) navigationCloseRef.current?.focus()
    else if (wasDrawerOpen.current) menuButtonRef.current?.focus()
    wasDrawerOpen.current = drawerOpen
  }, [drawerOpen])
  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute('lang')
    root.setAttribute('lang', language)
    return () => {
      if (previous === null) root.removeAttribute('lang')
      else root.setAttribute('lang', previous)
    }
  }, [language])
  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    root.dataset.twTheme = theme
    body.dataset.twTheme = theme
    root.style.colorScheme = theme
    return () => {
      delete root.dataset.twTheme
      delete body.dataset.twTheme
      root.style.removeProperty('color-scheme')
    }
  }, [theme])
  useEffect(() => {
    const onKeyDown = (event) => {
      if (drawerOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setMobileNavigationOpen(false)
        }
        if (event.key === 'Tab') {
          const focusable = [...document.getElementById('fxreplay-rail').querySelectorAll('button, [href]')]
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        return
      }
      const target = event.target
      const isEditable = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      if (event.key === '?' && !isEditable) {
        event.preventDefault()
        setHelpOpen((value) => !value)
        return
      }
      if (!helpOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setHelpOpen(false)
      }
      if (event.key === 'Tab') {
        const dialog = document.getElementById('fx-shell-help')
        const focusable = dialog ? [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled')) : []
        if (focusable.length > 0) {
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault()
            const next = event.shiftKey ? last : first
            next.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [helpOpen, drawerOpen])
  useEffect(() => {
    if (helpOpen) helpCloseRef.current?.focus()
  }, [helpOpen])
  const wasHelpOpen = useRef(false)
  useEffect(() => {
    if (!helpOpen && wasHelpOpen.current) helpButtonRef.current?.focus()
    wasHelpOpen.current = helpOpen
  }, [helpOpen])

  return (
    <TestingLocaleProvider language={language}><FxReplayContext.Provider value={contextValue}>
      <div className={`fx-app fx-shell-story ${aiOpen && !aiPage ? 'is-ai-open' : ''} ${aiPage ? 'is-ai-page' : ''} ${displayedRailCollapsed ? 'is-rail-collapsed' : ''} ${drawerOpen ? 'is-mobile-nav-open' : ''} ${chartWorkspace ? 'is-chart-workspace' : ''} ${chartRoute ? 'is-chart-route' : ''}`} data-testid="fxreplay-shell" data-theme={theme} data-ui-area={query.get('area') || (['overview', 'replay', 'trade', 'analytics', 'market-data', 'testing', 'prop'].includes(activeView) ? 'testing' : activeView)} lang={language}>
        <ShellTopbar copy={copy} language={language} setLanguage={handleLanguage} theme={theme} setTheme={handleTheme} railCollapsed={displayedRailCollapsed} onToggleRail={handleRail} chartWorkspace={chartWorkspace} query={query} workspace={workspace} helpOpen={helpOpen} onToggleHelp={() => { setHelpOpen((value) => !value); setAiOpen(false) }} helpButtonRef={helpButtonRef} railId="fxreplay-rail" mobileNavigation={mobileNavigation} drawerOpen={drawerOpen} menuButtonRef={menuButtonRef} aiOpen={aiOpen || aiPage} onToggleAi={toggleAi} aiButtonRef={aiButtonRef} aiModal={!aiPage && aiOpen && aiOverlay} topbarAction={topbarAction} />
        {drawerOpen && <div className="fx-mobile-nav-backdrop" aria-hidden="true" onClick={() => setMobileNavigationOpen(false)} />}
        {!chartWorkspace && <ShellRail activeView={activeView} workspace={workspace} query={query} copy={copy} railId="fxreplay-rail" drawerOpen={drawerOpen} onClose={() => setMobileNavigationOpen(false)} closeButtonRef={navigationCloseRef} inert={!aiPage && aiOpen && aiOverlay} />}
        <section className="fx-main" role={['overview', 'live', 'market-data', 'analytics'].includes(activeView) || aiPage || (activeView === 'trade' && query.get('intent') !== 'order') || (activeView === 'replay' && query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')) ? 'main' : undefined} aria-label={copy.contentAria} inert={drawerOpen}>
          <div className="fx-main-content" inert={!aiPage && aiOpen && aiOverlay}>
          <ShellSubnav activeView={activeView} workspace={workspace} query={query} copy={copy} action={subnavAction} />
          {helpOpen && <ShellHelp copy={copy} helpCloseRef={helpCloseRef} onClose={() => setHelpOpen(false)} />}
          <NotificationProvider key={workspace}><div className="fx-content" tabIndex={0}>
            {children}
          </div></NotificationProvider>
          </div>
          {(aiMounted || aiPage) && <TestingRouteBoundary key={workspace} fallback={<AiPanelFallback open={aiOpen || aiPage} modal={!aiPage && aiOverlay} standalone={aiPage} onClose={closeAi} language={language} error />}><Suspense fallback={<AiPanelFallback open={aiOpen || aiPage} modal={!aiPage && aiOverlay} standalone={aiPage} onClose={closeAi} language={language} />}><AiChatPanel workspace={workspace} screen={activeView === 'ai' ? 'settings' : activeView} open={aiOpen || aiPage} modal={!aiPage && aiOverlay} standalone={aiPage} onClose={closeAi} settingsHref={buildWorkspaceHref('ai', workspace, query, { area: 'ai', section: 'connections', demo: null })} language={language} /></Suspense></TestingRouteBoundary>}
        </section>
        {!aiPage && aiOpen && aiOverlay && <div className="wm-ai-backdrop" aria-hidden="true" onClick={closeAi} />}
      </div>
    </FxReplayContext.Provider></TestingLocaleProvider>
  )
}
