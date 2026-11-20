#!/usr/bin/env python3
"""Snapshot the official Egern documentation into Markdown and generate llms.txt.

Source: https://egernapp.com/docs (English), https://egernapp.com/zh-CN/docs (Chinese)
Output: docs/<lang>/<page>.md, llms.txt, llms-full.txt

Stdlib only — runs in CI without a pip install.

Usage:
    python3 scripts/scrape.py            # fetch everything, rewrite files
    python3 scripts/scrape.py --check    # exit 1 if any page changed
"""

from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SKILL_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = SKILL_DIR / "docs"
DOCS_LINK = str(DOCS_DIR.relative_to(REPO_ROOT))
BASE_URL = "https://egernapp.com"
USER_AGENT = "egern-docs-snapshot/1.0 (+https://github.com/Sliverkiss/egern)"
LANGUAGES = ("en", "zh-CN")
FETCH_RETRIES = 3
RETRY_DELAY_SECONDS = 2

# (slug, English title, Chinese title, English summary, Chinese summary)
PAGES: list[tuple[str, str, str, str, str]] = [
    ("intro", "Introduction", "产品介绍",
     "What Egern is: traffic logging, rule types, policy groups, supported protocols, scripting.",
     "Egern 是什么：流量记录、规则类型、策略组、支持的协议与脚本能力。"),
    ("faq", "FAQ", "常见问题",
     "Frequently asked questions about Egern behaviour and configuration.",
     "Egern 使用与配置的常见问题。"),
    ("javascript-api", "JavaScript API", "JavaScript API",
     "The script runtime API: ctx objects, HTTP helpers, persistence, notifications, SSH.",
     "脚本运行时 API：ctx 对象、HTTP 请求、持久化存储、通知与 SSH。"),
    ("url-scheme", "URL Scheme", "URL Scheme",
     "egern:// URL schemes for automation and shortcuts.",
     "用于自动化与捷径的 egern:// URL Scheme。"),
    ("configuration/example", "Full configuration example", "完整配置示例",
     "A complete Profile.yaml with every global field annotated.",
     "带全局字段注释的完整 Profile.yaml 示例。"),
    ("configuration/dns", "DNS", "DNS",
     "Bootstrap, upstreams, forward rules, proxy DNS, block IPs, DoH/DoT/DoQ/DoH3.",
     "Bootstrap、上游 DNS、Forward 规则、代理 DNS、block_ips 与 DoH/DoT/DoQ/DoH3。"),
    ("configuration/proxies", "Proxies", "代理节点",
     "Proxy definitions and protocols: HTTP, SOCKS5, Shadowsocks, Trojan, Hysteria2, VLESS, VMess.",
     "代理节点定义与协议：HTTP、SOCKS5、Shadowsocks、Trojan、Hysteria2、VLESS、VMess。"),
    ("configuration/policy_groups", "Policy groups", "策略组",
     "Policy groups, group types, filters, flattening and subscriptions.",
     "策略组、组类型、节点筛选、flatten 与订阅。"),
    ("configuration/rules", "Rules", "分流规则",
     "Routing rule syntax and rule sets, including remote rule set references.",
     "分流规则语法与规则集，包括远程规则集引用。"),
    ("configuration/scriptings", "Scriptings", "脚本",
     "Script configuration: http_request, http_response, schedule, generic and network scripts.",
     "脚本配置：http_request、http_response、schedule、generic 与 network 五种脚本类型。"),
    ("configuration/url_rewrites", "URL rewrites", "URL 重写",
     "URL rewrite rules for MITM traffic.",
     "针对 MITM 流量的 URL 重写规则。"),
    ("configuration/header_rewrites", "Header rewrites", "HTTP 头重写",
     "Request and response header rewriting.",
     "请求头与响应头重写。"),
    ("configuration/body_rewrites", "Body rewrites", "HTTP 正文重写",
     "Request and response body rewriting, including JQ expressions.",
     "请求正文与响应正文重写，包括 JQ 表达式。"),
    ("configuration/http_captures", "HTTP captures", "HTTP 抓包",
     "Capturing and exporting HTTP traffic.",
     "HTTP 流量的抓取与导出。"),
    ("configuration/modules", "Modules", "模块",
     "Modules, remote module references and argument substitution.",
     "模块、远程模块引用与参数替换。"),
    ("configuration/env", "Environment variables", "环境变量",
     "Environment variables exposed to scripts and modules.",
     "脚本与模块可读取的环境变量。"),
    ("configuration/widgets", "Widgets", "小组件",
     "Widget DSL for home screen widgets and script-driven panels.",
     "用于主屏小组件与脚本面板的 Widget DSL。"),
    ("example/proxy", "Proxy tutorial", "代理教程",
     "Step-by-step setup of a proxy configuration.",
     "从零配置代理的分步教程。"),
    ("example/http-traffic-sniffer", "HTTP sniffer tutorial", "抓包教程",
     "Step-by-step HTTPS interception setup with certificates.",
     "配置证书与 HTTPS 中间人抓包的分步教程。"),
]


