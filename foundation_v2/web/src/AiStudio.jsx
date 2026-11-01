import AppIcon from './AppIcon.jsx'

export function AiPageHeader({ id, title, description, children }) {
  return <header className="ai-page-heading">
    <div><h1 id={id}>{title}</h1>{description && <p>{description}</p>}</div>
    {children && <div className="ai-page-actions">{children}</div>}
  </header>
}

// tone: positive | warning | muted
export function AiStatus({ tone = 'muted', children, role }) {
  return <span className={`ai-status is-${tone}`} role={role}><span className="ai-status-dot" aria-hidden="true" />{children}</span>
}

export function AiPanelState({ icon = 'sparkles', title, message, alert = false, busy = false, children, className = '' }) {
  return <section className={`ai-gateway-state ${className}`} role={alert ? 'alert' : 'status'} aria-busy={busy || undefined}>
    <AppIcon name={icon} size={24} className="ai-gateway-state-icon" />
    <h1>{title}</h1>
    <p>{message}</p>
    {children && <div>{children}</div>}
  </section>
}
