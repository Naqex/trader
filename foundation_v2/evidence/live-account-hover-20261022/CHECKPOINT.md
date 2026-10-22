# Account row hover — 2026-10-22

The accounts table used the shared current-account context to set aria-selected
and persist the hover background. Removed row selection and its CSS rule;
the account name button now exposes aria-current=true. Choosing an account
still updates live_account and keeps the existing data flow.

Validation on the real localhost:5180 production preview:

- npm run build passed; git diff --check passed.
- At 1368x790, all seven cells are transparent before hover, use the hover token
  while hovered, and return to transparent after clicking the account then leaving.
- The current account remains in the URL and aria-current after the click.
- Keyboard navigation to the name button retains a visible 2px focus outline.
- Light theme uses rgb(221,225,231) hover; dark uses rgb(61,65,72).
- At the reported 1920x940 viewport, resting cells remain transparent.
- Independent calendar_review review: no findings.

Evidence: interaction.json and rest-dark.png. No broker sync retry or execution
was requested. The existing MT5 timeout remains; this change fixes table styling.

Official reference checked in browser:
https://fxreplay.com/trading-journal — describes Live Journal account sync,
CSV import, tagging/filtering and analytics. The footer explicitly states that
FX Replay does not execute real trades or facilitate live trading.
