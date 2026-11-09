"""Explicit PATH-2 semantic reuse from framework-independent legacy modules."""

from .semantics.data_contracts import CostModel, DataContractError, InstrumentSpec, NewsEvent, SourceSpec
from .semantics.data_costs import calculate_round_trip_cost
from .semantics.data_news import visible_events
from .semantics.ai_provider import FakeProvider, OfflineProvider
from .semantics.ai_service import AIInvalidRequest, AIService
from .semantics.evidence_metrics import compute_metrics_v2
from .semantics.prop_profile import PropProfileValidationError, evaluate_prop_profile

__all__ = [
    "AIInvalidRequest",
    "AIService",
    "CostModel",
    "DataContractError",
    "FakeProvider",
    "InstrumentSpec",
    "NewsEvent",
    "OfflineProvider",
    "PropProfileValidationError",
    "SourceSpec",
    "calculate_round_trip_cost",
    "compute_metrics_v2",
    "evaluate_prop_profile",
    "visible_events",
]
