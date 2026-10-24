import { useEffect, useId, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import './session-actions.css'
import './session-duplicate.css'

export default function SessionDuplicateDialog({ item, onClose, onSubmit, pending = false, blocked = false, error, preview = false }) {
  const { t } = useTestingLocale()
  const dialog = useRef(null), opener = useRef(document.activeElement), id = useId()
  const [history, setHistory] = useState('clean')
  const prop = item.session_kind === 'prop' || Boolean(item.prop_attempt_id)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    element.querySelector('input:checked')?.focus({ preventScroll: true })
    return () => { element.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!pending) onClose() }
  return <dialog ref={dialog} className="fx-dashboard-dialog fxs-duplicate-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
  }}>
    <header><h2 id={`${id}-title`}>{t('Tạo bản sao phiên')}</h2><button type="button" className="wm-dialog-close" aria-label={t('Đóng hộp thoại phiên')} disabled={pending} onClick={close}>×</button></header>
    <form onSubmit={event => { event.preventDefault(); if (!pending && !blocked) onSubmit('duplicate', item, { history }) }}>
      <p className="fxs-duplicate-name">{item.name || item.record_id}</p>
      <fieldset disabled={pending}>
        <legend className="sr-only">{t('Dữ liệu của bản sao')}</legend>
        <label><input type="radio" name={`${id}-history`} value="clean" checked={history === 'clean'} onChange={() => setHistory('clean')} /><span><strong>{t('Không có giao dịch')}</strong><small>{t(prop ? 'Tạo phiên Backtest độc lập từ cấu hình này.' : 'Bắt đầu lại từ đầu với cùng cấu hình phiên.')}</small></span></label>
        <label><input type="radio" name={`${id}-history`} value="keep" checked={history === 'keep'} disabled={prop} onChange={() => setHistory('keep')} /><span><strong>{t('Giữ dữ liệu giao dịch')}</strong><small>{t(prop ? 'Chưa hỗ trợ sao chép lịch sử Prop Firm.' : 'Giữ lịch sử và trạng thái tại vị trí replay hiện tại.')}</small></span></label>
      </fieldset>
      {preview && <small className="fx-dashboard-dialog-preview">{t('Bản xem thử · thay đổi chỉ ở chế độ demo')}</small>}
      {error && <p role="alert">{t(error)}</p>}
      <footer><button className="fxr-button fxr-button-secondary" type="button" disabled={pending} onClick={close}>{t('Hủy')}</button><button className="fxr-button fxr-button-primary" type="submit" disabled={pending || blocked}>{t(pending ? 'Đang tạo…' : 'Tạo bản sao')}</button></footer>
    </form>
  </dialog>
}