# ---------------------------------------------------------------- HTML parsing


class Node:
    """Minimal DOM node: either a tag with children or a text leaf."""

    __slots__ = ("tag", "attrs", "children", "text")

    def __init__(
        self,
        tag: str | None = None,
        attrs: dict[str, str] | None = None,
        text: str = "",
    ) -> None:
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list[Node] = []
        self.text = text

    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def find_all(self, predicate) -> list[Node]:
        hits: list[Node] = []
        for child in self.children:
            if child.tag is not None:
                if predicate(child):
                    hits.append(child)
                hits.extend(child.find_all(predicate))
        return hits


class TreeBuilder(HTMLParser):
    """Parse HTML into a Node tree, skipping void-element bookkeeping."""

    VOID = {"br", "hr", "img", "input", "meta", "link", "source", "path", "area", "col"}
    SKIP = {"script", "style", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.stack = [self.root]
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        node = Node(tag, {k: (v or "") for k, v in attrs})
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.skip_depth or tag in self.SKIP:
            return
        node = Node(tag, {k: (v or "") for k, v in attrs})
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag in self.VOID:
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self.skip_depth or not data:
            return
        self.stack[-1].children.append(Node(text=data))


def parse_html(markup: str) -> Node:
    builder = TreeBuilder()
    builder.feed(markup)
    builder.close()
    return builder.root


# ------------------------------------------------------------- HTML -> Markdown

NOISE_CLASSES = {
    "theme-doc-breadcrumbs",
    "breadcrumbsContainer_Z_bl",
    "tocCollapsible_ETCw",
    "theme-doc-toc-mobile",
    "tocMobile_ITEo",
    "theme-doc-footer",
    "pagination-nav",
    "theme-doc-version-banner",
    "theme-edit-this-page",
}

BLOCK_TAGS = {
    "p", "div", "section", "article", "ul", "ol", "table", "pre", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6", "dl", "figure", "hr",
}


def is_noise(node: Node) -> bool:
    if node.tag in {"nav", "svg", "button", "footer", "aside", "script", "style"}:
        return True
    if node.attrs.get("aria-label") == "Breadcrumbs":
        return True
    return bool(node.classes() & NOISE_CLASSES)


def text_of(node: Node) -> str:
    """Flatten a node to plain text (used for table cells, links, code)."""
    if node.tag is None:
        return node.text
    if node.tag == "br":
        return "\n"
    return "".join(text_of(child) for child in node.children)


def code_text(node: Node) -> str:
    """Extract Prism-highlighted code, preserving line breaks."""
    lines: list[str] = []
    buffer: list[str] = []

    def flush() -> None:
        lines.append("".join(buffer))
        buffer.clear()

    def walk(current: Node) -> None:
        if current.tag is None:
            buffer.append(current.text)
            return
        if current.tag == "br":
            flush()
            return
        for child in current.children:
            walk(child)

    walk(node)
    if buffer:
        flush()
    while lines and not lines[-1].strip():
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    return "\n".join(line.rstrip() for line in lines)


def code_language(node: Node) -> str:
    for candidate in [node, *node.find_all(lambda n: True)]:
        for cls in candidate.classes():
            if cls.startswith("language-"):
                return cls[9:]
    return ""


def absolute(url: str, page_url: str) -> str:
    if not url:
        return url
    if url.startswith(("http://", "https://", "mailto:")):
        return url
    if url.startswith("#"):
        return url
    if url.startswith("/"):
        return BASE_URL + url
    return page_url.rsplit("/", 1)[0] + "/" + url


def render_table(node: Node, page_url: str) -> str:
    rows: list[list[str]] = []
    for row in node.find_all(lambda n: n.tag == "tr"):
        cells = [cell for cell in row.children if cell.tag in {"td", "th"}]
        rows.append([text_of(cell).replace("\n", " ").strip().replace("|", "\\|") for cell in cells])
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "|" + "|".join([" --- "] * width) + "|"]
    for row in rows[1:]:
        out.append("| " + " | ".join(row) + " |")
    return "\n".join(out)


