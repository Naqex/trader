# Third-party components

Application code is copyright (c) 2026 Naqex and licensed under the
[Naqex Source Available License 1.0.0](LICENSE). See [licensing](docs/licensing.md)
for the adoption boundary and previous MIT permissions. The preserved original
MIT notice is in [LICENSES/MIT-previous.txt](LICENSES/MIT-previous.txt).
Dependencies retain their own licenses; the application license does not relicense them.

| Component | Source/version | Distribution treatment |
|---|---|---|
| TradingView Advanced Charts | separately acquired 23.040 distribution | Proprietary, separately licensed; excluded from Git and public packages. See [setup/recovery](docs/advanced-charts.md). |
| TradingView Lightweight Charts | web lockfile | Apache-2.0; preserve the package notices and required attribution when shipped. |
| React / React DOM | web lockfile | MIT; preserve notices. |
| Vite and build dependencies | web lockfile | Build tooling; dependency notices remain applicable to shipped code. |
| NautilusTrader | optional engine, 1.231.0 | LGPLv3; not bundled in the candidate. A downstream distribution of this engine requires its applicable notices/source/relinking review. |
| MetaTrader 5 | optional Windows installation / Python integration | Installed separately under the vendor's terms; no terminal installer or account files included. |
| QuantDataManager | optional external downloader | Installed separately; no installer or licensed payload included. |

Rust dependencies are frozen by `foundation_v2/api-rust/Cargo.lock`; Python by
the two `uv.lock` files; JavaScript by each `package-lock.json`. A release must
inventory the actual resolved components and include their applicable license
texts for the shipped binaries/web bundle. This table is an entry point, not a
claim that every transitive dependency has been reviewed.

Authoritative references:

- [Advanced Charts terms/setup](https://www.tradingview.com/charting-library-docs/latest/quick-start/)
- [Lightweight Charts license and attribution](https://github.com/tradingview/lightweight-charts#license)
- [NautilusTrader 1.231.0 license](https://github.com/nautechsystems/nautilus_trader/blob/v1.231.0/LICENSE)
