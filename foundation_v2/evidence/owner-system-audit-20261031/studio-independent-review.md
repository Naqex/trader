# Studio — independent review (01/11/2026)

Scope: Studio WIP in `foundation_v2/web`, against `STUDIO-SPEC.md`. Read-only source review plus isolated Chromium fixture at **127.0.0.1:5251**. No source edits, staging, commits, real provider/broker calls, management services, or owner data. Findings describe the pre-fix snapshot reviewed around 21:35–21:40 local time. The integration owner owns fixes and revalidation.

## Findings

### P2 — Studio width cap loses to the shared page rule

- Location: `web/src/ai-workspace.css:3`.
- The new `max-width:calc(960px + 2 * var(--ds-page-gutter))` is overridden by the more specific `.fx-app.fx-shell-story:not(.is-chart-workspace) .fx-content > :is(...)` rule at `web/src/page-layout.css:5–6`.
- Browser evidence at 1440×940: `.ai-workspace` width **1144px**, computed `maxWidth: none`, padding `20px 0px 40px`, gutter token `32px`. The Connections rows stretch across the available shell instead of respecting the intended quiet column. This gets wider on larger screens.
- Fix the Studio-scoped cascade and assert computed/bounding width, rather than only testing page overflow. Since the parent already owns page gutters, choose the intended content width explicitly.

### P2 — Connection status is absent from the row button's accessible name/description

- Location: `web/src/AiProviderSettings.jsx:155–158` (`AiStatus` at line 158).
- Moving the status inside the whole-row button makes the status span a nested live region. Chromium's AX tree retains the `status` node, so it is not accurate to claim that the span is entirely hidden. However, its text is excluded from the button's accessible name and there is no `aria-describedby` relationship.
- Observed aria snapshot:

  ```text
  button "CLIProxyAPI Dùng nhiều nhà cung cấp AI qua một cổng 2 tài khoản đã lưu"
    status: Đã tải model
  ```

- On keyboard focus the control does not expose the connection's current status through its name/description. A previous live announcement is insufficient when revisiting the button. Connect the row button to a stable status ID with `aria-describedby`, or supply an equivalent explicit accessible name. Keep text plus dot and the live update behavior where needed.

### P2 — Gateway runtime errors produce a warning row and a positive drawer status

- Location: `web/src/AiProviderSettings.jsx:106–114`, used at line 165.
- `tone()` checks `value.error` for ChatGPT Web but returns from the local-gateway branch first. The row separately checks `needsAttention`, while the drawer directly calls `tone()`.
- This is a possible real contract: `api-rust/src/ai_gateway.rs:208–209` overlays `runtime.error` onto a catalog response, including a `catalog_ready` response.
- Fixture `{status:'catalog_ready', error:'ai_gateway_runtime_error', runtime:{managed:true,running:true,accounts:2}}` produces row `ai-status is-warning`, drawer `ai-status is-positive`; both say `Đã tải model`, while the drawer also displays an error. Use one error-aware status/tone rule in both places, preserving the intentionally stopped gateway exception.

### P2 — Composer removes the field focus indicator without a clear replacement

- Location: `web/src/ai-workspace.css:91–93`.
- The textarea sets `outline:none`, has no border/shadow, and the form only switches its 1px border to `--project-border-strong`. The required `--wm-focus` indicator from the spec is not used.
- Focused browser measurements in dark mode: textarea border `0px none`, outline style `none`, box shadow `none`; parent form border `1px solid rgb(66,66,66)` and no shadow; `--wm-focus` is `#5AAEFF`.
- Give the focused composer a visible token-based focus border/ring. It can remain on the composite form so that it keeps the chosen flat layout.

### P2 — The new fixture test can call a real service through Vite's health bridge

- Location: `web/tests/aiStudio.browser.mjs:61` and `:114` in the reviewed snapshot.
- The test aborts browser requests to other origins, but continues same-origin non-`/api/` requests. Opening the old automation URL redirects to Paperclip and triggers `/integrations/paperclip/health`; `paperclipBridge.mjs` handles that on the Vite server and fetches the real Paperclip service. Browser origin filtering cannot block that server-side request.
- Mock `/integrations/*` explicitly before `route.continue()` in every context, and stub integration documents for iframe fixture checks. Do not use the original real-service Paperclip test in this expired-provider-key session. Root has been informed and is handling this guard.

