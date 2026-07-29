from __future__ import annotations

import json

from maneflow_vision.gpu.doctor import collect_environment


def main() -> int:
    report = collect_environment()
    print(json.dumps({
        "generated_at": report["generated_at"],
        "platform": report["platform"],
        "resources": report["resources"],
        "cuda_capability": report["cuda_capability"],
        "selected_compute": report["selected_compute"],
        "nvidia_smi_summary": report["commands"]["nvidia_smi_summary"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
