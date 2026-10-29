# Advanced Charts setup and recovery

Advanced Charts is an optional separately licensed dependency. Do not add its
files to Git, public CI artifacts or application release ZIPs. A private repo
alone does not grant redistribution rights.

## Install an authorized copy

Obtain access from [TradingView](https://www.tradingview.com/charting-library-docs/latest/quick-start/).
Use your own authorized account and official upstream. The integration currently
expects distribution **23.040**, including its locale and bundle files.

```powershell
python scripts/advanced_charts.py verify --source C:/licensed/charting_library
python scripts/advanced_charts.py install --source C:/licensed/charting_library
```

The source may also be a ZIP containing the `charting_library/` directory.
The tool verifies the loader SHA-256 before installing an intact distribution to
the ignored `.runtime/vendors/advanced-charts/23.040/` directory. It refuses to
overwrite an existing installation. Vite discovers that installation relative
to its own config. `TW_V2_CHARTING_LIBRARY_DIR` overrides the path explicitly.

For an upstream commit already known to be the supported distribution:

```powershell
python scripts/advanced_charts.py fetch --commit OFFICIAL_COMMIT_SHA
```

This uses the already authenticated GitHub CLI to download from the official
private repository, then verifies the supported loader hash before installation.
It does not obtain access, create credentials or bypass a failed authorization.
The exact upstream commit for the existing local 23.040 copy is not yet verified;
it must not be replaced by an arbitrary `latest` reference. Failed fetch or hash
verification leaves the installation unchanged.

## Restore the tested copy

Keep the authorized original archive, its checksum and acquisition/license record
in the owner's private backup, plus a second independent device/location where
the applicable terms allow it. Do not put credentials into the manifest or ZIP.
Use `install --source <archive>` to restore and verify the mounted chart in the
browser. Re-downloading an unpinned newer release is not an exact restoration.

The compatibility adapter in `foundation_v2/web/advancedChartCompatibility.mjs`
checks the original loader hash before adapting iframe transport for IAB/webviews.
Do not bypass that check. A library upgrade requires release-note review and
chart regression testing; see [official upgrade guidance](https://www.tradingview.com/charting-library-docs/latest/releases/Update-Library/).

Without a licensed copy, explicitly select `chart_engine=lightweight`. Missing
Advanced Charts stays an actionable state; setup never silently switches engines.
