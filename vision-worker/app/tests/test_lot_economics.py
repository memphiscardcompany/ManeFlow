from decimal import Decimal

from app.services.lot_economics import ItemValue, calculate_lot_economics


def test_unpriced_lot_does_not_invent_roi():
    result = calculate_lot_economics(
        [ItemValue(None, None, None)],
        listing_price=Decimal("100"),
    )
    assert result.pricing_status == "unpriced"
    assert result.expected_profit is None
    assert result.decision == "NEEDS PRICING"


def test_lot_profit_and_max_purchase():
    result = calculate_lot_economics(
        [
            ItemValue(Decimal("90"), Decimal("100"), Decimal("110"), 0.95),
            ItemValue(Decimal("45"), Decimal("50"), Decimal("60"), 0.90),
        ],
        listing_price=Decimal("80"),
        inbound_shipping=Decimal("10"),
        marketplace_fee_rate=Decimal("0.10"),
        payment_fee_fixed=Decimal("0"),
        target_roi=Decimal("0.25"),
    )
    assert result.expected_gross_value == Decimal("150.00")
    assert result.expected_net_resale == Decimal("135.00")
    assert result.expected_profit == Decimal("45.00")
    assert result.expected_roi == 0.5
    assert result.decision == "BUY TARGET"
    assert result.recommended_max_purchase == Decimal("98.00")
