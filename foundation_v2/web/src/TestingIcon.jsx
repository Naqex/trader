import React from 'react'

export default function TestingIcon({ kind = 'info', size = 18 }) {
  const paths = {
    refresh: <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></>,
    sync: <><path d="M20 4v6h-6M4 20v-6h6"/><path d="M5.6 8a7 7 0 0 1 11.5-2L20 10M4 14l2.9 4A7 7 0 0 0 18.4 16"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    ledger: <><path d="M4 4h16v16H4ZM4 9h16M8 13h5m-5 4h8" /></>,
    trophy: <><path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    stop: <rect x="5" y="5" width="14" height="14" rx="1" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    play: <path d="m8 4 12 8-12 8Z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6" /></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    'chevron-left': <path d="m14 6-6 6 6 6" />,
    'chevron-right': <path d="m10 6 6 6-6 6" />,
    'chevrons-left': <path d="m11 6-6 6 6 6m8-12-6 6 6 6" />,
    'chevrons-right': <path d="m5 6 6 6-6 6m8-12 6 6-6 6" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m6-16v16" /></>,
    account: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18m-5 5h3" /></>,
    chart: <><path d="M4 4v16h16M7 15l4-5 4 3 5-7" /></>,
    tags: <><path d="m4 4 7 0 10 10-7 7L4 11Z" /><circle cx="8" cy="8" r="1" /></>,
  }
  if (paths[kind]) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
  if (kind === 'delete') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg>
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'plus' ? <path d="M12 5v14M5 12h14" /> : kind === 'journal' ? <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M11 8h6M11 12h6" /></> : kind === 'clock' ? <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></> : kind === 'history' ? <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l4 2" /></> : kind === 'trades' ? <><path d="M3 7h18l-4-4M21 17H3l4 4" /></> : kind === 'target' ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" /></>}</svg>
}
