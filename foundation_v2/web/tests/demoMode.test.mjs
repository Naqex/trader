import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_LEDGER, DEMO_SESSIONS, demoSessionItems, demoDashboardAnalytics, demoResult, demoFilterRows, demoOverview } from '../src/demoFixtures.js'
import { canPreviewDemo, demoToggleHref, previewMode, previewStateHref, previewOptions } from '../src/demoMode.js'
import { buildWorkspaceHref, readWorkspaceContext } from '../src/workspaceContext.js'
import { sessionPeriods } from '../src/sessionPerformanceModel.js'

test('demo curve, money, fee and R values reconcile to the same ledger', () => {
  assert.equal(DEMO_LEDGER.length, 160)
  assert.equal(new Set(DEMO_LEDGER.map(row => row.trade_id)).size, 160)
  for (const session of DEMO_SESSIONS) {
    const rows = demoFilterRows([session.record_id]), { metrics } = demoResult(rows, session)
    assert.equal(rows.length, session.record_id === 'demo-gold' ? 120 : 20)
    const net = rows.reduce((sum, row) => sum + row.net_pnl, 0)
    assert.equal(metrics.net_pnl, net)
    assert.equal(metrics.ending_closed_trade_balance, 10000 + net)
    assert.equal(metrics.closed_trade_balance_curve.at(-1).closed_trade_balance, 10000 + net)
    assert.equal(metrics.wins + metrics.losses + metrics.breakeven, rows.length)
    for (const row of rows) {
      assert.equal(row.gross_pnl - row.fees, row.net_pnl)
      assert.equal(row.realized_r, row.net_pnl / row.planned_risk_budget)
      const gross = (row.price_close - row.price_open) * (row.side === 'buy' ? 1 : -1) * row.quantity * (row.symbol === 'XAUUSD' ? 100 : 100000)
      assert.ok(Math.abs(gross - row.gross_pnl) < 1e-7)
    }
  }
  const { performance } = demoOverview()
  assert.equal(performance.months.reduce((n, item) => n + item.closed_trade_count, 0), 160)
  assert.equal(performance.symbols.reduce((n, item) => n + item.closed_trade_count, 0), 160)
})

test('demo selection and UTC date filters have an independent numeric oracle', () => {
  assert.equal(demoFilterRows(null, { side: 'buy' }).length, 80)
  assert.equal(demoFilterRows(null, { outcome: 'win' }).length, 68)
  assert.equal(demoFilterRows(null, { outcome: 'loss' }).length, 64)
  assert.equal(demoFilterRows(null, { outcome: 'breakeven' }).length, 28)
  assert.equal(demoFilterRows([]).length, 0)
  assert.ok(demoFilterRows(null, { from: '2026-09-01', to: '2026-09-30' }).every(row => row.report_time_utc.startsWith('2026-09')))
})

test('activity time filters measured user intervals, while historical backtest time stays separate', () => {
  const all = demoOverview().performance
  assert.equal(all.time_invested_seconds, 67200)
  assert.equal(all.historical_time_replayed_seconds, 3135600)
  assert.deepEqual(all.activity_months, [
    { month: '2026-07', time_invested_seconds: 16200 },
    { month: '2026-08', time_invested_seconds: 19800 },
    { month: '2026-09', time_invested_seconds: 31200 },
  ])
  const selected = { sessionIds: ['demo-london'], filters: { from: '2026-08-01', to: '2026-08-01' }, timezone: 'UTC' }
  const august = demoOverview([], selected).performance
  assert.equal(august.time_invested_seconds, 5400)
  assert.equal(august.historical_time_replayed_seconds, 432000)
  assert.equal(august.scope.session_count, 1)
  assert.equal(august.metrics.closed_trade_count, 0, 'known activity does not depend on closing a trade')
  const local = demoOverview([], { ...selected, timezone: 'Asia/Ho_Chi_Minh' }).performance
  assert.equal(local.time_invested_seconds, 10800)
  const outside = demoOverview([], { ...selected, filters: { from: '2027-01-01' } }).performance
  assert.equal(outside.time_invested_seconds, 0)
  assert.deepEqual(outside.activity_months, [])
  const row = { session_id: 'a', report_time_utc: '2026-01-31T23:30:00Z', net_pnl: 1 }
  assert.equal(demoFilterRows(null, { from: '2026-02-01', to: '2026-02-01', timezone: 'Asia/Ho_Chi_Minh' }, [row]).length, 1)
  assert.equal(demoOverview([row], { timezone: 'Asia/Ho_Chi_Minh' }).performance.months[0].month, '2026-02')
})

