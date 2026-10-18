import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { categoryLabel, categoryOf } from './dataLibraryModel.js'
import { assetTradingDefaults, assetSlippageUnit, LEGACY_TRADING_OPTIONS_VERSION } from './sessionTradingOptions.js'
import './session-trading-options.css'

const specFor = asset => asset.instrument_spec || asset.replay_instrument_spec
export default function SessionTradingOptions({ assets, value, onChange, disabled, error, id }) {
  const { t, language } = useTestingLocale()
  const legacy = value.version === LEGACY_TRADING_OPTIONS_VERSION
  const settings = asset => value.assets[asset.dataset_id] || assetTradingDefaults()
  const update = (asset, field, next) => onChange({ ...value, assets:{ ...value.assets, [asset.dataset_id]:{ ...settings(asset), [field]:next } } })
  const field = (asset, key, label) => <label><span>{t(label)}</span><input type="text" inputMode="decimal" aria-label={`${t(label)} · ${asset.instrument_id}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-options-error` : undefined} value={settings(asset)[key]} disabled={disabled} onChange={event => update(asset,key,event.target.value)} /></label>
  const assetName = asset => <div className="session-option-asset"><strong>{asset.instrument_id}</strong><small>{t(categoryLabel(categoryOf({ ...asset, instrument_spec: specFor(asset) })))}</small></div>
  return <section className="session-trading-options" aria-label={t('Tùy chọn giao dịch')}>
    <section className="session-option-section session-cost-surface" data-option="costs">
      <header className="session-option-heading"><div><h3>{t('Spread và hoa hồng')}</h3><p>{t(value.costs_enabled ? 'Đặt chi phí riêng cho từng tài sản.' : 'Khớp giá gốc, không tính spread hoặc hoa hồng.')}</p></div><button type="button" role="switch" aria-label={t('Spread và hoa hồng')} aria-checked={value.costs_enabled} className="session-option-switch" disabled={disabled} onClick={() => onChange({ ...value, costs_enabled:!value.costs_enabled })}><span /></button></header>
      {!assets.length && value.costs_enabled && <p className="session-cost-empty">{t('Chọn tài sản trong Cơ bản để đặt phí.')}</p>}
      {assets.length > 0 && value.costs_enabled && <div className="session-asset-options session-cost-table">
        <div className="session-cost-columns" aria-hidden="true"><span /><span>Spread</span><span>{t('Hoa hồng')}</span><span>{t('Thu phí')}</span></div>
        {assets.map(asset => <fieldset className="session-cost-grid" key={asset.dataset_id}><legend>{asset.instrument_id}</legend>
          <div>{assetName(asset)}<small className="session-cost-unit">{t('Đơn vị giá')} · {specFor(asset)?.account_ccy || 'USD'}/{['fx','forex'].includes(specFor(asset)?.asset_class) ? 'lot' : t('đơn vị')}</small></div>
          {field(asset,'spread_price','Spread · đơn vị giá')}
          {field(asset,'commission_per_lot',t('Hoa hồng · {currency}/{unit}', { currency:specFor(asset)?.account_ccy || 'USD', unit:['fx','forex'].includes(specFor(asset)?.asset_class) ? 'lot' : t('đơn vị') }))}
          <div className="session-option-charge"><span>{t('Thu phí')}</span><FxSelect className="is-field" label={`${t('Thu phí')} · ${asset.instrument_id}`} value={settings(asset).commission_charge} disabled={disabled} onChange={next => update(asset,'commission_charge',next)} options={[{value:'round_trip',label:t('Cả lượt mở + đóng')},{value:'per_side',label:t('Mỗi chiều')}]} /></div>
        </fieldset>)}
      </div>}
    </section>
    {!assets.length && <div className="session-options-empty"><strong>{t('Chọn tài sản trước')}</strong><p>{t('Thiết lập riêng cho từng tài sản.')}</p></div>}
    {assets.length > 0 && <>
      <section className="session-option-section" data-option="leverage"><h3 className="session-option-caption">{t('Đòn bẩy và ký quỹ')}</h3><div className="session-option-surface">{assets.map(asset => <div className="session-assumption-row" key={asset.dataset_id}><div>{assetName(asset)}<p>{t('Chưa hỗ trợ')}</p></div><FxSelect className="is-field" label={`${t('Đòn bẩy và ký quỹ')} · ${asset.instrument_id}`} value="off" disabled options={[{value:'off',label:t('Tắt')}]} /></div>)}</div></section>
      <section className="session-option-section" data-option="hedging"><h3 className="session-option-caption">{t('Lệnh đối ứng (hedging)')}</h3><div className="session-option-surface">{assets.map(asset => <div className="session-assumption-row" key={asset.dataset_id}><div>{assetName(asset)}<p>{t('Giữ BUY và SELL cùng tài sản.')}</p></div><div className="session-option-unavailable"><button type="button" role="switch" aria-label={`Hedging · ${asset.instrument_id}`} aria-checked="false" className="session-option-switch" disabled><span /></button><small>{t('Chưa hỗ trợ')}</small></div></div>)}</div></section>
      <section className="session-option-section" data-option="slippage"><h3 className="session-option-caption">{t('Trượt giá')}</h3><div className="session-option-surface">{assets.map(asset => {
        if (legacy) return <div className="session-assumption-row" key={asset.dataset_id}><div>{assetName(asset)}<p>{t('Chi phí trượt giá cũ, mỗi chiều.')}</p></div>{field(asset,'slippage_price','Trượt giá · đơn vị giá / chiều')}</div>
        const slippage = settings(asset).slippage, { unit, available } = assetSlippageUnit(asset)
        const max = slippage.mode === 'medium' ? [3,8] : [1,2]
        const unitLabel = count => language === 'en' && count !== 1 ? `${unit}s` : unit
        const description = ['light','medium'].includes(slippage.mode)
          ? t('Tối đa {market} {marketUnit} với lệnh thị trường, {stop} {stopUnit} với lệnh stop.', { market:max[0], marketUnit:unitLabel(max[0]), stop:max[1], stopUnit:unitLabel(max[1]) })
          : t(slippage.mode === 'fixed' ? 'Cùng mức trượt cho lệnh thị trường và stop.' : 'Khớp đúng giá.')
        const fixedLabel = t('Mức cố định ({unit})', {unit:language === 'en' ? `${unit}s` : unit})
        return <div className="session-slippage-asset" key={asset.dataset_id}><div className="session-assumption-row"><div>{assetName(asset)}<p>{description}</p></div><div className="session-slippage-modes" role="group" aria-label={`${t('Trượt giá')} · ${asset.instrument_id}`}>
          {[['off','Tắt'],['light','Nhẹ'],['medium','Vừa'],['fixed','Cố định']].map(([mode,label]) => <button key={mode} type="button" aria-pressed={slippage.mode === mode} disabled={disabled || (!available && mode !== 'off')} title={!available && mode !== 'off' ? t('Thiếu quy cách pip hoặc tick của tài sản.') : undefined} onClick={() => update(asset,'slippage',{ ...slippage, mode, ...(mode === 'fixed' ? { fixed_steps:slippage.fixed_steps ?? '1' } : {}) })}>{t(label)}</button>)}
        </div></div>{slippage.mode === 'fixed' && <div className="session-slippage-value"><label><span>{fixedLabel}</span><input type="text" inputMode="numeric" maxLength={2} aria-label={`${fixedLabel} · ${asset.instrument_id}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-options-error` : undefined} value={slippage.fixed_steps ?? ''} disabled={disabled} onChange={event => update(asset,'slippage',{ ...slippage, fixed_steps:event.target.value })} /></label><small>{t('Số nguyên từ 1 đến 20.')}</small></div>}</div>
      })}</div></section>
    </>}
    {error && <p id={`${id}-options-error`} className="wm-field-error" role="alert">{t(error)}</p>}
  </section>
}
