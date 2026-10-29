import { useMemo } from 'react'
import { useTradeLabels } from './TradeLabelCell.jsx'
import { tagResults } from './liveLedgerModel.js'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function TradeTagOverview({ workspace, deals, currency }) {
  const { t, fmt } = useTestingLocale()
  const catalog = useTradeLabels(workspace)
  const rows = useMemo(() => tagResults(deals).sort((a,b) => b.count - a.count || a.tag.localeCompare(b.tag)), [deals])
  return <section className="live-tag-overview" aria-label={t('Tổng quan nhãn')}>
    <div className="live-tag-overview-heading"><h3>{t('Tổng quan nhãn')}</h3><button type="button" className="fxa-button fxa-icon-button" aria-label={t('Cài đặt tổng quan nhãn')} aria-disabled="true"><TestingIcon kind="settings" /></button></div>
    {rows.length ? <ul>{rows.map(row => <li key={row.tag}>
      <div><span className="wm-trade-label" data-color={catalog.items.find(item => item.name === row.tag)?.color || 'gray'}>{row.tag}</span><span className="live-tag-count" aria-label={t('{count} giao dịch', {count:row.count})}>{fmt(row.count, '', 0)}</span></div>
      <div className="live-tag-results"><strong className={row.net > 0 ? 'is-gain' : row.net < 0 ? 'is-loss' : ''}>{fmt(row.net, currency ? ` ${currency}` : '')}</strong><span aria-label={t('Win rate')}>{Number.isFinite(row.winRate) ? fmt(row.winRate, '%') : 'N/A'}</span></div>
    </li>)}</ul> : <p className="live-muted">{t('Chưa có giao dịch gắn nhãn.')}</p>}
  </section>
}
