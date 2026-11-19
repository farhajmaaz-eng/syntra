"""Refresh the attributed offline Roblox reference pack. Python 3 standard library only.

The pack is pinned to one Creator Documentation commit so every article, digest
and source link in one release describes the same revision. Set
ROBLOX_DOCS_REVISION to refresh the pin explicitly; otherwise the revision from
the existing official.json is reused. A failed download leaves the previous pack
untouched.
"""
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOG = ROOT / "library/catalog.json"
TARGET = ROOT / "library/official.json"
USER_AGENT = "SyntraStudio-ReferenceLibrary/1.0"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def current_revision() -> str:
    configured = os.environ.get("ROBLOX_DOCS_REVISION", "").strip()
    if configured:
        if not re.fullmatch(r"[a-f0-9]{40}", configured):
            raise SystemExit("ROBLOX_DOCS_REVISION must be a full 40-character commit SHA")
        return configured
    if TARGET.exists():
        try:
            entries = json.loads(TARGET.read_text())
            revision = entries[0].get("revision")
            if isinstance(revision, str) and re.fullmatch(r"[a-f0-9]{40}", revision):
                return revision
        except (ValueError, IndexError, AttributeError):
            pass
    try:
        data = json.loads(
            fetch("https://api.github.com/repos/Roblox/creator-docs/commits/main")
        )
        return data["sha"]
    except Exception as error:  # noqa: BLE001 - actionable message for maintainers
        raise SystemExit(
            "Could not determine a Creator Documentation revision. "
            "Set ROBLOX_DOCS_REVISION to a commit SHA and retry. " + str(error)
        )


def clean_source(path: str) -> str:
    return "https://create.roblox.com/docs/" + re.sub(r"/index$", "", path)


def main() -> int:
    catalog = json.loads(CATALOG.read_text())
    revision = current_revision()
    retrieved = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def collect(row):
        path = "content/en-us/" + row["path"] + ".md"
        raw = fetch(
            f"https://raw.githubusercontent.com/Roblox/creator-docs/{revision}/{path}"
        ).decode()
        body = re.sub(r"^---\n.*?\n---\n", "", raw, count=1, flags=re.S)
        # The reader preserves Markdown and code. JSX components are not
        # executed; they remain readable source text with their attributes.
        entry = {
            **row,
            "id": "official-" + row["path"].replace("/", "-"),
            "kind": row.get("kind", "official"),
            "source": clean_source(row["path"]),
            "source_file": f"https://github.com/Roblox/creator-docs/blob/{revision}/{path}",
            "content": body.strip(),
            "retrieved": retrieved,
            "revision": revision,
            "license": "CC BY 4.0",
            "attribution": "Roblox Creator Documentation contributors",
            "digest": hashlib.sha256(raw.encode()).hexdigest(),
            "image": "/library/" + row.get("diagram", "workflow") + ".svg",
        }
        print("Collected:", row["title"], flush=True)
        return entry

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            entries = list(pool.map(collect, catalog))
    except Exception as error:  # noqa: BLE001 - keep the old pack intact
        print("Download failed; the existing reference pack is unchanged.", error, file=sys.stderr)
        return 1

    temporary = TARGET.with_suffix(".tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(TARGET)
    words = sum(len(entry["content"].split()) for entry in entries)
    print("Saved", len(entries), "references;", words, "words; revision", revision)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
