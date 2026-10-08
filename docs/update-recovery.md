# Desktop updater investigation — 0.2.24

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
