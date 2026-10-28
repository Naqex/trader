import DataTable from './DataTable.jsx'
import TestingIcon from './TestingIcon.jsx'
import { propObjectiveRows } from './propAnalyticsModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import { currencyLabel } from './moneyFormat.js'

const statusLabels = { unknown:'Chưa đủ dữ liệu', pending:'Đang thực hiện', finished:'Đã kết thúc', passed:'Đạt', breached:'Vi phạm', within:'Trong giới hạn', expired:'Hết hạn' }

export default function PropChallengeObjectives({ report }) {
  const { t, fmt } = useTestingLocale()
  const rows = propObjectiveRows(report), unit = currencyLabel(report.phase?.currency) || report.phase?.currency || t('Đơn vị tài khoản')
  const money = value => value === null || value === undefined ? 'N/A' : fmt(value,` ${unit}`)
  const result = row => row.key === 'time' ? row.minutes === null ? 'N/A' : t('{days} ngày {hours} giờ',{days:fmt(Math.floor(row.minutes/1440),'',0),hours:fmt(Math.floor(row.minutes%1440/60),'',0)})
    : row.key === 'days' ? row.days === null ? 'N/A' : fmt(row.days,'',0)
    : row.value === null ? 'N/A' : <><span>{money(row.value)}</span><span className="fxa-objective-percent">({fmt(row.percent,'%')})</span></>
  return <section className="fxa-prop-objectives" data-testid="prop-analytics-objectives" aria-label={t('Challenge objectives')}>
    <DataTable scrollAxis="x" label={t('Challenge objectives')}><colgroup><col style={{width:'44%'}}/><col style={{width:'28%'}}/><col style={{width:'28%'}}/></colgroup>
      <thead><tr><th scope="col">{t('Challenge objectives')}</th><th scope="col">{t('Kết quả')}</th><th scope="col">{t('Trạng thái')}</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.key} data-objective={row.key}>
        <th scope="row"><div className="fxa-objective-name"><span>{t(row.label)}</span>{row.limit !== null && row.limit !== undefined && <span className="fxa-objective-limit">{money(Math.abs(row.limit))}</span>}</div></th>
        <td><div className="fxa-objective-result">{result(row)}</div></td>
        <td><span className={`fxa-objective-state is-${row.state}`}><TestingIcon kind={row.state==='passed'||row.state==='within'?'check':row.state==='breached'||row.state==='expired'?'close':row.state==='pending'?'clock':'info'} size={16}/><span>{t(statusLabels[row.state])}</span></span></td>
      </tr>)}</tbody>
    </DataTable>
  </section>
}
