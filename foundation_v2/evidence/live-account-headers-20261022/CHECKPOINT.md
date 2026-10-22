# Live account headings and MT5 connection clarity — 22/10/2026

Scope: latest owner comments on manual terminology, sortable header hit area/color,
and the meaning of an investor password for a demo account.

## Changes and data flow

- Manual source labels, forms, menus and CSV guidance consistently use Thủ công.
  Internal `manual` identifiers, persistence and account data are unchanged.
- Account and trade-ledger sort buttons use one compact-system recipe. The
  button fills the heading cell, inherits its resting color, retains `aria-sort`
  and keyboard focus, and uses token hover/motion. No new component dependency.
- Password is labeled Mật khẩu investor with an info tooltip explaining viewing
  versus trading access for demo/real accounts. The eye action remains separate;
  credential submission/clearing/uncertain-request behavior is unchanged.
- Python reads only SDK numeric error codes; allowlisted categories pass through
  Rust into localized UI. Raw SDK descriptions never reach the response. Legacy
  generic failures remain neutral. Prior error text is hidden during queued/syncing
  states. Effective trade-permission, identity and isolation guards stay closed.

## Verification

- Python synthetic connector suite: 9 tests passed, including auth, IPC, timeout,
  incompatible version, malformed/throwing SDK result, cleanup and permission guards.
- Account/ledger model suites: 15 tests passed.
- Vite production build passed; existing >500 kB chunk advisory remains.
- Cargo locked release build of all binaries passed. New runtime directory:
  `.runtime/api-builds/accounts-diagnostics-20261022/release`.
- Independent source review by calendar_review: no remaining findings. Its first
  cell padding finding was reproduced in browser and corrected before acceptance.
- Real 5180 account page at 1920 and 1368 widths: button x/width matches each th,
  60px height plus collapsed border; edge click changes aria-sort to descending,
  Enter restores ascending. All seven heading colors match in dark and light.
  At top of panel, nav centers219px versus heading219.25px (collapsed border).
- Investor tooltip opens on hover, has the explanatory text, and Escape dismisses.
  Password info/visibility controls do not overlap. EN/VI copy checked.
- 360×800 form has no horizontal document overflow; keyboard reaches submit and
  Cancel through the stacked, scrolling layout. See `form-360-dark.png`.
- Shared trade-ledger sample: buttons exactly match 44px th rectangles, inherit
  header color and change sort. This is a labeled UI sample, not broker evidence.
- No browser warning/error entries captured in the two QA tabs. Temporary tabs
  closed; viewport/CDP overrides reset. User form was not reloaded or submitted.

## Runtime and limits

Native/compact API8010 restarted through verified owner paths after idle/schema
preflight (9 migrations, none pending); ready endpoint returned true. UI5180 serves
new dist. No migration, new credential entry or manual broker retry was performed.
The existing automatic collector ran and now reports `mt5_sync_timeout` through
API and UI. Successful broker login/history sync remains unverified; timeout does
not prove a password error. The supplied Exness image shows read-only access
inactive, so the owner must configure an investor password to use this connector.
No broker permission setting or order was changed.

Primary references checked in browser:
- https://www.metatrader5.com/en/terminal/help/startworking/authorization
- https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py

Browser screenshot API clipped large emulated viewports; final PNG evidence uses
explicit CDP capture at the verified viewport dimensions. Incomplete captures were
removed. Screenshots cover actual account/error UI and responsive form, not a
successful connection.