## Checks that passed

Ran a temporary copy of `tests/aiStudio.browser.mjs` with only the Playwright import resolved to the existing local module and all `/integrations/*` reads fulfilled as unavailable. Used port 5251; no test network reached other local services. The original source test was not modified by this reviewer.

- All four combinations dark/light × vi/en: exact four Studio tabs in the specified order, Studio rail label, ready gateway positive state, refresh icon/text centre and status dot/text centre within 1px.
- Selected, hovered and selected+hover row colors differ after transitions in all four combinations. Measured light selected `rgb(255,240,221)`, hover `rgb(239,239,239)`, selected+hover `color(srgb 0.967216 0.921333 0.863216)`; dark selected `rgb(50,35,19)`, hover `rgb(29,29,29)`, selected+hover `color(srgb 0.201255 0.155373 0.106431)`.
- Automation URL replaces to Paperclip; gateway deep link lights Connections.
- Connections, Reviews and Models have no document-level horizontal overflow at 390px. Desktop Connections and mobile Reviews screenshots were visually inspected; vertical stacking remains legible. Studio tabs use the existing horizontal scroll behavior on mobile.
- Model disclosure opens and its chevron rotates.
- Keyboard Enter opens the provider drawer, initial focus lands on Close, Escape closes it, and focus returns to the exact row button.
- Source inspection: `PersistentAiPanel` at `FxReplayShell.jsx:20–31` preserves visited iframe hosts; `hidden` and `inert` remove inactive hosts from display/focus. The hosts sit outside keyed route boundaries (`:703–707`), and changing language does not change iframe keys. No new unmount path was introduced by this Studio diff. Root is adding a deterministic iframe retention fixture for runtime confirmation.
- CSS reduced-motion rules explicitly disable row/disclosure transitions and status/stepper animations. No new hardcoded hex was introduced in the reviewed Studio styles.
- The adapted Studio test reported zero page errors and zero mutation requests.

Screenshots: `C:\Users\MIIKEY\AppData\Local\Temp\studio-independent-shots`.
Probe script: `C:\Users\MIIKEY\AppData\Local\Temp\studio-independent-probe-5251.mjs`.

## Acceptance limits

This is product UI **fixture** evidence. It does not establish current Paperclip/CLIProxyAPI document behavior, provider credentials or response readiness, real workflow completion, cost, broker execution, production deployment, or whole-product acceptance. The default mock returns successful empty objects for unrecognized APIs, so it cannot validate native API contracts beyond the explicit fixtures.

The existing new test does not itself cover provider loading/error/stale/unknown states, iframe retention, focused accessibility names, reduced-motion computed styles, or every mobile theme/language combination. Those limits must remain explicit until focused fixtures cover them.

`ui/compact-system.md` had no Studio section in the reviewed snapshot; the spec's documentation delivery item remains for the owner lane. Some small numeric layout/motion choices differ from the spec (for example selected-hover mix, step dot size, composer geometry). They are not independently escalated as bugs unless the spec owner requires those exact values; the behavioral findings above are concrete.

Recommendation: fix the five findings, run the focused Studio/iframe fixtures with integration routes mocked, and then accept this Studio slice separately from the following owner audit.

## Addendum — review of the first repair build on port 5250

Read the updated source and root's `.runtime/studio-embed-fixture/report.json`; then independently probed the built UI at 5250 with every API/integration route mocked and all non-GET/browser-external requests denied.

Confirmed repaired:

