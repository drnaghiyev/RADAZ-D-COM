# Desktop updater investigation

## 0.2.40 — Watch/startup ownership during activation

Reported transition: 0.2.37 to 0.2.39, expected build `c54f9af987cbf591e1a03352503d74ff34db76ee5c77b65368fe7970d1ac0727`, received `159e45c31ba26a9f3b8beb7afeb4f3db8d99e1e0e6f13a75b37261d0b6afb6fa`, followed by connection refused during rollback. At investigation time this workstation already served the correct 0.2.39 on 5173; its available error log did not contain that exact failed transaction. The changes address the reproduced lifecycle gap, not a claim to have recovered the other workstation's complete process history.

`launch.lock` serializes Python controllers, including Watch recovery, but does not revoke a PowerShell startup already spawned by an earlier controller. Early launcher failure did not clean up candidate children, and timeout cleanup depended on a working HTTP endpoint. An abandoned old launcher could consequently replace the candidate on the shared port after the Python transaction ended. Watch accepted any endpoint named RADAZ, even a different build, and only handed off to a changed active version after another possibly slow GitHub check.

The controller now quiesces installation-scoped Watch/startup producers before switching. Process matching uses exact installation/version script paths, snapshots and creation-time rechecks; it excludes the invoking controller and ancestors and never kills an entire gateway process tree. After commit the new Watch takes `launch.lock` before retiring an old-version Watch, including a parent Watch that applied the update itself. This waits until the parent's activation transaction has ended, but does not wait for its next GitHub request or `update.lock`. The real Windows ancestor/lock regression covers this handoff. Candidate health still requires the original build ID, client asset health, archive protocol/version and root page; it additionally requires the TCP listener to be the bundled Node executable running that version's gateway. New gateways also report a per-launch nonce and PID. A delayed new launcher rejects a superseded controller lease. Legacy controllers activating 0.2.40 use the same quiescing helper through its startup script.

Every failed candidate startup, including an early process exit, stops that candidate's starters, gateway and renderers before rollback. The archive is stopped only through its existing authenticated, busy-aware graceful lifecycle; no DICOM receiver is force-killed by the process helper. Connection refused after a shutdown probe is benign only if the old archive port is actually free. A restored runtime must pass health before recovery is reported. Watch checks the active version before any release-feed request and rejects a mismatched runtime build.

The immutable published 0.2.37/0.2.39 ZIPs are not patched or rehashed. `tests/desktop-watch-migration.py` verifies both release SHA-256 values and every manifest entry, starts real 0.2.37 services and Watch, introduces a suspended obsolete startup, and activates the exact 0.2.39 with the repaired controller. It checks the new Watch, listener/build, a synthetic C-STORE study and unchanged hashes for DICOM, license, encrypted credential and user configuration. `--reproduce-legacy` exercises the original controller and resumes the obsolete launcher after commit, then runs repair. The normal offline package smoke additionally covers early-startup failure and missing-client-asset rollback while a Watch is alive.

### Repairing an already downloaded 0.2.39

Extract `RADAZ-Updater-Repair-0.2.40.zip` into a separate folder and run `REPAIR-UPDATE.cmd` after finishing the examination. It uses RADAZ's bundled Python, validates the existing `versions/0.2.39` manifest, restores the pending pointer if the failed legacy attempt removed it, and applies through the repaired controller. It does not replace files inside either published version, reset licensing, delete an archive, or clear browser/Electron profiles. If 0.2.39 is absent or corrupt, validation fails before stopping services; install/download a verified complete release first.

