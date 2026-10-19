# Stable chart startup loading surface

The route Suspense fallback and initial session read used `is-viewport`, which
filled the shell content below the header. Native chart initialization used
`is-overlay`, fixed across the viewport. This caused the two successive loading
layouts reported by the owner. The baseline browser check reproduced a loader
rectangle of (0,46,1368,744) instead of (0,0,1368,790).

The shared loading stylesheet now gives every ChartLoadingState fixed viewport
geometry above the header and floating playback controls. Background, text and
spinner border resolve directly from project tokens rather than lazy chart CSS.
The existing route → session-read → engine-ready state flow is unchanged; no
request, execution, chart instance or stored-data behavior was modified.

Validation:

- Production build passed, with the existing large-chunk advisory.
- `tests/chartStartup.browser.mjs` gates the actual preview's lazy JS, synthetic
  session response and native library separately. It reproduces the baseline
  failure under `before/` and passes after the fix under `verified/`.
- At 1368px/dark and 390px/light, all three phases have identical geometry,
  center and palette, with one loader covering the header in every sampled frame
  (39 frames per journey). Native host stays hidden until ready; then loading
  disappears. The 403 case also exits loading and exposes the denied state.
- Initial test fixture omitted the chart history endpoint while retaining a
  dataset hash, so its native-ready wait timed out (`final/`). The verified
  fixture follows the existing chart UI fixture convention of using its local
  visible rows with dataset_sha256=null. That failed attempt is not acceptance.
- Reloaded the owner's real preview: `owner-loading.png` shows the full-page
  loader; `owner-ready.png` records the ready chart. No order was submitted.

Requests in automated tests are intercepted. This proves startup UI behavior;
it is not native API execution or whole-product acceptance.
