# Menu, table header and calendar boundaries — 29 October 2026

## Delivered

- Shared FxSelect, SessionFilter, filter/action menus and anchored LegacyPopover
  shells are borderless. Search separators, focus feedback and tooltip borders
  remain intact.
- Centered table headings align the text to the cell center. Equal action gutters
  reserve sort/priority/clear space from the start, so sorting cannot shift the
  heading or column. This costs horizontal space in centered columns.
- Weekly Live Calendar summaries own their colored right border. The calendar
  supplies the neutral baseline on that same pixel; the adjacent analytics pane
  does not add a second border. Existing single-owner day/week/month seams remain.

These are presentation changes. Existing sorting state, selection state and PnL
tone rules remain their data owners.

## Evidence

Local artifacts: `E:/BACKUP-TRADINGWORKSPACE/ui-boundaries-20261029/`.

- Production build passed, including revised constant header gutters (`dist-r2`).
  Existing large-chunk advisory remains.
- `calendar/browser.json`: PASS, seven width/theme configurations from 390 to
  1920px including 1240/1241 boundary, gain/loss/flat/unknown/empty, hover/focus,
  drawer return, 4/5/6-week geometry and month edges. New assertions check right
  weekly borders and absence of the neighboring sidebar border.
- `controls-r3/browser.json`: PASS, 1920 dark/light and 390 light; inactive,
  hover, ascending, descending, multiple and cleared sorting keep identical
  column/text centers with nonoverlapping actions. Menus retain search, Escape,
  focus return; FxSelect, account/session and anchored popup borders are zero.
- Independent review identified the first version's changing gutter, which
  widened the column 56px on sort. Constant gutters and a no-shift assertion
  resolved this; reviewer found no remaining blocking issue in the revised delta.
- UI-only promotion retained old hashed assets and private branding, saved the
  previous index, and replaced the entry index atomically. No API or MT5 restart.
- `runtime-final/browser.json`: PASS on actual localhost:5180, GET-only with
  external requests and writes blocked. Actual trade sort, account menus,
  replay picker search/keyboard/Escape and calendar seam were verified.
  Calendar showed 14 trades/$1.01; the hovered green week right edge was 1px,
  exactly at the calendar pane boundary, beside a 0px sidebar border. Inspected
  full screenshots and the ten-pixel seam crop show one stroke.
- Served index SHA256:
  `8de4a8a0cce8afe26f0217af1b185276a09c98ccf36184bd946fd5315f6d399a`.
  Rollback index: `ui-before/index.html` under the artifact directory.

The first controls attempt failed on a stale account-trigger selector after its
sort checks passed; `controls/browser.json` retains the failure. The corrected
selector and subsequent revisions passed. Preview processes owned by this task
were stopped. No trading action was performed or broker gate closed.
