# Independent source review — UI system, 20/10/2026

Reviewer: delegated `ui_final_review`, read-only, current working tree. Root agent
reviewed and integrated fixes. Review covers LegacyModal, LegacyPopover,
FxSelect, ProjectDateInput, TestingPageState and related CSS; not unrelated WIP.

| Finding | Resolution and verification |
| --- | --- |
| P2: calendar Escape/arrow events could be consumed by parent LegacyPopover | Date Escape handler now runs at the field root; parent respects defaultPrevented and native-popover ownership. Browser: real chart → Go To → Custom calendar, ArrowRight moves20→21, first Escape keeps parent open and returns calendar trigger, second closes parent. |
| P2: touch calendar icon overlaps clearable field's X | Clearable geometry moved from ledger-specific CSS to date component. Browser: both controls44×44, adjacent without overlap at360px. |
| P2: clamped value09:00 while time picker still00:00 | chooseDate synchronizes pickerTime from bounded value. Browser verifies visible field and time input both09:00. |
| P3: collapsed resource status consumed Escape | Guard requires details.open; only an open status popup owns Escape. Source rechecked by root. |

Reviewer found no further blocking source defects in modal stack, restoration,
portal/theme or disabled behavior after the above fixes. Independent review was
source-only; browser and image verification in CHECKPOINT.md was done by root.

Root image review additionally found a redundant ring on the calendar icon:
the composite field now owns its one blue focus border. Checkbox/radio retain
their separate keyboard focus ring. Browser confirms picker outline none,
checkbox solid2px and field focus border blue.
