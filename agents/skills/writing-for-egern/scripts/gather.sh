#!/usr/bin/env bash
# Exhaustively gather community proxy-client modules for one app.
#
#   bash scripts/gather.sh '中国人保' PICC epicc --out /tmp/picc
#
# Two phases, because searching the app's name alone is a sample, not a sweep:
#
#   A. seed   — each name crossed with every client format (sgmodule, plugin,
#               conf, lpx, snippet, stoverride)
#   B. domain — hostnames harvested from phase A, re-searched; this reaches
#               modules filed under a different app name
#
# Searches run one at a time, back to back — an authenticated gh account has
# a 30 requests/min code-search quota, far above what a sweep needs. If a run
# does hit the limit, pass --pace 7; it is opt-in, never the default.
# Fetches run in parallel: raw.githubusercontent.com is a CDN, not the API.
#
# Output: <out>/<slug>.<ext> and <out>/manifest.tsv, appended per file as it
# lands, so an interrupted run still leaves a usable manifest and re-running
# skips what is already there.
#
# --max-calls bounds each phase separately, so the budget covers both sweeps.
# manifest.tsv, tab separated: repo, path, local, format, name, author, date, icon

set -uo pipefail

SELF=${BASH_SOURCE[0]}
# inherited when this script re-enters itself as a fetch worker
OUT=${OUT:-sources}
MAX_CALLS=30
LIMIT=100
WORKERS=12
PACE=0
NAMES=()
DOMAIN_PHASE=1
FORMATS=(sgmodule plugin conf lpx snippet stoverride)


die() { printf '%s\n' "$*" >&2; exit 1; }

require_gh() {
  command -v gh >/dev/null 2>&1 || die "gh not found — install GitHub CLI and run 'gh auth login'"
  gh auth status >/dev/null 2>&1 || die "gh not authenticated — run 'gh auth login'"
}

# ---- one file, run inside a worker -----------------------------------------
# Invoked as: bash gather.sh _fetch "<repo>\t<path>"
fetch_one() {
  local line=$1 repo path url content slug target fmt name author date icon
  local hit="" names_file=${NAMES_FILE:-} domains_file=${DOMAINS_FILE:-}
  IFS=$'\t' read -r repo path <<< "$line"
  [ -n "${repo:-}" ] && [ -n "${path:-}" ] || return 0

  url="https://raw.githubusercontent.com/${repo}/HEAD/${path}"
  content=$(curl -fsSL --max-time 25 "$url" 2>/dev/null) || return 0
  [ -n "$content" ] || return 0

  # relevance: the file must mention one of the names or a harvested domain
  if [ -n "$names_file" ] && [ -s "$names_file" ] \
     && printf '%s' "$content" | grep -qiF -f "$names_file"; then
    hit=1
  elif [ -n "$domains_file" ] && [ -s "$domains_file" ] \
     && printf '%s' "$content" | grep -qiF -f "$domains_file"; then
    hit=1
  fi
  [ -n "$hit" ] || return 0

  slugify() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'; }
  case "$path" in
    *.*) slug="$(slugify "$repo")-$(slugify "${path%.*}" | cut -c1-100).${path##*.}" ;;
    *)   slug="$(slugify "$repo")-$(slugify "$path" | cut -c1-100)" ;;
  esac
  target="${OUT}/${slug}"
  printf '%s' "$content" > "$target"

  case "${path##*.}" in
    yaml|yml)
      if grep -qE '^(url_rewrites|scriptings|mitm|body_rewrites):' "$target"; then fmt=egern; else fmt=other; fi ;;
    sgmodule|stoverride) fmt=surge ;;
    plugin|lpx)          fmt=loon ;;
    conf)
      if grep -qE '\[URL Rewrite\]' "$target"; then fmt=surge
      elif grep -qE '^\[Rewrite\]' "$target"; then fmt=loon
      else fmt=qx
      fi ;;
    *) fmt=other ;;
  esac
  case "$fmt" in
    other)
      if grep -qE '\[URL Rewrite\]' "$target"; then fmt=surge
      elif grep -qE '^\[Rewrite\]' "$target"; then fmt=loon
      elif grep -qE 'url (reject|script-response-body|script-request-header|302)' "$target"; then fmt=qx
      fi ;;
  esac

  meta() { grep -m1 -iE "^#!? *$1 *=" "$target" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*//' | tr -d '\r'; }
  name=$(meta 'name')
  author=$(meta 'author')
  date=$(meta 'date')
  icon=$(meta 'icon')

  mkdir -p "${OUT}/.meta"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$repo" "$path" "${target##*/}" "$fmt" "$name" "$author" "$date" "$icon" \
    > "${OUT}/.meta/${slug}.tsv"

  printf '  + %-6s %s : %s\n' "$fmt" "$repo" "$path"
}

if [ "${1:-}" = "_fetch" ]; then
  fetch_one "${2:-}"
  exit 0
fi

# ---- argument parsing -------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --out)              OUT=${2:?--out needs a value}; shift 2 ;;
    --max-calls)        MAX_CALLS=${2:?--max-calls needs a value}; shift 2 ;;
    --limit)            LIMIT=${2:?--limit needs a value}; shift 2 ;;
    --workers)          WORKERS=${2:?--workers needs a value}; shift 2 ;;
    --pace)             PACE=${2:?--pace needs a value}; shift 2 ;;
    --no-domain-phase)  DOMAIN_PHASE=0; shift ;;
    -h|--help)          sed -n '2,26p' "$SELF"; exit 0 ;;
    -*)                 die "unknown option: $1" ;;
    *)                  NAMES+=("$1"); shift ;;
  esac
