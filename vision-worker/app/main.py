from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.corrections import router as corrections_router
from app.api.desktop import router as desktop_router
from app.api.lots import router as lots_router
from app.api.intake import router as intake_router
from app.api.scan import router as scan_router
from app.core.config import settings
from app.core.security import bearer_token_matches
from app.services.imaging.embedding_engine import embedding_engine
from app.services.imaging.detector_router import detector_readiness
from maneflow_vision.gpu.runtime import detect_cuda_capability, resolve_compute_device

app = FastAPI(
    title="ManeFlow API",
    version="2.18.0",
    description=(
        "ManeFlow desktop card scanning, multi-card lot intelligence, PSA verification, "
        "Vault, grading, pricing, and correction API."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin"],
)


@app.middleware("http")
async def require_service_auth(request: Request, call_next):
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)

    if not (settings.maneflow_service_token or "").strip():
        return JSONResponse(
            status_code=503,
            content={"detail": "Vision worker service authentication is not configured."},
        )

    if not bearer_token_matches(request.headers.get("authorization")):
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or missing bearer token."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await call_next(request)


app.include_router(scan_router, prefix="/v1")
app.include_router(corrections_router, prefix="/v1")
app.include_router(lots_router, prefix="/v1")
app.include_router(desktop_router, prefix="/v1")
app.include_router(intake_router, prefix="/v1")
app.mount("/local-images", StaticFiles(directory=str(settings.images_dir)), name="local-images")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "maneflow-api",
        "version": "2.18.0",
        "mode": "windows_desktop_local_first",
        "imaging_engine": "learned_adapter_with_classical_fallback",
    }


@app.get("/readiness")
def readiness() -> dict:
    return {
        "status": "ready",
        "identity": {
            "openai_vision_configured": bool(settings.openai_api_key and settings.openai_vision_model),
            "model": settings.openai_vision_model if settings.openai_api_key else None,
        },
        "compute": {
            "capability": detect_cuda_capability(),
            "default_decision": resolve_compute_device("evaluation").to_dict(),
            "profile": settings.maneflow_gpu_execution_profile,
            "mixed_precision": settings.maneflow_gpu_mixed_precision,
        },
        "detection": detector_readiness(),
        "embedding": embedding_engine.readiness(initialize=False).to_dict(),
        "verification": {"psa_configured": bool(settings.effective_psa_api_key)},
        "marketplaces": {
            "ebay_import_configured": bool(settings.ebay_client_id and settings.ebay_client_secret)
        },
        "storage": {
            "local_sqlite_available": True,
            "local_database": str(settings.dev_database_file),
            "local_images": str(settings.images_dir),
            "supabase_configured": bool(settings.supabase_url and settings.supabase_service_role_key),
            "redis_configured": bool(settings.redis_url),
            "r2_configured": bool(
                settings.r2_endpoint_url and settings.r2_access_key_id and settings.r2_secret_access_key
            ),
        },
        "pricing": {
            "canonical_core_configured": bool(settings.maneflow_core_url and settings.maneflow_service_token),
            "verified_comp_provider_configured": bool(settings.maneflow_core_url and settings.maneflow_service_token),
            "manual_comp_engine_available": True,
            "safe_unverifiable_fallback": True,
        },
    }
