from __future__ import annotations

import hashlib

import cv2
import numpy as np
import pytest

import replay_live_sequence as replay
from app.services import live_session as live_session_module


@pytest.mark.asyncio
async def test_replay_verifies_asset_and_emits_no_unverified_catalog_id(tmp_path, monkeypatch):
    payload = b"authorized synthetic video bytes"
    (tmp_path / "video.mp4").write_bytes(payload)
    class Capture:
        timestamp = 0.0
        def isOpened(self): return True
        def set(self, _property, value): self.timestamp = value
        def get(self, prop): return 30.0 if prop == cv2.CAP_PROP_FPS else self.timestamp
        def read(self): return True, np.full((100, 100, 3), 100, dtype=np.uint8)
        def release(self): pass
    monkeypatch.setattr(replay.cv2, "VideoCapture", lambda _path: Capture())
    monkeypatch.setattr(live_session_module, "detect_card_objects", lambda *_args, **_kwargs: [])
    sequence = {
        "sequence_id": "synthetic", "split": "locked_test",
        "asset": {"asset_id": "video-1", "source_path": "video.mp4", "sha256": hashlib.sha256(payload).hexdigest(),
                  "physical_card_group_id": "physical-1", "rights_status": "owner-controlled", "retention_policy": "private", "training_use_allowed": False},
        "frames": [{"timestamp_ms": 0, "cards": []}],
    }
    result = await replay.replay_sequence(sequence, tmp_path)
    assert result["asset_id"] == "video-1"
    assert result["frames"][0]["tracks"] == []
    sequence["asset"]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        await replay.replay_sequence(sequence, tmp_path)
    sequence["asset"]["source_path"] = "../outside.mp4"
    with pytest.raises((ValueError, FileNotFoundError)):
        await replay.replay_sequence(sequence, tmp_path)
