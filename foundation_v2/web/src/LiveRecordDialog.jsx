import { useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import FxSelect from './FxSelect.jsx'
import ProjectDateInput from './ProjectDateInput.jsx'
import { saveLiveRecord } from './liveLedgerApi.js'
import { exportTradesCsv, parseTradesCsv } from './liveLedgerModel.js'
import { accountDraftErrors } from './liveAccountModel.js'

export function downloadLiveCsv(records = [], name = 'wmreplay-trades.csv') {
  const url = URL.createObjectURL(new Blob([exportTradesCsv(records)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function LiveRecordDialog({ workspace, kind, accounts, strategies, accountId, record, seed, onClose, onSaved }) {
  const initial = record?.payload || seed || {}
  const [draft, setDraft] = useState({ name: '', currency: 'USD', opening_balance: '', account_type:'', opening_at_utc:new Date().toISOString().slice(0,16), account_id: accountId || (kind === 'note' ? '' : accounts[0]?.record_id) || '',
    symbol: '', side: 'BUY', quantity: '1', opened_at_utc: new Date().toISOString().slice(0,16), closed_at_utc: new Date().toISOString().slice(0,16),
    entry_price: '', exit_price: '', gross_pnl: '', commission: '0', swap: '0', fee: '0', title: '', note: '',
    ...initial, ...(record && kind === 'account' ? {account_type:initial.account_type || '',opening_at_utc:new Date(initial.opening_at_utc || record.created_at_utc).toISOString().slice(0,19)} : {}), ...(record && kind === 'trade' ? Object.fromEntries(['opened_at_utc','closed_at_utc'].map(key => [key,new Date(initial[key]).toISOString().slice(0,19)])) : {}), tags: (initial.tags || []).join(', '), strategy: initial.playbook_id ? `${initial.playbook_id}:${initial.playbook_revision}` : '' })
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const [importRows, setImportRows] = useState([]), [importDone, setImportDone] = useState(0)
  const lock = useRef(false)
  const fileRead = useRef(0)
  const [touched,setTouched] = useState({})
  const accountErrors = kind === 'account' ? accountDraftErrors(draft) : {}
  const hint = key => touched[key] && accountErrors[key] ? <small id={`live-account-${key}-error`} className="live-field-error">{accountErrors[key]}</small> : null
  const accountField = (key,label,options={}) => <label>{label}<input aria-label={label} value={draft[key]} onChange={event=>change(key,event.target.value)} onBlur={()=>setTouched(current=>({...current,[key]:true}))} aria-invalid={Boolean(touched[key] && accountErrors[key])} aria-describedby={touched[key] && accountErrors[key] ? `live-account-${key}-error` : undefined} disabled={pending} {...options}/>{hint(key)}</label>
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  const titles = { account: 'Tài khoản ghi tay', trade: 'Giao dịch đã đóng', note: 'Ghi chú', import: 'Nhập giao dịch từ CSV' }
  const strategyOptions = strategies.map(item => ({ value: `${item.record_id}:${item.revision}`, label: `${item.payload.name} · v${item.revision}`, localize: false }))
  if (draft.strategy && !strategyOptions.some(item => item.value === draft.strategy)) strategyOptions.unshift({ value: draft.strategy, label: `Phiên bản đã lưu · v${initial.playbook_revision}`, localize: false })
  const field = (key, label, options = {}) => <label>{label}<input value={draft[key]} onChange={event => change(key,event.target.value)} disabled={pending} {...options} /></label>
  const selectAccount = <label>Tài khoản<FxSelect className="is-field" label="Tài khoản" localizeOptions={false} disabled={pending || importDone > 0 || Boolean(record && kind === 'trade')} value={draft.account_id} onChange={value => change('account_id',value)} options={[...(kind === 'note' ? [{value:'',label:'Ghi chú chung',localize:false}] : []),...accounts.map(item => ({ value:item.record_id,label:`${item.payload.name} · ${item.payload.currency}`,localize:false }))]} /></label>
  async function submit(event) {
    event.preventDefault()
    if (lock.current || uncertain) return
    lock.current = true; setPending(true); setError('')
    try {
      let payload
      const tags = [...new Set(draft.tags.split(',').map(tag => tag.trim()).filter(Boolean))]
      const chosen = draft.strategy ? draft.strategy.split(':') : []
      const strategy = chosen.length ? { playbook_id:chosen[0],playbook_revision:Number(chosen[1]) } : { playbook_id:null,playbook_revision:null }
      if (kind === 'account') {
        if (Object.keys(accountErrors).length) { setTouched(Object.fromEntries(Object.keys(accountErrors).map(key=>[key,true]))); return }
        payload = { name:draft.name.trim(), currency:draft.currency, opening_balance:draft.opening_balance, account_type:draft.account_type, opening_at_utc:new Date(`${draft.opening_at_utc.replace(/Z$/,'')}Z`).toISOString() }
      }
      else if (kind === 'note') payload = { title:draft.title.trim(),note:draft.note.trim(),tags,account_id:draft.account_id || null,...strategy }
      else if (kind === 'trade') payload = { ...Object.fromEntries(['account_id','symbol','side','quantity','entry_price','exit_price','gross_pnl','commission','swap','fee','note'].map(key => [key,draft[key]])),
        symbol:draft.symbol.trim().toUpperCase(), opened_at_utc:new Date(draft.opened_at_utc.endsWith('Z') ? draft.opened_at_utc : `${draft.opened_at_utc}Z`).toISOString(),
        closed_at_utc:new Date(draft.closed_at_utc.endsWith('Z') ? draft.closed_at_utc : `${draft.closed_at_utc}Z`).toISOString(),tags,...strategy }
      if (kind === 'import') {
        if (!draft.account_id || !importRows.length) throw new Error('Chọn tài khoản và tệp CSV trước khi nhập.')
        for (let index = importDone; index < importRows.length; index++) {
          const saved = await saveLiveRecord(workspace,'trade',{ ...importRows[index],account_id:draft.account_id,...strategy })
          onSaved(saved, false); setImportDone(index+1)
        }
        onClose()
      } else onSaved(await saveLiveRecord(workspace,kind,payload,record))
    } catch (problem) {
      setUncertain(problem.outcomeKnown === false)
      setError(problem.outcomeKnown === false ? 'Chưa xác nhận kết quả lưu. Tải lại sổ giao dịch để kiểm tra trước khi thao tác tiếp.' : problem.message || 'Không lưu được bản ghi.')
    } finally { lock.current = false; setPending(false) }
  }
  return <LegacyModal className={`live-record-dialog${kind === 'account' ? ' is-account' : ''}`} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={kind === 'account' ? record ? 'Sửa tài khoản' : 'Tạo tài khoản' : `${record ? 'Sửa ' : ''}${titles[kind]}`} onClose={() => { if (!lock.current) onClose() }}>
    <form className="live-record-form" onSubmit={submit} aria-busy={pending}>
      {kind === 'account' ? <>
        {accountField('name','Tên tài khoản',{required:true,maxLength:160,placeholder:'Tên tài khoản'})}
        <div className="live-record-grid">
          <label>Đơn vị tiền tệ<FxSelect searchable className="is-field" label="Đơn vị tiền tệ" localizeOptions={false} value={draft.currency} disabled={pending || Boolean(record)} onChange={value=>change('currency',value)} options={[...new Set(['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD','VND',draft.currency])].filter(Boolean).map(value=>({value,label:value}))}/></label>
          <label>Loại tài khoản<FxSelect className="is-field" label="Loại tài khoản" triggerContent={draft.account_type ? undefined : 'Chọn loại tài khoản'} value={draft.account_type} disabled={pending} onChange={value=>change('account_type',value)} options={[{value:'live',label:'Live',localize:false},{value:'demo',label:'Demo',localize:false},{value:'prop',label:'Prop firm',localize:false}]}/>{hint('account_type')}</label>
        </div>
        <fieldset className="live-initial-balance"><legend>Vốn ban đầu</legend><div className="live-record-grid">
          {accountField('opening_balance',`Số tiền (${draft.currency})`,{required:true,inputMode:'decimal',placeholder:'0.00'})}
          <label>Ngày vốn ban đầu (UTC)<ProjectDateInput type="datetime-local" utc required disabled={pending} value={draft.opening_at_utc.replace(/Z$/,'')} onChange={event=>change('opening_at_utc',event.target.value)}/>{hint('opening_at_utc')}</label>
        </div></fieldset>
      </> : <>
        <div className="live-record-grid">{selectAccount}{<label>Chiến lược<FxSelect label="Chiến lược" className="is-field" localizeOptions={false} disabled={pending || importDone > 0} value={draft.strategy} onChange={value => change('strategy',value)} options={[{ value:'',label:'Không gắn chiến lược',localize:false },...strategyOptions]} /></label>}</div>
        {kind === 'trade' && <>
          <div className="live-record-grid">{field('symbol','Sản phẩm',{required:true,maxLength:64})}<label>Chiều lệnh<FxSelect label="Chiều lệnh" className="is-field" value={draft.side} onChange={value => change('side',value)} disabled={pending} options={[{value:'BUY',label:'Buy'},{value:'SELL',label:'Sell'}]} /></label>{field('quantity','Khối lượng',{required:true,inputMode:'decimal',pattern:'[0-9]+(\\.[0-9]{1,12})?'})}</div>
          <div className="live-record-grid"><label>Thời gian mở (UTC)<ProjectDateInput type="datetime-local" utc required disabled={pending} value={draft.opened_at_utc.replace(/Z$/,'')} onChange={event => change('opened_at_utc',event.target.value)} /></label><label>Thời gian đóng (UTC)<ProjectDateInput type="datetime-local" utc required disabled={pending} value={draft.closed_at_utc.replace(/Z$/,'')} onChange={event => change('closed_at_utc',event.target.value)} /></label>{field('entry_price','Giá vào',{required:true,inputMode:'decimal'})}{field('exit_price','Giá đóng',{required:true,inputMode:'decimal'})}</div>
          <div className="live-record-grid">{field('gross_pnl','PnL gộp',{required:true,inputMode:'decimal'})}{field('commission','Hoa hồng',{required:true,inputMode:'decimal'})}{field('swap','Swap',{required:true,inputMode:'decimal'})}{field('fee','Phí khác',{required:true,inputMode:'decimal'})}</div>
          <p className="live-muted">Số tiền theo đơn vị tài khoản. Phí thu ghi số âm; hoàn phí ghi số dương.</p>
        </>}
        {kind === 'note' && field('title','Tiêu đề',{required:true,maxLength:160})}
        {kind !== 'import' ? <><label>Nhãn<input value={draft.tags} maxLength={2000} disabled={pending} onChange={event => change('tags',event.target.value)} placeholder="Ví dụ: London, phá vỡ" /></label><label>Ghi chú<textarea value={draft.note} required={kind === 'note'} rows={4} maxLength={10000} disabled={pending} onChange={event => change('note',event.target.value)} /></label></> : <>
          <button type="button" className="fxa-button" onClick={() => downloadLiveCsv([], 'wmreplay-trades-template.csv')}>Tải mẫu CSV</button>
          <label>Chọn tệp CSV<input type="file" accept=".csv,text/csv" disabled={pending || importDone > 0} onChange={async event => {
            const request = ++fileRead.current
            setError(''); setImportRows([])
            const file = event.target.files[0]
            if (!file) return
            try { if (file.size > 1_000_000) throw new Error('Tệp CSV tối đa 1 MB.'); const rows = parseTradesCsv(await file.text()); if (request === fileRead.current) setImportRows(rows) } catch(problem) { if (request === fileRead.current) setError(problem.message) }
          }} /></label>
          {importRows.length > 0 && <div className="live-import-review"><strong>{importRows.length} giao dịch · {importDone} đã lưu</strong><p>{importRows.slice(0,3).map(row => `${row.symbol} ${row.side} · ${row.gross_pnl}`).join(' / ')}</p></div>}
          <p className="live-muted">Thời gian UTC, phí có dấu. Các dòng được lưu lần lượt; nếu gặp lỗi, lần thử tiếp theo tiếp tục từ dòng chưa lưu.</p>
        </>}
      </>}
      {error && <p role="alert" className="live-record-error">{error}</p>}
      <footer className="live-dialog-footer"><button type="button" className="fxa-button" disabled={pending} onClick={onClose}>Hủy</button><button className="fxa-button is-primary" disabled={pending || uncertain || kind === 'account' && Object.keys(accountErrors).length > 0 || ['trade','import'].includes(kind) && !draft.account_id || kind === 'import' && !importRows.length}>{pending ? 'Đang lưu…' : kind === 'import' ? 'Nhập giao dịch' : kind === 'account' ? record ? 'Lưu thay đổi' : 'Tạo tài khoản' : 'Lưu'}</button></footer>
    </form>
  </LegacyModal>
}
