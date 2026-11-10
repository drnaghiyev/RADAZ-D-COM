# Native 3D local preview

This is an optional, local-only PySide6 + native VTK preview alongside the current Viewer. It is not a replacement for Smart Volume or a published Windows release.

## Open on this computer

Use the desktop shortcut **RADAZ - Lokal sinaq**, or `START-LOCAL.cmd`. The existing RADAZ must be running so its archive path can be discovered. This starts the private viewer at **http://127.0.0.1:5334/**, worker at 5335 and a separate HTTP-only archive service at 8768. These listeners bind to loopback. The HTTP-only service uses the same durable archive, without starting or changing its PACS receiver. File imports are real imports into that archive, not a disposable demo.

In the main Viewer, select a fully archived CT/MR series, open the **3D** menu and select **Native 3D**. This does not initialize the web GPU volume first. Close the native window before opening another native series. Original web Smart Volume and 3D remain available.

The installed launcher's log-lock fix was applied with its prior file saved under `%LOCALAPPDATA%/Programs/RADAZ/repair-backups/local-performance-20261110/`. The installed active version, updater manifest, website and public release were not changed. All other changes are in this private worktree/preview. Existing open RADAZ windows were not closed.

### Validation on 2026-11-10

- Production build and TypeScript passed; build prefix `adfdaee6324f`.
- Actual Edge cursor/overlay regression and direct-native-menu routing passed; native routing test uses a stub, native rendering is separately checked below.
- First-image progressive import with a delayed and an unreadable file passed in Edge with disposable synthetic studies.
- Archive tests: 15 passed. Native geometry/resource tests: 10 passed. Launcher concurrency test passed while the old log was exclusively locked.
- Existing archive read-only transport benchmark: same 32 files / 8.37 MB, sequential warm 509 ms versus bounded parallel 208–220 ms. This is not an end-to-end import/render speed claim.
- Native real CT: 512×512×442, all slices retained, load-to-ready 8.2–10.1 seconds; median interactive render 48.3 ms. Web/native comparative speed and full clinical validation are not established.
- Email integration deferred by user because no Google OAuth application exists. No Android, iOS or macOS package was produced.

## Implemented and tested

- Native Qt maximized window, VTK GPU volume ray casting, all source slices retained.
- Same evaluated transfer curves/materials as `lib/volume-presets.ts` (exported by `node scripts/export-native-volume-presets.mjs`). Native VTK and vtk.js are different renderers; identical pixel output is not claimed.
- Presets, interactive/coarse then stationary/fine sampling, rotation/pan/zoom, mouse WW/WL transfer adjustment, opacity, six geometric crop planes, axial/coronal/sagittal camera views, 360-degree rotation.
- Original stored DICOM read through a read-only archive connection; selected SeriesInstanceUID only. No patient or archive writes. Data stays local.
- Native-only RAM preflight reserves room for calibrated voxels, rendering upload and staging against currently available physical RAM. Oversized native views fail clearly before allocation; this does not restrict archive import or impose a file-count limit.
- Pixel calibration and DICOM LPS orientation/spacing checked. Irregular intervals, duplicate positions, gantry tilt, mixed orientation and enhanced multiframe are rejected, rather than silently distorted. Exact validated browser-volume handoff is also supported.
- Optional monitor button in 3D appears only if `/native-volume-api/status` reports availability. POST `/native-volume-api/open` passes the selected series UID and preset. Gateway controls the archive root and executable. Missing/nonarchived series returns an error; existing web features stay available.

## Still incomplete

Full native Smart Volume parity is **not implemented**: native freehand/brush/eraser, contour refinement, multi-segment state, undo/redo, MedSAM2 prompting, DICOM SEG and native report transfer are not present. These remain in the existing web Smart Volume. Native scalpel, custom transfer-function editor and labelled surface overlays are also not implemented. Native axial/coronal/sagittal controls orient the 3D camera; they are not MPR slice viewports.

No Android/iOS/macOS executable or code signing is provided by this preview. Native does not guarantee faster rendering on every GPU; compare measured workloads before replacement. No speedup relative to the web renderer is claimed from the native benchmark alone.

## Local commands

Use a Python environment containing PySide6 6.10.1, VTK 9.5.2, NumPy and pydicom. This machine already has these; the public Setup was not modified or enlarged.

```powershell
python bridge/native_volume_app.py --archive-root C:/Users/drnag/Documents/RADAZ-Archive --series SERIES_UID
python bridge/native_volume_app.py --synthetic --size 96 --slices 128 --smoke-output outputs/native-volume-smoke.json
python -m unittest discover -s tests -p native_volume_test.py
```

The synthetic smoke creates its own Qt window, renders, rotates, crops, changes orientation and closes only that test window. Anonymous output is written beside its timing JSON. Real-series benchmark writes timings only, no image or patient metadata. Existing RADAZ windows are not closed.

## Dependencies and sources

- [Qt for Python](https://doc.qt.io/qtforpython-6/): LGPLv3/GPLv3 or commercial terms. Distribution still needs its own compliance review; dependency availability is not a blanket commercial permission.
- [Native GPU mapper](https://vtk.org/doc/nightly/html/classvtkGPUVolumeRayCastMapper.html): native VTK GPU ray casting and sampling controls.

No certificate validation, updater safety or clinical data retention policy is changed.