def render_inline(node: Node, page_url: str) -> str:
    if node.tag is None:
        return re.sub(r"\s+", " ", node.text)
    if node.tag == "br":
        return "\n"
    if node.tag == "code":
        content = text_of(node).replace("\n", " ")
        return f"`{content}`" if content.strip() else ""
    if node.tag == "strong" or node.tag == "b":
        content = render_inline_children(node, page_url).strip()
        return f"**{content}**" if content else ""
    if node.tag == "em" or node.tag == "i":
        content = render_inline_children(node, page_url).strip()
        return f"*{content}*" if content else ""
    if node.tag == "a":
        content = render_inline_children(node, page_url).strip()
        href = absolute(node.attrs.get("href", ""), page_url)
        if not href or href.startswith("#"):
            return content
        return f"[{content}]({href})" if content else ""
    if node.tag == "img":
        src = absolute(node.attrs.get("src") or node.attrs.get("data-src", ""), page_url)
        return f"![{node.attrs.get('alt', '')}]({src})"
    if node.tag in BLOCK_TAGS:
        return render_block(node, page_url)
    return render_inline_children(node, page_url)


def render_inline_children(node: Node, page_url: str) -> str:
    return "".join(render_inline(child, page_url) for child in node.children)


def render_list(node: Node, page_url: str, depth: int = 0) -> str:
    ordered = node.tag == "ol"
    lines: list[str] = []
    index = 1
    for child in node.children:
        if child.tag != "li":
            continue
        marker = f"{index}." if ordered else "-"
        index += 1
        inline_parts: list[str] = []
        nested: list[str] = []
        for grandchild in child.children:
            if grandchild.tag in {"ul", "ol"}:
                nested.append(render_list(grandchild, page_url, depth + 1))
            else:
                part = render_inline(grandchild, page_url).strip()
                if part:
                    inline_parts.append(part)
        body = " ".join(inline_parts).strip()
        indent = "  " * depth
        lines.append(f"{indent}{marker} {body}".rstrip())
        lines.extend(nested)
    return "\n".join(lines)


def render_block(node: Node, page_url: str) -> str:
    tag = node.tag
    if tag is None:
        return re.sub(r"\s+", " ", node.text)
    if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = int(tag[1])
        content = render_inline_children(node, page_url).strip()
        return f"\n{'#' * level} {content}\n"
    if tag == "p":
        content = collapse_paragraph(render_inline_children(node, page_url))
        return f"\n{content}\n" if content else ""
    if tag in {"ul", "ol"}:
        return "\n" + render_list(node, page_url) + "\n"
    if tag == "pre":
        language = code_language(node)
        body = code_text(node)
        fence = "```"
        while fence in body:
            fence += "`"
        return f"\n{fence}{language}\n{body}\n{fence}\n"
    if tag == "table":
        return "\n" + render_table(node, page_url) + "\n"
    if tag == "blockquote":
        inner = render_children(node, page_url).strip()
        quoted = "\n".join("> " + line if line.strip() else ">" for line in inner.splitlines())
        return f"\n{quoted}\n"
    if tag == "hr":
        return "\n---\n"
    if tag in {"div", "section", "article", "dl", "figure"}:
        return render_children(node, page_url)
    return render_inline_children(node, page_url)


def render_children(node: Node, page_url: str) -> str:
    chunks: list[str] = []
    for child in node.children:
        if child.tag is None:
            chunk = collapse_paragraph(child.text)
            if chunk:
                chunks.append(chunk)
            continue
        if is_noise(child):
            continue
        chunk = render_block(child, page_url)
        if chunk:
            chunks.append(chunk)
    return "".join(chunks)


