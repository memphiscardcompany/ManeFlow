from uuid import uuid4

from app.models.schemas import PredictedCard
from app.services.imaging.reconciliation import PhysicalItemReconciler, identity_key, unique_serial_number


def _card(**updates):
    values = dict(
        year=2018,
        brand="Topps",
        set_name="Update",
        player_name="Printed Name",
        card_number="US1",
    )
    values.update(updates)
    return PredictedCard(**values)


def test_same_photo_lookalikes_remain_separate():
    source = uuid4()
    reconciler = PhysicalItemReconciler()
    first = reconciler.register(
        source_image_id=source,
        fingerprint="0000000000000000",
        card=PredictedCard(),
        identity_confidence=0,
        card_side="unknown",
    )
    second = reconciler.register(
        source_image_id=source,
        fingerprint="0000000000000000",
        card=PredictedCard(),
        identity_confidence=0,
        card_side="unknown",
    )
    assert first.group_id != second.group_id


def test_same_cert_across_photos_is_same_slab():
    reconciler = PhysicalItemReconciler()
    first = reconciler.register(
        source_image_id=uuid4(),
        fingerprint="0000000000000000",
        card=_card(cert_number="12345678"),
        identity_confidence=0.98,
        card_side="front",
    )
    second = reconciler.register(
        source_image_id=uuid4(),
        fingerprint="ffffffffffffffff",
        card=_card(cert_number="12345678"),
        identity_confidence=0.98,
        card_side="back",
    )
    assert second.group_id == first.group_id
    assert second.method == "cert_match"


def test_front_and_back_exact_identity_can_pair_but_same_side_does_not():
    reconciler = PhysicalItemReconciler()
    front = reconciler.register(
        source_image_id=uuid4(),
        fingerprint="0000000000000000",
        card=_card(),
        identity_confidence=0.95,
        card_side="front",
    )
    back = reconciler.register(
        source_image_id=uuid4(),
        fingerprint="ffffffffffffffff",
        card=_card(),
        identity_confidence=0.95,
        card_side="back",
    )
    another_front = reconciler.register(
        source_image_id=uuid4(),
        fingerprint="aaaaaaaaaaaaaaaa",
        card=_card(),
        identity_confidence=0.95,
        card_side="front",
    )
    assert back.group_id == front.group_id
    assert back.method == "front_back_identity"
    assert another_front.group_id != front.group_id


def test_serial_requires_actual_numerator_and_denominator():
    assert unique_serial_number("12/99") == "12/99"
    assert unique_serial_number("/99") is None
    assert unique_serial_number("numbered to 99") is None


def test_identity_key_requires_specific_metadata():
    assert identity_key(PredictedCard(player_name="Only a Name")) is None
    assert identity_key(_card()) is not None
