import pytest

from app.services.ebay_listing import EbayListingClient


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("123456789012", "123456789012"),
        ("https://www.ebay.com/itm/123456789012", "123456789012"),
        ("https://www.ebay.com/itm/card-lot/123456789012?hash=abc", "123456789012"),
        ("https://www.ebay.com/sch/i.html?item=123456789012", "123456789012"),
    ],
)
def test_parse_legacy_item_id(value, expected):
    assert EbayListingClient.parse_legacy_item_id(value) == expected


def test_parse_legacy_item_id_rejects_non_ebay_text():
    with pytest.raises(ValueError):
        EbayListingClient.parse_legacy_item_id("not a listing")


def test_trusted_image_host_is_restricted_to_ebay_images():
    assert EbayListingClient._trusted_image_url("https://i.ebayimg.com/images/g/example/s-l1600.jpg")
    assert not EbayListingClient._trusted_image_url("http://i.ebayimg.com/insecure.jpg")
    assert not EbayListingClient._trusted_image_url("https://evil.example/ebay.jpg")