- Width cap now computes to `960px` and the actual Studio column is 960px at 1440×940.
- Chromium AX now exposes row name `CLIProxyAPI` and description `Đã tải model 2 tài khoản đã lưu`; status is related explicitly with `aria-describedby`.
- A running gateway with `catalog_ready` plus `value.error` shows `Cần kiểm tra`/warning in both row and drawer.
- Focused composer has border `rgb(90,174,255)` and a `2px solid` outline of the same focus token. With reduced motion, its computed transition duration is `0s`.
- Both `aiStudio.browser.mjs` route handlers now explicitly mock `/integrations/*`, closing the Vite bridge escape.
- The new embed fixture source intercepts both integration health routes, both cross-origin iframe documents and native catalog-refresh writes. Its saved report has four passing cases and no errors/unexpected writes: gateway document/draft retention and preview no-write behavior, Paperclip preference/navigation retention plus unavailable/Retry, for initial width cases 1440 and 390. Note that its gateway navigation switches the 390px case to 1440px before clicking the tab, so that assertion is not mobile-tab-navigation coverage.

### Residual P2 — stopped gateway exemption hides real login failures

The first repair removed the row's separate `needsAttention` guard and now uses `tone()` everywhere. Both `status()` and `tone()` return the stopped/muted result before checking `value.error`. This preserves the intended ordinary stopped gateway state but also suppresses an actual failed sign-in in the overview row.

- Location: `web/src/AiProviderSettings.jsx:98–99` and `:112–113` in this repair snapshot.
- Real contract evidence: `api-rust/src/ai_gateway_runtime.rs:149–152` records `ai_gateway_login_failed`; its test at `:812–818` confirms that exposed error on the runtime.
- Independent fixture `{status:'unavailable', error:'ai_gateway_login_failed', runtime:{managed:true,running:false,external:false,accounts:2}}` produces row `Đã tắt`/`is-muted`, drawer `Đã tắt`/`is-muted`, and one visible drawer error. The overview no longer indicates that attention is needed.
- Scope the ordinary-stopped exception to expected stopped/unavailable errors. Unexpected login/start/configuration errors should remain warning and say `Cần kiểm tra` in both views. Root has been notified.

Probe outputs: five originally targeted checks passed, zero writes, zero integration requests. The residual stopped+login-failure case was observed explicitly and remains open in this addendum. Temporary probe scripts: `C:\Users\MIIKEY\AppData\Local\Temp\studio-independent-final-5250.mjs` and `studio-independent-edge-5250.mjs`.

Verdict at this repair snapshot: the first, second, fourth and fifth original findings are closed; the provider status finding needs the narrow stopped-error exception above before final signoff. Native services/provider readiness remain untested by design. Root still owns the Studio contract documentation delivery item.

## Final addendum — residual repaired and independently rechecked

Re-read the narrow `expectedGatewayStop()` helper and all three call sites in `AiProviderSettings.jsx`. The helper exempts only a managed stopped/non-external gateway with no error or `ai_gateway_unavailable`/`ai_gateway_stopped`; sign-in failures now continue through the error branch. The drawer uses the same helper to suppress only ordinary stopped errors. The Studio fixture adds expected-stop, unavailable and login-failure cases for every desktop theme/language combination.

Re-ran the independent probe against the updated build on **5250**, with all API/integration requests mocked. Confirmed:

- `ai_gateway_unavailable` + stopped remains `Đã tắt`/muted with no drawer error.
- `ai_gateway_login_failed` + stopped now shows `Cần kiểm tra`/warning in **both** row and drawer; drawer has one error, as expected.
- The same run reconfirmed actual 960px cap, accessible name plus status description, consistent running+error state, focus token border/2px ring, and reduced-motion transition `0s`.
- Zero mutation requests; no integration health requests left the fixture; no real services contacted.

**Final independent verdict: all five original findings and the stopped-login residual are resolved. No remaining blocking source finding in this Studio slice.** Root is completing the Studio section of `ui/compact-system.md` and owns the final rerun/build/commit receipt.

Acceptance stays limited to the reviewed Studio source and offline UI/iframe fixtures. It establishes host mounting, navigation, draft retention and preference transport against synthetic documents; it does not establish actual Paperclip/CLIProxyAPI content behavior, provider credentials/model calls, real workflow completion, broker actions or whole-product acceptance. The 390px gateway fixture's resize-before-navigation limitation remains as documented above.
