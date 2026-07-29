from __future__ import annotations

import json

from app.core.compute import probe_compute, select_compute_device


def main() -> int:
    probe = probe_compute()
    selection = select_compute_device(
        workload="current ManeFlow compute status",
        required_runtime="any",
        beneficial=True,
        probe=probe,
    )
    print(
        json.dumps(
            {
                "selection": selection.to_dict(),
                "probe": probe.to_dict(),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
