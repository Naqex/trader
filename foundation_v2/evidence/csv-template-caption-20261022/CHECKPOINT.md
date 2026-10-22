# CSV template caption — 22 October 2026

Restored the full pre-upload instruction followed by an inline download action,
matching the owner's reference. VI/EN copy uses the existing locale dictionary;
the link uses project primary/hover colors. It still calls `downloadLiveCsv` with
the WMREPLAY schema, rather than downloading an incompatible external template.

Validation on preview 5180: full VI/EN copy; desktop and 360px layout; keyboard
focus and successful CSV download. Downloaded header has the existing 13 columns
from symbol through note. Mobile caption clientWidth/scrollWidth both 239px;
English wraps to two lines. No captured browser errors. Build passed, scoped
diff check clean, independent source review returned no findings. Screenshots
are scoped visual evidence; no broker connection was attempted.

Read-only connector inspection for the owner's terminal question:
`scripts/mt5_connector.py` prepares an isolated portable terminal, requests
SW_HIDE on launch, initializes the SDK, then shuts down/terminates the terminal
after snapshot collection. Rust schedules the next successful sync in 60s.
No real-broker or fully invisible-launch acceptance was performed in this task.
Official initialize documentation confirms SDK connection is to the terminal
and may automatically launch it when needed:
https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py

No backend/lifecycle change, broker credentials, submission or terminal restart.
