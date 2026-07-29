from fastapi.testclient import TestClient

from app.main import app


def test_readiness_does_not_expose_secrets_and_reports_safe_fallbacks():
    payload = TestClient(app).get("/readiness").json()
    assert payload["detection"]["classical_fallback_available"] is True
    assert "roboflow" in payload["detection"]
    assert payload["storage"]["local_sqlite_available"] is True
    assert payload["pricing"]["safe_unverifiable_fallback"] is True
    serialized = str(payload).lower()
    assert "secret" not in serialized
    assert "api_key" not in serialized