SPACE_BEFORE_PUNCTUATION = re.compile(r" +([,.;:!?)\]])")
SPACE_AFTER_OPENING = re.compile(r"([(\[]) +")


def collapse_paragraph(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\u200b", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = SPACE_BEFORE_PUNCTUATION.sub(r"\1", text)
    text = SPACE_AFTER_OPENING.sub(r"\1", text)
    return text.strip()


def tidy(markdown: str) -> str:
    markdown = markdown.replace("\u00a0", " ").replace("\u200b", "")
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    markdown = re.sub(r"[ \t]+\n", "\n", markdown)
    markdown = SPACE_BEFORE_PUNCTUATION.sub(r"\1", markdown)
    markdown = SPACE_AFTER_OPENING.sub(r"\1", markdown)
    return markdown.strip() + "\n"


def extract_content(markup: str, page_url: str) -> str:
    root = parse_html(markup)
    containers = root.find_all(
        lambda n: "theme-doc-markdown" in n.classes() or n.tag == "article"
    )
    if not containers:
        raise ValueError(f"no documentation container found in {page_url}")
    container = containers[0]
    return tidy(render_children(container, page_url))


# ------------------------------------------------------------------------ fetch


def fetch(url: str) -> str:
    last_error: Exception | None = None
    for attempt in range(1, FETCH_RETRIES + 1):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, errors="replace")
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < FETCH_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS * attempt)
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def doc_url(language: str, slug: str) -> str:
    prefix = "" if language == "en" else f"/{language}"
    return f"{BASE_URL}{prefix}/docs/{slug}"


# ----------------------------------------------------------------------- output


def page_path(language: str, slug: str) -> Path:
    return DOCS_DIR / language / f"{slug.replace('/', '-')}.md"


def build_page(language: str, slug: str, title: str, summary: str) -> str:
    url = doc_url(language, slug)
    body = extract_content(fetch(url), url)
    front = [
        "---",
        f"title: {title}",
        f"source: {url}",
        f"language: {language}",
        f"fetched: {date.today().isoformat()}",
        "---",
        "",
        f"> {summary}",
        "",
        f"> Source: {url}",
        "",
        "",
    ]
    return "\n".join(front) + body


def write_page(path: Path, content: str, check: bool, changed: list[str]) -> None:
    if path.exists():
        previous = path.read_text(encoding="utf-8")
        previous_body = re.sub(r"^fetched: .*$", "", previous, count=1, flags=re.M)
        next_body = re.sub(r"^fetched: .*$", "", content, count=1, flags=re.M)
        if previous_body == next_body:
            # unchanged apart from the fetch date: keep the old timestamp
            if not check:
                path.write_text(previous, encoding="utf-8")
            return
    changed.append(str(path.relative_to(REPO_ROOT)))
    if not check:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def generate_llms_txt() -> str:
    lines = [
        "# Egern",
        "",
        "> Egern is an iOS, iPadOS and macOS network tool for proxying, intercepting and",
        "> modifying traffic. This repository is a machine-readable snapshot of the official",
        "> documentation at https://egernapp.com/docs, published as Markdown for LLM and",
        "> agent consumption.",
        "",
        "Official documentation: https://egernapp.com/docs",
        "Chinese documentation: https://egernapp.com/zh-CN/docs",
        "App Store: https://apps.apple.com/app/id1616105820",
        "",
        f"Every page is a Markdown file under `{DOCS_LINK}/en/` and `{DOCS_LINK}/zh-CN/`.",
        "`llms-full.txt` contains all English pages concatenated in this order.",
        "",
    ]

    def entry(slug: str, title: str, summary: str, language: str) -> str:
        relative = f"{DOCS_LINK}/{language}/{slug.replace('/', '-')}.md"
        return f"- [{title}]({relative}): {summary}"

    def link_only(slug: str, title: str, language: str) -> str:
        relative = f"{DOCS_LINK}/{language}/{slug.replace('/', '-')}.md"
        return f"- [{title}]({relative})"

    english = {slug: (title, summary) for slug, title, _zh, summary, _zhs in PAGES}
    chinese = {slug: zht for slug, _t, zht, _s, _zhs in PAGES}

    groups = [
        ("Getting started", ["intro", "faq", "url-scheme"]),
        ("Configuration", [
            "configuration/example",
            "configuration/proxies",
            "configuration/policy_groups",
            "configuration/rules",
            "configuration/dns",
        ]),
        ("Scripting", [
            "javascript-api",
            "configuration/scriptings",
            "configuration/env",
            "configuration/widgets",
        ]),
        ("Traffic rewriting", [
            "configuration/url_rewrites",
            "configuration/header_rewrites",
            "configuration/body_rewrites",
            "configuration/http_captures",
            "configuration/modules",
        ]),
        ("Tutorials", ["example/proxy", "example/http-traffic-sniffer"]),
    ]

    body: list[str] = []
    for heading, slugs in groups:
        body.append(f"## {heading}")
        body.append("")
        for slug in slugs:
            title, summary = english[slug]
            body.append(entry(slug, title, summary, "en"))
        body.append("")

    body.append("## 中文文档")
    body.append("")
    body.append(
        f"Chinese mirror of every page above, same slugs under `{DOCS_LINK}/zh-CN/`."
    )
    body.append("")
    for slug in [s for _, group in groups for s in group]:
        body.append(link_only(slug, chinese[slug], "zh-CN"))
    body.append("")

    body.append("## Optional")
    body.append("")
    body.append(
        "- [llms-full.txt](llms-full.txt): every English page in one file, "
        "for context windows that can hold the whole documentation."
    )
    body.append(
        f"- [{DOCS_LINK.rsplit('/docs', 1)[0]}/SKILL.md]({DOCS_LINK.rsplit('/docs', 1)[0]}/SKILL.md): "
        "agent skill definition that routes questions to the right page."
    )
    body.append("")

    return "\n".join(lines + body)


