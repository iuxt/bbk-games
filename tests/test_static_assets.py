from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import unittest


ROOT = Path(__file__).resolve().parents[1]
LOCAL_ATTRIBUTES = {
    "a": "href",
    "audio": "src",
    "img": "src",
    "link": "href",
    "script": "src",
    "source": "src",
}
EXTERNAL_PREFIXES = (
    "#",
    "//",
    "data:",
    "http:",
    "https:",
    "javascript:",
    "mailto:",
)


class LocalAssetParser(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.source = source
        self.missing = []

    def handle_starttag(self, tag, attrs):
        attribute = LOCAL_ATTRIBUTES.get(tag)
        raw = dict(attrs).get(attribute) if attribute else None
        if not raw or raw.startswith(EXTERNAL_PREFIXES):
            return

        relative = urlsplit(raw).path
        if not relative or "{" in relative:
            return

        if relative.startswith("/"):
            target = ROOT / relative.lstrip("/")
        else:
            target = self.source.parent / relative
        if not target.exists():
            self.missing.append((raw, target))


class StaticAssetTests(unittest.TestCase):
    def test_all_html_local_assets_exist(self):
        failures = []
        for source in ROOT.rglob("*.html"):
            if ".git" in source.parts:
                continue
            parser = LocalAssetParser(source)
            parser.feed(source.read_text(encoding="utf-8"))
            for raw, target in parser.missing:
                failures.append(
                    f"{source.relative_to(ROOT)}: {raw} -> {target.relative_to(ROOT)}"
                )

        self.assertEqual(failures, [], "\n" + "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
