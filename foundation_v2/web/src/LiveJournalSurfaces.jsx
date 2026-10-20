import { useEffect, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { dealNet } from './liveWorkspaceModel.js'
import { tagResults } from './liveLedgerModel.js'
import { downloadLiveCsv } from './LiveRecordDialog.jsx'
import { manualSnapshot } from './liveLedgerModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'

function StrategyReference({ payload, strategies, workspace }) {
  if (!payload.playbook_id) return '—'
  const current = strategies.find(item => item.record_id === payload.playbook_id && item.revision === payload.playbook_revision)
  return <a href={buildWorkspaceHref('playbook',workspace,new URLSearchParams(),{area:'strategies',section:'my-strategies',playbook:payload.playbook_id,playbook_revision:payload.playbook_revision})}>{current?.payload.name || `Chiến lược #${payload.playbook_id.slice(0,8)}`} · v{payload.playbook_revision}</a>
}

export function ManualTrades({ deals, currency, strategies, workspace, filterKey, writable, onEdit }) {
  const { fmt } = useTestingLocale()
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [size, setSize] = useState(20)
  useEffect(() => setPage(1),[filterKey])
  const rows = deals.filter(deal => `${deal.symbol} ${deal.record.payload.tags.join(' ')} ${deal.record.payload.note}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => b.time_msc-a.time_msc)
  const pages = Math.max(1,Math.ceil(rows.length/size)), current = Math.min(page,pages)
  return <section className="live-broker"><div className="live-deals-toolbar"><h2>Giao dịch đã đóng · {rows.length}</h2><label className="live-search"><TestingIcon kind="search" /><input type="search" placeholder="Tìm sản phẩm, nhãn…" aria-label="Tìm giao dịch" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label></div>
    <div className="live-table-scroll" role="region" tabIndex={0} aria-label="Giao dịch ghi tay"><table><thead><tr>{['Đóng lệnh (UTC)','Sản phẩm','Chiều / Khối lượng','Chiến lược','Nhãn',`PnL ròng (${currency})`,''].map((label,index) => <th key={index}>{label}</th>)}</tr></thead><tbody>
      {rows.slice((current-1)*size,current*size).map(deal => <tr key={deal.ticket}><td>{displayDate(deal.time_msc,{timeStyle:'short'})}</td><td>{deal.symbol}</td><td>{deal.type === 0 ? 'Buy' : 'Sell'} · {fmt(deal.volume,'',5)}</td><td><StrategyReference payload={deal.record.payload} strategies={strategies} workspace={workspace} /></td><td>{deal.record.payload.tags.join(', ') || '—'}</td><td className={dealNet(deal) > 0 ? 'is-gain' : dealNet(deal) < 0 ? 'is-loss' : ''}>{fmt(dealNet(deal))}</td><td><button type="button" className="fxa-button" disabled={!writable} onClick={() => onEdit(deal.record)}>Chi tiết</button></td></tr>)}
      {!rows.length && <tr><td colSpan={7}>Chưa có giao dịch trong bộ lọc này.</td></tr>}
    </tbody></table></div><PaginationFooter label="Trang giao dịch" page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value => { setSize(value); setPage(1) }} sizes={[10,20,50,100]} meta={<button type="button" className="fxa-button" disabled={!rows.length} onClick={() => downloadLiveCsv(rows.map(item => item.record))}>Xuất CSV</button>} />
  </section>
}

export function JournalNotes({ records, accountId, strategies, writable, onEdit, onCreate }) {
  const [search,setSearch] = useState(''), [group,setGroup] = useState('all')
  const rows = records.filter(record => record.kind === 'note' && (!accountId || !record.payload.account_id || record.payload.account_id === accountId)
    && `${record.payload.title} ${record.payload.note} ${record.payload.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const tags = [...new Set(rows.flatMap(record => record.payload.tags))]
  return <section className="live-notes"><div className="live-toolbar"><button type="button" className="fxa-button is-primary" disabled={!writable} onClick={onCreate}>+ Ghi chú mới</button><div className="live-toolbar-actions"><label className="live-search"><TestingIcon kind="search" /><input type="search" aria-label="Tìm ghi chú" placeholder="Tìm ghi chú…" value={search} onChange={event => setSearch(event.target.value)} /></label><FxSelect label="Nhãn ghi chú" value={group} onChange={setGroup} options={[{value:'all',label:'Tất cả'},...tags.map(value => ({value,label:value,localize:false}))]} /></div></div>
    <div className="live-note-list">{rows.filter(record => group === 'all' || record.payload.tags.includes(group)).map(record => <button type="button" className="live-note-row" key={record.record_id} disabled={!writable} onClick={() => onEdit(record)}><strong>{record.payload.title}</strong><span>{record.payload.note}</span><small>{displayDate(record.updated_at_utc)}{record.payload.playbook_id && ` · ${strategies.find(item => item.record_id === record.payload.playbook_id && item.revision === record.payload.playbook_revision)?.payload.name || `Chiến lược #${record.payload.playbook_id.slice(0,8)}`} v${record.payload.playbook_revision}`} · {record.payload.tags.join(', ')}</small></button>)}{!rows.filter(record => group === 'all' || record.payload.tags.includes(group)).length && <div className="live-empty"><h2>{search || group !== 'all' ? 'Không tìm thấy ghi chú' : 'Chưa có ghi chú'}</h2><p>Lưu quan sát và bài học sau mỗi giao dịch.</p></div>}</div>
  </section>
}

export function JournalTags({ deals, currency }) {
  const { fmt } = useTestingLocale(), [search,setSearch] = useState('')
  const rows = tagResults(deals).filter(row => row.tag.toLowerCase().includes(search.toLowerCase()))
  return <section className="live-journal-tags"><div className="live-section-heading"><h2>PnL theo nhãn</h2><label className="live-search"><TestingIcon kind="search" /><input type="search" aria-label="Tìm nhãn" placeholder="Tìm nhãn…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    {rows.length ? <><div className="live-tag-bars">{rows.map(row => <div key={row.tag}><span>{row.tag}</span><div><i className={row.net < 0 ? 'is-loss' : 'is-gain'} style={{width:`${row.net === null ? 0 : Math.abs(row.net)/Math.max(1,...rows.map(item => Math.abs(item.net || 0)))*100}%`}} /></div><strong className={row.net < 0 ? 'is-loss' : 'is-gain'}>{fmt(row.net)}</strong></div>)}</div><div className="live-table-scroll" tabIndex={0} role="region" aria-label="Thống kê nhãn"><table><thead><tr><th>Nhãn</th><th>Giao dịch</th><th>Tỷ lệ thắng</th><th>PnL ròng ({currency})</th></tr></thead><tbody>{rows.map(row => <tr key={row.tag}><td>{row.tag}</td><td>{row.count}</td><td>{fmt(row.winRate,'%')}</td><td>{fmt(row.net)}</td></tr>)}</tbody></table></div><p className="live-muted">Một giao dịch có thể có nhiều nhãn; không cộng các nhóm thành tổng PnL.</p></> : <div className="live-empty"><h2>Chưa có phân tích nhãn</h2><p>Thêm nhãn vào giao dịch để so sánh kết quả.</p></div>}
  </section>
}

export function ManualAccounts({ accounts, records, writable, onEdit, onSelect, onCreate }) {
  const { fmt } = useTestingLocale()
  return <section className="live-manual-accounts"><div className="live-section-heading"><h2>Tài khoản ghi tay</h2><button type="button" className="fxa-button is-primary" disabled={!writable} onClick={onCreate}>+ Tài khoản</button></div>{accounts.length ? <div className="live-table-scroll" role="region" tabIndex={0} aria-label="Tài khoản ghi tay"><table><thead><tr><th>Tên tài khoản</th><th>Tiền tệ</th><th>Số dư ban đầu</th><th>Số dư đã ghi</th><th>Giao dịch</th><th /></tr></thead><tbody>{accounts.map(account => <tr key={account.record_id}><td><button type="button" className="live-text-action" onClick={() => onSelect(account.record_id)}>{account.payload.name}</button></td><td>{account.payload.currency}</td><td>{fmt(Number(account.payload.opening_balance))}</td><td>{fmt(manualSnapshot(account,records).account.balance)}</td><td>{records.filter(record => record.kind === 'trade' && record.payload.account_id === account.record_id).length}</td><td><button type="button" className="fxa-button" disabled={!writable} onClick={() => onEdit(account)}>Sửa</button></td></tr>)}</tbody></table></div> : <div className="live-empty"><h2>Chưa có tài khoản</h2><p>Tạo tài khoản ghi tay để nhập và phân tích lịch sử giao dịch.</p></div>}</section>
}
