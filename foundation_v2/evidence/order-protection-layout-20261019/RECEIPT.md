# Order protection layout

SL/TP and the disabled Auto Break-even row use aligned 48px control surfaces from the existing project palette. Enabled protection expands into matching price/pip fields below the toggle. Price/pip edits work for new orders, pending orders and positions; clearing a field keeps its switch enabled and requires a valid price before submission.

Gross P/L estimates stay within each protection section. Optional percentage/amount sizing stays collapsed under SL, reads initial/current account balance and instrument/conversion metadata, rounds quantity down to its allowed step, and only changes the draft when Apply size is pressed. It explicitly estimates before costs. Enter in calculator fields cannot submit the order form. Order persistence/fills remain backend-owned.

Partial TP assessment: the engine supports manual partial closes, but its persisted protective exit contract has one take-profit level. Automatic multiple targets require engine, ledger validation, cost allocation and replay integration. No nonfunctional Add Partial control was added in this UI change.

Validation:
- 15 focused protection/model/notice tests passed, including BUY/SELL, unknown conversion, profit-locking stops, tick rounding, quantity steps and minimums.
- Production frontend build passed (existing bundle-size warning).
- Real native API + compact storage + disposable PostgreSQL/chart journey passed: BUY/SELL Limit/Stop, 1368/768/390px, VI/EN and dark/light. Checked matching toggle geometry, empty/enabled editors, price/pip conversion, keyboard sizing, low-budget rejection, no draft writes/markers, saved conditional orders, Market execution, active-position edits and reload persistence.
- Visually reviewed disabled/enabled/sizing and mobile position-edit screenshots. No owner session writes, broker calls, shared token changes or backend restart.

Evidence: `native/browser.json` and selected `native/*protection*.png` / `native/*risk-sizing.png`.
