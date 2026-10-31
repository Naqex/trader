import {useState} from 'react'
import LegacyModal from './LegacyModal.jsx'
import ChartIcon from './ChartIcon.jsx'
import {useTestingLocale} from './testingLocale.jsx'
import {tradeGroupIssue} from './tradeGroupsModel.js'
import {displayDate} from './dateFormat.js'

export function TradeMergeDialog({trades,catalog,onClose,onSaved}){
  const {t,fmt}=useTestingLocale(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false)
  const issue=tradeGroupIssue(trades,catalog.items)
  const save=async()=>{setBusy(true);setError('');try{await catalog.mutate({action:'merge',members:trades.map(trade=>trade.member)});onSaved()}catch(error){setError(error.message);setConflict(Boolean(error.conflict))}finally{setBusy(false)}}
  return <LegacyModal theme={document.querySelector('.fx-app')?.dataset.theme||'dark'} label={t('Gộp giao dịch')} onClose={busy?()=>{}:onClose} className="wm-trade-merge-dialog">
    <div className="wm-trade-merge-body"><p>{t('Gộp {count} giao dịch thành một nhóm trong nhật ký.',{count:trades.length})}</p><p>{t('Giữ giao dịch nguồn, ghi chú và nhãn. Có thể tách nhóm sau.')}</p>
      <ul>{trades.map((trade,index)=><li key={index}><strong>{trade.symbol||'-'} · {t(trade.side==='BUY'?'Buy':'Sell')} · {fmt(trade.quantity,'',5)}</strong><span>{displayDate(trade.closedAt,{timeStyle:'short'})}</span></li>)}</ul>
      {(issue||error)&&<p role="alert">{t(error||issue)}</p>}
      <footer><button className="wm-button" type="button" disabled={busy} onClick={onClose}>{t('Hủy')}</button><button className="wm-button is-primary" type="button" disabled={busy||Boolean(issue)||conflict||catalog.status!=='ready'} onClick={save}>{t(busy?'Đang lưu…':'Gộp giao dịch')}</button></footer>
    </div>
  </LegacyModal>
}

export function TradeGroupRow({group,visibleCount,colSpan,expanded,onToggle,catalog,onSplit,stale}){
  const {t}=useTestingLocale(),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const split=async()=>{setBusy(true);setError('');try{await catalog.mutate({action:'split',id:group.id});onSplit?.()}catch(error){setError(error.message)}finally{setBusy(false)}}
  return <tr className="wm-trade-group-row"><td colSpan={colSpan}><div><button type="button" className="wm-button is-icon" aria-label={t(expanded?'Thu gọn nhóm giao dịch':'Mở rộng nhóm giao dịch')} aria-expanded={expanded} onClick={onToggle}><ChartIcon name={expanded?'chevron-down':'chevron-right'}/></button><strong>{stale?t('Nhóm cần kiểm tra'):`${group.symbol} · ${t(group.side==='BUY'?'Buy':'Sell')}`}</strong><span>{t('{count} giao dịch',{count:group.members.length})}{visibleCount<group.members.length?` · ${t('Hiển thị {count}/{total}',{count:visibleCount,total:group.members.length})}`:''}</span>
    {confirm?<><button type="button" className="wm-button" disabled={busy} onClick={()=>{setConfirm(false);setError('')}}>{t('Hủy')}</button><button type="button" className="wm-button" disabled={busy||catalog.status!=='ready'} onClick={split}>{t(busy?'Đang lưu…':'Xác nhận tách nhóm')}</button></>:<button type="button" className="wm-button" disabled={catalog.status!=='ready'} onClick={()=>setConfirm(true)}>{t('Tách nhóm')}</button>}
    {error&&<span role="alert">{t(error)}</span>}
  </div>{stale&&<p role="status">{t('Dữ liệu nguồn đã thay đổi. Tách nhóm để gộp lại.')}</p>}</td></tr>
}
