import { useEffect } from 'react'
import ChartOrderPanel from './ChartOrderPanel.jsx'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function LegacyOrderDialog({ order, blockedReason, theme, onClose, onJournal }) {
  const { t } = useTestingLocale()
  useEffect(() => { order.resetDraft() }, [])
  return <LegacyModal theme={theme} label={t(order.active ? order.execution?.position ? 'Chỉnh sửa vị thế' : 'Chỉnh sửa lệnh chờ' : 'Đặt lệnh')}
    className="legacy-order-modal" overlayClassName="legacy-order-overlay" closeLabel="Đóng panel" onClose={onClose}
    headerActions={!order.active && <button type="button" disabled title={t('Chưa hỗ trợ preset')}>{t('Preset')}</button>}>
    <ChartOrderPanel order={order} blockedReason={blockedReason} legacy onClose={onClose} onJournal={onJournal} />
  </LegacyModal>
}
