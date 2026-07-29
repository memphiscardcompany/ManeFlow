from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

MONEY = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class ItemValue:
    value_low: Decimal | None
    value_mid: Decimal | None
    value_high: Decimal | None
    identity_confidence: float = 0.0


@dataclass(frozen=True)
class EconomicsResult:
    pricing_status: str
    listing_price: Decimal
    inbound_shipping: Decimal
    sales_tax: Decimal
    acquisition_total: Decimal
    detected_physical_items: int
    exact_or_likely_items: int
    priced_items: int
    unresolved_items: int
    conservative_gross_value: Decimal | None
    expected_gross_value: Decimal | None
    optimistic_gross_value: Decimal | None
    expected_marketplace_fees: Decimal | None
    expected_outbound_shipping: Decimal | None
    expected_net_resale: Decimal | None
    expected_profit: Decimal | None
    expected_roi: float | None
    recommended_max_purchase: Decimal | None
    decision: str
    explanation: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def calculate_lot_economics(
    item_values: Iterable[ItemValue],
    *,
    listing_price: Decimal,
    inbound_shipping: Decimal = Decimal("0"),
    sales_tax: Decimal = Decimal("0"),
    marketplace_fee_rate: Decimal = Decimal("0.1325"),
    payment_fee_fixed: Decimal = Decimal("0.30"),
    outbound_shipping_per_item: Decimal = Decimal("0"),
    target_roi: Decimal = Decimal("0.25"),
) -> EconomicsResult:
    items = list(item_values)
    priced = [item for item in items if item.value_mid is not None and item.value_mid > 0]
    detected = len(items)
    exact_or_likely = sum(1 for item in items if item.identity_confidence >= 0.70)
    unresolved = detected - exact_or_likely
    acquisition_total = money(listing_price + inbound_shipping + sales_tax)

    if not priced:
        return EconomicsResult(
            pricing_status="unpriced",
            listing_price=money(listing_price),
            inbound_shipping=money(inbound_shipping),
            sales_tax=money(sales_tax),
            acquisition_total=acquisition_total,
            detected_physical_items=detected,
            exact_or_likely_items=exact_or_likely,
            priced_items=0,
            unresolved_items=unresolved,
            conservative_gross_value=None,
            expected_gross_value=None,
            optimistic_gross_value=None,
            expected_marketplace_fees=None,
            expected_outbound_shipping=None,
            expected_net_resale=None,
            expected_profit=None,
            expected_roi=None,
            recommended_max_purchase=None,
            decision="NEEDS PRICING",
            explanation="No verified item values are available, so ManeFlow will not fabricate lot ROI.",
        )

    conservative = money(sum((item.value_low or item.value_mid) for item in priced))
    expected = money(sum(item.value_mid for item in priced if item.value_mid is not None))
    optimistic = money(sum((item.value_high or item.value_mid) for item in priced))
    marketplace_fees = money(expected * marketplace_fee_rate + payment_fee_fixed * len(priced))
    outbound_shipping = money(outbound_shipping_per_item * len(priced))
    net_resale = money(expected - marketplace_fees - outbound_shipping)
    profit = money(net_resale - acquisition_total)
    roi = round(float(profit / acquisition_total), 4) if acquisition_total > 0 else None
    max_total_acquisition = net_resale / (Decimal("1") + target_roi)
    recommended_max_purchase = money(max(Decimal("0"), max_total_acquisition - inbound_shipping - sales_tax))

    coverage = len(priced) / detected if detected else 0.0
    pricing_status = "priced" if coverage >= 0.90 else "partially_priced"
    if profit > 0 and (roi or 0) >= float(target_roi):
        decision = "BUY TARGET"
    elif profit > 0:
        decision = "MARGIN TOO THIN"
    else:
        decision = "PASS AT CURRENT PRICE"

    return EconomicsResult(
        pricing_status=pricing_status,
        listing_price=money(listing_price),
        inbound_shipping=money(inbound_shipping),
        sales_tax=money(sales_tax),
        acquisition_total=acquisition_total,
        detected_physical_items=detected,
        exact_or_likely_items=exact_or_likely,
        priced_items=len(priced),
        unresolved_items=unresolved,
        conservative_gross_value=conservative,
        expected_gross_value=expected,
        optimistic_gross_value=optimistic,
        expected_marketplace_fees=marketplace_fees,
        expected_outbound_shipping=outbound_shipping,
        expected_net_resale=net_resale,
        expected_profit=profit,
        expected_roi=roi,
        recommended_max_purchase=recommended_max_purchase,
        decision=decision,
        explanation=(
            f"Economics use {len(priced)} priced item(s) out of {detected}. "
            "Expected resale uses item midpoints, marketplace fees, and configured shipping assumptions."
        ),
    )
