# Session option control alignment

The smoothing field inherited 14px body type and measured 40px high beside a
36px/13px select. Its disabled switch was also dimmed twice by competing CSS.
It now uses the same control-height/type/line tokens as the select, and applies
disabled opacity once. Small-screen controls follow the existing 44px token.

Smoothing, cost and hedging switches share the pinned 28×16px switch geometry.
Option section spacing, surface radius, headings and metadata use the current
annam-compact tokens. Shared styles cover the saved-session settings drawer too.
The navigation and preset-editor heading now read Tùy chọn / Options, with a
context-specific translation key to avoid the existing Custom translation.

Validation: Vite production build and 2 copy tests PASS. The [four preset/UI
journeys](ui/browser.json) assert adjacent control dimensions, type, line height,
single disabled opacity and switch selected color at 1368/360px in both themes
and languages, alongside existing CRUD/error regressions. [Four asset-category
journeys](groups/browser.json) also PASS. Real local catalog reads; preset HTTP
and creation failure fixtures are labeled, with all owner writes blocked.
Desktop/mobile dark/light screenshots were visually reviewed. Independent review
caught the shared-drawer selector scope; the corrected selector was reviewed and
the focused production-UI suite rerun. No backend/data contract changes.
