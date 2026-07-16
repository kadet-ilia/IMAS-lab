#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JSON bridge between the Node dashboard server and the Python model.

Progress messages are emitted to stderr as lines beginning with
``IMAS_PROGRESS\t``. The final JSON document is written to stdout.
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import fields, replace
from pathlib import Path
from typing import Any


def configure_utf8_stdio() -> None:
    """Use UTF-8 for the Node/Python pipe on every supported platform."""
    for stream_name, errors in (("stdin", "strict"), ("stdout", "strict"), ("stderr", "backslashreplace")):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors=errors, newline="\n")


configure_utf8_stdio()

try:
    import numpy as np
except ModuleNotFoundError as exc:
    dependency = exc.name or "required Python package"
    sys.stderr.write(
        f"Missing Python dependency: {dependency}. "
        "Run start_gui.bat (recommended) or install_dependencies.bat before launching the application.\n"
    )
    raise SystemExit(2) from exc

from experiment import (
    ExperimentConfig,
    run_factorial_sensitivity,
    run_monte_carlo_analysis,
    run_one_factor_sensitivity,
    simulate_trace,
)


def clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    if isinstance(value, np.generic):
        return clean(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def make_config(payload: dict[str, Any]) -> ExperimentConfig:
    raw = dict(payload.get("config", {}))
    allowed = {field.name for field in fields(ExperimentConfig)}
    raw = {key: value for key, value in raw.items() if key in allowed}
    if "scenarios" in raw:
        raw["scenarios"] = tuple(raw["scenarios"])
    cfg = replace(ExperimentConfig(), **raw)
    cfg.validate()
    if cfg.n_steps > 500 or cfg.n_runs > 500:
        raise ValueError("GUI limit exceeded: steps<=500, runs<=500")
    return cfg


def emit_progress(payload: dict[str, Any]) -> None:
    sys.stderr.write("IMAS_PROGRESS\t" + json.dumps(clean(payload), ensure_ascii=False) + "\n")
    sys.stderr.flush()


def stop_checker() -> bool:
    path = os.environ.get("IMAS_STOP_FILE")
    return bool(path and Path(path).exists())


def checkpoint_path() -> Path | None:
    value = os.environ.get("IMAS_CHECKPOINT_FILE")
    return Path(value) if value else None


def main() -> int:
    payload = json.load(sys.stdin)
    action = payload.get("action", "trace")
    cfg = make_config(payload)
    scenario = payload.get("scenario", cfg.scenarios[0])

    if action == "trace":
        result = simulate_trace(
            cfg,
            scenario=scenario,
            run_index=int(payload.get("run_index", 0)),
            progress_callback=emit_progress,
            stop_checker=stop_checker,
        )
    elif action == "monte_carlo":
        result = run_monte_carlo_analysis(
            replace(cfg, scenarios=(scenario,)),
            scenario,
            progress_callback=emit_progress,
            stop_checker=stop_checker,
            checkpoint_path=checkpoint_path(),
        )
    elif action == "sensitivity":
        mode = payload.get("sensitivity_mode", "one_factor")
        if mode == "factorial":
            raw_ranges = payload.get("factor_ranges")
            ranges = None
            if isinstance(raw_ranges, dict):
                ranges = {
                    key: (float(value[0]), float(value[1]))
                    for key, value in raw_ranges.items()
                    if isinstance(value, (list, tuple)) and len(value) == 2
                }
            result = run_factorial_sensitivity(
                cfg,
                scenario,
                factor_ranges=ranges,
                progress_callback=emit_progress,
                stop_checker=stop_checker,
                checkpoint_path=checkpoint_path(),
            )
        else:
            requested = payload.get("f_values", [0, 2, 4, 6, 8, 10])
            result = run_one_factor_sensitivity(
                cfg,
                scenario,
                requested,
                progress_callback=emit_progress,
                stop_checker=stop_checker,
                checkpoint_path=checkpoint_path(),
            )
    else:
        raise ValueError(f"Unknown action: {action}")

    json.dump(clean(result), sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        raise SystemExit(1)
