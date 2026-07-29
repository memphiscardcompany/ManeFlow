#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / 'vision-worker'))

from app.services.imaging.adaptive_grouping import normalize_card_image, pair_evidence
from app.services.imaging.card_detector import decode_image

SUPPORTED = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'}


def augment(image: np.ndarray, rng: random.Random) -> np.ndarray:
    height, width = image.shape[:2]
    amount = max(3, int(min(width, height) * rng.uniform(0.01, 0.045)))
    source = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    target = np.float32([
        [rng.randint(0, amount), rng.randint(0, amount)],
        [width - 1 - rng.randint(0, amount), rng.randint(0, amount)],
        [width - 1 - rng.randint(0, amount), height - 1 - rng.randint(0, amount)],
        [rng.randint(0, amount), height - 1 - rng.randint(0, amount)],
    ])
    matrix = cv2.getPerspectiveTransform(source, target)
    transformed = cv2.warpPerspective(image, matrix, (width, height), borderMode=cv2.BORDER_REFLECT)
    alpha = rng.uniform(0.78, 1.22)
    beta = rng.uniform(-18, 18)
    transformed = cv2.convertScaleAbs(transformed, alpha=alpha, beta=beta)
    if rng.random() < 0.5:
        transformed = cv2.GaussianBlur(transformed, (3, 3), rng.uniform(0.2, 1.1))
    if rng.random() < 0.45:
        overlay = transformed.copy()
        center = (rng.randint(width // 4, 3 * width // 4), rng.randint(height // 5, 4 * height // 5))
        axes = (rng.randint(max(20, width // 10), max(25, width // 3)), rng.randint(max(20, height // 14), max(25, height // 5)))
        cv2.ellipse(overlay, center, axes, rng.uniform(0, 180), 0, 360, (255, 255, 255), -1)
        transformed = cv2.addWeighted(overlay, rng.uniform(0.05, 0.16), transformed, 1.0, 0)
    return transformed


def choose_threshold(positives: list[float], negatives: list[float]) -> tuple[float, dict]:
    candidates = sorted(set([0.60, 0.65, 0.70, 0.75, 0.80, 0.82, 0.84, 0.86, 0.88, 0.90, 0.92] + positives + negatives))
    best = None
    for threshold in candidates:
        tp = sum(score >= threshold for score in positives)
        fn = len(positives) - tp
        fp = sum(score >= threshold for score in negatives)
        tn = len(negatives) - fp
        tpr = tp / max(1, len(positives))
        fpr = fp / max(1, len(negatives))
        # False physical-card merges are much more damaging than missed grouping.
        objective = tpr - 8.0 * fpr
        candidate = (objective, -fpr, tpr, threshold, tp, fn, fp, tn)
        if best is None or candidate > best:
            best = candidate
    assert best is not None
    _, _, tpr, threshold, tp, fn, fp, tn = best
    return round(max(0.74, min(0.94, threshold)), 4), {
        'true_positive_rate': round(tpr, 4),
        'false_positive_rate': round(fp / max(1, len(negatives)), 4),
        'true_positives': tp,
        'false_negatives': fn,
        'false_positives': fp,
        'true_negatives': tn,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Calibrate ManeFlow multi-view photo grouping from rights-cleared owner images.')
    parser.add_argument('--input', default='data/training/owner-authorized/images')
    parser.add_argument('--output', default='data/training/grouping-calibration.json')
    parser.add_argument('--augmentations', type=int, default=4)
    parser.add_argument('--seed', type=int, default=20260726)
    args = parser.parse_args()

    source = Path(args.input).resolve()
    paths = [path for path in sorted(source.iterdir()) if path.is_file() and path.suffix.lower() in SUPPORTED] if source.is_dir() else []
    if len(paths) < 8:
        result = {
            'schema_version': '1.0',
            'updated_at': datetime.now(timezone.utc).isoformat(),
            'status': 'paused_insufficient_owner_images',
            'owner_images': len(paths),
            'minimum_owner_images': 8,
            'model_weights_changed': False,
        }
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, indent=2))
        return 0

    rng = random.Random(args.seed)
    images = []
    valid_paths = []
    for path in paths:
        try:
            image = normalize_card_image(decode_image(path.read_bytes()))
        except Exception:
            continue
        images.append(image)
        valid_paths.append(path)

    positive_scores: list[float] = []
    positive_distances: list[int] = []
    for image in images:
        for _ in range(max(1, args.augmentations)):
            evidence = pair_evidence(image, augment(image, rng), {'acceptance_threshold': 0.0, 'max_dhash_distance': 64, 'min_good_matches': 0, 'min_homography_inliers': 0, 'min_homography_inlier_ratio': 0.0})
            positive_scores.append(evidence.score)
            positive_distances.append(evidence.dhash_distance)

    negative_scores: list[float] = []
    negative_distances: list[int] = []
    pairs = [(i, j) for i in range(len(images)) for j in range(i + 1, len(images))]
    rng.shuffle(pairs)
    for i, j in pairs[: min(500, max(80, len(positive_scores) * 3))]:
        evidence = pair_evidence(images[i], images[j], {'acceptance_threshold': 0.0, 'max_dhash_distance': 64, 'min_good_matches': 0, 'min_homography_inliers': 0, 'min_homography_inlier_ratio': 0.0})
        negative_scores.append(evidence.score)
        negative_distances.append(evidence.dhash_distance)

    threshold, metrics = choose_threshold(positive_scores, negative_scores)
    positive_sorted = sorted(positive_distances)
    max_dhash = positive_sorted[min(len(positive_sorted) - 1, int(len(positive_sorted) * 0.95))]
    max_dhash = max(8, min(22, int(max_dhash)))
    corpus_hash = hashlib.sha256('\n'.join(sorted(path.name for path in valid_paths)).encode()).hexdigest()
    result = {
        'schema_version': '1.0',
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'status': 'trained_owner_corpus_calibration',
        'owner_images': len(images),
        'positive_pairs': len(positive_scores),
        'negative_pairs': len(negative_scores),
        'acceptance_threshold': threshold,
        'max_dhash_distance': max_dhash,
        'min_good_matches': 12,
        'min_homography_inliers': 8,
        'min_homography_inlier_ratio': 0.42,
        'metrics': metrics,
        'corpus_hash': corpus_hash,
        'training_type': 'self_supervised_synthetic_view_calibration',
        'identity_labels_used': 0,
        'user_labels_required': False,
        'model_weights_changed': False,
        'system_component_updated': 'any_order_multi_view_grouping',
        'safety_note': 'Visual grouping remains conservative; cert, serial, front/back identity, and capture-time evidence take priority.',
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
