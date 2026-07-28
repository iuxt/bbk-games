from html.parser import HTMLParser
import hashlib
import json
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
    def test_vercel_serves_the_static_build_output(self):
        config = json.loads(
            (ROOT / "vercel.json").read_text(encoding="utf-8")
        )

        self.assertEqual(config["buildCommand"], "npm run build")
        self.assertEqual(config["outputDirectory"], "dist/client")

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

    def test_rpg_fumo_rom_conversion_is_preserved(self):
        rom = ROOT / "rpg" / "roms" / "fmj_rpg.lib"

        self.assertEqual(rom.stat().st_size, 557057)
        self.assertEqual(
            hashlib.sha256(rom.read_bytes()).hexdigest(),
            "a71a98c72af5d1122cc4adbad861c5fa4c2454850cbc6d2b70903b818c0dfd93",
        )

    def test_rpg_catalog_does_not_bundle_duplicate_roms(self):
        roms_by_hash = {}

        for rom in (ROOT / "rpg" / "roms").glob("*.lib"):
            digest = hashlib.sha256(rom.read_bytes()).hexdigest()
            roms_by_hash.setdefault(digest, []).append(rom.name)

        duplicates = [
            names for names in roms_by_hash.values()
            if len(names) > 1
        ]
        self.assertEqual(duplicates, [])


if __name__ == "__main__":
    unittest.main()
