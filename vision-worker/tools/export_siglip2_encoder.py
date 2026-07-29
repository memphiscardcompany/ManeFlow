from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np


DEFAULT_MODEL_ID = "google/siglip2-so400m-patch16-384"
EXPECTED_DIMENSIONS = 1152
DEFAULT_IMAGE_SIZE = 384


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_encoder(
    *,
    model_id: str,
    output_dir: Path,
    opset: int,
    device: str,
) -> dict[str, Any]:
    try:
        import torch
        import torch.nn.functional as functional
        from transformers import AutoModel
    except ImportError as exc:
        raise RuntimeError(
            "Model export dependencies are missing. Install requirements-model-export.txt first."
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    model = AutoModel.from_pretrained(model_id, torch_dtype=torch.float32).eval().to(device)
    vision_config = getattr(getattr(model, "config", None), "vision_config", None)
    hidden_size = int(getattr(vision_config, "hidden_size", 0) or 0)
    image_size = int(getattr(vision_config, "image_size", DEFAULT_IMAGE_SIZE) or DEFAULT_IMAGE_SIZE)
    if hidden_size != EXPECTED_DIMENSIONS:
        raise RuntimeError(
            f"Model '{model_id}' exposes {hidden_size} vision dimensions; {EXPECTED_DIMENSIONS} are required."
        )

    class VisionEncoder(torch.nn.Module):
        def __init__(self, wrapped: torch.nn.Module) -> None:
            super().__init__()
            self.wrapped = wrapped

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            features = self.wrapped.get_image_features(pixel_values=pixel_values)
            return functional.normalize(features.float(), p=2, dim=-1)

    wrapper = VisionEncoder(model).eval()
    example = torch.linspace(
        -1.0,
        1.0,
        steps=3 * image_size * image_size,
        dtype=torch.float32,
        device=device,
    ).reshape(1, 3, image_size, image_size)
    onnx_path = output_dir / "siglip2-so400m-card-front-1152.onnx"

    with torch.inference_mode():
        expected = wrapper(example).detach().cpu().numpy()
    if expected.shape != (1, EXPECTED_DIMENSIONS):
        raise RuntimeError(f"Unexpected PyTorch output shape: {expected.shape!r}")

    torch.onnx.export(
        wrapper,
        (example,),
        str(onnx_path),
        input_names=["pixel_values"],
        output_names=["image_embedding"],
        dynamic_axes={
            "pixel_values": {0: "batch"},
            "image_embedding": {0: "batch"},
        },
        opset_version=opset,
        do_constant_folding=True,
        export_params=True,
    )

    try:
        import onnx
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError("onnx and onnxruntime are required to validate the exported model.") from exc

    graph = onnx.load(str(onnx_path))
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    actual = session.run(["image_embedding"], {"pixel_values": example.cpu().numpy()})[0]
    if actual.shape != expected.shape:
        raise RuntimeError(f"Unexpected ONNX output shape: {actual.shape!r}")
    maximum_error = float(np.max(np.abs(actual.astype(np.float32) - expected.astype(np.float32))))
    cosine = float(
        np.dot(actual[0], expected[0])
        / (max(np.linalg.norm(actual[0]), 1e-12) * max(np.linalg.norm(expected[0]), 1e-12))
    )
    if not np.isfinite(maximum_error) or cosine < 0.999:
        raise RuntimeError(
            f"Export parity validation failed: max_abs_error={maximum_error:.8f}, cosine={cosine:.8f}."
        )

    manifest = {
        "model_id": model_id,
        "license": "Apache-2.0",
        "source": f"https://huggingface.co/{model_id}",
        "artifact": onnx_path.name,
        "sha256": _sha256(onnx_path),
        "input": {
            "name": "pixel_values",
            "shape": ["batch", 3, image_size, image_size],
            "dtype": "float32",
            "color_space": "RGB",
            "scale": "0..1 then (x - 0.5) / 0.5",
        },
        "output": {
            "name": "image_embedding",
            "shape": ["batch", EXPECTED_DIMENSIONS],
            "dtype": "float32",
            "l2_normalized": True,
        },
        "opset": opset,
        "validation": {
            "maximum_absolute_error": maximum_error,
            "cosine_similarity": cosine,
        },
    }
    (output_dir / "model-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "LICENSE-SOURCE.txt").write_text(
        "Google SigLIP 2 model checkpoint\n"
        f"Source: https://huggingface.co/{model_id}\n"
        "License declared by the source model card: Apache License 2.0\n",
        encoding="utf-8",
    )
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and export the approved 1152-D SigLIP 2 vision encoder to ONNX."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL_ID)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--opset", type=int, default=18)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = export_encoder(
        model_id=args.model,
        output_dir=args.output.expanduser().resolve(),
        opset=args.opset,
        device=args.device,
    )
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
