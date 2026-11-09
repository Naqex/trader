# Legacy archive manifest

Generated during the ordered cleanup on 2026-10-29.

| Area | Files | Disposition | Reason |
|---|---:|---|---|
| root | 52 | archive | Retired legacy implementation; preserved for rollback/history |
| flask/static | 28 | archive | Retired legacy implementation; preserved for rollback/history |
| flask/templates | 8 | archive | Retired legacy implementation; preserved for rollback/history |
| tests | 32 | archive | Retired legacy implementation; preserved for rollback/history |
| scripts | 13 | archive | Retired legacy implementation; preserved for rollback/history |
| docs | 1 | archive | Retired legacy implementation; preserved for rollback/history |

Rollback: revert the archive move commit or move the paths back with `git mv`; no database/runtime/evidence deletion was performed.

Advanced Charts is intentionally outside this manifest.
