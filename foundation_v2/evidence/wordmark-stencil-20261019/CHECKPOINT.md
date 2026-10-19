# WMREPLAY stencil wordmark trial

Owner authorized a vector trial of the cut-letter direction. The existing custom
letter outlines now live in `web/public/brand/wmreplay.svg`; transparent stencil
cuts share one mask. The full header references `#wordmark`, and the compact WM
variant references `#wm`. Both inherit the existing theme color. No font, image
service, new package or application state was added. The header layout is retained.

The revised cuts in M/R/P end in clear space to avoid small protrusions. The first
trial remains in `preview-v1.png`; `preview.png` is the selected trial, rendered
from the actual served SVG. It remains an editable design for owner feedback.

Validation: Vite production build passed (existing large-chunk warning);
`node --test tests/shellPreferences.test.mjs` passed. Six scoped read-only browser
cases on production preview5180 covered dark/light at1368/768/360px, asset HTTP200,
theme control, no menu/action overlap, no document overflow and zero page errors.
Header crops and `review.json` preserve the measurements. Final desktop, mobile,
light-theme and enlarged wordmark/WM images were visually inspected. At360px the
existing full-header layout reduces the logo to70×8.67px; it is132×16.36px at the
larger widths. This is branding validation, not full-product UI acceptance.

Earlier scoped capture used an80px minimum that does not match the existing
360px layout; it was corrected to record the actual size. The broader existing
`shell-controls.browser.mjs` did not complete because its `networkidle` navigation
timed out, and is not counted as a passing test. The final logo review waits for
the rendered SVG and actual theme state instead of global network silence.

Only web assets/source were changed. Production preview serves the rebuilt
bundle; no API restart, broker/provider call or database mutation was required.
