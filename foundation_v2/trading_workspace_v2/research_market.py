"""Declared USD metal geometry for opt-in coarse research, never broker authority."""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import FixedH4Candidate, HOUR
from .forex_h4_candidates import METAL_BASELINE, METAL_CANDIDATES, ResearchH4Candidate
from .replay_tick_execution import initialize_tick_execution
from .retained import CostModel, InstrumentSpec


class MetalStudyMarket(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    schema_version: Literal['usd-metal-study-market-v1'] = 'usd-metal-study-market-v1'
    instrument_id: Literal['XAUUSD'] = 'XAUUSD'
    asset_class: Literal['metal'] = 'metal'
    base_ccy: Literal['XAU'] = 'XAU'
    quote_ccy: Literal['USD'] = 'USD'
    account_ccy: Literal['USD'] = 'USD'
    contract_size: Decimal = Field(default=Decimal('100'), gt=0)
    tick_size: Decimal = Field(default=Decimal('.001'), gt=0)
    pip_size: Decimal = Field(default=Decimal('.1'), gt=0)
    quantity_min: Decimal = Field(default=Decimal('.01'), gt=0)
    quantity_step: Decimal = Field(default=Decimal('.01'), gt=0)
    leverage: Decimal = Field(default=Decimal('10'), gt=0)
    commission_usd_per_lot_per_side: Decimal = Field(default=Decimal('2.5'), ge=0)
    source_price_basis: Literal['bid_ohlc_with_declared_ask'] = 'bid_ohlc_with_declared_ask'
    broker_verified: Literal[False] = False

    @model_validator(mode='after')
    def frozen_geometry(self):
        if (self.contract_size != 100 or self.tick_size != Decimal('.001')
                or self.quantity_min != Decimal('.01') or self.quantity_step != Decimal('.01')
                or self.pip_size % self.tick_size or self.leverage != 10
                or self.commission_usd_per_lot_per_side != Decimal('2.5')):
            raise ValueError('metal study geometry differs from frozen declared contract')
        return self

    def instrument(self, start):
        return {**{key:str(getattr(self,key)) for key in ('instrument_id','asset_class','base_ccy',
            'quote_ccy','account_ccy','contract_size','tick_size','pip_size','quantity_min','quantity_step')},
            'effective_from_utc':datetime.fromtimestamp(start/1000,timezone.utc).isoformat()}

    def execution(self, name, slippage, data_hash, start):
        return initialize_tick_execution(replay_session_id='metal-coarse-'+name,branch_id='main',
            dataset_id='qdm-xauusd-indicative-m1',dataset_sha256=data_hash,
            tick_snapshot_id='indicative-bars-not-observed-ticks',tick_snapshot_sha256=data_hash,
            spread_price='0',timeframe_seconds=HOUR,starting_balance='10000',cursor_index=0,
            instrument_spec=self.instrument(start),
            cost_model=dict(version='metal-declared-'+name,spread_basis='bid_ask_embedded',
                commission_per_side_account='0',commission_per_side_per_quantity_account=str(self.commission_usd_per_lot_per_side),
                minimum_fee_account='0',slippage_price_per_side=str(slippage),financing_account='0',
                quote_to_account_rate='1',account_ccy='USD',rounding_decimals=2),
            research_margin=dict(version='fixed-starting-balance-leverage-v1',leverage=str(self.leverage)))


def metal_candidate(candidate):
    if candidate not in METAL_CANDIDATES:raise ValueError('unknown metal research recipe')
    return FixedH4Candidate() if candidate == METAL_BASELINE else ResearchH4Candidate(candidate)


def size_for_market_stop(distance, *, instrument:InstrumentSpec, model:CostModel, budget=Decimal('25')):
    if (any(not x.is_finite() for x in (distance,budget)) or distance<=0 or budget<=0
            or instrument.account_ccy!='USD' or instrument.quote_ccy!='USD' or model.account_ccy!='USD'
            or model.quote_to_account_rate!=1 or model.minimum_fee_account or model.commission_per_side_account
            or model.financing_account):
        raise ValueError('unsupported USD research sizing terms')
    # Stop is relative to entry fill; include one grid-rounding reserve and both
    # slippage/commission sides. Overnight financing is separately accounted.
    per_lot=(distance+instrument.tick_size+2*model.slippage_price_per_side)*instrument.contract_size
    per_lot+=2*model.commission_per_side_per_quantity_account
    quantity=(budget/per_lot/instrument.quantity_step).to_integral_value(rounding=ROUND_FLOOR)*instrument.quantity_step
    return quantity if quantity>=instrument.quantity_min else None
