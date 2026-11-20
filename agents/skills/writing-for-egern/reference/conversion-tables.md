# Conversion tables

Source-client syntax → Egern field. The `egern-docs` skill owns the
right-hand column; this file owns the mapping. On conflict the docs win —
fix the mapping here.

## Metadata headers

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge module | `#!name=` `#!desc=` `#!author=` `#!homepage=` `#!icon=` `#!category=` | `name` `description` `author` `homepage` `icon` (category has no Egern field; fold it into description if informative) |
| Loon plugin | `#!name = ` `#!desc = ` `#!icon = ` `#!author = ` | same fields |
| QX conf | `#!name=` or bare comments | same fields; a bare `# > App - Tag` first comment is the name |

`icon` rule, in order: (1) a source module already carries an icon URL —
use it as-is, it points at the community's icon CDN that stays stable
across their updates; (2) no icon anywhere — the app's own App Store icon
at 104×104: look the app up (`itunes.apple.com/lookup?id=<appId>&country=cn`,
the appId is usually in the source module's `App链接=`/`#!system` header
or searchable by name), take `artworkUrl512`, rewrite the trailing size
segment to `104x104bb.jpg`; (3) no appId either — an SF Symbol name
(`shield.fill`).

`author` rule: the field carries the original authors, not us — we
integrate, we don't originate. Multiple sources: list each with what
they contributed in the provenance comments; `author` itself takes the
main script/rewrite author (the `#!author=` header value), or a
comma-joined list when contributions are co-equal.

## URL rewrites

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge | `pattern - reject` | `url_rewrites: - match: pattern` + `location: http://reject/` |
| Surge/Loon | `pattern - reject-dict` | `location: http://reject-dict/` |
| any | `reject-array` / `reject-200` / `reject-img` / `reject-video` | `http://reject-array/` / `http://reject-200/` / `http://reject-img/` / `http://reject-video/` |
| Surge | `pattern target` (302) | `location: target` + `status_code: 302` |
| Surge | `pattern header-location target` (header mode) | `location: target`, omit `status_code` |
| QX | `pattern url 302 target` | same as Surge redirect |
| QX | `pattern url reject` | reject mapping above |
| Loon v2 | `pattern reject` / `pattern reject-dict` | same mapping |

Egern `match` is a regex matched against the **full URL** including scheme.

Regex flavor is undocumented; the engine behaves like the platform's
NSRegularExpression (ICU), while Surge and Loon sources are written against
PCRE. Scrub these on the way in:

| PCRE construct | Portable rewrite |
| --- | --- |
| `(?>pop\|float)` atomic group | `(?:pop\|float)` |
| `a++` `a*+` `a?+` possessive | `a+` `a*` `a?` |
| `\K` keep-out | capture group + `replace` back reference |
| `(?\|a\|b)` branch reset | plain alternatives |

Seen in the wild: `^https?:\/\/smsp\.epicc\.com\.cn\/WAS\/(?>pop|float)Windows\/`
— the atomic group never matches under ICU, so the entry silently does nothing.

## Map Local

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge | `pattern data-type=text data="{}" status-code=200 header="Content-Type:application/json"` | `map_locals: - match: pattern` + `status_code: 200` + `body: '{}'` + `headers: {Content-Type: application/json}` |
| Loon reject with body | `reject-dict` when a body is needed | prefer `map_locals` over reject-dict when the source pins a status or headers |

QX `response-body` rewrites (`pattern url response-body re re`) are **body
rewrites**, not map locals: map to `body_rewrites: - response_regex:` with
`find`/`replace`.

## Scripts

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge | `type=pattern, pattern=…, script-path=…` (`http-request`/`http-response`) | `scriptings: - http_request:` / `- http_response:` with `name` `match` `script_url` |
| Surge | `requires-body=true` | `body_required: true` |
| Loon | `http-response pattern script-path=…, requires-body=true, tag=名称` | `http_response:` + `name: 名称` + `body_required: true` |
| QX | `pattern url script-response-body url` | `http_response:` + `script_url` |
| QX | `pattern url script-request-header url` | `http_request:` |
| Surge | `argument=…` | `arguments:` map |
| Surge cron | `type=cron, cronexp="…"`, event scripts | `schedule:` with `cron`; `event network-changed` → `network:` |
| Loon generic | `generic script-path=…` | `generic:` |

### Script runtime — the hard part

Egern scripts run `export default async function(ctx)` with a Fetch-style
`ctx` object (see `egern-docs` javascript-api page). Community scripts target
QX (`$task`, `$prefs`, `$notify`, `$done`) or Surge/Loon (`$httpClient`,
`$persistentStore`, `$notification`, `$done`).

