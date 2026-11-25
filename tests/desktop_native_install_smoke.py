"""Run the production Windows shortcut and installer with a disposable profile and archive."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import io
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.request import ProxyHandler, Request, build_opener

import psutil


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for(check, duration=45):
    until = time.monotonic() + duration
    while time.monotonic() < until:
        try:
            result = check()
            if result:
                return result
        except OSError:
            pass
        time.sleep(.25)
    raise AssertionError("Timed out waiting for " + check.__name__)


def hashfile(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def visible_viewer(install, version):
    expected = install / "versions" / version / "runtime/electron/RADAZ.exe"
    titles = []
    api = ctypes.windll.user32
    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def inspect(hwnd, data):
        if api.IsWindowVisible(hwnd):
            pid = wintypes.DWORD()
            api.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            try:
                if Path(psutil.Process(pid.value).exe()) == expected:
                    title = ctypes.create_unicode_buffer(512)
                    api.GetWindowTextW(hwnd, title, len(title))
                    if "RADAZ" in title.value and version in title.value:
                        titles.append(title.value)
            except psutil.Error:
                pass
        return True
    api.EnumWindows(inspect, 0)
    return titles


def synthetic_radiograph():
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import generate_uid, ExplicitVRLittleEndian, SecondaryCaptureImageStorage
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.StudyInstanceUID, ds.SeriesInstanceUID = generate_uid(), generate_uid()
    ds.PatientName, ds.PatientID, ds.Modality = "QA^Synthetic", "RADAZ-QA", "OT"
    ds.Rows, ds.Columns, ds.SamplesPerPixel = 2, 2, 1
    ds.PhotometricInterpretation, ds.PixelRepresentation = "MONOCHROME2", 0
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelData = 8, 8, 7, bytes(range(4))
    stream = io.BytesIO()
    pydicom.dcmwrite(stream, ds, enforce_file_format=True)
    return str(ds.StudyInstanceUID), stream.getvalue()


def run(setup, previous, version, gui=True):
    with tempfile.TemporaryDirectory(prefix="radaz-native-start-") as scratch:
        temp = Path(scratch).resolve()
        install, data = temp / "app", temp / "archive"
        data.mkdir()
        web, worker, archive, dicom = (unused_port() for _ in range(4))
        config = data / "config.json"
        config.write_text(json.dumps({"aeTitle": "RADAZ_QA", "port": dicom, "enabled": False}))
        protected = [config]
        for path in ("archive/instances/qa.dcm", "profile/PACS/settings.json", "profile/Bridge/config.json",
                     "profile/license.json", "profile/settings.json", "profile/reports/qa.txt"):
            file = temp / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(os.urandom(72))
            protected.append(file)
        hashes = {file: hashfile(file) for file in protected}
        profile = temp / "profile"
        env = {**os.environ, "RADAZ_INSTALL_ROOT": str(install), "RADAZ_PORT": str(web),
               "RADAZ_WORKER_PORT": str(worker), "RADAZ_ARCHIVE_PORT": str(archive),
               "RADAZ_ARCHIVE_DATA": str(data), "RADAZ_DESKTOP_PROFILE": str(profile / "Electron"),
               "RADAZ_DESKTOP_SKIP_PACS": "1", "LOCALAPPDATA": str(profile / "Local"),
               "APPDATA": str(profile / "Roaming"), "HTTP_PROXY": "http://127.0.0.1:9",
               "HTTPS_PROXY": "http://127.0.0.1:9", "NO_PROXY": "localhost,127.0.0.1"}
        local = build_opener(ProxyHandler({}))
        def get(port, path):
            with local.open(f"http://127.0.0.1:{port}/{path}", timeout=2) as response:
                return json.load(response)
        def health():
            return get(web, "radaz-health.json").get("ready")
        def runtime_version():
            return get(web, "radaz-runtime.json")["version"]
        def execute(command, timeout=150):
            return subprocess.run([str(x) for x in command], env=env, check=True,
                                  creationflags=subprocess.CREATE_NO_WINDOW, timeout=timeout)
        shortcut = install / "RADAZ-Start.exe"
        base = None
        study, pixels = synthetic_radiograph()
        def import_image():
            request = Request(f"http://127.0.0.1:{archive}/import", data=pixels,
                              headers={"Content-Type": "application/dicom", "Origin": "http://localhost:5173"})
            with local.open(request, timeout=12) as response:
                assert json.load(response)["ok"]
        def check_image():
            assert study in json.dumps(get(archive, "studies"))
            assert any(f.read_bytes() == pixels for f in (data / "instances").rglob("*") if f.is_file())
        stream = (temp / "isolated.log").open("wb")
        try:
            if previous:
                base = install / "versions" / previous.name
                for name in [*json.loads((previous / "SHA256SUMS.json").read_bytes()), "SHA256SUMS.json"]:
                    dest = base / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    os.link(previous / name, dest)
                execute([base / "runtime/python/python.exe", base / "bridge/radaz_desktop.py", "initialize",
                         "--install-root", install, "--no-shortcuts"])
                token = (install / "control-token").read_bytes()
                old_env = dict(env, RADAZ_DESKTOP_TOKEN=token.decode().strip())
                for command in [[base / "runtime/python/python.exe", base / "bridge/radaz_archive.py",
                                 "--data-dir", data, "--http-port", str(archive)],
                                [base / "runtime/node/node.exe", base / "scripts/start-release.mjs"]]:
                    subprocess.Popen(list(map(str, command)), cwd=base, env=old_env, stdin=subprocess.DEVNULL,
                                     stdout=stream, stderr=stream, creationflags=subprocess.CREATE_NO_WINDOW)
                wait_for(health)
                assert runtime_version() == base.name and get(archive, "status")["appVersion"] == base.name
                import_image()
                check_image()
                print("Previous packaged gateway and archive live:", base.name, flush=True)
            execute([setup, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/SSLDiagnosticsOnly=1", "/NORESTART", "/SP-",
                     "/NoRegistry=1", "/NoShortcuts=1", "/NoStartup=1", "/DIR=" + str(install),
                     "/LOG=" + str(temp / "setup.log")], timeout=300)
            candidate = install / "versions" / version
            manifest = json.loads((candidate / "SHA256SUMS.json").read_bytes())
            assert all(hashfile(candidate / name) == digest for name, digest in manifest.items())
            assert hashfile(shortcut) == manifest["runtime/RadazStart.exe"]
            if previous:
                assert runtime_version() == base.name
                assert json.loads((install / "pending.json").read_bytes())["version"] == version
                assert (install / "control-token").read_bytes() == token
                execute([shortcut, "--no-browser"])
                assert json.loads((install / "active.json").read_bytes()).get("previousVersion") == base.name
            else:
                # Setup itself must start both services before any shortcut is executed.
                assert health() and runtime_version() == version
                import_image()
            check_image()
            assert get(archive, "status")["appVersion"] == version and health() and runtime_version() == version
            assert json.loads((install / "active.json").read_bytes())["version"] == version
            assert all(hashfile(file) == digest for file, digest in hashes.items())
            print("Windows", "upgrade" if previous else "first install", "verified", len(manifest),
                  "files, 7 protected values, live gateway and archive", version, flush=True)
            if gui:
                execute([shortcut])
                title = wait_for(lambda: visible_viewer(install, version))
                print("Visible native Viewer from the normal shortcut:", title[0], flush=True)
        finally:
            if shortcut.exists():
                try:
                    execute([shortcut, "--uninstall"], timeout=40)
                except (subprocess.SubprocessError, OSError):
                    pass
            # Confine fallback teardown to the resolved disposable installation.
            assert install.parent == temp and temp.name.startswith("radaz-native-start-")
            children = []
            for proc in psutil.process_iter(["exe"]):
                try:
                    if proc.info["exe"] and Path(proc.info["exe"]).is_relative_to(install):
                        children.append(proc)
                        proc.terminate()
                except psutil.NoSuchProcess:
                    pass
            psutil.wait_procs(children, timeout=12)
            stream.close()
            if not (install / "activation-verified.json").exists():
                log = install / "logs/desktop.log"
                if log.exists():
                    print(log.read_text(errors="replace")[-1200:], flush=True)


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("setup", type=Path)
    cli.add_argument("version")
    cli.add_argument("--previous", type=Path)
    cli.add_argument("--no-window", action="store_true")
    args = cli.parse_args()
    run(args.setup.resolve(), args.previous.resolve() if args.previous else None, args.version, not args.no_window)
