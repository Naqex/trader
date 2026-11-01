import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import LegacyModal from './LegacyModal.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import ProjectDateInput from './ProjectDateInput.jsx'
import { TestingResourceStatus } from './TestingPageState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { Metric } from './FxAnalytics.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import ReferenceDataTable from './ReferenceDataTable.jsx'
import ReferenceVirtualTable from './ReferenceVirtualTable.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import './component-reference.css'
import { DATA_STATES as dataStates } from './dataStates.js'
import { TradeBulkSelectionBar, TradeBulkTagsDialog } from './TradeJournalPreview.jsx'
import SelectionToolbar from './SelectionToolbar.jsx'
import ConfirmationDialog from './ConfirmationDialog.jsx'
import { NotificationSurface, useNotifications } from './Notifications.jsx'

function ReferenceTradeSelection() {
  const { t }=useTestingLocale()
  const [count,setCount]=useState(0),[tags,setTags]=useState(false),[account,setAccount]=useState(false)
  return <section id="trade-selection"><h2>{t("Thanh thao tác khi chọn giao dịch")}</h2>
    <p>{t("Dữ liệu minh họa. Thanh nằm dưới viewport; thao tác nhãn xuất hiện khi chọn từ hai giao dịch.")}</p>
    <div className="wm-reference-controls"><button type="button" className="wm-button" onClick={()=>{setAccount(false);setCount(1)}}>{t("Chọn 1 giao dịch mẫu")}</button><button type="button" className="wm-button" onClick={()=>{setAccount(false);setCount(2)}}>{t("Chọn 2 giao dịch mẫu")}</button><button type="button" className="wm-button" onClick={()=>{setCount(0);setAccount(true)}}>{t("Chọn 1 tài khoản mẫu")}</button></div>
    {count>0 && <TradeBulkSelectionBar count={count} allSelected={count===2} onClose={()=>setCount(0)} onSelectAll={()=>setCount(2)} onTags={()=>setTags(true)}/>}
    {account && <SelectionToolbar label={t("Thao tác tài khoản minh họa")} summary={t("Đã chọn 1 tài khoản mẫu")} allSelected onClose={()=>setAccount(false)} onSelectAll={()=>setAccount(true)} actions={[{id:'example',label:'Bỏ chọn tài khoản mẫu',onClick:()=>setAccount(false)}]}/>}
    {tags && <TradeBulkTagsDialog count={count} groups={[{id:'demo-setup',name:'Setup'}]} labels={[{id:'demo-breakout',name:'Breakout',group_id:'demo-setup'}]} onClose={()=>setTags(false)}/>}
  </section>
}