For a custom installation: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/repair-desktop-update.ps1 -InstallRoot "D:\RADAZ" -TargetVersion 0.2.39`. This targeted repair cannot downgrade a newer active version. The permanent lifecycle changes ship in 0.2.40; the small repair is for computers still using older controllers.

## 0.2.24

## Evidence before changes

The reported `0.2.23 açıla bilmədi. Əvvəlki işlək versiya saxlanılıb` is produced by `check_update()` when `failed-update.json` matches the latest release. The old `launch()` caught every activation exception and wrote only the version, losing the error. `check_update()` then returned before the approved-download branch. A regression reproduction with an approved target and this marker returned `error`, without calling the download function.

The failure was on another computer. Its original logs were not provided. The message alone cannot establish whether its first failure was a timeout, locked process, archive handoff, runtime error, network, cache, or resource problem. On the inspected computer, 0.2.23 was active, its installed manifest passed, and both the viewer and managed archive reported 0.2.23. The public release's seven asset sizes and SHA-256 digests matched the local artifacts; older update clients selected the published 0.2.23 feed. No Service Worker registration existed in the repository.

Additional confirmed gaps: health checked runtime identity, archive status and root HTTP 200, but not browser resources; UI reloaded upon seeing the candidate runtime version before the active pointer was committed; archive error logs were overwritten on subsequent launches.

## Activation and recovery

GitHub static manifest (REST fallback) -> strict release/URL/size/SHA-256 validation -> file manifest validation -> isolated version directory -> pending pointer. Downloading never restarts the app. User restart validates the candidate again, opens the archive and gateway, and waits for health. The gateway independently verifies the client asset manifest on disk and through the actual worker, including MIME and SHA-256, and renders six routes. It returns 503 for pages until ready, so this health gate also works when an older desktop updater launches 0.2.24. Only then is `active.json` replaced atomically.

The browser waits for a healthy runtime build matching the committed active version; a candidate responding during activation is insufficient. Reload retains the route and adds its build ID. Responses are no-store, missing static chunks are 404 instead of HTML fallbacks, and bootstrap reports resource/runtime errors and retires obsolete service workers controlling the app. It never clears localStorage or IndexedDB. A worker that serves an entirely old cached HTML document without the new bootstrap cannot be diagnosed retroactively by that bootstrap.

For older UI clients that only check `runtime.version`, the gateway withholds that field during activation while keeping `buildId` available to the desktop health check. A later GitHub feed outage does not invalidate a committed healthy activation. Failure to atomically commit the active pointer is handled by the same rollback path as failed startup.

Failed startup retains the active pointer and previous files, records structured diagnostics, and attempts the previous runtime. Failure to restore runtime is reported separately instead of claiming recovery succeeded. Discovery permits an explicit retry; corrupt inactive files can be replaced from a newly verified package. `logs/update-errors.jsonl` preserves history, `failed-update.json` retains the latest activation cause, and archive stdout/stderr have per-launch filenames. Successful activation clears the failure marker.

## Persistence and compatibility

No update operation migrates/deletes the clinical archive, PACS configuration, license/trial records, user localStorage or IndexedDB. Versions remain separate from these stores. An archive receiving images defers activation. Old releases have no asset health endpoint; rollback keeps their existing runtime check. The improved Python retry/diagnostic logic takes effect after 0.2.24 is installed; the new target version bypasses older clients' 0.2.23 failure latch. Existing 0.2.23 assets are not overwritten.

Regression coverage includes failed-release retry, corruption replacement, diagnostic persistence and rollback failure, missing/wrong-MIME/corrupt HTTP resources, deferred activation, early UI reload prevention, browser state persistence and Service Worker recovery, plus the isolated offline Windows installer/update/rollback smoke test.

## 0.2.25 — updater terminated with the old gateway

Follow-up symptom: after restart the browser reports ERR_CONNECTION_REFUSED. A Windows regression reproduced a previously uncovered process topology: when no watcher is running, the gateway spawns a detached Python watcher to handle `/radaz-update`. The candidate launcher's `stop-web-server.ps1` used `taskkill /T` on the old gateway, killing that watcher and the candidate launcher beneath it. Windows detachment does not exclude descendants from `taskkill /T`. The new server was never started. This code defect is reproduced locally; the remote computer's exact logs remain necessary to distinguish it from unrelated startup failures.

Stop only the verified gateway and its direct, known Node renderer processes. Match process creation time and command line again before stopping to avoid a reused PID. Never stop the gateway's entire descendant tree. `tests/update-process-tree.mjs` fails on the old helper and passes on the fixed helper, proving both updater and unrelated child survival. The offline installed upgrade test can force this topology with `RADAZ_TEST_GATEWAY_UPDATER=1`, including upgrades from older released packages.

## 0.2.26 — offline activation, server recovery and application windows

The old `watch` path checked the remote release feed before consuming a local apply request. Slow/offline GitHub checks could therefore delay a fully downloaded update. The gateway now starts a dedicated `apply` command that atomically consumes the confirmed request and runs the existing verified activation/rollback transaction without requesting the release feed or waiting for the download lock. The watcher also consumes pending apply requests before its first network check for compatibility. Updater stdout/stderr are appended to desktop.log instead of discarded.

An idle watcher restores the active runtime after three failed health probes. Recovery acquires the launch lock and opens only the active version, leaving unrequested pending updates staged. Repeated failures are recorded and retried with a backoff. The user-started launcher opens an Edge/Chrome app window only after runtime health succeeds. It uses the existing default Chromium profile and localhost origin; no new profile or browser-store cleanup is performed. Windows Startup shortcuts already invoke this launcher, including fresh Setup installs. The background server and updater are independent of closing the app window.

The remote computer's previous ERR_CONNECTION_REFUSED cause still cannot be conclusively identified without its launch logs. Native tests use temporary installations and synthetic archives, never the user's live installation.
