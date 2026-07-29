from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.core.config import settings
from app.services.imaging.embedding_engine import (
    EmbeddingEngineError,
    LocalEmbeddingEngine,
)


class FakeSession:
    def __init__(self, output: np.ndarray) -> None:
        self._output = output
        self.last_input: np.ndarray | None = None

    def get_inputs(self):
        return [SimpleNamespace(name="pixel_values", shape=[1, 3, 4, 4], type="tensor(float)")]

    def get_outputs(self):
        return [SimpleNamespace(name="image_embeds", shape=[1, 1152], type="tensor(float)")]

    def get_providers(self):
        return ["CPUExecutionProvider"]

    def run(self, output_names, input_feed):
        self.last_input = input_feed["pixel_values"]
        return [self._output]


class FakeOrt:
    @staticmethod
    def get_available_providers():
        return ["CPUExecutionProvider"]


def test_local_embedding_engine_returns_unit_normalized_1152_vector(tmp_path: Path, monkeypatch):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"fake-model")
    raw = np.arange(1, 1153, dtype=np.float32).reshape(1, 1152)
    session = FakeSession(raw)

    monkeypatch.setattr(settings, "embedding_enabled", True)
    monkeypatch.setattr(settings, "embedding_input_size", 4)
    monkeypatch.setattr(settings, "embedding_channel_mean", (0.5, 0.5, 0.5))
    monkeypatch.setattr(settings, "embedding_channel_std", (0.5, 0.5, 0.5))

    engine = LocalEmbeddingEngine(
        model_path=model_path,
        ort_module=FakeOrt(),
        session_factory=lambda _path, _providers, _ort: session,
    )
    image = np.full((8, 6, 3), 160, dtype=np.uint8)
    result = engine.extract(image)

    assert result.dimensions == 1152
    assert result.normalized is True
    assert result.provider == "CPUExecutionProvider"
    assert len(result.vector) == 1152
    assert np.linalg.norm(np.asarray(result.vector, dtype=np.float32)) == pytest.approx(1.0, rel=1e-5)
    assert session.last_input is not None
    assert session.last_input.shape == (1, 3, 4, 4)


def test_local_embedding_engine_fails_closed_for_wrong_output_dimensions(tmp_path: Path, monkeypatch):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"fake-model")
    session = FakeSession(np.ones((1, 128), dtype=np.float32))
    monkeypatch.setattr(settings, "embedding_enabled", True)

    engine = LocalEmbeddingEngine(
        model_path=model_path,
        ort_module=FakeOrt(),
        session_factory=lambda _path, _providers, _ort: session,
    )

    with pytest.raises(EmbeddingEngineError, match="1152"):
        engine.extract(np.zeros((8, 8, 3), dtype=np.uint8))


def test_local_embedding_engine_reports_unconfigured_state(monkeypatch):
    monkeypatch.setattr(settings, "embedding_enabled", True)
    engine = LocalEmbeddingEngine(model_path=None)
    readiness = engine.readiness()
    assert readiness.enabled is True
    assert readiness.configured is False
    assert readiness.ready is False
