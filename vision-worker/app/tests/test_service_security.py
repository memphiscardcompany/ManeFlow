from fastapi.testclient import TestClient

from app.main import app


AUTH_HEADERS = {"Authorization": "Bearer test-maneflow-service-token"}


def test_health_remains_public():
    response = TestClient(app).get("/health")
    assert response.status_code == 200


def test_protected_route_rejects_unauthenticated_request():
    response = TestClient(app).get("/readiness")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_protected_route_rejects_bad_bearer_token():
    response = TestClient(
        app,
        headers={"Authorization": "Bearer definitely-not-the-service-token"},
    ).get("/readiness")
    assert response.status_code == 401


def test_import_folder_rejects_path_outside_allowed_root():
    response = TestClient(app, headers=AUTH_HEADERS).post(
        "/v1/intake/photos/import-folder",
        json={
            "folder_path": "/etc",
            "batch_name": "path traversal rejection",
            "copy_into_maneflow": False,
        },
    )
    assert response.status_code == 422
    assert "configured allowed root" in response.json()["detail"]
