# Where community modules live

## Repo map

| Repo | Formats | Weight |
| --- | --- | --- |
| `fmz200/wool_scripts` | Surge / Loon / QX / Stash / Shadowrocket / Egern | large, actively updated; the default first stop |
| `I-am-R-E/Functional-Store-Hub` | native `.Egern.yaml` per app | native Egern modules — check here first for an existing native version |
| `zirawell/R-Store` | QX, organised by app | clean per-app structure, good regex hygiene |
| `leiyiyan/resource` | Loon plugins + scripts | one plugin per app with tagged scripts |
| `Repcz/Tool` | Surge/Loon/Egern tutorials + DNS | reference configs more than per-app modules |
| `7452323/Nexus` and other aggregators | mixed mirrors | secondary: verify against upstream before using |
| `Script-Hub-Org/Script-Hub` | converter, not modules | reference for edge-case syntax only — see below |

## GitHub search patterns

`gather.sh` automates these; reach for them by hand when it misses —
unusual naming, an app known only by a domain, a repo it cannot index. Keys:
English name (`PICC`), Chinese name (`中国人保`), brand variants, and the API
domains seen in any found module (`epicc.com.cn`). Then:

- `"<chinese name>" extension:sgmodule` — Surge
- `"<chinese name>" extension:plugin` — Loon
- `"<chinese name>" filename:*.conf` — QX rewrite confs
- `"<app-key>" Egern extension:yaml` — native Egern (also Functional-Store-Hub)
- `"<domain>" 去广告 OR 去除 OR remove_ads` — catch-all

Freshness check: the module's `#!date` header or the file's last commit.
Prefer repos updated within the last year; ad endpoints rot fast.

## Merge policy (dedup rules)

Merge the found modules into one Egern module:

1. Normalize each source entry to (URL pattern, action, comment) tuples
   before comparing — `reject-dict` vs `reject` on the same pattern is the
   same intent; keep the more specific action.
2. Identical pattern after regex-escape normalization → keep one, prefer the
   source with the tighter regex; record the rest as provenance.
3. Conflicting actions on the same pattern (one `reject`, one rewrite) →
   inspect the app behaviour; if undecidable, keep the reject (fail-closed:
   an ad shown is worse than a feature hidden) and note the conflict.
4. A pattern that exists only in the newest source → include; ad modules
   grow by accretion, newest = most current endpoints.
5. Provenance block at the module top (comments): which repos, which dates
   were merged. One line per source.

## Script-Hub — syntax edge-case reference

Research only, never output (the conversion tables own that rule). When a
source construct is ambiguous — a rare Loon v2 action, an odd Map Local
header shape — check how its parsers normalize it:

- `Rewrite-Parser.js` — parses QX rewrite / Surge module / Loon plugin /
  Shadowrocket module. Search it for the construct to see the canonical
  shape (reject variants, Map Local data types, argument syntax).
- `script-converter.js` — script runtime conversions; its Env layer shows
  which legacy APIs map to what, useful to sanity-check the port table in
  conversion-tables.md.
- `tests/fixtures/` — real-world module samples (lpx, jq) for odd syntax.
