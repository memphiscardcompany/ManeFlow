from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import inspect
from typing import Any, Awaitable, Callable

EvidenceCallable = Callable[[Any], Any | Awaitable[Any]]


@dataclass(frozen=True)
class EvidenceBranchResult:
    status: str
    value: Any | None = None
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class ParallelEvidenceResult:
    ocr: EvidenceBranchResult
    embedding: EvidenceBranchResult
    warnings: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.ocr.status == "complete" or self.embedding.status == "complete"


async def _invoke(callable_: EvidenceCallable, crop: Any) -> Any:
    if inspect.iscoroutinefunction(callable_):
        return await callable_(crop)
    return await asyncio.to_thread(callable_, crop)


def _failure(exc: BaseException) -> EvidenceBranchResult:
    name = type(exc).__name__.upper()
    message = str(exc)[:1000]
    lowered = message.lower()
    if "out of memory" in lowered or "cuda" in lowered and "memory" in lowered:
        code = "GPU_OOM"
    elif isinstance(exc, TimeoutError) or "timeout" in lowered or "timed out" in lowered:
        code = "TIMEOUT"
    elif "decode" in lowered or "invalid image" in lowered:
        code = "INVALID_IMAGE"
    else:
        code = name or "EVIDENCE_BRANCH_FAILED"
    return EvidenceBranchResult(status="failed", error_code=code, error_message=message)


async def run_parallel_crop_evidence(
    crop: Any,
    *,
    ocr: EvidenceCallable,
    embedding: EvidenceCallable,
    timeout_seconds: float = 30.0,
) -> ParallelEvidenceResult:
    """Run OCR and embedding independently after crop normalization.

    A branch failure does not cancel the other branch. The caller decides whether
    partial evidence is sufficient for retrieval/reranking or requires review.
    """
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive")

    async def guarded(callable_: EvidenceCallable) -> EvidenceBranchResult:
        try:
            value = await asyncio.wait_for(_invoke(callable_, crop), timeout=timeout_seconds)
            return EvidenceBranchResult(status="complete", value=value)
        except BaseException as exc:  # branch isolation is intentional
            return _failure(exc)

    ocr_result, embedding_result = await asyncio.gather(
        guarded(ocr),
        guarded(embedding),
    )
    warnings: list[str] = []
    if ocr_result.status != "complete":
        warnings.append(f"OCR evidence unavailable: {ocr_result.error_code}.")
    if embedding_result.status != "complete":
        warnings.append(f"Embedding evidence unavailable: {embedding_result.error_code}.")
    if ocr_result.status != "complete" and embedding_result.status != "complete":
        warnings.append("No parallel evidence branch completed; manual review or a controlled retry is required.")
    return ParallelEvidenceResult(ocr=ocr_result, embedding=embedding_result, warnings=warnings)
