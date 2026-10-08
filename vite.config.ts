import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { localAiRequest } from './scripts/local-ai-request.mjs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  // Local RADAZ has no Cloudflare bindings. Run its dev/build on Node so a
  // Windows workerd/Miniflare crash cannot prevent the workstation opening.
  const cloudPlugins = managedLinux ? [(await import("@cloudflare/vite-plugin")).cloudflare({
    viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    inspectorPort: false,
    config: localBindingConfig,
  })] : [];

  return {
    server: {
      ...(!managedLinux ? {
        host: '0.0.0.0',
        proxy: { '/local-archive-api': { target: 'http://127.0.0.1:8766', changeOrigin: true,
          bypass(req: IncomingMessage, res: ServerResponse | undefined) { if (req.url?.startsWith('/local-archive-api/ai/') && !localAiRequest(req)) { res?.writeHead(403, {'Content-Type':'application/json'}); res?.end(JSON.stringify({error:'AI ayarlarını serverin quraşdırıldığı kompüterdə açın.'})); return false; } },
          rewrite: (path: string) => path.replace(/^\/local-archive-api/, '') } },
      } : {}),
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      ...cloudPlugins,
    ],
  };
});