done
[ ${#NAMES[@]} -gt 0 ] || die "usage: bash gather.sh '中国人保' PICC [--out DIR]"
require_gh

mkdir -p "$OUT" "$OUT/.meta"
MANIFEST="${OUT}/manifest.tsv"
NAMES_FILE="${OUT}/.names.txt"
DOMAINS_FILE="${OUT}/.domains.txt"
printf '%s\n' "${NAMES[@]}" > "$NAMES_FILE"
: > "$DOMAINS_FILE"
export OUT NAMES_FILE DOMAINS_FILE

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
CANDIDATES="${WORK}/candidates.tsv"
: > "$CANDIDATES"

# ---- search: serial, paced --------------------------------------------------
run_queries() {
  local calls=0 query
  while IFS= read -r query; do
    [ -n "$query" ] || continue
    calls=$((calls + 1))
    if [ "$calls" -gt "$MAX_CALLS" ]; then
      printf 'call budget reached (%s)\n' "$MAX_CALLS" >&2
      break
    fi
    printf '[%d/%d] %s\n' "$calls" "$MAX_CALLS" "$query"
    gh search code "$query" --limit "$LIMIT" --json repository,path \
       --jq '.[] | [.repository.nameWithOwner, .path] | @tsv' 2>/dev/null \
       >> "$CANDIDATES"
    sleep "$PACE"
  done
}

# names x formats, plus a bare "Egern" pass to catch native modules
for name in "${NAMES[@]}"; do
  for fmt in "${FORMATS[@]}"; do
    printf '%s extension:%s\n' "$name" "$fmt"
  done
  printf '%s Egern\n' "$name"
done > "${WORK}/queries-a.txt"

printf '== phase A: seed queries ==\n'
run_queries < "${WORK}/queries-a.txt"

# skip what a previous run already pulled
sort -u "$CANDIDATES" -o "$CANDIDATES"
if [ -s "$MANIFEST" ]; then
  awk -F'\t' 'NR==FNR{seen[$1 SUBSEP $2]=1; next} !(($1 SUBSEP $2) in seen)' \
    "$MANIFEST" "$CANDIDATES" > "${WORK}/todo-a.tsv"
else
  cp "$CANDIDATES" "${WORK}/todo-a.tsv"
fi

# ---- fetch: parallel, unpaced ----------------------------------------------
fetch_batch() {
  local todo=$1
  local count
  count=$(wc -l < "$todo" | tr -d ' ')
  printf 'fetching %s candidate(s) with %s workers\n' "$count" "$WORKERS"
  tr '\n' '\0' < "$todo" | xargs -0 -n 1 -P "$WORKERS" bash "$SELF" _fetch
}

fetch_batch "${WORK}/todo-a.tsv"

# ---- rebuild the manifest from whatever landed ------------------------------
rebuild_manifest() {
  if ls "${OUT}/.meta/"*.tsv >/dev/null 2>&1; then
    cat "${OUT}/.meta/"*.tsv | sort -u > "$MANIFEST"
  fi
}
rebuild_manifest

# ---- phase B: re-search the hosts phase A exposed ---------------------------
if [ "$DOMAIN_PHASE" -eq 1 ] && [ -s "$MANIFEST" ]; then
  # de-escape the patterns first (zgrb\.epicc\.com\.cn) or the host splits at the backslash
  find "$OUT" -maxdepth 1 -type f ! -name 'manifest.tsv' -print0 \
    | xargs -0 sed 's/\\//g' 2>/dev/null \
    | grep -hoiE 'https?[\\:/]+[a-z0-9][a-z0-9.-]{3,}\.[a-z]{2,}' \
    | tr 'A-Z' 'a-z' \
    | grep -vE 'github\.com|githubusercontent|apple\.com|example\.com|w3\.org' \
    | sort | uniq -c | sort -rn | head -6 \
    | awk '{print $2}' > "$DOMAINS_FILE"

  if [ -s "$DOMAINS_FILE" ]; then
    printf '\n== phase B: domain queries ==\n'
    cat "$DOMAINS_FILE"
    for domain in $(cat "$DOMAINS_FILE"); do
      for fmt in "${FORMATS[@]}"; do
        printf '%s extension:%s\n' "$domain" "$fmt"
      done
    done > "${WORK}/queries-b.txt"

    : > "$CANDIDATES"
    run_queries < "${WORK}/queries-b.txt"
    sort -u "$CANDIDATES" -o "$CANDIDATES"
    awk -F'\t' 'NR==FNR{seen[$1 SUBSEP $2]=1; next} !(($1 SUBSEP $2) in seen)' \
      "$MANIFEST" "$CANDIDATES" > "${WORK}/todo-b.tsv"
    fetch_batch "${WORK}/todo-b.tsv"
    rebuild_manifest
  fi
fi

# ---- summary ---------------------------------------------------------------
[ -s "$MANIFEST" ] || die "nothing gathered — check the names, or raise --limit"

printf '\ngathered %s module(s)\n' "$(wc -l < "$MANIFEST" | tr -d ' ')"
printf 'by format: '
cut -f4 "$MANIFEST" | sort | uniq -c | sort -rn | awk '{printf "%s=%s ", $2, $1}'
printf '\n'

NAMED="${WORK}/named.tsv"
awk -F'\t' '$5 != ""' "$MANIFEST" > "$NAMED"
if [ -s "$NAMED" ]; then
  printf 'named modules (whose work you are absorbing):\n'
  awk -F'\t' '{printf "  %s — %s (%s@%s)\n", $5, ($6 == "" ? "?" : $6), $1, ($7 == "" ? "?" : $7)}' "$NAMED" | head -20
fi
printf 'manifest: %s\n' "$MANIFEST"
