"""Attach the locally signed tablet APK to the matching desktop release draft."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release", ROOT / "scripts/github-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def tablet_package(info):
    version = info["version"]
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
    return tag, apk, feed, record


def stage(commit):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("An exact remote commit is required")
    info = release.config()
    api = release.GitHub(info["repository"], os.environ["GH_TOKEN"])
    tag, apk, feed, _ = tablet_package(info)
    if api.request("/commits/"+commit)["sha"] != commit:
        raise ValueError("Release source is not on GitHub")
    draft = api.request("/releases/tags/"+tag, missing=True)
    if draft is None:
        draft = api.request("/releases", "POST", {"tag_name":tag, "target_commitish":commit,
            "name":f"RADAZ {info['version']} · Windows və Android", "draft":True, "prerelease":False})
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


def promote(commit):
    """Advance the public fallback only after the primary feed serves the signed local build."""
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("An exact remote commit is required")
    info = release.config()
    repo = info["repository"]
    tag, apk, feed, record = tablet_package(info)
    api = release.GitHub(repo)
    latest = api.request("/releases/latest")
    if latest["tag_name"] != tag or latest["prerelease"] or latest["draft"] or api.request("/commits/"+tag)["sha"] != commit:
        raise ValueError("The requested source is not the current public release")
    base = f"https://github.com/{repo}/releases/latest/download/"
    with urlopen(Request(base+feed.name, headers={"User-Agent":"RADAZ-Tablet-Updater"}), timeout=45) as response:
        data = response.read(16385)
    if len(data)>16384 or json.loads(data) != record:
        raise ValueError("Public tablet update feed differs from the locally signed build")
    digest = hashlib.sha256()
    received = 0
    with urlopen(Request(record["url"], headers={"User-Agent":"RADAZ-Tablet-Updater"}), timeout=90) as response:
        while block := response.read(1024*1024):
            received += len(block)
            if received>record["size"]:
                raise ValueError("Public APK exceeds its advertised size")
            digest.update(block)
    if received!=record["size"] or digest.hexdigest()!=record["sha256"]:
        raise ValueError("Public Android download differs from the signed package")
    (ROOT/"android/release.json").write_bytes(feed.read_bytes())
    print(f"Verified {apk.name} at the public update address ({received} bytes); fallback feed is ready")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit")
    parser.add_argument("--promote", action="store_true", help="Verify the live APK and update the fallback feed")
    args = parser.parse_args()
    (promote if args.promote else stage)(args.commit)
