#!/usr/bin/env python3
"""Extract rewrite entries from gathered modules and cluster duplicates.

    python3 extract.py /tmp/picc          # writes entries.json, clusters.md

Turns every gathered file into normalized entries

    {pattern, pattern_norm, action, target, source_repo, source_author,
     source_date, comment}

then groups entries across sources by normalized pattern, so the merge step
sees one cluster per intent instead of N near-copies. Clusters with more
than one distinct action are the conflicts the policy has to decide.

Reads the manifest.tsv written by gather.sh; understands Surge [URL Rewrite] /
[Map Local] / [Script] / [MITM], Loon v1 and v2 [Rewrite] / [Script], QX
rewrite lines, and native Egern YAML url_rewrites / map_locals.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from manifest import read_manifest

SURGE_REWRITE_RE = re.compile(r"^(?P<pattern>\S.*?)\s+-\s+(?P<action>[\w-]+)\s*$")
SURGE_MAPLOCAL_RE = re.compile(r"^(?P<pattern>\S.*?)\s+(?P<opts>data-type=.*)$")
SURGE_SCRIPT_RE = re.compile(
    r"(?:type=(?P<type>[\w-]+)\s*,\s*)?pattern=(?P<pattern>[^,]+),\s*(?:requires-body=(?P<body>\d),?\s*)?script-path=(?P<url>[^,\s]+)"
)
LOON_V2_RE = re.compile(
    r"^(?P<phase>request|response)\s+if\s+\$\{url\}\s+~=\s+/(?P<pattern>.+?)/[a-z]*\s+then\s+(?P<action>.+)$"
)
LOON_SCRIPT_RE = re.compile(
    r"^(?P<phase>request|response)\s+(?P<pattern>\S+)\s+script-path\s*=\s*(?P<url>[^,\s]+)"
)
QX_REWRITE_RE = re.compile(
    r"^(?P<pattern>\^?\S+)\s+url\s+(?P<action>reject[\w-]*|302\s+\S+|script-response-body|script-request-header|response-body|request-body)(?:\s+(?P<target>\S+))?"
)
EGERN_KEY_RE = re.compile(r"^\s*-?\s*(?P<key>match|location|filter|status_code|body|script_url|name):\s*(?P<value>.+)$")
SECTION_RE = re.compile(r"^\[(?P<section>[^\]]+)\]\s*$")


def classify_local(filename: str, content: str) -> str:
    lowered = filename.lower()
    if lowered.endswith((".yaml", ".yml")) and re.search(
        r"^(url_rewrites|scriptings|mitm|body_rewrites):", content, re.M
    ):
        return "egern"
    if lowered.endswith(".sgmodule") or "[URL Rewrite]" in content:
        return "surge"
    if lowered.endswith((".plugin", ".lpx")) or re.search(r"^\[Rewrite\]", content, re.M):
        return "loon"
    if re.search(r"\burl\s+(reject|script-response-body|script-request-header|302)", content):
        return "qx"
    if lowered.endswith(".stoverride"):
        return "stash"
    return "other"


def header_value(content: str, key: str) -> str:
    for line in content.splitlines()[:30]:
        match = re.match(rf"^#!?\s*{key}\s*=\s*(.+)$", line.strip(), re.I)
        if match:
            return match.group(1).strip()
    return ""


def normalize_pattern(pattern: str) -> str:
    """Reduce a URL pattern to a comparison key."""
    text = pattern.strip().strip("'\"")
    text = text.replace("\\/", "/")
    text = re.sub(r"^https\?\?:?\\?/\\?/", "https://", text)
    text = re.sub(r"^https:", "https:", text)
    text = re.sub(r"\^|\$", "", text)
    text = re.sub(r"\\\.", ".", text)
    text = re.sub(r"\\", "", text)
    return text.rstrip("/").lower()


def add(entries: list[dict], **fields) -> None:
    pattern = fields.get("pattern", "")
    if not pattern:
        return
    fields["pattern_norm"] = normalize_pattern(pattern)
    entries.append(fields)


def parse_surge(text: str, meta: dict) -> list[dict]:
    entries: list[dict] = []
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        header = SECTION_RE.match(line)
        if header:
            section = header.group("section").lower()
            continue
        if section == "url rewrite":
            match = SURGE_REWRITE_RE.match(line)
            if match:
                add(entries, pattern=match.group("pattern"), action=match.group("action"),
                    target="", **meta)
        elif section == "map local":
            match = SURGE_MAPLOCAL_RE.match(line)
            if match:
                add(entries, pattern=match.group("pattern"), action="map-local",
                    target=match.group("opts")[:120], **meta)
        elif section == "script":
            match = SURGE_SCRIPT_RE.search(line)
            if match:
                add(entries, pattern=match.group("pattern").strip(),
                    action=match.group("type") or "script",
                    target=match.group("url"), **meta)
    return entries


def parse_loon(text: str, meta: dict) -> list[dict]:
    entries: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        v2 = LOON_V2_RE.match(line)
        if v2:
            add(entries, pattern=v2.group("pattern"), action=v2.group("phase"),
                target=v2.group("action")[:120], **meta)
            continue
        script = LOON_SCRIPT_RE.match(line)
        if script:
            add(entries, pattern=script.group("pattern"), action=script.group("phase"),
                target=script.group("url"), **meta)
            continue
        surge_style = SURGE_REWRITE_RE.match(line)
        if surge_style:
            add(entries, pattern=surge_style.group("pattern"),
                action=surge_style.group("action"), target="", **meta)
    return entries


def parse_qx(text: str, meta: dict) -> list[dict]:
    entries: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.lower().startswith("hostname"):
            continue
        match = QX_REWRITE_RE.match(line)
        if match:
            add(entries, pattern=match.group("pattern"), action=match.group("action"),
                target=(match.group("target") or ""), **meta)
    return entries


def parse_egern(text: str, meta: dict) -> list[dict]:
    """Native Egern YAML: track section + the current entry's match."""
    entries: list[dict] = []
    section = ""
    pending: dict | None = None
    for raw in text.splitlines():
        if re.match(r"^url_rewrites:", raw):
            section, pending = "url_rewrites", None
            continue
        if re.match(r"^map_locals:", raw):
            section, pending = "map_locals", None
            continue
        if re.match(r"^[a-z_]+:", raw):
            section, pending = "", None
            continue
        match = EGERN_KEY_RE.match(raw)
        if not match:
            continue
        key, value = match.group("key"), match.group("value").strip().strip("'\"")
        if key == "match" and section in {"url_rewrites", "map_locals"}:
            pending = {"pattern": value,
                       "action": section,
                       "target": ""}
            add(entries, **pending, **meta)
            pending = None
        elif key == "location" and entries and section == "url_rewrites":
            entries[-1]["target"] = value
    return entries


