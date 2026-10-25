import { useEffect, useState } from 'react'
import ChartPositionsPanel from './ChartPositionsPanel.jsx'
import LegacyModal from './LegacyModal.jsx'
import { TestingEmptyState } from './TestingPageState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import PaginationFooter from './PaginationFooter.jsx'

const EMPTY = []
export default function Mt5Positions({ snapshot, active, ledgerEvent, canAct, capability, onAction, theme }) {
  const { t, fmt } = useTestingLocale()
  const [tab, setTab] = useState('positions'), [selected, setSelected] = useState(null)
  const [page,setPage] = useState(1), [size,setSize] = useState(10)
  useEffect(()=>{setPage(1);setSelected(null)},[tab,snapshot?.account?.login,snapshot?.account?.server])
  useEffect(() => { if (ledgerEvent?.sequence) { setTab(ledgerEvent.tab);setSelected(null) } }, [ledgerEvent?.sequence])
  if (!active) return null
  const rows = snapshot?.[tab] || EMPTY
  const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages),visible=rows.slice((current-1)*size,current*size)
  const detail = selected && snapshot?.[selected.tab]?.find(item => String(item.ticket) === selected.ticket)
  const money = value => Number.isFinite(value) ? fmt(value, snapshot?.account?.currency ? ` ${snapshot.account.currency}` : '') : '-'
  const actions = (item, pending) => pending
    ? <button type="button" className="live-text-action" disabled={!canAct || !capability('cancel') || item.managed === false} onClick={() => onAction('cancel',{ ticket:item.ticket,symbol:item.symbol },'Hủy lệnh chờ MT5')}>{t('Hủy lệnh')}</button>
    : <><button type="button" className="live-text-action" disabled={!canAct || !capability('protect') || item.managed === false} onClick={() => onAction('protect',{ ticket:item.ticket,symbol:item.symbol,stop_loss:item.sl || '',take_profit:item.tp || '' },'Sửa SL/TP')}>{t('Sửa SL/TP')}</button><button type="button" className="live-text-action" disabled={!canAct || !capability('close') || item.managed === false} onClick={() => onAction('close',{ ticket:item.ticket,symbol:item.symbol },'Đóng vị thế MT5')}>{t('Đóng vị thế')}</button></>
  return <>
    <ChartPositionsPanel label="Quản lý lệnh MT5" prefix="mt5-position" panelId="mt5-position-panel" tab={tab} onTab={setTab}
      tabs={[["positions","Vị thế đang mở"],["orders","Lệnh chờ"],["requests","Yêu cầu"]]}>
      {!rows.length ? <TestingEmptyState kind={snapshot?.status === 'ready' ? `mt5-${tab}` : 'mt5-unknown'} /> : <div className="legacy-position-scroll" tabIndex={0} role="region" aria-label={t('Quản lý lệnh MT5')}>
        {tab === 'requests' ? <table><thead><tr>{['Mã yêu cầu','Thao tác','Trạng thái'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{visible.map(item => <tr key={item.request_id}><td>{item.request_id}</td><td>{t(({ place:'Place order',close:'Close position',protect:'Update SL/TP',cancel:'Cancel pending order',pause:'Pause new orders',resume:'Resume new orders' })[item.action || item.operation] || item.action || item.operation || '-')}</td><td>{t(({ filled:'Đã khớp',accepted:'Đã tiếp nhận',rejected:'Bị từ chối',unknown:'Chưa rõ kết quả',done:'Hoàn tất',cancelled:'Đã hủy' })[item.status] || item.status)}</td></tr>)}</tbody></table>
          : <table><thead><tr>{['Ticket','Asset','Side','Lot','Entry price','SL / TP','PnL','Thao tác'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{visible.map(item => <tr key={item.ticket}><td><button type="button" className="mt5-ticket-link" aria-label={`${t('Chi tiết lệnh')} #${item.ticket}`} onClick={() => setSelected({ tab,ticket:String(item.ticket) })}>#{item.ticket}</button></td><td>{item.symbol}</td><td>{item.side}</td><td>{fmt(item.volume,'',8)}</td><td>{fmt(item.price_open,'',8)}</td><td>{fmt(item.sl || null,'',8)} / {fmt(item.tp || null,'',8)}</td><td>{money(item.profit)}</td><td><div className="live-terminal-row-actions">{actions(item,tab === 'orders')}</div></td></tr>)}</tbody></table>}
      </div>}
      {rows.length>0 && <PaginationFooter className="legacy-position-paging" label="Quản lý lệnh MT5" page={current} pages={pages} onPageChange={setPage} pageSize={size} sizes={[10,25,50]} onPageSizeChange={value=>{setSize(value);setPage(1)}}/>}
    </ChartPositionsPanel>
    {selected && <LegacyModal theme={theme} label={`${t('Chi tiết lệnh')} #${selected.ticket}`} className="mt5-ticket-details" onClose={() => setSelected(null)}>
      <div className="live-terminal-confirm-body">
        {detail ? <><p><strong>{snapshot?.mode === 'real' ? 'Real' : 'Demo'} · #{snapshot?.account?.login}</strong><br/>{snapshot?.account?.server}</p>
          <dl className="live-terminal-values">{[['Asset',detail.symbol],['Hướng',detail.side],['Khối lượng (lot)',fmt(detail.volume,'',8)],['Giá vào lệnh',fmt(detail.price_open,'',8)],['Stop loss',fmt(detail.sl || null,'',8)],['Take profit',fmt(detail.tp || null,'',8)],['Unrealized PnL',money(detail.profit)]].map(([label,value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>
          <footer>{actions(detail,selected.tab === 'orders')}</footer>
        </> : <p role="status">{t('Lệnh không còn trong ảnh chụp MT5 hiện tại.')}</p>}
      </div>
    </LegacyModal>}
  </>
}
