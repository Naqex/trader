import { useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { partialCloseAmount, partialCloseBasis, partialCloseError } from './partialCloseModel.js'

export default function PartialCloseDialog({ levels, theme, pending, disabled, onClose, onSubmit }) {
  const { t, fmt } = useTestingLocale()
  const [basis, setBasis] = useState('remaining')
  const [percentage, setPercentage] = useState('50')
  const [amount, setAmount] = useState(() => partialCloseAmount(levels, 'remaining', '50'))
  const [error, setError] = useState('')
  const validation = partialCloseError(levels, amount)
  const choosePercent = value => { setPercentage(value); setAmount(partialCloseAmount(levels, basis, value)); setError('') }
  const chooseAmount = value => {
    setAmount(value)
    setPercentage(value === '' ? '' : String(Number((Number(value) / partialCloseBasis(levels, basis) * 100).toFixed(4))))
    setError('')
  }
  return <LegacyModal theme={theme} label={t('Đóng một phần vị thế')} className="legacy-order-modal partial-close-dialog" onClose={() => { if (!pending) onClose() }}>
    <form className="legacy-order-form" onSubmit={async event => {
      event.preventDefault()
      if (validation || disabled || pending || !levels.partialCloseSupported) return
      setError('')
      if (!await onSubmit(amount)) setError('Không đóng được vị thế. Kiểm tra thông báo rồi thử lại.')
    }}>
      <fieldset className="partial-close-basis" disabled={pending} aria-label={t('Tính tỷ lệ theo')}>
        {[['remaining', 'Khối lượng còn lại'], ['original', 'Khối lượng ban đầu']].map(([value, label]) => <label key={value}><input type="radio" name="partial-basis" value={value} checked={basis === value} onChange={() => { setBasis(value); setAmount(partialCloseAmount(levels, value, percentage)); setError('') }} />{t(label)}</label>)}
      </fieldset>
      <div className="partial-close-presets" role="group" aria-label={t('Tỷ lệ đóng')}>{[25, 50, 75, 100].map(value => <button type="button" key={value} aria-pressed={Number(percentage) === value} disabled={pending} onClick={() => choosePercent(String(value))}>{value}%</button>)}</div>
      <div className="legacy-order-grid">
        <label>{t('Tỷ lệ đóng (%)')}<input type="number" min="0" max="100" step="any" value={percentage} disabled={pending} onChange={event => choosePercent(event.target.value)} /></label>
        <label>{t(levels.assetClass === 'fx' ? 'Khối lượng đóng (lot)' : 'Khối lượng đóng')}<span className="partial-close-amount"><input type="number" aria-label={t('Khối lượng đóng')} min={levels.quantityMin || '0'} max={levels.quantity} step={levels.quantityStep || 'any'} value={amount} disabled={pending} onChange={event => chooseAmount(event.target.value)} /><button type="button" disabled={pending} onClick={() => chooseAmount(String(levels.quantity))}>{t('Tối đa')}</button></span></label>
      </div>
      <dl className="partial-close-summary"><div><dt>{t('Khối lượng hiện tại')}</dt><dd>{levels.quantity}</dd></div><div><dt>{t('PnL đã chốt')}</dt><dd>{fmt(levels.realizedPnl ?? 0, levels.currency ? ` ${levels.currency}` : '')}</dd></div></dl>
      {(error || validation) && <p className="partial-close-error" role={error ? 'alert' : 'status'}>{t(error || validation)}</p>}
      <footer><button type="button" disabled={pending} onClick={onClose}>{t('Hủy')}</button><button className="legacy-order-save" type="submit" disabled={pending || disabled || !levels.partialCloseSupported || Boolean(validation)}>{t(pending ? 'Đang xử lý…' : 'Save')}</button></footer>
    </form>
  </LegacyModal>
}
