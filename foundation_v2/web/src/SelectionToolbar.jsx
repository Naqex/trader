import AppIcon from './AppIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import {useEffect,useRef} from 'react'
import './trade-journal-preview.css'

export default function SelectionToolbar({ label, summary, onClose, onSelectAll, allSelected=false, selectAllHint, clearHint, busy=false, actions=[] }) {
  const { t } = useTestingLocale()
  const root=useRef(null)
  useEffect(()=>{
    const bar=root.current,parent=bar.parentElement,previous=parent.style.getPropertyValue('--wm-selection-reserve')
    const reserve=()=>parent.style.setProperty('--wm-selection-reserve',`${bar.getBoundingClientRect().height+32}px`)
    reserve()
    const observer=new ResizeObserver(reserve);observer.observe(bar)
    return()=>{observer.disconnect();previous?parent.style.setProperty('--wm-selection-reserve',previous):parent.style.removeProperty('--wm-selection-reserve')}
  },[])
  return <div ref={root} className="wm-trade-selection-bar" role="region" aria-label={label} aria-busy={busy}>
    <div className="wm-trade-selection-head">
      <button type="button" className="wm-trade-selection-close" aria-label={t('Bỏ chọn')} disabled={busy} onClick={onClose}><AppIcon name="close" size={16} /></button>
      <strong role="status">{summary}</strong>
      <div className="wm-trade-selection-controls"><button type="button" className={allSelected?'wm-trade-selection-clear':'wm-trade-selection-all'} data-tooltip={allSelected?clearHint:selectAllHint} disabled={busy} onClick={allSelected?onClose:onSelectAll}>{t(allSelected?'Bỏ chọn tất cả':'Chọn tất cả')}</button></div>
    </div>
    {actions.length>0 && <div className="wm-trade-selection-actions">{actions.map(action=><button key={action.id} type="button" className={`wm-trade-selection-action${action.danger?' is-danger':''}`} disabled={busy || action.disabled} data-tooltip={action.hint} onClick={action.onClick}>{action.icon}{action.label}</button>)}</div>}
  </div>
}
