# Partial TP controls

Owner requested a centered orange add action, the reference's Single profit/back
control and allocation total, and quick percentage options beneath each share.

Implementation reuses PartialTakeProfits draft state and existing engine validation:
- Add action uses shared primary background/hover/text tokens and centers in TP.
- Split toolbar returns to one full-size TP at the first target price, clearing
  only split rows in the local draft. The adjacent badge reports total / 100% and
  marks non-100 totals negative. No order is changed before explicit Save.
- 10/25/50% buttons update their own row. They deliberately do not silently
  redistribute other shares; the existing 100%-total/lot-step validation remains.
- Selected shortcut uses orange semantic tokens; hover reuses control tokens.
  Coarse pointers keep 44px shortcut targets. VI/EN labels are in testing-copy.
- Top alignment keeps price, pips and share inputs level despite share shortcuts.

Validation:
- `browser-final/browser.json`: three passing native/compact browser journeys
  (1368 dark VI, 768 light EN, 390 dark VI). Checks cover quick values, invalid
  total indicator, single-mode return preserving first price, centered add button,
  input alignment, failed invalid save, target fills/accounting, reload and branch.
- Production build passed; existing large-chunk advisory remains.
- Visually reviewed mobile dark, tablet light and actual owner desktop evidence.
- Rebuilt/reloaded port 5180 and restored the owner's visible 0.5lot, 20pip SL,
  two TP40/60pip at 50/50 draft. No owner order submitted; backend untouched.
- Scoped whitespace/diff review passed. Proof: `owner-controls.png`.
