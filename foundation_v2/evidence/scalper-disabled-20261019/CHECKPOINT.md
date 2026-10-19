# Scalper disabled controls and Partial TP copy

- Renamed the return action to “Chốt lời một lần” / “Single take profit”; its
  existing draft conversion behavior is unchanged.
- Moved SL/TP/Auto Break-even switches before their labels with an 8px gap.
- Off SL/TP rows use the shared disabled opacity and empty disabled inputs.
  Hidden distance and unit values remain in local draft state and return when
  re-enabled. No preset migration or execution-engine change is required.
- Production build passed (existing chunk-size advisory). Five scalper preset
  unit tests passed.
- `final/browser.json`: 17 UI fixture cases passed, no browser errors or
  unexpected requests, covering 1368/390px and dark/light. Added checks cover
  left-side switches, empty disabled inputs, units locked while off and preserving
  edited distances/units through a toggle cycle. Existing order side-switch test
  now explicitly enables SL before reading its value, matching the current
  default-off contract. The first attempt failed on that stale expectation;
  its report remains outside final evidence.
- Reviewed actual owner-tab disabled state (`owner-scalper-off.png`) and the
  mobile light fixture. Reloaded port 5180 preview and left Scalper mode open;
  no order submitted and no preset saved in the owner's session.

Fixture requests were intercepted; these checks do not establish native execution
or whole-product acceptance. The Partial TP label's existing browser selectors
were updated; its full native acceptance suite was not rerun for this copy edit.
