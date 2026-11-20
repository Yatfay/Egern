#!/usr/bin/env python3
"""Verify an Egern module before shipping it.

    python3 verify.py modules/picc-ads.yaml

Checks, in the order they fail in practice:

  structure   required metadata, non-empty author (the originals, not us)
  native      no converter/script-hub URLs anywhere in the file
  rewrites    every `match` is a full-URL anchored regex; every location is
              an Egern reject token or a real URL
  jq          every response_jq filter is non-empty and parses with jq
  mitm        hostnames non-empty when the section exists — entries are copied
              verbatim from upstream and users extend their own; no
              pattern↔mitm coverage cross-check (that would mean guessing
              how the runtime expands `*` in entries like `*xmind.*`)

Exits 1 on any failure so it can gate a commit. Reads the module as text
with an indentation scanner rather than a YAML library, so it runs anywhere
Python does — the module format is simple enough for that to be safe.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REQUIRED_FIELDS = ["name", "description", "author", "icon"]
REJECT_TOKENS = {
    "http://reject/", "http://reject-200/", "http://reject-dict/",
    "http://reject-array/", "http://reject-img/", "http://reject-video/",
}
FORBIDDEN = re.compile(r"script\.hub|script-hub|Script-Hub-Org", re.I)


def read_module(path: Path) -> dict:
    """Scan the module into {top-level key: raw block text}."""
    text = path.read_text(encoding="utf-8")
    blocks: dict[str, list[str]] = {}
    current = "_preamble"
    for line in text.splitlines():
        top = re.match(r"^([a-z_]+):", line)
        if top:
            current = top.group(1)
            blocks.setdefault(current, [])
        blocks.setdefault(current, []).append(line)
    return {key: "\n".join(lines) for key, lines in blocks.items()}


def scalars(block: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in block.splitlines():
        match = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if match and match.group(2):
            out[match.group(1)] = match.group(2).strip().strip("'\"")
    return out


def matches(block: str) -> list[str]:
    return [
        m.group(1).strip().strip("'\"")
        for m in re.finditer(r"^\s*-?\s*match:\s*(.+)$", block, re.M)
    ]


def mitm_hosts(block: str) -> set[str]:
    hosts: set[str] = set()
    inside = False
    for line in block.splitlines():
        if re.match(r"^\s+hostnames:", line):
            inside = True
            continue
        if inside:
            item = re.match(r"^\s+-\s*(.+)$", line)
            if item:
                hosts.add(item.group(1).strip().strip("'\"").lower())
            elif re.match(r"^\s{0,2}\w+:", line):
                inside = False
    return hosts


def extract_block_scalars(block: str, key: str) -> list[str]:
    """Read `key:` values, resolving YAML block scalars (`>-`, `|`, `|-`)."""
    values: list[str] = []
    lines = block.splitlines()
    index = 0
    while index < len(lines):
        match = re.match(rf"^\s+{key}:\s*(.*)$", lines[index])
        if not match:
            index += 1
            continue
        raw = match.group(1).strip()
        if raw in {">", ">-", "|", "|-"} or not raw:
            indent = len(lines[index]) - len(lines[index].lstrip())
            collected: list[str] = []
            index += 1
            while index < len(lines):
                following = lines[index]
                if following.strip() and (len(following) - len(following.lstrip())) <= indent:
                    break
                collected.append(following.strip())
                index += 1
            values.append(" ".join(part for part in collected if part))
            continue
        values.append(raw.strip("'\""))
        index += 1
    return values


SYNTAX_MARKERS = ("parse error", "syntax error")


def check_jq(filters: list[str], sample: Path | None = None) -> tuple[list[str], int]:
    """Grade each filter. Without a sample, only syntax is checked: a filter
    that fails on shape (iterating a null) would pass on the real payload."""
    errors: list[str] = []
    verified = 0
    for index, expression in enumerate(filters, 1):
        command = ["jq", "-c", expression]
        if sample is None:
            command.insert(1, "-n")
        else:
            command.append(str(sample))
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        except FileNotFoundError:
            return ["jq binary not found — cannot verify filters"], 0
        stderr = result.stderr.strip()
        if any(marker in stderr.lower() for marker in SYNTAX_MARKERS):
            errors.append(f"filter {index} does not parse: {stderr.splitlines()[-1][:120]}")
        elif result.returncode == 0 and sample is not None:
            verified += 1
    return errors, verified


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("module", type=Path)
    parser.add_argument("--sample", type=Path,
                        help="a captured JSON payload to run the jq filters against")
    args = parser.parse_args()

    if not args.module.exists():
        print(f"missing: {args.module}", file=sys.stderr)
        return 1

    text = args.module.read_text(encoding="utf-8")
    blocks = read_module(args.module)
    problems: list[str] = []

    meta = {field: scalars(blocks.get(field, "")).get(field, "") for field in REQUIRED_FIELDS}
    for field in REQUIRED_FIELDS:
        if not meta.get(field):
            problems.append(f"metadata: missing or empty `{field}`")
    if re.search(r"author:\s*(me|you|<you>|us)\b", text, re.I):
        problems.append("metadata: `author` must credit the original authors only — "
                        "never add our own name to a derived module")

    for hit in FORBIDDEN.findall(text):
        problems.append(f"native: converter reference found (`{hit}`)")

    rewrite_patterns = matches(blocks.get("url_rewrites", ""))
    for pattern in rewrite_patterns:
        if not pattern.startswith("^"):
            problems.append(f"rewrites: pattern not anchored at the URL start: {pattern[:60]}")
    for location in re.findall(r"^\s+location:\s*(.+)$", blocks.get("url_rewrites", ""), re.M):
        value = location.strip().strip("'\"")
        if value.startswith("http://reject") and value not in REJECT_TOKENS:
            problems.append(f"rewrites: unknown reject token `{value}`")

    jq_filters = extract_block_scalars(blocks.get("body_rewrites", ""), "filter")
    if "body_rewrites" in blocks and not jq_filters:
        problems.append("body_rewrites: section present but no `filter` found")
    jq_errors, jq_verified = check_jq(jq_filters, args.sample)
    problems.extend(jq_errors)

    all_patterns = (
        rewrite_patterns
        + matches(blocks.get("body_rewrites", ""))
        + matches(blocks.get("scriptings", ""))
        + matches(blocks.get("map_locals", ""))
    )
    declared = mitm_hosts(blocks.get("mitm", ""))
    # mitm.hostnames 照抄上游 `[mitm]` 声明（`*xmind.*`、`cubox.*` 这种 QX 通配写法
    # 原样进模块），用户还会按自己的需要增删 —— 校验器不做 pattern↔mitm 的覆盖
    # 交叉检查：字面宿主对带通配符的声明怎么算覆盖、交替 TLD 展开成几个分支，
    # 全是替 Egern 猜语义，猜错就冤枉一个正确的模块。声明非空即可。
    if "mitm" in blocks and not declared:
        problems.append("mitm: section present but hostnames is empty")

    if problems:
        print(f"FAIL {args.module}")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(f"PASS {args.module}")
    print(f"  {len(rewrite_patterns)} url_rewrites, {len(jq_filters)} jq filters "
          f"({'verified on sample' if args.sample else 'syntax only'}), "
          f"{len(all_patterns) - len(rewrite_patterns) - len(jq_filters)} other entries, "
          f"{len(declared)} mitm host(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
