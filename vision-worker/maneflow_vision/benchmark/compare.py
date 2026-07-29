from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

LOWER_IS_BETTER = {
    "false_confident_rate",
    "false_confident_matches",
    "latency_p50_ms",
    "latency_p95_ms",
    "latency_p99_ms",
    "expected_calibration_error",
    "peak_vram_mb",
    "peak_ram_mb",
    "failure_rate",
}


def _flatten(prefix: str, value: Any, output: dict[str, float]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            _flatten(f"{prefix}.{key}" if prefix else key, child, output)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        output[prefix] = float(value)


def compare(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    baseline_values: dict[str, float] = {}
    candidate_values: dict[str, float] = {}
    _flatten("", baseline, baseline_values)
    _flatten("", candidate, candidate_values)
    metrics = []
    for name in sorted(set(baseline_values).intersection(candidate_values)):
        before, after = baseline_values[name], candidate_values[name]
        delta = after - before
        leaf = name.rsplit(".", 1)[-1]
        lower_is_better = leaf in LOWER_IS_BETTER
        improved = delta < 0 if lower_is_better else delta > 0
        equivalent = abs(delta) <= 1e-12
        metrics.append({
            "metric": name,
            "baseline": before,
            "candidate": after,
            "delta": delta,
            "direction": "lower_is_better" if lower_is_better else "higher_is_better",
            "assessment": "equivalent" if equivalent else "improved" if improved else "regressed",
        })
    regressions = [metric for metric in metrics if metric["assessment"] == "regressed"]
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "regressions": regressions,
        "promotion_decision": "REVIEW_REQUIRED" if not regressions else "REJECTED_REGRESSION",
        "warning": "Metric direction must be reviewed for domain-specific fields before promotion.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare ManeFlow baseline and candidate benchmark JSON.")
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--output", default="artifacts/benchmark-comparison.json")
    args = parser.parse_args()
    baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    candidate = json.loads(Path(args.candidate).read_text(encoding="utf-8"))
    result = compare(baseline, candidate)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not result["regressions"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
