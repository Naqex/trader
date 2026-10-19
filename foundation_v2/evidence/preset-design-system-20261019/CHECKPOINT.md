# Preset controls use shared select/menu states — 19 October 2026

Owner reported inconsistent effects on the preset trigger and Create preset row.

The trigger previously duplicated normal/hover colors, omitted the shared open state and locally remapped keyboard focus to the action color. Create preset used square corners and its own padding rather than shared menu-row geometry.

- SessionPresetMenu now consumes the existing `fx-select` / `fx-select-trigger` styles. Its CSS only owns header sizing and the owner-requested orange selected preset treatment.
- Shared select menu rows now also expose `fx-menu-action` for an action rather than a selectable value. Create preset consumes the same row geometry, hover and keyboard focus, keeping its orange action text. The plus sign uses the existing TestingIcon.
- Open/closed/selected state and preset API data flow are unchanged. The change reuses CSS roles without introducing a new React component or altering persistence.

Validation: production build PASS; four existing preset CRUD/error/reload journeys PASS (Backtesting/Prop Firm × VI/EN), now including shared hover/open colors, pointer versus keyboard focus, menu radius/type and the control-height token. All owner writes blocked; preset HTTP uses the existing labeled in-memory fixture, catalog reads use real local services. Initial test attempts incorrectly compared the action's full geometry with the taller catalog asset rows; the oracle was corrected to compare shared typography/radius and independently assert the single-line control-height token.

Actual transitions enabled: four additional local checks at 1368/360px × dark/light PASS. Hover settles to the shared surface, uses the existing 120ms motion token, has no transform, and does not show keyboard focus under pointer interaction. Representative screenshots reviewed. `motion.json` holds these measurements; `ui/browser.json` holds journey results. No backend restart or database writes.
