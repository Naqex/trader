from types import SimpleNamespace

from trading_workspace_v2.replay_instrument import replay_instrument_spec


def test_price_only_fx_dataset_gets_explicit_replay_contract():
    spec = replay_instrument_spec(SimpleNamespace(
        instrument_id="EUR/USD", instrument_spec=None, first_timestamp=1_735_689_600,
    ))
    assert spec["asset_class"] == "fx"
    assert spec["instrument_id"] == "EUR/USD"
    assert spec["tick_size"] == "0.00001"
    assert spec["pip_size"] == "0.0001"
    assert spec["quantity_min"] == "0.01"


def test_price_only_non_fx_and_qualified_metadata_stay_conservative():
    assert replay_instrument_spec(SimpleNamespace(
        instrument_id="XAU/USD", instrument_spec=None, first_timestamp=1,
    )) is None
    existing = {"instrument_id": "EUR/USD", "asset_class": "fx"}
    assert replay_instrument_spec(SimpleNamespace(
        instrument_id="EUR/USD", instrument_spec=existing, first_timestamp=1,
    )) == existing
