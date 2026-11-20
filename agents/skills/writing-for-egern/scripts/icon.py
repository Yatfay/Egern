#!/usr/bin/env python3
"""Resolve a module icon, honouring the skill's priority order.

    python3 icon.py --sources /tmp/picc            # source icon wins if any
    python3 icon.py --name '中国人保'               # else App Store 104x104
    python3 icon.py --id 710189980                 # direct appId

Priority: (1) an icon URL already present in a gathered source module,
(2) the app's App Store artwork resized to 104x104, (3) an SF Symbol.
Prints one icon value for the module's `icon:` field and its provenance.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from manifest import read_manifest

STORE_SIZES = "104x104bb.jpg"
SF_SYMBOL_FALLBACK = "shield.fill"


def http_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "writing-for-egern/2.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def from_sources(directory: Path) -> tuple[str, str] | None:
    """First source module that ships its own icon — the originals' branding."""
    for item in read_manifest(directory):
        icon = item["icon"].strip()
        if icon.startswith("http"):
            return icon, f"source: {item['repo']}"
    return None


def from_store(app_id: str | None, name: str | None) -> tuple[str, str] | None:
    if app_id:
        results = http_json(
            f"https://itunes.apple.com/lookup?id={app_id}&country=cn"
        ).get("results", [])
    elif name:
        results = http_json(
            "https://itunes.apple.com/search?term="
            f"{urllib.parse.quote(name)}&country=cn&entity=software&limit=5"
        ).get("results", [])
    else:
        return None

    if not results:
        return None
    best = results[0]
    artwork = best.get("artworkUrl512") or best.get("artworkUrl100") or ""
    if not artwork:
        return None
    resized = artwork.rsplit("/", 1)[0] + "/" + STORE_SIZES
    return resized, f"App Store: {best.get('trackName', '')} (id {best.get('trackId')})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, help="gather.sh output directory")
    parser.add_argument("--name", help="app name to search the App Store for")
    parser.add_argument("--id", dest="app_id", help="App Store appId")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    resolved: tuple[str, str] | None = None
    if args.sources and (found := from_sources(args.sources)):
        resolved = found
    if resolved is None:
        resolved = from_store(args.app_id, args.name)
    if resolved is None:
        resolved = (SF_SYMBOL_FALLBACK, "fallback: no icon in sources, no App Store match")

    icon, provenance = resolved
    if args.json:
        print(json.dumps({"icon": icon, "provenance": provenance}, ensure_ascii=False))
    else:
        print(f"icon: {icon}")
        print(f"from: {provenance}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
