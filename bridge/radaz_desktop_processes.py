"""Identify this installation's listeners and background processes using the Windows process table."""
import os
import re
from pathlib import Path

import psutil

VERSION = re.compile(r"\d+\.\d+\.\d+")
SHELLS = {"powershell.exe", "pwsh.exe"}
PYTHONS = {"python.exe", "pythonw.exe"}
STARTERS = {"scripts/start-radaz.ps1", "scripts/start-archive.ps1", "scripts/stop-web-server.ps1"}


def version_path(root, path):
    if not path:
        return None, None
    try:
        parts = Path(path).relative_to(root / "versions").parts
    except ValueError:
        return None, None
    if len(parts) < 2 or not VERSION.fullmatch(parts[0]):
        return None, None
    return parts[0], "/".join(parts[1:]).lower()


def identity(root, process):
    exe = process.exe()
    version, executable = version_path(root, exe)
    name = Path(exe).name.lower()
    legacy_shell = name in SHELLS
    if not version and name not in SHELLS | PYTHONS:
        return None, None
    if executable == "runtime/electron/radaz.exe":
        return version, "viewer"
    args = process.cmdline()
    for index, argument in enumerate(args[1:], 1):
        if Path(argument).is_absolute():
            source_version, script = version_path(root, argument)
        else:
            source_version, script = version, argument.replace("\\", "/").lower()
        if legacy_shell and source_version and script in STARTERS:
            return source_version, "starter"
        if (name in PYTHONS and source_version and script == "bridge/radaz_desktop.py"
                and args[index+1:index+2] == ["watch"] and (version == source_version or not version)):
            return source_version, "watch"
        if not version or source_version != version:
            continue
        if executable == "runtime/node/node.exe":
            if script == "scripts/start-release.mjs":
                return version, "gateway"
            if script == "dist/runtime/web-server.mjs":
                return version, "worker"
        if executable == "runtime/python/python.exe":
            if script == "bridge/radaz_archive.py":
                return version, "archive"
            if script == "bridge/radaz_pacs_bridge.py":
                return version, "bridge"
    return version, None


def listeners(port):
    return {c.pid for c in psutil.net_connections(kind="tcp") if c.pid and c.laddr
            and c.laddr.port == port and not c.raddr}


def owner(root, port, role, expected=None):
    matches = listeners(port)
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {role} listener on port {port}")
    process = psutil.Process(matches.pop())
    version, kind = identity(root, process)
    if kind != role or (expected and expected != version):
        raise RuntimeError(f"Port {port} is not owned by the expected RADAZ {role}")
    return process, version


def stop_checked(root, process, version, role):
    try:
        if not process.is_running():
            return
        if identity(root, process) != (version, role):
            raise RuntimeError("Process identity changed during RADAZ shutdown")
        # psutil verifies the creation time before terminating a Windows PID.
        process.terminate()
        process.wait(timeout=10)
    except psutil.NoSuchProcess:
        pass


def manage(root, action, target=None, port=5173):
    if target and not VERSION.fullmatch(target):
        raise ValueError("Invalid runtime version")
    if action == "Owner":
        process, detected = owner(root, port, "gateway", target)
        return {"pid": process.pid, "version": detected, "created": process.create_time()}
    if action not in ("InUse", "StopRuntime", "StopServices", "Quiesce", "RetireWatch"):
        raise ValueError("Unknown RADAZ process action")
    if action in ("StopRuntime", "RetireWatch") and not target:
        raise ValueError("Runtime version is required")
    used = set()
    this = psutil.Process()
    protected = {os.getpid(), *(p.pid for p in this.parents())}
    stops = []
    for proc in psutil.process_iter(["exe"]):
        try:
            exe = proc.info["exe"]
            bundled, _ = version_path(root, exe)
            if not bundled and (not exe or Path(exe).name.lower() not in SHELLS | PYTHONS):
                continue
            if action == "InUse" and bundled:
                used.add(bundled)
                continue
            version, role = identity(root, proc)
            if not version:
                continue
            used.add(version)
            retire = action == "RetireWatch" and role == "watch" and version != target
            if proc.pid in protected and not retire:
                continue
            if (retire or (role == "starter" and action in ("Quiesce","StopRuntime","StopServices") and (not target or version == target))
                    or (action == "Quiesce" and role == "watch")
                    or (action == "StopRuntime" and version == target and role in ("gateway","worker"))
                    or (action == "StopServices" and role in ("archive","bridge","viewer"))):
                stops.append((proc, version, role))
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    if action == "InUse":
        return {"versions": sorted(used)}
    for proc, version, role in sorted(stops, key=lambda x: x[2] not in ("gateway","starter")):
        stop_checked(root, proc, version, role)
