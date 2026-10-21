# Live accounts and shared controls — 21 October 2026

## Scope

Owner's five browser comments: reuse Practice filters in Live; remove the redundant Live title/action row; place data-view mode in the app header; adapt Connect and Transactions to the supplied FX reference using existing design-system components. This is scoped UI acceptance, not whole-product or broker acceptance.

## Implementation and state flow

- `FilterDrawer` owns only the shared dialog, tabs, sections, search and footer. Practice and Live retain their existing filter semantics. Live copies applied filters to a draft on open; cancel/Escape discards edits; Apply commits; Clear inside the drawer edits only the draft. Native modal focus containment and opener restoration are shared.
- The data-view selector has one shell-header location. Routes without a supported preview keep it disabled. Existing fullscreen chart behavior still hides the shell header; no preview is introduced into replay execution.
- Connect lists broker and manual accounts, supports search/source filtering/sort/pagination, and provides CSV template/import, manual account and MetaTrader choices in the right pane. Existing manual and import dialogs remain mutation owners. Demo preview cannot mutate records.
- Transactions derives account-scoped cashflows independently of trading PnL. Manual opening balance is a separate event, not a deposit. Unsupported manual funding and unknown broker opening balance remain `—`. Broker totals cover only the synchronized history. Existing Equity, margin, positions, orders and quote facts remain accessible in the read-only broker disclosure.
- MetaTrader panel describes the existing preconfigured demo-only terminal adapter. Check connection refreshes broker data without unmounting the pane. No password collection, broker login, terminal switching or broker order execution was added.

## Verification

- `node --test tests/*.test.mjs`: 432 passed, 0 failed. Includes four new account-model tests for opening/funding separation, signed broker cashflows, unknown versus zero, account isolation and stale data. See `tests.log`.
- `npm run build`: passed. Existing >500 kB chunk warning remains; see `build.log`.
- Independent source review: `/root/ui_final_review` found no remaining blocker after restoring broker facts and localizing new UI. Review was source-only; browser verification below was performed by root through CUA against local production preview 5180.
- Real empty Connect state, manual-account dialog open/cancel, MetaTrader instructions, Check connection retaining pane, no owner-data writes.
- Demo Connect and Transactions; account amounts and unavailable opening balance, withdrawal empty state, broker disclosure retaining Equity/margin/positions/orders/quotes.
- Live shared filter: Sell apply changes calendar results, focus returns to opener; Clear then Escape leaves applied filter unchanged. Mobile drawer fills viewport.
- Practice shared filter: Basic sections render, ArrowRight selects Tags and moves focus, Escape closes and restores Basic opener.
- Header observed on Live, Practice, Strategies and Settings (disabled where unsupported); mobile logo/utilities and selector do not overlap. Existing fullscreen chart loaded without console errors; shell header remains hidden by its prior fullscreen layout.
- Responsive 1368×790, 768×900, 360×800; account layout stacks below 1000 px, tables scroll locally, document has no horizontal overflow. Manual account dialog fits mobile. Dark/light and VI/EN checked. Screenshots are selective receipts, not exhaustive route coverage.
- Browser error log empty in final checked tab.

## Limits

No configured broker connection on API 8010, so no live-login/sync success claimed. No new manual cashflow write API or connector authentication implemented. Current MT5 worker requires an already authorized demo terminal plus workspace adapter configuration. The owner's terminal screenshot reports Invalid account; UI work cannot resolve broker credentials.

Potential future web-login flow still needs a dedicated terminal/connector and explicit credential storage/account-isolation design. Official references: https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py and https://www.metatrader5.com/en/terminal/help/startworking/authorization.

No migrations, terminal actions, provider setup or shared pinned-system edits were necessary. Unrelated working-tree edits were preserved.