test('Gold Swing demo has five complete backtest years, separate from real activity time', () => {
  const rows = demoFilterRows(['demo-gold'])
  const history = sessionPeriods(rows, 'UTC', new Date('2026-10-25'), 'market').performance.months
  assert.equal(history.length, 60)
  assert.deepEqual([...new Set(history.map(month => month.label.slice(0, 4)))], ['2021', '2022', '2023', '2024', '2025'])
  assert.ok(history.every(month => month.count === 2 && month.value === month.profit + month.loss))
  assert.ok(history.some(month => month.value < 0))
  assert.ok(history.some(month => month.value > 0))
  assert.ok(history.some(month => month.value === 0 && month.count > 0))
  assert.deepEqual(sessionPeriods(rows, 'UTC', new Date('2026-10-25'), 'activity').months.map(month => month.label), ['2026-09'])
})

test('preview keeps exactly three fixture sessions and rejects the retired many mode', () => {
  assert.equal(demoSessionItems(new URLSearchParams('ui_state=many')).length, 3)
  assert.equal(previewOptions('overview').some(option => option.value === 'many'), false)
  assert.equal(previewMode(new URLSearchParams('demo=1&ui_state=many'), 'overview'), 'demo')
})

test('demo toggle roundtrip retains every real context/filter query value', () => {
  const original = 'http://127.0.0.1:5180/?workspace=tenant-a&view=analytics&session=real-owner&dataset=real-bars&cursor=500&sessions=a&sessions=b&analytics_asset=EURUSD&cutoff=bar-500'
  const enabled = demoToggleHref(original, true)
  assert.equal(enabled.searchParams.get('demo'), '1')
  assert.equal(demoToggleHref(enabled, false).href, original)
  const destination = new URL(buildWorkspaceHref('analytics', 'tenant-a', enabled.searchParams, { analytics_source: 'prop' }), enabled)
  assert.equal(destination.searchParams.get('demo'), '1')
  assert.deepEqual(readWorkspaceContext(destination), readWorkspaceContext(enabled))
  assert.equal(new URL(buildWorkspaceHref('overview', 'tenant-a', enabled.searchParams, { demo: null }), enabled).searchParams.has('demo'), false)
})

test('demo does not replace chart or order-entry surfaces', () => {
  assert.equal(canPreviewDemo('replay', new URLSearchParams('surface=workspace')), false)
  assert.equal(canPreviewDemo('replay', new URLSearchParams('select=1')), true)
  assert.equal(canPreviewDemo('trade', new URLSearchParams('intent=order')), false)
  assert.equal(canPreviewDemo('settings', new URLSearchParams()), false)
})

test('new-session preview preserves old session data and round-trips only supported pages', () => {
  const oldRows = DEMO_LEDGER.filter(row => row.session_id !== DEMO_SESSIONS[0].record_id)
  assert.equal(demoFilterRows([DEMO_SESSIONS[0].record_id], {}, oldRows).length, 0)
  assert.equal(demoFilterRows([DEMO_SESSIONS[1].record_id], {}, oldRows).length, 20)
  assert.equal(demoFilterRows(null, {}, oldRows).length, 140)
  for (const view of ['replay', 'trade', 'analytics']) {
    const url = previewStateHref(`http://127.0.0.1:5180/?view=${view}&select=1`, 'new-session')
    assert.equal(previewMode(url.searchParams, view), 'new-session')
  }
  assert.equal(previewMode(new URLSearchParams('demo=1&ui_state=new-session'), 'overview'), 'demo')
})

test('state previews preserve real context, round-trip to real and fence unsupported surfaces', () => {
  const original = 'http://127.0.0.1:5180/?workspace=tenant-a&view=overview&session=owner&dashboard_from=2026-01-01'
  for (const option of previewOptions('overview').filter(option => !option.disabled)) {
    const href = previewStateHref(original, option.value)
    assert.equal(previewMode(href.searchParams, 'overview'), option.value)
    assert.equal(href.searchParams.get('session'), 'owner')
    assert.equal(previewStateHref(href, 'real').href, original)
  }
  assert.equal(previewMode(new URLSearchParams('ui_state=error'), 'overview'), 'real')
  assert.equal(previewMode(new URLSearchParams('demo=1&ui_state=typo'), 'overview'), 'demo')
  assert.equal(previewMode(new URLSearchParams('demo=1&ui_state=unknown'), 'market-data'), 'demo')
  assert.equal(previewMode(new URLSearchParams('demo=1&ui_state=error&surface=workspace'), 'replay'), 'real')
  assert.equal(previewMode(new URLSearchParams('demo=1&ui_state=error&intent=order'), 'trade'), 'real')
  const carried = new URL(buildWorkspaceHref('analytics', 'tenant-a', previewStateHref(original, 'loading').searchParams), original)
  assert.equal(carried.searchParams.get('ui_state'), 'loading')
  assert.equal(new URL(buildWorkspaceHref('overview', 'tenant-a', carried.searchParams, { demo: null }), original).searchParams.has('ui_state'), false)
})
