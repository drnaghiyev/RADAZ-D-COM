# RADAZ Desktop

Canonical source: `C:\Users\drnag\Documents\GitHub\RADAZ-D-COM`.

The public application and native desktop shell are built together. The UI remains the existing RADAZ application; Electron hosts the viewer and its MPR, 3D, archive and report windows. Closing the main window hides it to the tray while the local services keep running.

Build from this directory:

```powershell
node scripts/run-framework.mjs build
python scripts/package-release.py
python scripts/package-desktop.py
python scripts/github-release.py validate
```

Distribute `outputs/releases/RADAZ-0.2.29-Setup.exe`. The installer includes Node.js, Python, FFmpeg and Electron. Windows startup and RADAZ shortcuts use the stable launcher so that they follow the active version after an update. The archive stays outside the installation in Documents/RADAZ-Archive.

Private anatomy research and backups belong in ignored `.local-research` and `.local-backups` directories; they must not enter public builds or GitHub.

Native smoke test: stage the complete package into `outputs/desktop-test/install/versions/0.2.29`, provide synthetic DICOM files in `outputs/desktop-fixture`, set PLAYWRIGHT_MODULE and run `node desktop/smoke.mjs`. It uses isolated ports, profile and archive.
