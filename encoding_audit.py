# -*- coding: utf-8 -*-
"""Audit project text files for invalid UTF-8 and common mojibake markers."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".git", ".venv", "node_modules", ".matplotlib-cache", "cache", "runs", "results"}
TEXT_SUFFIXES = {
    ".bat", ".css", ".csv", ".html", ".js", ".jsx", ".json", ".md",
    ".mjs", ".py", ".sh", ".txt", ".xml", ".yml", ".yaml",
}
MOJIBAKE_MARKERS = (
    "╨", "╤", "Ð", "Ñ", "Р°", "Рµ", "Рё", "Рѕ", "РЅ", "СЃ", "С‚",
    "вЂ", "в„", "п»ї", "ï»¿", "Ã", "Â",
)


def iter_text_files():
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.suffix.lower() in TEXT_SUFFIXES or path.name in {".editorconfig", ".gitattributes"}:
            yield path


def main() -> int:
    problems: list[str] = []
    checked = 0
    for path in iter_text_files():
        checked += 1
        data = path.read_bytes()
        relative = path.relative_to(ROOT)
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            problems.append(f"{relative}: invalid UTF-8 at byte {exc.start}")
            continue

        if path.name != "encoding_audit.py":
            markers = [marker for marker in MOJIBAKE_MARKERS if marker in text]
            if markers:
                problems.append(f"{relative}: possible mojibake markers: {', '.join(markers)}")

        if path.suffix.lower() == ".bat":
            if any(byte >= 128 for byte in data):
                problems.append(f"{relative}: batch launchers must remain ASCII-only")
            if b"\n" in data and data.count(b"\r\n") != data.count(b"\n"):
                problems.append(f"{relative}: batch launcher must use CRLF line endings")

        if path.suffix.lower() == ".json":
            try:
                json.loads(text)
            except json.JSONDecodeError as exc:
                problems.append(f"{relative}: invalid JSON: {exc}")

    index = ROOT / "gui" / "index.html"
    if index.exists() and '<meta charset="UTF-8"' not in index.read_text(encoding="utf-8"):
        problems.append("gui/index.html: missing UTF-8 meta declaration")

    if problems:
        print(f"Encoding audit: FAILED ({len(problems)} issue(s), {checked} files checked)")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(f"Encoding audit: OK ({checked} text files checked, UTF-8 policy verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
