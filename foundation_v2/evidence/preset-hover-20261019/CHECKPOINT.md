# Preset surfaces and missing slippage metadata

Unselected preset triggers now have a neutral control surface without a colored
border. Selected presets retain the orange state. The Create preset menu item
uses the existing hover surface. Actual production screenshots were reviewed.

The read-only [catalog diagnosis](catalog-diagnosis.json) found that both local
XAU/USD datasets lack instrument_spec/replay_instrument_spec and tick_size.
EUR/USD has its replay pip/tick specification. The existing slippage guard is
therefore intentional: a missing unit cannot define an execution offset. The UI
now explains the missing specification beside the disabled modes instead of
displaying the misleading default description. No tick value was invented and
no dataset, session, order or financial contract was changed.

Validation: production build and 20 focused Node tests PASS. [Four preset UI
journeys](ui/browser.json) verify the new trigger/create-hover surfaces alongside
CRUD and selected-state regressions. [Four category journeys](groups/browser.json)
verify the missing-spec explanation, disabled non-off metal modes, available Off
mode and working Forex controls in VI/EN and Backtesting/Prop Firm. Preset HTTP
fixtures and one extra Forex catalog fixture are labeled; owner writes blocked.