const sizes = [
  ['Nút / ô nhập thường','control','Thon gọn trên máy tính'], ['Nút icon','icon-button','Icon nằm giữa vùng bấm'],
  ['Vùng bấm cảm ứng','touch','Dễ chạm, không thu nhỏ để ép vừa màn hình'], ['Tab trong cụm','tab','Chọn loại, không phải nút gửi'],
  ['Thanh điều hướng','nav','Gạch dưới cho trang đang mở'], ['Icon nhỏ','icon-small','Trong bảng, mũi tên, nút icon'],
  ['Icon thường','icon','Bên cạnh chữ'], ['Icon điều hướng','icon-nav','Sidebar / navigation'], ['Icon minh hoạ','icon-large','Lối tắt lớn'],
  ['Chữ phụ','font-meta','Nội dung cần đọc không nhỏ hơn 12px'], ['Chữ nút / bảng','font-control','Dòng chữ cao 20px'],
  ['Nội dung','font-body','Dòng cao khoảng 21px'], ['Tiêu đề cụm','font-section','Đậm vừa'], ['Tiêu đề dialog','font-dialog','Không lấn át nội dung'],
  ['Tiêu đề trang','font-page','Một tiêu đề chính'], ['Số tổng quan','font-value','Số và đơn vị cùng hàng'],
  ['Bo ô nhập','radius-field','Rõ hình ô'], ['Bo menu / dialog','radius-menu','Một lớp nổi'], ['Thanh tiến độ','progress','Chỉ hiện số thật'],
  ['Hàng bảng tối thiểu','row','Nhiều nội dung được cao hơn'], ['Lề trang','page-gutter','Máy tính 24px, tablet 20px, điện thoại 16px'],
  ['Lề dialog','dialog-gutter','Điện thoại 16px'], ['Khoảng icon và chữ','space-2','Cũng là khoảng giữa nút cùng nhóm'],
  ['Khoảng giữa cụm','space-6','Phân nhóm bằng khoảng trống'], ['Khoảng giữa khu vực','space-8','Không cần thêm card'],
  ['Dialog nhỏ','dialog-small','Xác nhận ngắn'], ['Dialog vừa','dialog-medium','Biểu mẫu đơn giản'], ['Dialog lớn','dialog-large','Tạo phiên'], ['Drawer','drawer','Chi tiết cạnh phải'],
]
const productSizeTokens = {
  control:'--wm-control-height', 'icon-button':'--wm-icon-action-size', row:'--wm-table-row',
  'page-gutter':'--wm-page-gutter', 'dialog-gutter':'--wm-dialog-gutter',
  'space-6':'--wm-space-group', 'space-8':'--wm-space-section',
}
const motions = [['Hover','hover','Đổi màu, không đổi kích thước'], ['Nhấn','press','Phản hồi ngay, không nảy'], ['Menu','menu','Mờ dần + dịch 4px'], ['Dialog','dialog','Mờ dần + dịch 4px'], ['Drawer','drawer','Trượt 4px từ bên phải'], ['Tiến độ','progress','Nối nhẹ hai số đo'], ['Loading','loading','Nhịp nhẹ, giữ bố cục']]
const colors = [['action','Cam','Tạo phiên, áp dụng'], ['primary','Xanh biển','Focus, tiến độ, thông tin'], ['positive','Xanh lá','Thành công, lãi'], ['negative','Đỏ chữ','Lỗi, lỗ'], ['danger-action','Đỏ nền','Xoá: chữ trắng'], ['warning','Vàng','Cảnh báo'], ['hover','Hover control','Khác nền dòng'], ['row-hover','Hover dòng','Nhẹ để đọc dữ liệu'], ['row-selected','Dòng đã chọn','Khác hover nút'], ['text','Chữ chính','Nội dung'], ['muted','Chữ phụ','Vẫn đủ tương phản'], ['border','Viền','Phân tách cấu trúc'], ['report-violet','Tím','Chuỗi biểu đồ bổ sung'], ['report-gold','Vàng biểu đồ','Chuỗi so sánh bổ sung']]
function ReferenceDataFlow() {
  const { t }=useTestingLocale()
  const [flow,setFlow]=useState('no-sessions')
  const rootStates={loading:'Đang đọc dữ liệu phiên…', 'no-sessions':'Chưa có phiên. Tạo phiên đầu tiên để bắt đầu luyện tập.', error:'Không tải được dữ liệu phiên. Thử lại trước khi xem kết quả.'}
  return <section id="data-flow"><h2>{t("Trạng thái theo luồng dữ liệu")}</h2><p>{t("Mẫu minh hoạ Tổng quan: các cụm này cùng cần phiên; biểu đồ có bước đọc/tính riêng nên có thể lỗi riêng. Nguồn không phụ thuộc phiên, ví dụ danh mục tài sản, vẫn hoạt động ngoài cụm này.")}</p>
    <FxSelect label={t("Luồng Tổng quan minh hoạ")} value={flow} onChange={setFlow} options={[
      ['loading','Đang đọc phiên'],['no-sessions','Chưa có phiên'],['no-trades','Có phiên, chưa giao dịch'],['ready','Có kết quả'],['component-error','Một biểu đồ lỗi riêng'],['error','Nguồn phiên lỗi'],
    ].map(([value,label])=>({value,label}))} />
    <div className="wm-reference-flow" data-testid="reference-data-flow" aria-busy={flow==='loading'}>
      {rootStates[flow] ? flow==='loading' ? <TestingSkeleton rows={2} label={rootStates[flow]} /> : <TestingReadState message={rootStates[flow]} error={flow==='error'} onRetry={flow==='error'?()=>setFlow('ready'):undefined} /> : <>
        <h3>{t("Phiên mẫu · minh hoạ")}</h3><p>{t("Đã có phiên: tên, tài sản và thời gian luyện tập vẫn có thể hiển thị.")}</p>
        {flow==='no-trades' ? <TestingReadState message="Chưa có giao dịch đóng. Giao dịch đầu tiên sẽ tạo dữ liệu kết quả." /> : <div className="wm-reference-layout-grid"><div><h3>{t("Kết quả chung")}</h3><p>{t("KPI và biểu đồ cùng nguồn tiếp tục hiển thị.")}</p></div><div><h3>{t("Biểu đồ cùng phiên, đọc riêng")}</h3>{flow==='component-error' ? <TestingReadState error message="Không tải được biểu đồ này; kết quả chung vẫn dùng được." onRetry={()=>setFlow('ready')} /> : <p>{t("Nguồn biểu đồ sẵn sàng.")}</p>}</div></div>}
      </>}
    </div>
    <div className="wm-reference-table-scroll"><table className="wm-reference-table"><thead><tr><th>{t("Trạng thái / tình huống")}</th><th>{t("Cách hiển thị")}</th></tr></thead><tbody>{dataStates.map(([key,label,note])=><tr key={key}><td>{t(label)}<small> · {key}</small></td><td>{t(note)}</td></tr>)}</tbody></table></div>
    <p>{t("6 trạng thái nền; refreshing/filtered là tình huống, stale/partial/unknown bổ sung độ mới và độ đầy đủ. Một cụm có thể vừa có dữ liệu vừa đang cập nhật.")}</p>
  </section>
}
function ReferenceOverlays({ theme }) {
  const { t }=useTestingLocale()
  const [depth, setDepth] = useState(0), [anchor, setAnchor] = useState(null)
  const [side, setSide] = useState('buy'), [date, setDate] = useState('2026-10-20T10:30')
  const [sides,setSides]=useState(['buy'])
  const [disabled, setDisabled] = useState(false)
  const [day,setDay] = useState('2026-10-20'),[time,setTime] = useState('10:30:45'),[range,setRange] = useState({from:'2026-10-20',to:'2026-10-25'})
  const choices = [{ value:'buy', label:'Buy' }, { value:'sell', label:'Sell' }, { value:'locked', label:'Chưa khả dụng', disabled:true }]
  const controls = <div className="wm-reference-overlay-fields">
    <label>{t("Hướng lệnh mẫu")}<FxSelect className="is-field" label={t("Hướng lệnh trong dialog")} value={side} onChange={setSide} options={choices} disabled={disabled} /></label>
    <label>{t("Thời điểm mẫu")}<ProjectDateInput clearable aria-label={t("Thời điểm trong dialog")} type="datetime-local" value={date} onChange={event => setDate(event.target.value)} min="2026-10-20T09:00" max="2026-10-20T17:00" disabled={disabled} /></label>
    <label>{t("Ngày mẫu")}<ProjectDateInput clearable aria-label={t("Ngày trong dialog")} value={day} onChange={event=>setDay(event.target.value)} disabled={disabled}/></label>
    <label>{t("Giờ mẫu")}<ProjectDateInput clearable aria-label={t("Giờ trong dialog")} type="time" step="1" value={time} onChange={event=>setTime(event.target.value)} disabled={disabled}/></label>
    <label>{t("Khoảng ngày mẫu")}<ProjectDateInput clearable aria-label={t("Khoảng ngày trong dialog")} range value={range} onChange={event=>setRange(event.target.value)} disabled={disabled}/></label>
    <label><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} />{t("Khoá ô nhập mẫu")}</label>
    <label><input type="checkbox" defaultChecked disabled />{t("Lựa chọn đã khoá")}</label>
    <label>{t("Nhiều lựa chọn trong dialog")}<FxSelect label={t("Nhiều lựa chọn trong dialog")} multiple value={sides} options={choices} onChange={setSides} /></label>
    <div className="wm-reference-controls"><button type="button" className="wm-button" onClick={event => setAnchor(event.currentTarget)}>{t("Mở popover mẫu")}</button><button type="button" className="wm-button" onClick={() => setDepth(2)}>{t("Mở dialog con")}</button><button type="button" className="wm-button is-icon" aria-label={t("Trợ giúp trong dialog")} data-tooltip={t("Tooltip vẫn hiển thị phía trên dialog và giữ focus tại nút mở.")}><TestingIcon kind="info" /></button></div>
  </div>
  return <section id="overlays"><h2>{t("Dialog, popover và focus")}</h2><p>{t("Escape đóng lớp đang thao tác; Tab giữ trong dialog, mũi tên di chuyển lựa chọn. Đóng lớp trả focus về nút mở. Popup theo control khi cuộn và tránh mép màn hình.")}</p>
    <div className="wm-reference-controls"><button type="button" className="wm-button is-primary" onClick={() => setDepth(1)}>{t("Mở dialog tương tác")}</button><button type="button" className="wm-button" onClick={event => setAnchor(event.currentTarget)}>{t("Mở menu bám nút")}</button><TestingResourceStatus state="partial" resource={t("Dữ liệu mẫu")} /></div>
    {depth > 0 && <LegacyModal theme={theme} label={t("Dialog tương tác mẫu")} onClose={() => { setDepth(0); setAnchor(null) }} className="wm-reference-portal-dialog">{controls}<footer><button type="button" className="wm-button is-primary" onClick={() => setDepth(0)}>{t("Hoàn tất mẫu")}</button></footer></LegacyModal>}
    {depth === 2 && <LegacyModal theme={theme} label={t("Dialog con mẫu")} onClose={() => setDepth(1)} className="wm-reference-portal-dialog"><p>{t("Đóng lớp này để quay lại biểu mẫu.")}</p><footer><button type="button" className="wm-button" onClick={() => setDepth(1)}>{t("Quay lại mẫu")}</button></footer></LegacyModal>}
    {anchor && <LegacyPopover anchor={anchor} theme={theme} label={t("Menu tương tác mẫu")} onClose={() => setAnchor(null)}><button type="button" aria-pressed={side === 'buy'} onClick={() => { setSide('buy'); setAnchor(null) }}>{t("Buy")}</button><button type="button" disabled>{t("Chưa khả dụng")}</button><button type="button" aria-pressed={side === 'sell'} onClick={() => { setSide('sell'); setAnchor(null) }}>{t("Sell")}</button></LegacyPopover>}
  </section>
}
function ReferenceReportPatterns() {
  const { t }=useTestingLocale()
  return <section id="report-patterns"><h2>{t("KPI, card và biểu đồ báo cáo")}</h2><p>{t("Mẫu bố cục với dữ liệu minh hoạ. Card tĩnh không có hover giả; chart giao dịch có bộ quy tắc riêng.")}</p>
    <div className="wm-reference-report-grid">
      <div className="wm-reference-report-card"><h3>{t("KPI dạng card")}</h3><Metric label={t("Kết quả minh hoạ")} value="$1.234,50" note={t("28px cho giá trị, 12px cho ghi chú")} tone="is-positive" /></div>
      <div className="wm-reference-report-card"><h3>{t("Card nội dung")}</h3><p>{t("Một cụm thông tin có tiêu đề và nội dung liên quan. Không cần lồng thêm card.")}</p><small>{t("Padding 24px desktop, 16px mobile · bo12px · viền1px.")}</small></div>
      <div className="wm-reference-report-card"><h3>{t("Xu hướng · minh hoạ")}</h3><p className="wm-reference-report-caption">{t("Số bản ghi theo tuần · không phải dữ liệu trading")}</p><svg className="wm-reference-report-chart" viewBox="0 0 320 160" role="img" aria-label={t("Dữ liệu minh hoạ: tuần 1 có2 bản ghi, tuần 2 có4, tuần 3 có3, tuần 4 có6")}><title>{t("Xu hướng minh hoạ, đơn vị bản ghi")}</title>{[20,60,100,140].map((y,i)=><g key={y}><line x1="32" x2="310" y1={y} y2={y} className="is-grid" /><text x="22" y={y+4} textAnchor="end">{6-i*2}</text></g>)}<polyline points="42,100 126,60 210,80 294,20" className="is-series" />{[[42,100],[126,60],[210,80],[294,20]].map(([x,y],i)=><g key={x}><circle cx={x} cy={y} r="3" className="is-point" /><text x={x} y="157" textAnchor="middle">{t('T{number}',{number:i+1})}</text></g>)}</svg><div className="wm-reference-report-labels"><span>{t("T1 · 2")}</span><span>{t("T2 · 4")}</span><span>{t("T3 · 3")}</span><span>{t("T4 · 6")}</span></div><small>{t("Đường2px · chữ trục12px · một màu cho cùng một chuỗi.")}</small></div>
    </div>
    <p>{t("KPI dạng strip dùng khoảng cách/divider; card dùng surface khi cần phân nhóm. Chart có đơn vị, khoảng ngày, múi giờ và legend khi có nhiều chuỗi; không tô nền riêng cho từng thành phần con.")}</p>
  </section>
}
function SpecTable({ rows, tokens, prefix='--ds-', overrides={} }) {
  const { t }=useTestingLocale()
  return <div className="wm-reference-table-scroll"><table className="wm-reference-table"><thead><tr><th>{t("Thành phần")}</th><th>{t("Thông số")}</th><th>{t("Cách dùng")}</th></tr></thead><tbody>{rows.map(([label,key,note]) => { const property=overrides[key] || prefix+key; return <tr key={key+label} data-token={property}><td>{t(label)}</td><td>{tokens[property] || '-'}</td><td>{note}</td></tr> })}</tbody></table></div>
}
function ReferenceFeedback() {
  const { t }=useTestingLocale(),notify=useNotifications()
  const [confirm,setConfirm]=useState(false),[tone,setTone]=useState('info')
  return <section id="feedback"><h2>{t("Xác nhận và thông báo")}</h2>
    <div className="wm-reference-controls"><button type="button" className="wm-button" data-testid="reference-confirm" onClick={()=>setConfirm(true)}>{t("Mở xác nhận mẫu")}</button><FxSelect label={t("Loại thông báo")} value={tone} onChange={setTone} options={[{value:'info',label:'Thông tin'},{value:'success',label:'Thành công'},{value:'warning',label:'Cảnh báo'},{value:'error',label:'Lỗi'}]}/><button type="button" className="wm-button" data-testid="reference-notify" onClick={()=>notify({title:'Thông báo mẫu',message:'Đây là dữ liệu minh hoạ; không có thay đổi được lưu.',tone})}>{t("Hiện thông báo mẫu")}</button></div>
    <NotificationSurface tone={tone} persistent className="wm-reference-feedback" role="status"><span className="wm-notification-mark" aria-hidden="true"><TestingIcon kind={{success:'success',warning:'warning',error:'error'}[tone] || 'info'}/></span><p>{t("Đây là dữ liệu minh hoạ; không có thay đổi được lưu.")}</p></NotificationSurface>
    {confirm && <ConfirmationDialog title={t('Xác nhận mẫu')} confirmLabel={t("Xác nhận")} onClose={()=>setConfirm(false)} onConfirm={()=>{setConfirm(false);notify({message:'Đã xác nhận mẫu. Không có dữ liệu nào bị thay đổi.',tone:'success'})}}><p>{t("Chỉ xem giao diện xác nhận. Không xoá dữ liệu hay gửi lệnh.")}</p></ConfirmationDialog>}
  </section>
}
export default function TestingComponentReference() {
  const { t, fmt } = useTestingLocale(), { appearance } = useFxReplayContext()
  const root=useRef(null), dialog=useRef(null)
  const [value,setValue]=useState('buy'), [values,setValues]=useState(['buy']), [state,setState]=useState('ready')
  const [tokens,setTokens]=useState({}), [enabled,setEnabled]=useState(true)
  const options=[{value:'buy',label:'Buy'},{value:'sell',label:'Sell'},{value:'unknown',label:'Chưa rõ',disabled:true,detail:'Chưa đủ dữ liệu'}]
  useEffect(() => {
    let frame
    const readTokens=() => { cancelAnimationFrame(frame); frame=requestAnimationFrame(() => {
      const style=getComputedStyle(root.current), result={}
      for (const [,key] of sizes) { const property=productSizeTokens[key] || '--ds-'+key; result[property]=style.getPropertyValue(property).trim() }
      for (const [,key] of motions) result['--ds-motion-'+key]=style.getPropertyValue('--ds-motion-'+key).trim()
      for (const [key] of colors) {
        const probe=document.createElement('span'); probe.style.color=`var(--${key.startsWith('report-') ? '' : 'project-'}${key})`
        root.current.appendChild(probe)
        const rgb=getComputedStyle(probe).color.match(/[\d.]+/g)
        result[key]=`#${rgb.slice(0,3).map(v => Math.round(Number(v)).toString(16).padStart(2,'0')).join('').toUpperCase()}`
        probe.remove()
      }
      setTokens(result)
    }) }
    readTokens()
    window.addEventListener('resize',readTokens)
    const pointer=window.matchMedia('(pointer:coarse)')
    pointer.addEventListener('change',readTokens)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize',readTokens); pointer.removeEventListener('change',readTokens) }
  }, [appearance.theme])
  return <section ref={root} className="wm-page wm-component-reference" aria-label={t('Bộ chuẩn Testing')}>
    <header className="wm-reference-heading"><div><h1>{t("Bộ chuẩn giao diện")}</h1><p>{t("Mẫu dùng dữ liệu minh hoạ, không gửi lệnh hay tạo phiên.")}</p></div><span className="wm-reference-version">Naqex Trader</span></header>
    <nav className="wm-reference-jumps" aria-label={t("Các phần bộ chuẩn")}>{[['controls','Nút và trạng thái'],['overlays','Lớp nổi'],['tooltips','Tooltip'],['sizes','Kích thước và chữ'],['colors','Màu'],['motion','Chuyển động'],['data-flow','Luồng dữ liệu'],['report-patterns','KPI / card / chart'],['layout','Bố cục'],['audit','Rà soát']].map(([id,name]) => <a key={id} href={'#'+id}>{t(name)}</a>)}</nav>
    <section id="controls"><h2>{t("Nút, ô nhập và trạng thái")}</h2><p>{t("Rê chuột, bấm và dùng phím Tab. Hover giữ nguyên kích thước. Dòng đã chọn giữ màu chọn khi hover; nút bên trong có phản hồi riêng. Focus bàn phím có dấu riêng.")}</p>
      <div className="wm-reference-controls"><FxSelect label={t("Side")} value={value} options={options} onChange={setValue} /><FxSelect label={t("Side")} value={values} options={options} onChange={setValues} multiple searchable /><FxSelect label={t("Side")} value={value} options={options} onChange={setValue} disabled /></div>
      <div className="wm-reference-controls"><button type="button" className="wm-button is-primary" onClick={() => dialog.current.showModal()}><TestingIcon kind="plus" />{t("Mở dialog mẫu")}</button><button type="button" className="wm-button" onClick={() => setEnabled(!enabled)}>{t("Nút phụ")}</button><button type="button" className="wm-button is-info" onClick={() => setState('ready')}>{t("Thông tin")}</button><button type="button" className="wm-button is-success" onClick={() => setState('ready')}>{t("Hoàn tất")}</button><button type="button" className="wm-button is-danger" onClick={() => dialog.current.showModal()}><TestingIcon kind="delete" />{t("Xoá mẫu")}</button><button type="button" className="wm-button" disabled>{t("Không khả dụng")}</button><button type="button" className="wm-button is-icon" aria-label={t("Tạm dừng mẫu")} data-tooltip={t("Tạm dừng mẫu")} onClick={() => setEnabled(!enabled)}><TestingIcon kind={enabled ? 'pause' : 'play'} /></button><button type="button" className="wm-button is-text" onClick={() => setState('empty')}>{t("Liên kết thao tác")}</button></div>
      <div className="wm-reference-form-grid"><label>{t("Tên phiên")}{' '}<b aria-hidden="true">*</b><input className="wm-field" placeholder={t("Nhập tên phiên…")} /></label><label>{t("Số dư")}<input className="wm-field" type="number" defaultValue="100000" /></label><div className="wm-reference-form-field"><span>{t("Hướng lệnh (ô form)")}</span><FxSelect className="is-field" label={t("Hướng lệnh (ô form)")} value={value} options={options} onChange={setValue} /></div><div className="wm-reference-form-field"><span>{t("Ô form không khả dụng")}</span><FxSelect className="is-field" label={t("Ô form không khả dụng")} value={value} options={options} onChange={setValue} disabled /></div><label>{t("Mô tả")}<textarea className="wm-field" rows="2" placeholder={t("Nội dung nhiều dòng")} /></label><div className="wm-reference-choices"><label><input type="checkbox" defaultChecked />{t("Checkbox: đã chọn")}</label><label><input type="checkbox" ref={node => { if (node) node.indeterminate=true }} />{t("Checkbox: chọn một phần")}</label><label><input type="checkbox" defaultChecked disabled />{t("Checkbox: đã chọn, không khả dụng")}</label><label><input type="radio" name="reference-mode" defaultChecked />{t("Lựa chọn A")}</label><label><input type="radio" name="reference-mode" />{t("Lựa chọn B")}</label><label><input type="checkbox" role="switch" className="wm-reference-switch" checked={enabled} onChange={e => setEnabled(e.target.checked)} />{t("Bật / tắt")}</label></div></div>
      <div className="wm-reference-table-scroll"><table className="wm-reference-table wm-reference-row-sample"><thead><tr><th>{t("Tài sản")}</th><th>{t("Dữ liệu mẫu")}</th><th>{t("Thao tác")}</th></tr></thead><tbody>{['EUR/USD','XAU/USD'].map((asset,i) => <tr key={asset} className={i ? 'is-selected' : ''} aria-selected={Boolean(i)}><td>{asset}</td><td>{t(i ? 'Dòng đã chọn' : 'Rê chuột lên dòng và nút')}</td><td><button type="button" className="wm-button is-icon" aria-label={t('Thao tác mẫu {asset}',{asset})} onClick={() => setValue(i ? 'sell' : 'buy')}><TestingIcon kind="settings" /></button></td></tr>)}</tbody></table></div>
    </section>
    <section id="sizes"><h2>{t("Kích thước và chữ")}</h2><p>{t("Thông số thực tế của Trader, gồm điều chỉnh theo màn hình và thiết bị. Nút dài theo chữ; vùng bấm khác kích thước nét icon.")}</p><SpecTable rows={sizes} tokens={tokens} overrides={productSizeTokens} /><div className="wm-reference-types"><span className="is-page">{t("Tiêu đề trang")}</span><span className="is-section">{t("Tiêu đề cụm")}</span><span>{t("Nội dung dễ đọc 14px")}</span><small>{t("Chú thích 12px · 09/10/2026 · 14:30:00")}</small></div><div className="fxa-metrics"><Metric label={t("Net PnL")} value={fmt(1234.5,' USD')} /><Metric label={t("Net PnL")} value={fmt(null,' USD')} note={t("Chưa đủ dữ liệu")} /><Metric label={t("Win rate")} value={fmt(0,'%')} /><Metric label={t("Net PnL")} value={fmt(-125,' USD')} tone="is-negative" /></div></section>
    <section id="colors"><h2>{t("Màu theo ý nghĩa")}</h2><p>{t("Đổi theme trên header để xem sáng/tối. Màu luôn đi cùng chữ hoặc icon.")}</p><div className="wm-reference-colors">{colors.map(([key,label,note]) => <div key={key}><i style={{background:`var(--${key.startsWith('report-') ? '' : 'project-'}${key})`}} /><span><strong>{t(label)}</strong><small>{t(note)}</small></span><code>{tokens[key]}</code></div>)}</div></section>
    <section id="motion"><h2>{t("Chuyển động")}</h2><p>{t("Khởi động nhanh, giảm tốc dịu. Mở lớp chỉ mờ/dịch nhẹ; hover không đổi layout. Đóng lớp và phản hồi dữ liệu không bị trì hoãn vì animation.")}</p><SpecTable rows={motions} tokens={tokens} prefix="--ds-motion-" /><p>{t("Giảm chuyển động của hệ điều hành: tắt hiệu ứng. Không biết tổng dung lượng: thanh chờ, không tạo % hay ETA giả.")}</p><FxSelect label={t("Trạng thái dữ liệu")} value={state} onChange={setState} options={[['ready','Sẵn sàng'],['loading','Đang tải'],['empty','Chưa có dữ liệu.'],['filtered','Không có kết quả khớp bộ lọc.'],['error','Không tải được dữ liệu.'],['unavailable','Nguồn chưa khả dụng.'],['denied','Không có quyền xem.'],['stale','Dữ liệu chưa cập nhật.'],['partial','Dữ liệu một phần.']].map(([value,label]) => ({value,label}))} />{state === 'loading' ? <TestingSkeleton /> : <TestingReadState message={{ready:'Sẵn sàng',empty:'Chưa có dữ liệu.',filtered:'Không có kết quả khớp bộ lọc.',error:'Không tải được dữ liệu.',unavailable:'Nguồn chưa khả dụng.',denied:'Không có quyền xem.',stale:'Dữ liệu chưa cập nhật.',partial:'Dữ liệu một phần.'}[state]} error={state === 'error'} onRetry={state === 'error' ? () => setState('ready') : undefined} />}</section>
    <ReferenceOverlays theme={appearance.theme} />
    <ReferenceFeedback />
    <section id="tooltips"><h2>{t("Tooltip")}</h2><p>{t("Gợi ý ngắn khi hover hoặc focus bằng Tab; Escape đóng. Nội dung quan trọng vẫn hiện trong form. Dùng popover nếu cần liên kết hoặc thao tác.")}</p><div className="wm-reference-controls"><button type="button" className="wm-button" data-tooltip={t("Gợi ý ngắn")}>{t("Tooltip ngắn")}</button><button type="button" className="wm-button" data-tooltip={t("Chỉ đọc dữ liệu đã đồng bộ.\nKhông gửi lệnh tới broker.")} data-tooltip-touch>{t("Hướng dẫn mẫu")}</button><button type="button" className="wm-button" data-tooltip={t("Số dư tài khoản\n\nSố dư sau các giao dịch đã đóng, không bao gồm lãi/lỗ thả nổi.\n\nKhi lọc giao dịch, số dư được dựng lại từ vốn ban đầu và những lệnh đã chọn; không đại diện cho toàn bộ số dư tài khoản hiện tại.")} data-tooltip-touch>{t("Định nghĩa dài")}</button><button type="button" className="wm-button" disabled data-tooltip={t("Chọn tài khoản trước khi đồng bộ.")}>{t("Chưa thể đồng bộ")}</button></div></section>
    <ReferenceDataFlow />
    <ReferenceDataTable />
    <ReferenceTradeSelection />
    <ReferenceVirtualTable />
    <ReferenceReportPatterns />
    <section id="layout"><h2>{t("Vị trí, nhóm và grid")}</h2><div className="wm-reference-layout-grid"><div><h3>{t("Trang dữ liệu")}</h3><p>{t("Tìm kiếm trái → filter / sort → hành động phải. Desktop một hàng; hẹp thì cuộn nhóm filter, không đổi vị trí khi thay nhãn.")}</p><p>{t("Header và dữ liệu chung mép cột. Chữ trái; số tiền/số lượng phải; icon giữa vùng bấm. Ngày dd/mm/yyyy, giờ HH:mm:ss; giữ rõ múi giờ.")}</p></div><div><h3>{t("Form và dialog")}</h3><p>{t("Label trên ô, mô tả/lỗi dưới ô. Hai cột khi đủ rộng, một cột trên điện thoại. Header/footer cố định, chỉ giữa cuộn.")}</p><p>{t("Huỷ bên trái nút chính ở footer phải. X trên phải, hover chỉ đổi màu icon. Không lồng card hay thêm viền để lấp khoảng trống.")}</p></div><div><h3>{t("KPI và báo cáo")}</h3><p>{t("Grid 4 → 2 → 1 theo chỗ trống. Khoảng cách 20px giữa cụm, 24px giữa khu vực. Biểu đồ giữ trục/đơn vị; bảng rộng cuộn trong vùng riêng.")}</p></div><div><h3>{t("Lớp nổi")}</h3><p>{t("Menu bám control, tránh mép màn hình; dialog giữa, drawer phải, tooltip cạnh mục đang chỉ. Escape đóng lớp hiện tại, trả focus về nút mở.")}</p></div></div></section>
    <section id="audit"><h2>{t("Những điểm đã phát hiện")}</h2><ul><li>{t("Dashboard áp 44px cho control con, ảnh hưởng dialog: bỏ luật ép.")}</li><li>{t("Ô nhập/nút Settings, Research, Risk, Prop, Learn khác chiều cao: dùng thang control chung.")}</li><li>{t("Hover control gần màu hover dòng: tách hai độ sáng trung tính, không phủ nền xanh lên nút.")}</li><li>{t("Thời gian chuyển màu 140–180ms: gom 120ms; progress 200ms.")}</li><li>{t("Focus tạo phiên trắng, phần khác xanh: đổi về xanh biển.")}</li><li>{t("Chuẩn chỉ áp Testing/Live: mở nền tảng cho các khu vực app.")}</li></ul><p>{t("Toolbar chart có kích thước đặc thù 30–38px; nến và Buy/Sell giữ nghĩa thị trường. Các workflow phụ thuộc dữ liệu thật cần kiểm chứng riêng; đây không phải nghiệm thu toàn sản phẩm.")}</p></section>
    <dialog ref={dialog} className="wm-reference-dialog" aria-labelledby="reference-dialog-title"><header><h2 id="reference-dialog-title">{t("Dialog mẫu")}</h2><button type="button" className="wm-dialog-close" aria-label={t("Đóng dialog mẫu")} data-tooltip={t("Đóng dialog mẫu")} onClick={() => dialog.current.close()}><TestingIcon kind="close" size={18} /></button></header><p>{t("Chỉ kiểm tra bố cục và hiệu ứng; không xoá dữ liệu hay tạo phiên.")}</p><footer><button type="button" className="wm-button" onClick={() => dialog.current.close()}>{t("Huỷ")}</button><button type="button" className="wm-button is-primary" onClick={() => dialog.current.close()}>{t("Hoàn tất")}</button></footer></dialog>
  </section>
}
