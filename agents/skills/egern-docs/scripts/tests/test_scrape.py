"""Unit tests for the Egern documentation HTML-to-Markdown converter.

Stdlib unittest only — no dependencies, runs anywhere Python 3.10+ exists.

    python3 -m unittest discover tests
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scrape import (  # noqa: E402
    DOCS_LINK,
    collapse_paragraph,
    code_text,
    doc_url,
    generate_llms_txt,
    parse_html,
    render_table,
    tidy,
)

PAGE_URL = "https://egernapp.com/docs/configuration/dns"


def wrap_article(inner: str) -> str:
    return (
        '<html><body><nav aria-label="Breadcrumbs">skip me</nav>'
        f'<div class="theme-doc-markdown markdown">{inner}</div>'
        '<nav role="toc">skip me too</nav></body></html>'
    )


class TestCodeBlocks(unittest.TestCase):
    def test_prism_token_lines_become_lines(self) -> None:
        markup = (
            '<pre class="prism-code language-yaml"><code>'
            '<span class="token-line"><span class="token plain">dns:</span><br></span>'
            '<span class="token-line"><span class="token plain">  bootstrap:</span><br></span>'
            "</code></pre>"
        )
        pre = parse_html(markup).find_all(lambda node: node.tag == "pre")[0]
        self.assertEqual(code_text(pre), "dns:\n  bootstrap:")

    def test_pre_code_is_fenced_with_language(self) -> None:
        from scrape import extract_content

        markup = wrap_article(
            '<pre class="prism-code language-json"><code>'
            '<span class="token-line"><span class="token plain">{}</span><br></span>'
            "</code></pre>"
        )
        self.assertIn("```json\n{}\n```", extract_content(markup, PAGE_URL))


class TestTables(unittest.TestCase):
    def test_table_renders_as_gfm_pipe_table(self) -> None:
        markup = (
            "<table><thead><tr><th>Format</th><th>Port</th></tr></thead>"
            "<tbody><tr><td><code>tls://1.1.1.1</code></td><td>853</td></tr></tbody></table>"
        )
        table = parse_html(markup).find_all(lambda node: node.tag == "table")[0]
        rendered = render_table(table, PAGE_URL)
        self.assertEqual(
            rendered.splitlines(),
            ["| Format | Port |", "| --- | --- |", "| tls://1.1.1.1 | 853 |"],
        )

    def test_ragged_rows_are_padded(self) -> None:
        markup = "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td></tr></table>"
        table = parse_html(markup).find_all(lambda node: node.tag == "table")[0]
        self.assertEqual(render_table(table, PAGE_URL).splitlines()[-1], "| 1 |  |")


class TestTextCleanup(unittest.TestCase):
    def test_zero_width_and_nbsp_removed(self) -> None:
        self.assertEqual(collapse_paragraph("Proxy​ DNS here"), "Proxy DNS here")

    def test_space_before_punctuation_removed(self) -> None:
        self.assertEqual(collapse_paragraph("**Default DNS** : resolves"), "**Default DNS**: resolves")
        self.assertEqual(collapse_paragraph("( `tls://` , etc.)"), "(`tls://`, etc.)")

    def test_tidy_collapses_blank_runs(self) -> None:
        self.assertEqual(tidy("a\n\n\n\nb\n"), "a\n\nb\n")


class TestNoiseRemoval(unittest.TestCase):
    def test_breadcrumbs_and_toc_are_dropped(self) -> None:
        from scrape import extract_content

        markup = wrap_article("<p>real content</p>")
        content = extract_content(markup, PAGE_URL)
        self.assertIn("real content", content)
        self.assertNotIn("skip me", content)


class TestUrls(unittest.TestCase):
    def test_language_prefix(self) -> None:
        self.assertEqual(doc_url("en", "configuration/dns"),
                         "https://egernapp.com/docs/configuration/dns")
        self.assertEqual(doc_url("zh-CN", "configuration/dns"),
                         "https://egernapp.com/zh-CN/docs/configuration/dns")


class TestLlmsTxt(unittest.TestCase):
    def test_every_page_is_linked_once_per_language(self) -> None:
        from scrape import PAGES

        text = generate_llms_txt()
        for slug, *_ in PAGES:
            for language in ("en", "zh-CN"):
                relative = f"{DOCS_LINK}/{language}/{slug.replace('/', '-')}.md"
                self.assertIn(relative, text)
        self.assertNotIn("## Getting started\n\n## Getting started", text)
        skill_link = DOCS_LINK.rsplit("/docs", 1)[0] + "/SKILL.md"
        self.assertEqual(text.count(f"]({skill_link})"), 1)


if __name__ == "__main__":
    unittest.main()
