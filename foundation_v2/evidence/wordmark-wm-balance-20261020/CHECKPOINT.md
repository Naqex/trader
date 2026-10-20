# WM spacing and shape refinement — 20 October 2026

Owner approved widening W, increasing W–M spacing and reducing rounded ends. W is now 29 units wide (previously 27); the gap is 5 units (previously 2). M retains its 26-unit width. Filled paths use small corner radii instead of round stroke caps. REPLAY geometry, including the restored R stem, is unchanged.

Both the full wordmark and compact mark reuse #wm in the same currentColor SVG. The compact viewBox expands from 55 to 60 units to contain the wider geometry; the full 242x30 box and header dimensions stay unchanged. No app data or state logic changed.

Validation: npm run build passed (existing chunk-size warning); node --test tests/shellPreferences.test.mjs passed 1/1; scoped diff check passed. Browser review covered enlarged full/compact marks on dark/light, actual header at 1280, and responsive DOM metrics at 360 (scrollWidth 360, logo 70x8.67 CSS px). Emulation reset. preview.png is a crop of the real browser screenshot using the same SVG asset as the header. This is branding QA only; dashboard data/API health is outside scope.
