# MT5 centered asset picker and quote-time warning — 24/10/2026

## Result and state

- Asset search uses the existing top-document LegacyModal, centered in the viewport, searchable with group filters and bounded scrolling. Escape/outside dismissal, focus trap and returning focus to the original native-chart iframe trigger are preserved.
- The exact current connection's snapshot symbol list remains the selection authority. Selection changes only mt5_symbol; the existing route preserves connection/workspace/timeframe.
- M1–D1 controls move out of asset search to a separate Live chart header selector. Advanced chart's single-resolution native selector is hidden only in Live; Replay keeps its native controls. Lightweight/fallback toolbar has a design-system FxSelect and follows the same route.
- API currently exposes strings only. MT5 Python symbol_info supports path/category/description, but current Live transport discards them; workspace market-assets endpoint is unavailable. No other broker's metadata is substituted.
- Provisional grouping recognizes known currency pairs, common crypto bases and precious-metal codes with conservative broker suffixes. Unknown stock/index/energy/opaque names remain unclassified. This is display-only and never changes instrument pricing, contract or execution rules. Full broker taxonomy requires a later scoped metadata transport change.
- Quote freshness continues comparing epoch milliseconds. No timezone shift, system-time change or threshold relaxation was made. Warning shows the last quote in browser-local time with zone and its age; a future tick gets a distinct clock-sync warning. Invalid/out-of-Date-range timestamp remains a safe generic warning.

## Read-only diagnosis

At 2026-10-24T03:40:12Z, current EURUSDm quote timestamp was 2026-10-23T20:58:57.684Z (03:58:57 GMT+7 on 24 October), about 6h41m old. UTC+7 vs UTC display is not the cause. Forex weekend closure is likely (Saturday), but broker market-session status was not supplied, so not asserted as verified.

Primary references: https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py and https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfo_py.

## Verification

- Isolated production build PASS; source archived from HEAD and overlaid only with this scope, excluding unrelated dirty work. Existing large-chunk Vite advisory remains.
- Node logic tests: 10/10 PASS (classifier known/unknown and existing permission/account/quote age/preview/receipt behavior).
- Synthetic SSE browser suite PASS on preview5188 and installed5180 at 1920 dark, 1440 light, 768 dark, 390 dark: centered geometry; groups; unknown/empty/search miss; keyboard selection; iframe focus restoration; M1→M5 separately while preserving symbol; unavailable options disabled; stale/future/invalid time warnings; reconnect and chart retention. Also Lightweight M5→H1 plus symbol change preserving H1. No mutations/page errors.
- Replay regression suite 18 cases PASS, no unexpected requests/page errors.
- Actual installed local read-only browser journey PASS: 241 symbols from connection, 106 in provisional Forex group, search dialog renders and dismisses correctly; actual warning gives 03:58:57 GMT+7 and six-hour age. No order preview, OrderCheck, command, terminal restart or backend change.
- Independent read-only source review completed. Findings about missing Advanced/fallback timeframe controls resolved and covered by browser checks. No remaining scoped findings.

## Delivery

- Local UI5180 promoted atomically; API8010 unchanged. Old hashed assets retained for already-open pages. Reload once for the new bundle.
- Before index SHA256: 6d5e7b169ca4e94e8e068242b8e6c5af33a5a6de1b7be63fce75995b43aa718f.
- After index SHA256: 8fa7613bd4080374827fdd443cb4cbfe2937bc707d1e8e3eccb8fd4a87252388.
- Builds, source archive, index backup, promotion record, actual GET snapshot, reports and screenshots: E:/BACKUP-TRADINGWORKSPACE/mt5-asset-picker-20261024/.
- UI/contract acceptance only; real broker execution has not been tested or authorized by this task.

## Reproduce

From foundation_v2/web: `node --test tests/mt5SymbolCategory.test.mjs tests/liveTradingModel.test.mjs`; set TW_LIVE_UI_ORIGIN/TW_LIVE_UI_EVIDENCE then `node run_live_market_acceptance.mjs`. Replay suite: set CHART_DS_ORIGIN/CHART_DS_OUTPUT then `node tests/chartDesignSystem.browser.mjs`. Browser fixtures block broker mutations.
