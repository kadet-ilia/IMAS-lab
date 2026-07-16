#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Preflight check for the Python runtime used by the IMAS GUI."""
from __future__ import annotations

import importlib
import platform
import sys

REQUIRED = ("numpy", "pandas", "matplotlib")


def configure_utf8_stdio() -> None:
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")



def main() -> int:
    configure_utf8_stdio()
    print(f"Python: {sys.executable}")
    print(f"Version: {platform.python_version()}")
    print(f"stdin/stdout/stderr: {sys.stdin.encoding}/{sys.stdout.encoding}/{sys.stderr.encoding}")
    if sys.version_info < (3, 11):
        print("ERROR: required Python version is 3.11 or newer.", file=sys.stderr)
        return 2

    failed: list[str] = []
    for name in REQUIRED:
        try:
            module = importlib.import_module(name)
            version = getattr(module, "__version__", "unknown")
            print(f"{name}: {version}")
        except Exception as exc:  # diagnostic script must report every failure
            failed.append(f"{name}: {exc}")

    if failed:
        print("ERROR: unavailable Python dependencies:", file=sys.stderr)
        for item in failed:
            print(f"  - {item}", file=sys.stderr)
        print("Run start_gui.bat or install_dependencies.bat.", file=sys.stderr)
        return 1

    print("Environment check: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
