"""Attach the locally signed tablet APK to the matching desktop release draft."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
from urllib.parse import quote
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release", ROOT / "scripts/github-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def stage(commit):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("An exact remote commit is required")
    info = release.config()
    version = info["version"]
    api = release.GitHub(info["repository"], os.environ["GH_TOKEN"])
    tablet = ROOT / "android"
    feed = tablet / "out/RADAZ-Tablet-update.json"
    record = json.loads(feed.read_text(encoding="utf-8"))
    attrs = ElementTree.parse(tablet / "AndroidManifest.xml").getroot().attrib
    prefix = "{http://schemas.android.com/apk/res/android}"
    revision = record["revision"]
    if record["version"] != version or attrs[prefix+"versionName"] != f"{version}-tablet.{revision}" or int(attrs[prefix+"versionCode"]) != record["versionCode"]:
        raise ValueError("Android version does not match the source")
    apk = tablet / "out" / f"RADAZ-Tablet-{version}-{revision}.apk"
    tag = "v" + version
    expected_url = f"https://github.com/{info['repository']}/releases/download/{tag}/{apk.name}"
    if record["url"] != expected_url or record["sha256"] != hashlib.sha256(apk.read_bytes()).hexdigest() or record["size"] != apk.stat().st_size:
        raise ValueError("Signed APK differs from its update manifest")
    if api.request("/commits/"+commit)["sha"] != commit:
        raise ValueError("Release source is not on GitHub")
    draft = api.request("/releases/tags/"+tag, missing=True)
    if draft is None:
        draft = api.request("/releases", "POST", {"tag_name":tag, "target_commitish":commit,
            "name":f"RADAZ {version} · Windows və Android", "draft":True, "prerelease":False})
    if not draft["draft"] or draft["target_commitish"] != commit:
        raise ValueError("Expected an unpublished draft for this exact commit")
    for path in (apk,feed):
        digest = "sha256:"+hashlib.sha256(path.read_bytes()).hexdigest()
        asset = next((a for a in draft["assets"] if a["name"] == path.name), None)
        if asset is None:
            asset = api.request(f"/releases/{draft['id']}/assets?name={quote(path.name)}", "POST", upload=path)
        if asset["state"] != "uploaded" or asset.get("digest") != digest or asset["size"] != path.stat().st_size:
            raise ValueError("GitHub tablet asset verification failed")
        print(f"Verified {path.name} ({asset['size']} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit")
    stage(parser.parse_args().commit)
