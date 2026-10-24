import { useTestingLocale } from './testingLocale.jsx'
import { managedBrokerRules, quoteQuality } from './liveTradingModel.js'

export default function Mt5TradingConditions({ snapshot, stale = false }) {
  const { t,fmt } = useTestingLocale()
  const spec=snapshot?.instrument, account=snapshot?.account, quote=snapshot?.quote
  const broker=snapshot?.broker_state, quality=quoteQuality(snapshot)
  const tradeMode=({0:'Bị khóa',1:'Chỉ mua',2:'Chỉ bán',3:'Chỉ đóng vị thế',4:'Mua và bán'})[broker?.symbol?.trade_mode]
  const allowed=value=>t(value===true?'Được phép':value===false?'Bị khóa':'Chưa có dữ liệu')
  const value=(number,unit='')=>Number.isFinite(number)?fmt(number,unit,8):t('Chưa có dữ liệu')
  return <section className="mt5-conditions" aria-label={t('Điều kiện giao dịch')}>
    <h3>{snapshot?.symbol || 'MetaTrader'}</h3>
    {stale && <p role="status">{t('Dữ liệu trước đó · đang mất kết nối')}</p>}
    <h4>{t('MT5 / broker')}</h4>
    <dl className="live-terminal-values">
      <div><dt>{t('Quyền giao dịch tài khoản')}</dt><dd>{allowed(broker?.account?.trade_allowed)}</dd></div>
      <div><dt>{t('Quyền giao dịch tự động')}</dt><dd>{allowed(broker?.account?.trade_expert)}</dd></div>
      <div><dt>{t('Quyền giao dịch terminal')}</dt><dd>{allowed(broker?.terminal?.trade_allowed)}</dd></div>
      <div><dt>{t('Quyền của symbol')}</dt><dd>{t(tradeMode || 'Chưa có dữ liệu')}</dd></div>
      <div><dt>{t('Phiên giao dịch')}</dt><dd>{t('Chưa xác định · chưa có lịch phiên từ MT5')}</dd></div>
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
    <h4>{t('Chất lượng dữ liệu')}</h4>
    <dl className="live-terminal-values">
      <div><dt>{t('Báo giá MT5')}</dt><dd>{t(({fresh:'Trong ngưỡng của ứng dụng',stale:'Báo giá cũ',future:'Thời gian báo giá đi trước đồng hồ máy',invalid:'Thời gian báo giá không hợp lệ'})[quality.state])}</dd></div>
      <div><dt>{t('Báo giá cuối')}</dt><dd>{quality.state!=='invalid'?new Date(Number(quote.time_msc)).toISOString().replace('T',' ').slice(0,19)+' UTC':t('Chưa có dữ liệu')}</dd></div>
    </dl>
    <p className="live-muted">{t('Tuổi báo giá được ứng dụng tính theo đồng hồ máy; không xác nhận thị trường đóng hay mở.')}</p>
    <h4>{t('Chính sách ứng dụng')}</h4>
    <dl className="live-terminal-values"><div><dt>{t('Tuổi báo giá tối đa để gửi lệnh')}</dt><dd>{value(quality.maxAgeMs/1000)} {t('giây')}</dd></div></dl>
    <p className="live-muted">{t('Đây là giới hạn của ứng dụng, không phải quy định thời gian của broker. MT5 vẫn kiểm tra lại từng yêu cầu.')}</p>
    {snapshot?.policy && !managedBrokerRules(snapshot) && <p className="live-muted">{t('Giới hạn của ứng dụng')}: {value(snapshot.policy.max_volume,' lot')} · {value(snapshot.policy.max_risk_amount,account?.currency ? ` ${account.currency}`:'')} {t('tổng rủi ro')}. {t('Khoản dự phòng chi phí không phải biểu phí broker.')}</p>}
  </section>
}
