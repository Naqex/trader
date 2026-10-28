import { Fragment, useId, useState } from 'react'
import DataTable from './DataTable.jsx'
import TestingIcon from './TestingIcon.jsx'
import { propObjectiveRows } from './propAnalyticsModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import { currencyLabel } from './moneyFormat.js'
import { displayDate } from './dateFormat.js'

const statusLabels = { unknown:'Chưa đủ dữ liệu', pending:'Đang thực hiện', finished:'Đã kết thúc', passed:'Đạt', breached:'Vi phạm', within:'Trong giới hạn', expired:'Hết hạn' }

export default function PropChallengeObjectives({ report }) {
  const { t, fmt } = useTestingLocale(), id = useId(), [expanded,setExpanded] = useState(null)
  const rows = propObjectiveRows(report), unit = currencyLabel(report.phase?.currency) || report.phase?.currency || t('Đơn vị tài khoản')
  const money = value => value === null || value === undefined ? 'N/A' : fmt(value,` ${unit}`)
  const result = row => row.key === 'time' ? row.minutes === null ? 'N/A' : t('{days} ngày {hours} giờ',{days:fmt(Math.floor(row.minutes/1440),'',0),hours:fmt(Math.floor(row.minutes%1440/60),'',0)})
    : row.key === 'days' ? row.days === null ? 'N/A' : fmt(row.days,'',0)
    : row.value === null ? 'N/A' : `${money(row.value)} (${fmt(row.percent,'%')})`
  return <section className="fxa-prop-objectives" data-testid="prop-analytics-objectives" aria-label={t('Challenge objectives')}>
    <DataTable scrollAxis="x" label={t('Challenge objectives')}><colgroup><col style={{width:'36%'}}/><col style={{width:'34%'}}/><col style={{width:'30%'}}/></colgroup>
      <thead><tr><th scope="col">{t('Challenge objectives')}</th><th scope="col">{t('Kết quả')}</th><th scope="col">{t('Trạng thái')}</th></tr></thead>
      <tbody>{rows.map(row=><Fragment key={row.key}>
        <tr data-objective={row.key}>
          <th scope="row"><button type="button" className="fxa-objective-toggle" aria-expanded={expanded===row.key} aria-controls={`${id}-${row.key}`} onClick={()=>setExpanded(value=>value===row.key?null:row.key)}><TestingIcon kind={expanded===row.key?'minus':'plus'} size={16}/><span>{t(row.label)}{row.limit !== null && row.limit !== undefined && <> {money(Math.abs(row.limit))}</>}</span></button></th>
          <td className={row.value > 0 ? 'is-positive' : row.value < 0 ? 'is-negative' : undefined}>{result(row)}</td>
          <td><span className={`fxa-objective-state is-${row.state}`}><TestingIcon kind={row.state==='passed'||row.state==='within'?'check':row.state==='breached'||row.state==='expired'?'close':row.state==='pending'?'clock':'info'} size={16}/>{t(statusLabels[row.state])}</span></td>
        </tr>
        <tr id={`${id}-${row.key}`} hidden={expanded!==row.key} className="fxa-objective-detail"><td colSpan={3}>
          {row.key==='time' ? <>{t('Thời gian replay của toàn bộ lượt challenge, không phải số ngày giao dịch đủ điều kiện.')} <time>{displayDate(row.start,{timeStyle:'short'})}</time> → <time>{displayDate(row.end,{timeStyle:'short'})}</time></>
            : row.key==='days' ? t('Số ngày giao dịch đủ điều kiện do bộ quy tắc challenge ghi nhận; không phải số ngày lịch.')
            : <>{t(row.target?'Lợi nhuận được đo từ vốn đầu giai đoạn. Đạt mục tiêu lợi nhuận chưa có nghĩa là vượt challenge.':'Mức lỗ được đo từ mốc tham chiếu của quy tắc; giới hạn tổng có thể thay đổi theo đỉnh vốn.')} <dl><div><dt>{t('Mốc tham chiếu')}</dt><dd>{money(row.reference)}</dd></div><div><dt>{t('Giá trị đánh giá')}</dt><dd>{money(row.current)}</dd></div><div><dt>{t(row.target?'Mục tiêu số dư':'Sàn vốn')}</dt><dd>{money(row.boundary)}</dd></div></dl>{t('Phần trăm tính trên mốc tham chiếu. Trạng thái lấy từ báo cáo challenge, không thay đổi theo bộ lọc giao dịch.')}</>}
        </td></tr>
      </Fragment>)}</tbody>
    </DataTable>
  </section>
}
