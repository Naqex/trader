The first rollback harness attempt was interrupted before its fixture database
was available to the test. On Windows, `pg_ctl` inherited captured pipe handles,
so `subprocess.run(..., capture_output=True)` waited after the server had started.
The exact owned temporary cluster was stopped with `pg_ctl`, then the verified
harness process was terminated. Owner services/data were not touched.

This attempt is not a product PASS or product failure. Subsequent attempts use
file-backed command logs and bounded PostgreSQL connection timeouts. The retained
startup logs belong to this attempt; the completed rehearsal has a separate
receipt directory.
