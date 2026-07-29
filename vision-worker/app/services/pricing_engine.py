from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from statistics import median
from typing import Iterable, Sequence


MONEY = Decimal("0.01")


@dataclass(frozen=True)
class PricingComputation:
    pricing_status: str
    value_low: Decimal | None
    value_mid: Decimal | None
    value_high: Decimal | None
    confidence_score: float
    recommended_cash_offer_low: Decimal | None
    recommended_cash_offer_high: Decimal | None
    recommended_list_price: Decimal | None
    comps_used: int
    outliers_removed: int
    explanation: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def _percentile(sorted_values: Sequence[Decimal], percentile: float) -> Decimal:
    if not sorted_values:
        raise ValueError("Cannot calculate percentile for empty values.")
    if len(sorted_values) == 1:
        return sorted_values[0]

    index = (len(sorted_values) - 1) * percentile
    lower = int(index)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = Decimal(str(index - lower))
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def _remove_iqr_outliers(values: Sequence[Decimal]) -> tuple[list[Decimal], int]:
    if len(values) < 4:
        return list(values), 0

    ordered = sorted(values)
    q1 = _percentile(ordered, 0.25)
    q3 = _percentile(ordered, 0.75)
    iqr = q3 - q1
    lower_bound = q1 - Decimal("1.5") * iqr
    upper_bound = q3 + Decimal("1.5") * iqr

    kept = [value for value in ordered if lower_bound <= value <= upper_bound]
    return kept, len(ordered) - len(kept)


def _confidence(values: Sequence[Decimal]) -> float:
    count = len(values)
    if count == 0:
        return 0.0

    count_score = min(count / 12.0, 1.0)
    mid = Decimal(str(median(values)))
    if mid <= 0:
        return 0.0

    spread = (max(values) - min(values)) / mid
    consistency_score = max(0.0, 1.0 - min(float(spread), 1.0))
    score = (0.65 * count_score) + (0.35 * consistency_score)
    return round(max(0.0, min(score, 1.0)), 3)


def calculate_pricing(
    prices: Iterable[Decimal | float | int | str],
    *,
    minimum_verified_comps: int = 3,
) -> PricingComputation:
    valid: list[Decimal] = []
    for raw in prices:
        try:
            value = Decimal(str(raw))
        except Exception:
            continue
        if value > 0:
            valid.append(value)

    if not valid:
        return PricingComputation(
            pricing_status="price_unverifiable",
            value_low=None,
            value_mid=None,
            value_high=None,
            confidence_score=0.0,
            recommended_cash_offer_low=None,
            recommended_cash_offer_high=None,
            recommended_list_price=None,
            comps_used=0,
            outliers_removed=0,
            explanation="No valid verified sold comps were available.",
        )

    filtered, removed = _remove_iqr_outliers(valid)

    if len(filtered) < minimum_verified_comps:
        return PricingComputation(
            pricing_status="insufficient_comps",
            value_low=None,
            value_mid=None,
            value_high=None,
            confidence_score=round(min(len(filtered) / minimum_verified_comps, 0.49), 3),
            recommended_cash_offer_low=None,
            recommended_cash_offer_high=None,
            recommended_list_price=None,
            comps_used=len(filtered),
            outliers_removed=removed,
            explanation=f"Only {len(filtered)} verified comps remained; at least {minimum_verified_comps} are required.",
        )

    ordered = sorted(filtered)
    low = _money(_percentile(ordered, 0.25))
    mid = _money(Decimal(str(median(ordered))))
    high = _money(_percentile(ordered, 0.75))

    return PricingComputation(
        pricing_status="verified",
        value_low=low,
        value_mid=mid,
        value_high=high,
        confidence_score=_confidence(ordered),
        recommended_cash_offer_low=_money(mid * Decimal("0.60")),
        recommended_cash_offer_high=_money(mid * Decimal("0.75")),
        recommended_list_price=_money(mid * Decimal("1.10")),
        comps_used=len(ordered),
        outliers_removed=removed,
        explanation=(
            f"Value derived from {len(ordered)} verified sold comps after removing "
            f"{removed} statistical outlier(s). Median is used as the market midpoint."
        ),
    )
