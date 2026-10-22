import { useTestingLocale } from './testingLocale.jsx'

export default function Mt5TradingConditions({ snapshot, stale = false }) {
  const { t,fmt } = useTestingLocale()
  const spec=snapshot?.instrument, account=snapshot?.account, quote=snapshot?.quote
  const value=(number,unit='')=>Number.isFinite(number)?fmt(number,unit,8):t('Chưa có dữ liệu')
  return <section className="mt5-conditions" aria-label={t('Điều kiện giao dịch')}>
    <h3>{snapshot?.symbol || 'MetaTrader'}</h3>
    {Number.isFinite(quote?.time_msc) && <time className="live-muted" dateTime={new Date(quote.time_msc).toISOString()}>{new Date(quote.time_msc).toISOString().replace('T',' ').slice(0,19)} UTC</time>}
    {stale && <p role="status">{t('Dữ liệu trước đó · đang mất kết nối')}</p>}
    <dl className="live-terminal-values">
      <div><dt>{t('Balance')}</dt><dd>{value(account?.balance,account?.currency ? ` ${account.currency}`:'')}</dd></div>
      <div><dt>{t('Đòn bẩy')}</dt><dd>{Number.isFinite(account?.leverage) ? `1:${account.leverage}` : t('Chưa có dữ liệu')}</dd></div>
      <div><dt>{t('Spread (Ask − Bid)')}</dt><dd>{value(quote ? quote.ask-quote.bid : null)}</dd></div>
      <div><dt>{t('Bước giá')}</dt><dd>{value(spec?.tick_size)}</dd></div>
      <div><dt>{t('Lot tối thiểu / tối đa')}</dt><dd>{value(spec?.quantity_min)} / {value(spec?.quantity_max)}</dd></div>
      <div><dt>{t('Bước lot')}</dt><dd>{value(spec?.quantity_step)}</dd></div>
      <div><dt>{t('Khoảng cách SL/TP tối thiểu (point)')}</dt><dd>{value(spec?.stops_level)}</dd></div>
      <div><dt>{t('Vùng đóng băng sửa lệnh (point)')}</dt><dd>{value(spec?.freeze_level)}</dd></div>
      <div><dt>{t('Hoa hồng')}</dt><dd>{t('Theo broker · chưa có biểu phí')}</dd></div>
    </dl>
    <p className="live-muted">{t('Thông số từ terminal MT5; spread thay đổi theo giá. Phí thực thu lấy từ lịch sử khớp lệnh. Không dùng chi phí mô phỏng.')}</p>
    {snapshot?.policy && snapshot.policy.source!=='broker' && <p className="live-muted">{t('Giới hạn của ứng dụng')}: {value(snapshot.policy.max_volume,' lot')} · {value(snapshot.policy.max_risk_amount,account?.currency ? ` ${account.currency}`:'')} {t('tổng rủi ro')}. {t('Khoản dự phòng chi phí không phải biểu phí broker.')}</p>}
  </section>
}