PARSERS = {"surge": parse_surge, "loon": parse_loon, "qx": parse_qx,
           "egern": parse_egern, "stash": parse_surge}


def cluster(entries: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for entry in entries:
        groups.setdefault(entry["pattern_norm"], []).append(entry)
    return groups


def render_report(clusters: dict[str, list[dict]]) -> str:
    lines = ["# Duplicate clusters", ""]
    multi_source = {k: v for k, v in clusters.items() if len({e["source_repo"] for e in v}) > 1}
    conflicts = {k: v for k, v in clusters.items() if len({e["action"] for e in v}) > 1}

    lines.append(f"{len(clusters)} clusters, {len(multi_source)} cross-source, "
                 f"{len(conflicts)} with conflicting actions.")
    lines.append("")

    for key in sorted(conflicts):
        lines.append(f"## CONFLICT `{key}`")
        for entry in conflicts[key]:
            lines.append(f"- {entry['action']:<22} {entry['target'][:60]:<60} "
                         f"{entry['source_repo']}@{entry['source_date'] or '?'}")
        lines.append("")

    lines.append("## Cross-source agreements (dedupe to one)")
    for key in sorted(set(multi_source) - set(conflicts)):
        actions = ", ".join(sorted({e["action"] for e in multi_source[key]}))
        repos = ", ".join(sorted({e["source_repo"] for e in multi_source[key]}))
        lines.append(f"- `{key}` → {actions} ({len(multi_source[key])} sources: {repos})")
    lines.append("")

    single = [k for k in clusters if k not in multi_source]
    lines.append(f"## Single-source entries ({len(single)})")
    for key in sorted(single):
        actions = ", ".join(sorted({e["action"] for e in clusters[key]}))
        lines.append(f"- `{key}` → {actions}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dir", help="directory produced by gather.sh")
    parser.add_argument("--only", nargs="+", metavar="TERM",
                        help="keep only entries whose pattern contains one of these terms "
                             "(the app domain and name) — aggregated modules carry thousands "
                             "of other apps' entries")
    args = parser.parse_args()

    root = Path(args.dir)
    manifest = read_manifest(root)
    if not manifest:
        print(f"no manifest at {root/'manifest.tsv'} — run gather.sh first", file=sys.stderr)
        return 1
    entries: list[dict] = []
    skipped: list[str] = []

    for item in manifest:
        path = root / item["local"]
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        fmt = item.get("format") or classify_local(item["local"], text)
        parser = PARSERS.get(fmt)
        if parser is None:
            skipped.append(f"{item['repo']}/{item['path']} ({fmt})")
            continue
        meta = {"source_repo": item["repo"],
                "source_author": item.get("author") or header_value(text, "author"),
                "source_date": item.get("date") or header_value(text, "date"),
                "source_path": item["path"]}
        entries.extend(parser(text, meta))

    if args.only:
        terms = [term.lower() for term in args.only]
        before = len(entries)
        entries = [e for e in entries
                   if any(term in e["pattern_norm"] for term in terms)]
        print(f"scoped to {args.only}: {len(entries)} of {before} entries")

    clusters = cluster(entries)
    (root / "entries.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (root / "clusters.md").write_text(render_report(clusters), encoding="utf-8")

    print(f"extracted {len(entries)} entries into {len(clusters)} clusters")
    print(f"  cross-source: {sum(1 for v in clusters.values() if len({e['source_repo'] for e in v}) > 1)}")
    print(f"  conflicts:    {sum(1 for v in clusters.values() if len({e['action'] for e in v}) > 1)}")
    if skipped:
        print(f"  unparsed:     {len(skipped)}")
        for line in skipped[:5]:
            print(f"    {line}")
    print(f"wrote {root/'entries.json'} and {root/'clusters.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
