# Independent calendar review — PASS

Scope: AnalyticsCalendar, shared CalendarDay, Live calendar integration and draft-only LiveDayNote drawer. Read-only product review; no original FX browser manipulation and no broker interaction.

## Source and behavior

- Analytics dates render as nonfocusable groups, with no click handler, day tooltip, plus or detail panel. Generic hover border styling now applies only to button cells. Month/year navigation and metric controls remain interactive.
- Live retains button dates. Hover and keyboard focus reveal the plus; eligible date opens a native modal drawer on the right. Escape/close/backdrop dismiss it; focus returns to its opener. Title/body are local React draft state only and reset when the drawer unmounts. No API, storage, or broker writes were introduced.
- Selected-day partial state is passed into the drawer. Unknown empty days display an unknown count and incomplete-coverage explanation, rather than claiming that no trades occurred. Proven empty days describe the current filter selection.
- New drawer labels and placeholders have VI/EN entries. Title and placeholder now retain 24px desktop/tablet and 20px mobile sizes despite global form styles.

## Evidence inspected

Parent-run, labeled fixture evidence: calendar/browser.json PASS 7 journeys; loading/browser.json PASS 9 journeys; live/report.json PASS 4 widths (1920, 1440, 768, 390). Reports show no page errors or mutations. Reviewer read the relevant runner assertions; did not independently launch the browser suite.

Actual images inspected: calendar 1920 VI dark, 1440 EN light, 390 VI dark; Live drawer 1920 VI dark, 1440 EN light, 768 VI dark, 390 VI dark. No remaining clipping/overlap found. The 768px Note type label wraps legibly. The mobile calendar retains intentional local horizontal scrolling; mobile drawer stacks facts and editor.

Resolved review history: inherited Analytics hover; missing EN copy; false empty claim for uncovered days; obsolete day-detail test expectations; global input font overriding the drawer title. Earlier failed fixture/font attempts remain in the live evidence directory.

Nonblocking polish: describe the daily-note action in the Live day button's accessible name; prefer English Trades for the drawer's list heading instead of the shared translation Trading.

Acceptance is limited to this calendar behavior and presentation. Draft persistence, all-chart arithmetic, deployed-runtime integration and broker acceptance are separate. Exact candidate index and reviewed component hashes are recorded in calendar-independent-review.json.
