from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _write_pattern(path: Path, *, circle_x: int, label: str) -> None:
    canvas = np.full((920, 700, 3), 235, dtype=np.uint8)
    cv2.rectangle(canvas, (35, 35), (665, 885), (20, 20, 20), 9)
    cv2.circle(canvas, (circle_x, 300), 95, (70, 125, 210), -1)
    cv2.putText(canvas, label, (90, 690), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 0), 3)
    assert cv2.imwrite(str(path), canvas)


def test_unordered_folder_groups_visual_views_without_using_filename_order(tmp_path: Path):
    # Deliberately misleading/random names. Two image pairs represent two physical cards.
    a1 = tmp_path / 'z-last-upload.jpg'
    a2 = tmp_path / '001-random.jpg'
    b1 = tmp_path / 'middle-file.jpg'
    b2 = tmp_path / 'IMG_9999.jpg'
    _write_pattern(a1, circle_x=220, label='CARD A')
    a2.write_bytes(a1.read_bytes())
    _write_pattern(b1, circle_x=475, label='CARD B')
    b2.write_bytes(b1.read_bytes())

    response = client.post(
        '/v1/intake/photos/import-folder',
        json={
            'folder_path': str(tmp_path),
            'batch_name': 'unordered test',
            'copy_into_maneflow': False,
        },
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch['pairing_strategy'] == 'unordered_evidence_clustering'
    assert batch['item_count'] == 2
    assert batch['metadata']['order_used_as_identity_evidence'] is False
    assert batch['grouping_summary']['order_independent'] is True
    assert batch['grouping_summary']['images'] == 4
    assert batch['grouping_summary']['physical_cards'] == 2
    assert sorted(len(item['evidence']['all_source_files']) for item in batch['items']) == [2, 2]
