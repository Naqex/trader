import { useState } from 'react'
import ReportSidePanel from './ReportSidePanel.jsx'
import FxSelect from './FxSelect.jsx'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function SmartPicksPanel({catalog}) {
  const {t}=useTestingLocale(),[tags,setTags]=useState([])
  return <ReportSidePanel title="Smart Picks" defaultCollapsed help="Smart Picks phân tích bộ lọc hiện tại để gợi ý tổ hợp nhãn nên bao gồm hoặc loại trừ.">
    <div className="wm-smart-picks-preview"><ChartIcon name="mentor" width={64} height={64}/><h3>{t('Khám phá tổ hợp nhãn')}</h3><p>{t('Chọn nhãn để chuẩn bị phân tích tổ hợp giao dịch.')}</p>
      <FxSelect label="Nhãn phân tích" multiple searchable value={tags} onChange={setTags} disabled={catalog.status!=='ready'} emptySelectionLabel="Chọn nhãn…" options={catalog.items.filter(item=>!item.archived).map(item=>({value:item.name,label:item.name,localize:false}))}/>
      <button type="button" className="fxa-button is-primary" disabled title={t('Chưa bật phân tích tổ hợp nhãn.')}>{t('Tạo Smart Picks')}</button>
    </div>
  </ReportSidePanel>
}
