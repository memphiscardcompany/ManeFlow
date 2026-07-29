from decimal import Decimal

from app.services.pricing_engine import calculate_pricing


def test_returns_unverifiable_without_valid_comps():
    result = calculate_pricing([])
    assert result.pricing_status == "price_unverifiable"
    assert result.confidence_score == 0
    assert result.value_mid is None


def test_rejects_non_positive_values():
    result = calculate_pricing([0, -10, "bad"])
    assert result.pricing_status == "price_unverifiable"


def test_requires_minimum_comp_count():
    result = calculate_pricing([100, 110])
    assert result.pricing_status == "insufficient_comps"
    assert result.comps_used == 2


def test_calculates_verified_range_and_recommendations():
    result = calculate_pricing([100, 105, 110, 115, 120])
    assert result.pricing_status == "verified"
    assert result.value_mid == Decimal("110.00")
    assert result.recommended_cash_offer_low == Decimal("66.00")
    assert result.recommended_cash_offer_high == Decimal("82.50")
    assert result.recommended_list_price == Decimal("121.00")


def test_removes_extreme_iqr_outlier():
    result = calculate_pricing([100, 101, 102, 103, 104, 9999])
    assert result.pricing_status == "verified"
    assert result.outliers_removed == 1
    assert result.value_mid == Decimal("102.00")
