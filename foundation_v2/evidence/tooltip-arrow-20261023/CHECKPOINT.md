# Tooltip arrows and centered MT5 access choices

Scope: center the Trading / Read only radio choices and add the owner's requested
small pointer to app-owned tooltips.

## Implementation

- Center only the MT5 radio-choice row; labels and the rest of the form retain
  their normal alignment. Trading remains the left and default choice.
- LegacyPopover exposes its computed top/bottom side and a clamped horizontal
  arrow position for tooltip roles. Ordinary menus retain their existing layout.
- ProjectTooltipLayer renders the shared arrow through CSS. It matches theme
  surface/border tokens, points toward the anchor, flips sides with placement and
  avoids rounded corners at viewport edges. A scrolling text span keeps long
  content bounded without clipping the arrow.
- Existing hover delay, keyboard focus, touch help, aria-describedby and Escape
  behavior are retained. No dependencies, extra observers or polling were added.
  The chart's app-owned tooltip controller imports the same CSS; vendor-rendered
  chart data tooltips retain their existing renderer lifecycle.

## Verification

- Production build passed, with the pre-existing main-chunk size warning.
- Actual localhost:5180, VI/dark 1920x940: radio-choice center 1742.992px versus
  group center 1743px; Trading checked. Login help opens on hover, with an 8px
  arrow and associated description; tooltip fits inside the right edge.
- At 1920x800, collapsed-rail Settings help flips above its trigger near the
  viewport bottom, stays at x=8px and shows its arrow on the bottom edge.
- EN/light 390x844: centered choices within 0.01px, no document horizontal
  overflow, account-help tooltip at x=65..345px with matching light surface.
  Escape removes tooltip and aria-describedby while retaining trigger focus.
  Switching to Read only updates the password label; restored Trading afterward.
- UI Reference dialog: tooltip appears above the modal surface with its arrow,
  retains focus on the help control, and Escape closes only the tooltip. Normal
  popover still focuses Buy initially; Escape returns focus to its opener.
- Screenshots reviewed: mt5-dark.png, edge-flip-dark.png, mobile-en-light.png and
  modal-dark.png. Temporary viewport, locale and theme changes restored. No
  connection submission, credentials, sync commands or trading operations used.
- Diff whitespace check passed. This is scoped UI acceptance, not broker execution
  or whole-product acceptance.
