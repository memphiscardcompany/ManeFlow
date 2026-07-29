from __future__ import annotations

import io
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

from app.models.intake_schemas import (
    BulkBatchStatusUpdate,
    BulkItemReviewRequest,
    ContributionCurationRequest,
    ContributionPackImportResponse,
    ContributorConsentResponse,
    ContributorConsentUpsert,
    RicohFolderImportRequest,
    PhotoFolderImportRequest,
)
from app.services.bulk_intake import bulk_intake_service
from app.services.bulk_intake_repository import bulk_intake_repository
from app.services.unordered_photo_intake import unordered_photo_intake_service

router = APIRouter(tags=["bulk-intake"])


def _contributor_response(payload: dict) -> dict:
    return {**payload, "contributor_id": payload.get("contributor_id") or payload.get("id")}


@router.post("/contributors/consent", response_model=ContributorConsentResponse)
def upsert_contributor(request: ContributorConsentUpsert) -> dict:
    return _contributor_response(bulk_intake_repository.upsert_contributor(request.model_dump(mode="json")))


@router.get("/contributors")
def list_contributors() -> list[dict]:
    return bulk_intake_repository.list_contributors()


@router.post("/contributors/{contributor_id}/revoke", response_model=ContributorConsentResponse)
def revoke_contributor(contributor_id: UUID) -> dict:
    try:
        return _contributor_response(bulk_intake_repository.revoke_contributor(contributor_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Contributor consent record not found.") from exc


@router.post("/intake/ricoh/import-folder")
async def import_ricoh_folder(request: RicohFolderImportRequest) -> dict:
    try:
        batch = bulk_intake_service.import_ricoh_folder(request.model_dump(mode="json"))
        if request.process_immediately:
            batch = await bulk_intake_service.process_batch(UUID(batch["id"]))
        return batch
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Contributor consent record not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/intake/photos/import-folder")
async def import_unordered_photo_folder(request: PhotoFolderImportRequest) -> dict:
    try:
        return await unordered_photo_intake_service.import_folder(request.model_dump(mode="json"))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Contributor consent record not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/intake/batches")
def list_batches(limit: int = 100) -> list[dict]:
    return bulk_intake_repository.list_batches(limit=max(1, min(limit, 1000)))


@router.get("/intake/batches/{batch_id}")
def get_batch(batch_id: UUID) -> dict:
    try:
        return bulk_intake_repository.get_batch(batch_id, include_items=True)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Bulk intake batch not found.") from exc


@router.post("/intake/batches/{batch_id}/process")
async def process_batch(batch_id: UUID, limit: int | None = None) -> dict:
    try:
        return await bulk_intake_service.process_batch(batch_id, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Bulk intake batch not found.") from exc


@router.patch("/intake/batches/{batch_id}/status")
def update_batch_status(batch_id: UUID, request: BulkBatchStatusUpdate) -> dict:
    try:
        return bulk_intake_repository.update_batch_status(batch_id, request.status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Bulk intake batch not found.") from exc


@router.get("/intake/items/{item_id}/image/{side}")
def get_item_image(item_id: UUID, side: str) -> FileResponse:
    if side not in {"front", "back"}:
        raise HTTPException(status_code=422, detail="Image side must be front or back.")
    try:
        item = bulk_intake_repository.get_item(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Bulk intake item not found.") from exc
    image_path = item.get(f"{side}_image_path")
    if not image_path or not Path(image_path).exists():
        raise HTTPException(status_code=404, detail=f"{side.title()} image not found.")
    return FileResponse(image_path)


@router.post("/intake/items/{item_id}/review")
def review_item(item_id: UUID, request: BulkItemReviewRequest) -> dict:
    try:
        return bulk_intake_repository.review_item(item_id, request.model_dump(mode="json"))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Bulk intake item not found.") from exc


@router.get("/intake/batches/{batch_id}/export.csv")
def export_batch_csv(batch_id: UUID) -> Response:
    try:
        content = bulk_intake_repository.export_batch_csv(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Bulk intake batch not found.") from exc
    return Response(
        content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=maneflow-bulk-{batch_id}.csv"},
    )


@router.get("/contributions/stats")
def contribution_stats() -> dict:
    examples = bulk_intake_repository.list_training_examples(limit=5000)
    approved = [item for item in examples if item.get("curation_status") == "approved"]
    dataset = bulk_intake_repository.approved_dataset_manifest()
    return {
        "contributed_examples": len(examples),
        "approved_examples": len(approved),
        "with_images": sum(1 for item in examples if item.get("front_image_path")),
        "labels_only": sum(1 for item in examples if not item.get("front_image_path")),
        "reference_eligible": sum(1 for item in examples if item.get("reference_eligible")),
        "reference_approved": sum(1 for item in approved if item.get("reference_eligible")),
        "curation_pending": sum(1 for item in examples if item.get("curation_status") == "pending"),
        "curation_approved": len(approved),
        "curation_rejected": sum(1 for item in examples if item.get("curation_status") == "rejected"),
        "dataset_train": dataset["summary"]["train"],
        "dataset_validation": dataset["summary"]["validation"],
        "dataset_test": dataset["summary"]["test"],
    }


@router.get("/contributions/dataset-manifest")
def contribution_dataset_manifest() -> dict:
    return bulk_intake_repository.approved_dataset_manifest()


@router.get("/contributions/examples")
def list_contribution_examples(limit: int = 200, curation_status: str | None = None) -> list[dict]:
    if curation_status and curation_status not in {"pending", "approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Invalid curation status.")
    return bulk_intake_repository.list_training_examples(limit=limit, curation_status=curation_status)


@router.get("/contributions/examples/{example_id}/image/{side}")
def contribution_example_image(example_id: UUID, side: str) -> FileResponse:
    if side not in {"front", "back"}:
        raise HTTPException(status_code=422, detail="Image side must be front or back.")
    try:
        example = next(
            item for item in bulk_intake_repository.list_training_examples(limit=5000)
            if item["id"] == str(example_id)
        )
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail="Contribution example not found.") from exc
    path_value = example.get(f"{side}_image_path")
    if not path_value:
        raise HTTPException(status_code=404, detail=f"No {side} image was contributed for this example.")
    path = Path(path_value).expanduser().resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Contribution image file is unavailable.")
    return FileResponse(path)


@router.post("/contributions/examples/{example_id}/curate")
def curate_contribution_example(example_id: UUID, request: ContributionCurationRequest) -> dict:
    try:
        return bulk_intake_repository.curate_training_example(
            example_id,
            request.curation_status,
            request.notes,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Contribution example not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/contributions/export.zip")
def export_contribution_pack(mode: str = "review_queue") -> Response:
    try:
        examples = bulk_intake_repository.exportable_training_examples(mode=mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    memory = io.BytesIO()
    manifest: list[dict] = []
    pack_id = str(uuid4())
    with zipfile.ZipFile(memory, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, example in enumerate(examples, start=1):
            entry = {
                "schema_version": "1.0",
                "example_id": example["id"],
                "consent_scope": example["consent_scope"],
                "front_sha256": example.get("front_sha256"),
                "back_sha256": example.get("back_sha256"),
                "label": example["label"],
                "evidence": example["evidence"],
                "reference_eligible": example["reference_eligible"],
                "source_curation_status": example.get("curation_status") or "pending",
                "front_file": None,
                "back_file": None,
            }
            for side in ("front", "back"):
                source = example.get(f"{side}_image_path")
                if not source:
                    continue
                path = Path(source)
                if path.exists() and path.is_file():
                    arcname = f"images/{index:07d}-{side}{path.suffix.lower()}"
                    archive.write(path, arcname)
                    entry[f"{side}_file"] = arcname
            manifest.append(entry)
        archive.writestr(
            "manifest.json",
            json.dumps({"pack_id": pack_id, "schema_version": "1.0", "examples": manifest}, indent=2),
        )
        archive.writestr(
            "README.txt",
            "ManeFlow opt-in recognition contribution pack. Imported examples always return to pending owner review. Private inventory costs, values, and seller notes are excluded.\n",
        )
    memory.seek(0)
    return Response(
        memory.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=maneflow-contribution-{pack_id}.zip"},
    )


@router.post("/contributions/import", response_model=ContributionPackImportResponse)
async def import_contribution_pack(pack: UploadFile = File(...)) -> ContributionPackImportResponse:
    if not pack.filename or not pack.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=415, detail="Contribution pack must be a ZIP file.")
    data = await pack.read()
    imported = 0
    duplicates = 0
    rejected = 0
    with tempfile.TemporaryDirectory(prefix="maneflow-contrib-") as temp_dir:
        temp_path = Path(temp_dir)
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                archive.extractall(temp_path)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=422, detail="Invalid contribution pack ZIP.") from exc
        manifest_path = temp_path / "manifest.json"
        if not manifest_path.exists():
            raise HTTPException(status_code=422, detail="Contribution pack manifest is missing.")
        manifest = json.loads(manifest_path.read_text("utf-8"))
        pack_id = str(manifest.get("pack_id") or uuid4())
        from app.core.config import settings
        destination = settings.data_dir / "imported-contributions" / pack_id
        destination.mkdir(parents=True, exist_ok=True)
        for example in manifest.get("examples") or []:
            try:
                payload = dict(example)
                for side in ("front", "back"):
                    relative = example.get(f"{side}_file")
                    if relative:
                        source = (temp_path / relative).resolve()
                        if not str(source).startswith(str(temp_path.resolve())) or not source.exists():
                            raise ValueError("Unsafe or missing image path")
                        target = destination / source.name
                        shutil.copy2(source, target)
                        payload[f"{side}_image_path"] = str(target)
                if bulk_intake_repository.import_training_example(payload, source_pack_id=pack_id):
                    imported += 1
                else:
                    duplicates += 1
            except Exception:
                rejected += 1
    return ContributionPackImportResponse(
        imported_examples=imported,
        duplicates_skipped=duplicates,
        rejected_examples=rejected,
    )
