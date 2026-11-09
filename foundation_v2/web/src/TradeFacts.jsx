import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import ChartIcon from './ChartIcon.jsx'

export default function TradeFacts({ account, asset, side, entryType, entryAt, entryPrice, size, stop, target, exitAt, exitPrice, gross, fees, net, currency, timeBasis, alternateEntry, alternateExit, duration, fills, variant }) {
  const { t } = useTestingLocale()
  const rows = [
    [...(account ? [['Account',account,'account']] : []),['Asset',asset,'account'],['Side',side,'trades']],
    [['Entry type',entryType,'info'],['Entry date',entryAt,'clock',alternateEntry],['Entry price',entryPrice,'money'],['Total size',size,'money'],['Stop loss',stop,'money'],['Take profit',target,'money'],['Exit date',exitAt,'clock',alternateExit],['Exit price',exitPrice,'money'],...(duration!==undefined?[['Thời gian giữ lệnh',duration,'clock']]:[])],
    [['Gross PnL',gross,'money'],['Fees',fees,'money'],['Net PnL',net,'money']],
  ]
  return <section className="fx-live-trade-details" aria-label={t('Thông tin giao dịch')} data-time-basis={timeBasis} data-variant={variant}>
    {rows.map((group,index) => <dl key={index}>{group.map(([label,value,icon,alternate]) => <div key={label} title={alternate || (icon === 'clock' ? timeBasis : undefined)}>
      <dt>{icon === 'money' ? <span className="fx-trade-money-icon" aria-hidden="true">$</span> : icon === 'clock' ? <ChartIcon name="news" size={14}/> : <TestingIcon kind={icon} size={14}/>}<span>{t(label)}{icon === 'clock' && <span className="sr-only"> · {timeBasis}</span>}</span></dt>
      <dd title={index === 2 ? currency : undefined}>{value == null || value === '' || value === '—' ? '-' : value}</dd>
    </div>)}{index===1 && fills && <div className="wm-trade-fills-action">{fills}</div>}</dl>)}
  </section>
}
