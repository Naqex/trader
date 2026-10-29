# Versions and releases

## Current delivery status

The owner deferred packaging on 29/10/2026. Source, CI and release preparation
remain maintained, but the experimental Windows ZIP is not a supported install.
Its hosted build and inventory checks passed; relocated end-to-end startup,
configuration, upgrade and rollback remain open. Some optional Rust adapters
still resolve resources from `CARGO_MANIFEST_DIR`; replace those build-time paths
with explicit installation roots before distributing prebuilt binaries. Until
then, build from the checkout where the application will run.

`VERSION` owns the product version. `python scripts/release.py prepare VERSION`
updates the five internal manifests and their local lock entries. It does not
commit, tag, publish or deploy. Review the diff and changelog before the release PR.
Upstream dependency versions are independent.

Use SemVer: `0.1.0-alpha.1` -> `alpha.2` for test iterations; publish `0.1.0`
only after its declared acceptance scope passes. During `0.x`, put incompatible
contract/storage changes in a minor release and document migration. After 1.0,
breaking public contracts require a major release. Patch releases fix compatible
bugs. Do not release every commit or infer a version solely from commit prefixes.

## Prepare

1. Read the diff since the last release and scoped receipts. Identify data/API,
   license, security or migration changes and choose the version.
2. Run `python scripts/release.py prepare 0.1.0-alpha.2`; update `CHANGELOG.md`.
3. Run `python scripts/release.py check`, focused tests and applicable CI jobs.
4. Build from a clean checkout. Generate a Windows candidate only with matching
   release-built executables and fresh web assets. See command help for inputs.
5. Try the candidate in a disposable directory with a path containing spaces.
   Test configuration, start/stop, upgrade and rollback as applicable. No personal
   broker/database or private vendor is part of public CI acceptance.
6. Open a release PR containing version, user changes, migration, evidence and
   unresolved limits. CI green alone is not whole-product acceptance.

## Draft and publish

The manually dispatched `Release candidate` workflow builds the selected source,
tests it and uploads a candidate artifact. It does not publish a public release.
After its smoke checks and owner authorization, create a draft GitHub release
from that exact commit, attach ZIP/checksums/notices and publish. Enable immutable
releases once all assets are attached and the workflow has been verified.

The candidate ZIP contains Windows executables, web assets, source, lockfiles and
notices. It is not a standalone installer: Python 3.12, Node 22+, PostgreSQL and
optional integrations must be installed as documented. The packaged source can
run the existing guarded launcher. Never bundle a developer's venv, MT5 terminal,
database, credential, datasets, QDM installer or Advanced Charts distribution.

Cloud production and automatic updates are not configured: there is no approved
deployment destination yet. Local rollout uses the existing guarded runtime
workflow, the candidate's exact hashes, a matching backup and a health check.
Only a separately authorized rollout may replace an active runtime. A failed
upgrade restores the previous binary/config and compatible data backup; do not
run old binaries against migrated data unless compatibility is proven.

The source package retains the four pinned synthetic compile-time fixtures still
referenced by Rust under `foundation_v2/evidence/`. Other run receipts, screenshots
and experiments are excluded. Package tests verify static Rust resource closure.

For a Windows candidate, pass `--rust-binary <candidate>/bin/trading-workspace-api.exe`,
`--rust-admin-binary <candidate>/bin/rust_runtime_admin.exe` and
`--rust-research-binary <candidate>/bin/rust_research_worker.exe` to the existing
launcher together with the documented database/artifact configuration. Serve
`web/` with the approved API proxy; it is not a `file://` application. The ZIP
does not start services or migrate data merely by extracting it.
