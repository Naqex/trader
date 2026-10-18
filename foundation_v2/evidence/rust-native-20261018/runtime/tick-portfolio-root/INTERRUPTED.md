# Interrupted Windows fixture startup

The first attempt stalled before native requests: pg_ctl's PostgreSQL child kept
the captured stdout/stderr pipes open after startup. No PASS receipt exists.
Only the exact owned Python processes and disposable cluster were stopped;
the owner API/UI and data were untouched. Subsequent attempts use DEVNULL and
a bounded startup timeout. See r2 and later receipts for actual native requests.