def generate_llms_full_txt(fetched: dict[str, str]) -> str:
    header = [
        "# Egern — complete documentation",
        "",
        "> Snapshot of the official Egern documentation (https://egernapp.com/docs),",
        "> concatenated for LLM consumption. English pages, in reading order.",
        "",
    ]
    chunks = ["\n".join(header)]
    for slug, title, _zh, _summary, _zhs in PAGES:
        content = fetched.get(slug)
        if content is None:
            continue
        body = content.split("---", 2)[-1].strip()
        chunks.append(f"\n\n<!-- page: {slug} -->\n\n# {title}\n\n{body}")
    return "".join(chunks).rstrip() + "\n"


# ------------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description="Snapshot Egern documentation")
    parser.add_argument("--check", action="store_true",
                        help="report changes without writing, exit 1 if any page changed")
    args = parser.parse_args()

    changed: list[str] = []
    english_bodies: dict[str, str] = {}

    for slug, title, zh_title, summary, zh_summary in PAGES:
        for language in LANGUAGES:
            page_title = title if language == "en" else zh_title
            page_summary = summary if language == "en" else zh_summary
            url = doc_url(language, slug)
            print(f"fetch {url}", flush=True)
            try:
                content = build_page(language, slug, page_title, page_summary)
            except Exception as error:  # noqa: BLE001 — report and keep going
                print(f"  error: {error}", file=sys.stderr)
                changed.append(f"ERROR {language}/{slug}")
                continue
            write_page(page_path(language, slug), content, args.check, changed)
            if language == "en":
                english_bodies[slug] = content

    llms_txt = generate_llms_txt()
    llms_path = SKILL_DIR / "llms.txt"
    if not llms_path.exists() or llms_path.read_text(encoding="utf-8") != llms_txt:
        changed.append("llms.txt")
        if not args.check:
            llms_path.write_text(llms_txt, encoding="utf-8")

    if len(english_bodies) == len(PAGES):
        llms_full = generate_llms_full_txt(english_bodies)
        full_path = SKILL_DIR / "llms-full.txt"
        if not full_path.exists() or full_path.read_text(encoding="utf-8") != llms_full:
            changed.append("llms-full.txt")
            if not args.check:
                full_path.write_text(llms_full, encoding="utf-8")
    else:
        print("warning: skipped llms-full.txt, not all English pages fetched",
              file=sys.stderr)

    if changed:
        print("changed:\n  " + "\n  ".join(changed))
        return 1 if args.check else 0

    print("no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
