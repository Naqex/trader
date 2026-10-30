import SessionReports from './SessionReports.jsx'
import { TradeInspector } from './FxTradeLedger.jsx'
import { TradeNoteDraft, TradeDetailHeading } from './TradeDetailContent.jsx'
import { navigate } from './clientNavigation.js'
import { useTestingLocale } from './testingLocale.jsx'

// Historical journal links retain their Practice source instead of opening Live notes.
export default function TradeNoteRoute({ workspace, query }) {
  const { t } = useTestingLocale()
  const ledgerQuery = new URLSearchParams(query)
  ledgerQuery.set('view', 'trade'); ledgerQuery.set('area', 'testing'); ledgerQuery.set('section', 'trades')
  ledgerQuery.delete('trade'); ledgerQuery.delete('trade_id')
  const close = () => navigate(`/?${ledgerQuery}`, { replace:true })
  return <>
    <SessionReports ledgerOnly workspace={workspace} query={ledgerQuery}/>
    <TradeInspector onClose={close} heading={<TradeDetailHeading title={t('Notes')}/>} data-session-id={query.get('session')} data-trade-id={query.get('trade') || query.get('trade_id')} aria-label={t('Ghi chú giao dịch')}>
      <TradeNoteDraft/>
    </TradeInspector>
  </>
}
