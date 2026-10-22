# Live layout corrections — 22/10/2026

Six owner annotations addressed in the running 5180 app:

1. Removed stacked 8px + 20px calendar margins; measured gap now 8px.
2. Total heading uses primary content color. Dark theme measurement:
   Total rgb(255,255,255), weekday headings rgb(184,192,201).
3. MetaTrader tile has a stable 96px width and centers avatar, image and label.
   At 1920px all three centers measured x=1653px.
4. Provider tile label is MetaTrader. Actual connector platform remains MT5;
   no platform, server or credential contract was changed.
5. Removed the Trades top create/import toolbar and its unused JSX definition.
   Accounts sidebar and per-row menus retain create/import/manual-entry paths.
6. Accounts toolbar and sidebar heading share 72px minimum height. Both desktop
   bottom borders measured y=189px at 1920 and 1368 widths (previously 188/190).

Validation: production build PASS (existing >500kB main chunk warning); actual
browser navigation across Accounts, Calendar and Trades. Provider tile opens the
existing MT5 form, Back returns to picker, also at 390px. No form was submitted.
Trades has zero direct top toolbars/create/import buttons and filters start at
y=117px. Calendar zero totals remain unchanged. Reviewed screenshots at
1920x940 dark, 1368x790 light, 390x844 dark; no document horizontal overflow or
captured browser warnings/errors. Independent review calendar_review: no blockers.

Pure presentation changes: no migration/API restart/data mutations/broker login.
Temporary browser tab closed, dark theme restored and viewport override reset.
Scoped whitespace diff check clean; unrelated worktree changes preserved.
