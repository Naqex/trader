# Slippage category rows — 18 October 2026

Owner correction: the FXReplay reference shows one row per asset category, with the category first, its symbols alongside, and one shared Off/Light/Medium/Fixed control.

Implemented that grouping for new slippage settings in both session modes and preset editing. Selecting a mode or fixed amount updates every selected asset in that category while preserving individual spread/commission settings and other categories. Persistence and execution contracts remain per asset, so each asset still uses its own pip/tick size. Legacy V1 monetary slippage fields remain separate and unchanged.

Existing presets may contain different modes or fixed amounts within one category. Reading them shows an explicit mixed state with no selected mode, without replacing their stored values. A deliberate choice applies to the whole group. If any group member lacks a valid unit spec, non-Off modes stay disabled; existing validation still blocks unsupported active slippage.

Validation:

- Focused model, preset and translation tests: 18 passed.
- Production Vite build: passed, existing chunk-size warning unchanged.
- `node tests/slippageGroups.browser.mjs`: four journeys passed, Backtesting/Prop Firm × VI/EN. Production UI with isolated storage; real catalog extended by an explicitly labeled cloned Forex dataset to exercise two assets in one category. All backend writes blocked. Verified shared modes/fixed values, mixed presets, independent category settings, save/reload and desktop/360px layout. This is UI/configuration evidence, not real market data or new backend execution validation.
- Screenshots reviewed at desktop and mobile. `browser.json` records the scope and results.
- Independent scoped source review: no blocker; mixed-state preservation, fee/category isolation, missing-unit guard and V1 compatibility checked.

No backend schema, financial fill algorithm, leverage or hedging changes.
