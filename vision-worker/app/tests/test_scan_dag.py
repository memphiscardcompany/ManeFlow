from __future__ import annotations

import asyncio
import threading
import time

import pytest

from app.services.scan_dag import run_parallel_crop_evidence


@pytest.mark.asyncio
async def test_parallel_evidence_runs_ocr_and_embedding_concurrently() -> None:
    barrier = threading.Barrier(2)

    def ocr(_: object) -> dict[str, str]:
        barrier.wait(timeout=1)
        time.sleep(0.03)
        return {"card_number": "US1"}

    def embed(_: object) -> list[float]:
        barrier.wait(timeout=1)
        time.sleep(0.03)
        return [0.1, 0.2]

    result = await run_parallel_crop_evidence(object(), ocr=ocr, embedding=embed, timeout_seconds=1)
    assert result.ocr.status == "complete"
    assert result.embedding.status == "complete"
    assert result.usable is True


@pytest.mark.asyncio
async def test_branch_failure_does_not_cancel_other_evidence() -> None:
    def bad_ocr(_: object) -> None:
        raise ValueError("invalid image text region")

    async def embed(_: object) -> list[float]:
        await asyncio.sleep(0)
        return [0.25]

    result = await run_parallel_crop_evidence(object(), ocr=bad_ocr, embedding=embed)
    assert result.ocr.status == "failed"
    assert result.ocr.error_code == "INVALID_IMAGE"
    assert result.embedding.status == "complete"
    assert result.usable is True


@pytest.mark.asyncio
async def test_timeout_is_isolated_and_reported() -> None:
    async def slow(_: object) -> str:
        await asyncio.sleep(0.05)
        return "late"

    result = await run_parallel_crop_evidence(object(), ocr=slow, embedding=lambda _: [1.0], timeout_seconds=0.01)
    assert result.ocr.status == "failed"
    assert result.ocr.error_code == "TIMEOUT"
    assert result.embedding.status == "complete"