Before porting any script, decide its fate. A community script is one of
three things, and the first two never survive as scripts:

**1. Fixed structure edits → jq, always.** A script that only sets JSON
fields to constants or filters arrays by a name regex is a declarative
rewrite wearing a script costume. Egern runs it as
`body_rewrites: - response_jq:` with a `filter` — no `script_url`, no
`body_required`, no runtime, nothing to download. Translate the script
body to jq:

| Script pattern | jq filter |
| --- | --- |
| `Body.data.x = {}` / `= []` | `.data.x = {}` / `.data.x = []` |
| `Body.data.x = null` | `.data.x = null` |
| `arr.filter(e => !e.name.match(/R1\|R2/))` | `.x = (.x \| map(select((.name // "") \| test("R1\|R2") \| not)))` |
| `arr.filter(e => e.name.match(/R/))` | `.x = (.x \| map(select(.name \| test("R"))))` |
| `delete Body.data.x` / `delete Body.x` | `del(.data.x)` |
| `Body.data.x = someConstant` | `.data.x = someConstant` |

Robustness upgrade carried by the port: the `// ""` guard passes entries
whose `name` is missing — the source script would crash on them. Verify
the translated filter against a sample payload with `jq -f filter.jq`
before writing it into the module.

**2. Conditionless string surgery → response_regex.** `body.replace(…)`
with no JSON parsing is a `body_rewrites: - response_regex:` `find`/`
replace` pair.

**3. Real logic → port natively.** Only scripts with branching, state,
storage, or cross-request work stay scripts: port to
`export default async (ctx)` per the port map below.

Port map:

| Legacy | Egern native |
| --- | --- |
| `$httpClient.get/post(opts, cb)` / `$task.fetch` | `await ctx.http.get/post(url, opts)` → `resp.json()` / `resp.text()` |
| `$persistentStore.read/write` / `$prefs.valueForKey/setValueForKey` | `ctx.storage.get/set` (string) / `getJSON/setJSON` (object) |
| `$notification.post(t, s, b)` / `$notify(t, s, b)` | `ctx.notify({title, subtitle, body})` |
| `$done({body, headers, status})` (response) | `return {body, headers, status}` |
| `$done({})` / `$done()` (pass through) | return nothing |
| `$request.url` / `$response.body` | `ctx.request.url` / `await ctx.response.text()` / `.json()` |
| `$argument` string | `ctx.env` (via scriptings `env:` or module `compat_arguments`) |
| Env detection (`$.isQuanX()` etc.) | delete — single runtime, no branching |

Porting procedure: read the script, list every legacy API call it makes,
map each with the table above, then rewrite as one async function with
early returns. Fetch-style details that bite: `body` streams are consumed
once — read to text/json once and reuse the variable; `ctx.notify` takes a
single object, not positional args.

A script too tangled to port (obfuscated, WASM, >300 lines of dense logic)
is dropped from the module with a comment naming it and why — never
referenced through a converter.

## MITM

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge | `[MITM] hostname = %APPEND% a.com, b.com` | `mitm: hostnames: [a.com, b.com]` (module merge handles the append) |
| Loon | `[MitM] hostname = a.com` | same |
| QX | `hostname = a.com` (last line) | same |

`%APPEND%` / `%INSERT%` have no Egern equivalent — modules merge by union, so
plain hostnames are correct.

## Rule sets / rules

A community ad-block module rarely carries routing rules; when it does:

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge | `DOMAIN-SUFFIX,example.com,REJECT` | `rules: - domain_suffix: {match: example.com, policy: REJECT}` |
| any | remote rule-set URL `.list` | `rules: - rule_set: {…}` per the `rules` page in `egern-docs` |

## Panels / widgets

| Source | Syntax | Egern |
| --- | --- | --- |
| Surge | `[Panel] …` | `widgets:` with a `generic` script returning Widget DSL JSON |
| Loon tile | `tile` section | same |

Panel scripts need a real port: Surge panel HTML does not map to Widget DSL.
Write a fresh `generic` script and return the DSL (`type: 'widget'` root).

## Unsupported / drop

- `[Argument]` platform-specific keys with no Egern meaning → drop unless
  they feed `compat_arguments`.
- `#!tg-channel`, `#!raw-url`, `#!date` headers → drop (provenance goes in
  the module's `homepage`/`description` or the module's repo README).
- QX `hostname` inside `[MITM]` sections that the rewrites never touch →
  keep only hostnames the surviving rewrites/scripts actually match. Tight
  hostname lists are a correctness feature: MITM is global for the client.
