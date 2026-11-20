---
name: writing-for-egern
description: >
  Egern 模块构建。触发于:要给某个 App 做去广告/去推广/解锁/重写模块;要合并、
  更新、去重已有的 Egern 模块;贴来 .sgmodule / .plugin / .conf / .lpx /
  .stoverride 或别家模块要求转换移植;提到某 App 在 Surge、Loon、Quantumult X、
  Stash 上已有模块想搬到 Egern。关键词: Egern 模块、去广告、重写、移植、
  sgmodule、loon plugin、qx conf。
---

# Writing for Egern

One job: turn **every** community module for one app into a single native
Egern module — YAML where possible, a script only when the logic earns it,
nothing referencing someone else's runtime, authors credited to the
originals. Absorb, don't translate: optimize while merging, or you're just
moving formats.

Field-level truth lives in the `egern-docs` skill — load its page for any
section you emit. This skill owns the rest: where sources live, how they
merge, and the ladder deciding what each entry becomes.

Four scripts carry the mechanical work; the judgement calls are yours.

## Pipeline

**Gather — sweep, don't sample.** A handful of repos is a sample, not an
absorption. Two phases, both scripted:

```bash
bash scripts/gather.sh '中国人保' PICC epicc --out /tmp/picc
```

Phase A searches the names across every client format; phase B harvests
the API domains from phase A's hits and re-searches them, which reaches
modules filed under a different app name. Raise `--max-calls` when the app
is common; the summary lists what each format yielded. An authenticated gh
account allows ~30 searches/minute, so queries run back to back — pass
`--pace 7` only if a run actually hits the limit. Fetches run in parallel
and an interrupted run resumes where it stopped. Supplement with the repo
map and query shapes in
[reference/source-repos.md](reference/source-repos.md).

Done when the run reports hits for all four clients (Surge, Loon, QX,
Egern) or names the missing ones, **and** you have read the summary's
author and date list to know whose work you are absorbing.

**Read — everything, including the junk.** Extract entries mechanically
instead of eyeballing:

```bash
python3 scripts/extract.py /tmp/picc --only epicc
```

`entries.json` is every entry as (pattern, action, target, source, author,
date). `clusters.md` groups them by normalized pattern and flags conflicts.
Done when `clusters.md` has been read end to end — the conflicts are the
decisions, and the cross-source agreements are the safe core.

**Merge.** Apply [reference/source-repos.md](reference/source-repos.md)'s
policy to each cluster: dedupe agreements to one, resolve conflicts
fail-closed and prefer the more specific action (a map-local pinning status
and headers beats a bare reject-dict), keep newest-only endpoints. Done
when every cluster in the report has a verdict — kept, replaced, or dropped
— and none is silently ignored.

**Convert.** Each surviving entry passes the ladder in
[reference/conversion-tables.md](reference/conversion-tables.md): fixed
JSON edits become `response_jq` filters, conditionless string surgery
becomes `response_regex`, only real logic (branching, state, storage) is
ported to `export default async (ctx)`. Metadata: `author` is the
creator of the content — original upstream authors for absorbed modules,
our own name only when the logic is ours (write `#!author` headers carry
across repositories; who hosts a file says nothing about who wrote it).
Never list ourselves as co-author of someone else's work. Icon resolves
by the tables' three-step rule.

```bash
python3 scripts/icon.py --sources /tmp/picc     # source icon, else App Store
```

Done when every merged entry appears in the module exactly once, as the
ladder's verdict rather than the source's shape.

**Verify.** Script the wiring checks before claiming done:

```bash
python3 scripts/verify.py modules/<app>.yaml --sample /tmp/payload.json
```

It gates: required metadata, non-empty author, no converter URLs, anchored
full-URL regexes, valid reject tokens, jq syntax (and jq results, when a
captured payload is supplied), and MITM hostnames exactly matching the
hosts your patterns touch. `--sample` is worth the effort — capture one
real response of each jq'd endpoint in Egern and re-run. Then report the
merged sources, the conflicts resolved, and anything dropped as
unportable, with the reason.

Module skeleton — the ladder's output shapes, most common first:

```yaml
name: <app> 去广告
description: <一句话:干什么 + 若需清缓存/重装才生效,压进同一句>
author: <who wrote the content — upstream authors for absorbed work, us only if the logic is ours>
homepage: <this repo>
icon: <source module's icon if one exists; else App Store 104×104>
# merged from: <repo@date → what it contributed, …>
# conflicts resolved: <what beat what, and why>

url_rewrites:
  - match: '^https?://api\.example\.com/ads'
    location: http://reject/
body_rewrites:
  - response_jq:
      match: '^https?://api\.example\.com/home'
      filter: '.data.ads = []'
map_locals:
  - match: '^https?://api\.example\.com/splash'
    status_code: 200
    headers: {Content-Type: application/json}
    body: '{}'
scriptings:        # only entries that survived the ladder's rung 3
  - http_response:
      name: <app> 主页
      match: '^https?://api\.example\.com/home'
      script_url: <ported script in this repo>
      body_required: true
mitm:
  hostnames:
    - api.example.com
```

Chinese app, Chinese sources → module comments in Chinese. A construct with
no Egern equivalent is dropped with a comment naming it, never approximated.
