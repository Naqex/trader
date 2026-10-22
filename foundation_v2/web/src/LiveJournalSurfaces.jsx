import { useEffect, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { dealNet } from './liveWorkspaceModel.js'
import { tagResults } from './liveLedgerModel.js'
import { downloadLiveCsv } from './LiveRecordDialog.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import LegacyModal from './LegacyModal.jsx'
import { MANUAL_TRADE_COLUMNS } from './liveTradeColumns.js'

function StrategyReference({ payload, strategies, workspace }) {
  if (!payload.playbook_id) return '—'
  const current = strategies.find(item => item.record_id === payload.playbook_id && item.revision === payload.playbook_revision)
  return <a href={buildWorkspaceHref('playbook',workspace,new URLSearchParams(),{area:'strategies',section:'my-strategies',playbook:payload.playbook_id,playbook_revision:payload.playbook_revision})}>{current?.payload.name || `Chiến lược #${payload.playbook_id.slice(0,8)}`} · v{payload.playbook_revision}</a>
}

export function ManualTrades({ columns = MANUAL_TRADE_COLUMNS.map(([key]) => key), deals, currency, strategies, workspace, filterKey, writable, onEdit }) {
  const { fmt } = useTestingLocale()
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [size, setSize] = useState(20)
  useEffect(() => setPage(1),[filterKey])
  const rows = deals.filter(deal => `${deal.symbol} ${deal.record.payload.tags.join(' ')} ${deal.record.payload.note}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => b.time_msc-a.time_msc)
  const pages = Math.max(1,Math.ceil(rows.length/size)), current = Math.min(page,pages)
  const shown = MANUAL_TRADE_COLUMNS.filter(([key]) => columns.includes(key))
  const cellValue = (deal, key) => {
    switch (key) {
      case 'time': return displayDate(deal.time_msc,{timeStyle:'short'})
      case 'asset': return deal.symbol
      case 'side': return `${deal.type === 0 ? 'Buy' : 'Sell'} · ${fmt(deal.volume,'',5)}`
      case 'strategy': return <StrategyReference payload={deal.record.payload} strategies={strategies} workspace={workspace} />
      case 'tags': return deal.record.payload.tags.join(', ') || '—'
      case 'net': return fmt(dealNet(deal))
    }
  }
  return <section className="live-broker"><div className="live-deals-toolbar"><h2>Giao dịch đã đóng · {rows.length}</h2><label className="live-search"><TestingIcon kind="search" /><input type="search" placeholder="Tìm sản phẩm, nhãn…" aria-label="Tìm giao dịch" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label></div>
    <div className="live-table-scroll" role="region" tabIndex={0} aria-label="Giao dịch thủ công"><table><thead><tr>{shown.map(([key,label]) => <th key={key}>{label}{key === 'net' && ` (${currency})`}</th>)}<th aria-label="Thao tác" /></tr></thead><tbody>
      {rows.slice((current-1)*size,current*size).map(deal => <tr key={deal.ticket}>{shown.map(([key]) => <td key={key} className={key === 'net' ? dealNet(deal) > 0 ? 'is-gain' : dealNet(deal) < 0 ? 'is-loss' : '' : ''}>{cellValue(deal,key)}</td>)}<td><button type="button" className="fxa-button" disabled={!writable} onClick={() => onEdit(deal.record)}>Chi tiết</button></td></tr>)}
      {!rows.length && <tr><td colSpan={shown.length + 1}>Chưa có giao dịch trong bộ lọc này.</td></tr>}
    </tbody></table></div><PaginationFooter label="Trang giao dịch" page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value => { setSize(value); setPage(1) }} sizes={[10,20,50,100]} meta={<button type="button" className="fxa-button" disabled={!rows.length} onClick={() => downloadLiveCsv(rows.map(item => item.record))}>Xuất CSV</button>} />
  </section>
}

export function JournalNotes({ records, accountId, strategies, writable, onEdit, onCreate }) {
  const [search,setSearch] = useState(''), [group,setGroup] = useState('all'), [readId,setReadId] = useState(null)
  const notes = records.filter(record => record.kind === 'note' && (!accountId || !record.payload.account_id || record.payload.account_id === accountId))
  const tags = [...new Set(notes.flatMap(record => record.payload.tags))]
  const activeGroup = tags.includes(group) ? group : 'all'
  const rows = notes.filter(record => (activeGroup === 'all' || record.payload.tags.includes(activeGroup))
    && `${record.payload.title} ${record.payload.note} ${record.payload.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const reading = notes.find(record => record.record_id === readId)
  return <section className="live-notes"><div className="live-toolbar"><button type="button" className="fxa-button is-primary" disabled={!writable} onClick={onCreate}>+ Ghi chú mới</button><div className="live-toolbar-actions"><label className="live-search"><TestingIcon kind="search" /><input type="search" aria-label="Tìm ghi chú" placeholder="Tìm ghi chú…" value={search} onChange={event => setSearch(event.target.value)} /></label><FxSelect label="Nhãn ghi chú" value={activeGroup} onChange={setGroup} options={[{value:'all',label:'Tất cả'},...tags.map(value => ({value,label:value,localize:false}))]} /></div></div>
    <div className="live-note-list">{rows.map(record => <button type="button" className="live-note-row" key={record.record_id} onClick={() => writable ? onEdit(record) : setReadId(record.record_id)}><strong>{record.payload.title}</strong><span>{record.payload.note}</span><small>{displayDate(record.updated_at_utc)}{record.payload.playbook_id && ` · ${strategies.find(item => item.record_id === record.payload.playbook_id && item.revision === record.payload.playbook_revision)?.payload.name || `Chiến lược #${record.payload.playbook_id.slice(0,8)}`} v${record.payload.playbook_revision}`} · {record.payload.tags.join(', ')}</small></button>)}{!rows.length && <div className="live-empty"><h2>{search || activeGroup !== 'all' ? 'Không tìm thấy ghi chú' : 'Chưa có ghi chú'}</h2><p>{search || activeGroup !== 'all' ? 'Thử từ khóa hoặc nhãn khác.' : 'Lưu quan sát và bài học sau mỗi giao dịch.'}</p></div>}</div>
    {reading && <LegacyModal className="live-record-dialog" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={reading.payload.title} onClose={() => setReadId(null)}><div className="live-record-form"><p className="live-muted">Chỉ đọc · tải lại dữ liệu trước khi chỉnh sửa.</p><p className="live-note-content">{reading.payload.note}</p><small className="live-muted">{displayDate(reading.updated_at_utc)} · {reading.payload.tags.join(', ') || 'Không có nhãn'}</small></div></LegacyModal>}
  </section>
}

export function JournalTags({ deals, currency }) {
  const { fmt } = useTestingLocale(), [search,setSearch] = useState('')
  const rows = tagResults(deals).filter(row => row.tag.toLowerCase().includes(search.toLowerCase()))
  const maximum = rows.reduce((max,item) => Math.max(max,Math.abs(item.net || 0)),1)
  return <section className="live-journal-tags"><div className="live-section-heading"><h2>PnL theo nhãn</h2><label className="live-search"><TestingIcon kind="search" /><input type="search" aria-label="Tìm nhãn" placeholder="Tìm nhãn…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    {rows.length ? <><div className="live-tag-bars">{rows.map(row => <div key={row.tag}><span>{row.tag}</span><div><i className={row.net < 0 ? 'is-loss' : row.net > 0 ? 'is-gain' : ''} style={{width:`${row.net === null ? 0 : Math.abs(row.net)/maximum*100}%`}} /></div><strong className={row.net < 0 ? 'is-loss' : row.net > 0 ? 'is-gain' : ''}>{fmt(row.net)}</strong></div>)}</div><div className="live-table-scroll" tabIndex={0} role="region" aria-label="Thống kê nhãn"><table><thead><tr><th>Nhãn</th><th>Giao dịch</th><th>Tỷ lệ thắng</th><th>PnL ròng ({currency})</th></tr></thead><tbody>{rows.map(row => <tr key={row.tag}><td>{row.tag}</td><td>{row.count}</td><td>{fmt(row.winRate,'%')}</td><td>{fmt(row.net)}</td></tr>)}</tbody></table></div><p className="live-muted">Một giao dịch có thể có nhiều nhãn; không cộng các nhóm thành tổng PnL.</p></> : <div className="live-empty"><h2>{search ? 'Không tìm thấy nhãn' : 'Chưa có phân tích nhãn'}</h2><p>{search ? 'Thử từ khóa khác hoặc xóa tìm kiếm.' : 'Thêm nhãn vào giao dịch để so sánh kết quả.'}</p></div>}
  </section>
}
