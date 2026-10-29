---
name: release-management
description: Prepare Naqex Trader versions, release PRs and Windows candidates with checked manifests, provenance and dependency notices. Use for this repository's releases, not ordinary feature commits or broker operation.
---

# Naqex Trader release management

Read [release policy](../../../docs/releases.md), `VERSION`, `CHANGELOG.md` and the
diff since the last release. The repository scripts and workflows own executable
checks; do not duplicate their implementation in ad hoc commands.

Choose a version using contract compatibility and the scope actually verified.
Commit prefixes are hints, not authority. Treat missing migrations, unreviewed
license terms, failed tests or unexplained dirty files as unresolved findings.
Keep original author/license notices. Do not claim broker/full-product acceptance
from fixture, package or build success.

Use `python scripts/release.py prepare <version>` and `check`, then the candidate
workflow or documented package command. Verify a relocated clean checkout,
candidate contents and SHA-256, and record the exact source commit/test results.
Test a mismatched version or missing vendor as a negative case when that branch
of the release procedure changes. Never update goldens to hide a regression.

Prepare a focused release PR and draft notes including changes, tested platform,
dependencies, migration/rollback and remaining limits. Stop before public publish
or active-runtime rollout unless that action was explicitly authorized. Runtime
operations use the existing runtime skill; this skill grants no broker authority.
