"""Scope process retirement to this installation; preserve active clinical transfers."""
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bridge"))
import radaz_desktop as desktop


@unittest.skipUnless(os.name == "nt", "Windows desktop startup")
class NativeProcesses(unittest.TestCase):
    root = Path("C:/RADAZ-QA/app")
    target = "0.2.98"

    @classmethod
    def setUpClass(cls):
        import radaz_desktop_processes as processes
        cls.processes = processes

    def test_only_same_version_bundled_node_and_script_qualify(self):
        base = self.root / "versions" / self.target
        process = Mock()
        process.exe.return_value = str(base / "runtime/node/node.exe")
        process.cmdline.return_value = ["node", str(base / "scripts/start-release.mjs")]
        self.assertEqual(self.processes.identity(self.root, process), (self.target, "gateway"))
        process.cmdline.return_value = ["node", str(base.parent / "0.2.97/scripts/start-release.mjs")]
        self.assertEqual(self.processes.identity(self.root, process), (self.target, None))
        process.cmdline.return_value = ["node", "dist/runtime/web-server.mjs"]
        self.assertEqual(self.processes.identity(self.root, process), (self.target, "worker"))
        process.exe.return_value = "C:/foreign/runtime/node/node.exe"
        self.assertEqual(self.processes.identity(self.root, process), (None, None))

    def test_foreign_listener_is_preserved(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen()
            port = sock.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, "not owned"):
                self.processes.owner(self.root, port, "gateway")
            self.assertIn(os.getpid(), self.processes.listeners(port))

    def test_pid_reuse_and_role_change_never_terminate_a_replacement(self):
        process = Mock()
        process.is_running.return_value = False
        self.processes.stop_checked(self.root, process, self.target, "gateway")
        process.is_running.return_value = True
        with patch.object(self.processes, "identity", return_value=(self.target, "worker")):
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                self.processes.stop_checked(self.root, process, self.target, "gateway")
        process.terminate.assert_not_called()

    def test_busy_archive_defers_before_stopping_the_previous_gateway(self):
        old = {"desktopManaged": True, "appVersion": "0.2.97", "version": 1}
        with patch.object(self.processes, "listeners", return_value={123}), \
             patch.object(self.processes, "owner", return_value=(Mock(), "0.2.97")), \
             patch.object(desktop, "get_json", return_value=old), \
             patch.object(Path, "read_text", return_value="test"), \
             patch.object(desktop, "local_or_remote_open", side_effect=HTTPError("http://localhost",409,"Busy",{},None)), \
             patch.object(self.processes, "stop_checked") as stop, patch.object(desktop, "run_hidden") as spawn:
            with self.assertRaises(desktop.ArchiveBusy):
                desktop.start_services(self.root, self.root / "versions" / self.target, self.target, "qa")
            stop.assert_not_called()
            spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
