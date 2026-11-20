#!/usr/bin/env python3
"""Read the manifest.tsv that gather.sh writes.

One row per gathered file, tab separated:

    repo, path, local, format, name, author, date, icon

Fields gather.sh could not read from the file's `#!` headers are empty strings,
which the callers treat as "classify it yourself".
"""

from __future__ import annotations

from pathlib import Path

FIELDS = ("repo", "path", "local", "format", "name", "author", "date", "icon")


def read_manifest(root: Path) -> list[dict[str, str]]:
    path = root / "manifest.tsv"
    if not path.exists():
        return []
    rows: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        parts += [""] * (len(FIELDS) - len(parts))
        rows.append(dict(zip(FIELDS, parts)))
    return rows
