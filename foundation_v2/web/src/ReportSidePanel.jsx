import { useId, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './report-side-panel.css'

export default function ReportSidePanel({title,help,defaultCollapsed=false,enabled=true,children}) {
  const {t}=useTestingLocale(),id=useId(),[collapsed,setCollapsed]=useState(defaultCollapsed)
  if(!enabled)return <section className="live-metrics" aria-label={t(title)}>{children}</section>
  return <section className={`live-analytics-side wm-report-side-panel${collapsed?' is-collapsed':''}`} aria-label={t(title)}>
    <h2><button type="button" className="wm-report-panel-toggle" aria-label={t(collapsed?'Expand panel {name}':'Collapse panel {name}',{name:t(title)})} aria-controls={id} aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}><ChartIcon name={collapsed?'panel-open':'panel-close'}/></button><span className="live-analytics-title">{t(title)}</span>{help && <button type="button" className="wm-report-panel-info" aria-label={t(help)} data-tooltip={t(help)}><ChartIcon name="info"/></button>}</h2>
    <div id={id} className="wm-report-panel-body" hidden={collapsed}>{children}</div>
  </section>
}
