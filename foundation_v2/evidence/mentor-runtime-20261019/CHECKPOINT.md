# Mentor browser/runtime repair · 19/10/2026

Scope: existing MT5 Mentor chat, dedicated saved ChatGPT account, GPT-6 Sol/high.
This is a focused bug-fix receipt, not whole-product or all-model acceptance.

## Root causes and changes

- Headed Chrome was created before CDP minimized it, so startup could steal focus.
  Product inference now launches headless from the start with saved state and the
  installed Chrome's native user agent. Interactive login remains visible.
  Model selection, account isolation, turn ownership and cancellation retain the
  existing engine. No visible-browser/provider/model fallback or automatic resend.
- The current ChatGPT renderer puts user and assistant content in one
  `data-turn-key` group. The bridge serialized the group, including the private
  prompt. It now follows mutations on the group but serializes only the assistant
  branch. Screen-reader headings and user bubbles are excluded. Pending/user-only
  groups cannot complete an answer via the user's Copy action.
- Product chat still inherited a Codex harness envelope and local-tools warning.
  The trusted core entrypoint now sends only product instructions and text history.
  HTTP callers cannot supply this internal mode or enable tools/agents.
- The resize separator received a full-height focus outline (two edges) plus its
  orange indicator. It now has one indicator; keyboard resizing remains supported.

Flow: Mentor policy + supplied history → existing Rust task API → tool-free core
→ saved headless Chrome context → existing model picker → assistant-only response
→ Rust result polling → chat UI. No chart/account-data capability was added.

## Verified

- Core focused transport/account/model suite: **194 pass, 0 fail** across 10 files;
  `core-tests.txt`. After final source cleanup: **17 pass, 0 fail** across the three
  directly affected suites; `final-focused-tests.txt`. `bun run typecheck` passed.
- Real UI at `127.0.0.1:5180`, cold saved-connection load and follow-up:
  two questions, **one POST each**, both returned exactly `REPLAY READY` in
  **17.333s / 16.264s**, no page errors or leaked transcript. `live-report.json`
  and `live-two-turns.png`. The first attempt in this acceptance run succeeded;
  this does not guarantee absence of future provider/login/rate-limit failures.
- The inference Chrome process (PID21908) was a direct child of the dedicated
  core (PID22256, verified listener17851 and `core-cli.ts` with the MT5 home).
  It had `--headless` and native `MainWindowHandle=0`. This is absence of a window,
  not a minimize-after-launch assertion. The idle owned core was then restarted
  on the final source; saved login state remains present.
- UI fixture suite passed 360/768/1368px, dark/light, pointer/keyboard resize,
  picker, send/cancel/error/disconnected and workspace isolation; `ui-report.json`.
  `resize-one-line.png` was visually reviewed along with the live chat screenshot.
- `npm run build` passed; existing >500kB bundle-size warning remains.

Earlier live failures reproduced transcript leakage; those runs were not accepted.
The fixture reproduces the captured shared-group structure using synthetic text.
Browser state, cookies, tokens, raw captured account DOM and failed diagnostics
are excluded from this receipt. Old malformed replies already stored in chat
history are not rewritten; use a new chat after reloading the UI.
