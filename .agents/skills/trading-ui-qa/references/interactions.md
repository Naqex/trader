# WMREPLAY interaction regression cases

Choose the affected behavior, not the whole table. Derived from repeated owner
reports; these are test prompts, not a mandate to implement every feature now.

| Change | Observable checks |
| --- | --- |
| Copy cleanup | Removed copy is absent in the rendered screen; names, search, count, units and meaningful error state still work. Avoid asserting readiness from a decorative helper sentence. |
| Live vs Replay/Prop | Compare the same toolbar, wallet fields, order form/details and notification. Record intentional broker-vs-simulation differences; do not compare color alone or send a Live order for UI QA. |
| Asset catalog/overlay | Search name and description, category, no results, metadata unavailable, selected symbol; keyboard/Escape, iframe-trigger focus return and bounded dialog at small widths. |
| Viewport/table footer | Bottom visible at relevant viewport; correct scroll owner, pagination stays at content bottom, no clipped fixed footer or duplicated separator. |
| Notifications | Entry/reload quiet unless the feature explicitly calls for a status notification; warning on rejected action, dismiss stable, auto-hide per existing system policy, repeated data refresh does not respawn the same dismissed toast. |
| Model/effort selection | Reload retains valid selection; missing model/provider or unsupported effort resolves to a valid catalog choice; failed catalog load is not proof the saved model was deleted. Snapshot running selection independently from changed defaults. |
| Chat stop/continue | Stop preserves partial answer and available reasoning summary; pending state ends, new prompt works. Continue follows documented runtime semantics without duplicate user messages or claiming network-stream resumption. Reload reconciles the existing run. |
| Embedded gateway | Switching tabs preserves intended mount/state; no repeated eager load. Offline/update state has a bounded recovery action; hiding an iframe is not proof its scripts/polling paused. |
| Chart realtime | Chart instance stays stable while quotes/candles update; verify actual transport and reconnect behavior from traffic. SSE/WebSocket labels alone do not prove no polling, no flicker or correct freshness. |
| Browser annotation issue | Identify whether the control belongs to WMREPLAY or the browser host. Compare local Backtest/Prop with local Live, not external FX Replay. Do not add permanent chart hacks for unconfirmed host behavior. |

Use fixtures for errors and potentially mutating branches. Use the actual local
service for authorized read-only integration. Keep both evidence scopes explicit;
a UI screenshot or mocked denial never proves broker execution behavior.
