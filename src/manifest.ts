import * as crypto from "node:crypto";
import * as https from "node:https";
import { exec } from "node:child_process";
import { findFreePort, startCallbackServer, buildAutoSubmitForm, startFormServer } from "./server.js";
import { savePem, saveWebhookSecret, saveClientSecret } from "./secrets.js";
import { info, success, warn, spinner } from "./ui.js";
import type { ManifestResult, AppPermissions } from "./types.js";

// ---------------------------------------------------------------------------
// Constants (matching github_manifest.py)
// ---------------------------------------------------------------------------

const GITHUB_BASE = "https://github.com";
const GITHUB_API = "https://api.github.com";

const DEFAULT_PERMISSIONS: AppPermissions = {
  contents: "write",
  pull_requests: "write",
  actions: "read",
  checks: "write",
  statuses: "write",
  issues: "write",
  metadata: "read",
};

const DEFAULT_EVENTS: string[] = [
  "workflow_run",
  "workflow_job",
  "check_run",
  "check_suite",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "commit_comment",
  "status",
  "issues",
  "issue_comment",
  "create",
  "delete",
  "label",
];

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

export interface ManifestOptions {
  appName: string;
  redirectUrl: string;
  webhookUrl?: string;
}

export function buildManifest(opts: ManifestOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: opts.appName,
    url: "https://github.com/syntropic137/syntropic137",
    redirect_url: opts.redirectUrl,
    public: false,
    default_permissions: DEFAULT_PERMISSIONS,
  };

  if (opts.webhookUrl) {
    manifest.default_events = DEFAULT_EVENTS;
    manifest.hook_attributes = { url: opts.webhookUrl, active: true };
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// GitHub API (stdlib only — node:https)
// ---------------------------------------------------------------------------

function apiRequest(url: string, method = "POST", data?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "syntropic137-cli",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub API error ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON from GitHub: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (data) req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Browser open (cross-platform, best-effort)
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    // Ignore errors — we print the URL as fallback
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface ManifestFlowOptions {
  appName: string;
  webhookUrl?: string;
  secretsDir: string;
  org?: string;
}

/**
 * Run the full GitHub App Manifest flow:
 *
 * 1. Build manifest JSON
 * 2. Start callback server on ephemeral port
 * 3. Serve auto-submit form → open browser
 * 4. Wait for GitHub redirect with temporary code
 * 5. Exchange code for credentials
 * 6. Save PEM + secrets
 * 7. Open installation page, capture installation_id
 */
export async function runManifestFlow(opts: ManifestFlowOptions): Promise<ManifestResult> {
  const [callbackPort, formPort] = await Promise.all([findFreePort(), findFreePort()]);

  const redirectUrl = `http://127.0.0.1:${callbackPort}/callback`;

  const manifest = buildManifest({
    appName: opts.appName,
    redirectUrl,
    webhookUrl: opts.webhookUrl,
  });
  const manifestJson = JSON.stringify(manifest);

  // CSRF state
  const csrfState = crypto.randomBytes(16).toString("base64url");

  // Build GitHub target URL
  const createUrl = opts.org
    ? `${GITHUB_BASE}/organizations/${opts.org}/settings/apps/new`
    : `${GITHUB_BASE}/settings/apps/new`;

  // Start servers
  const callbackHandle = startCallbackServer(callbackPort, csrfState);
  const formHtml = buildAutoSubmitForm(createUrl, manifestJson, csrfState);
  const formServer = startFormServer(formPort, formHtml);
  const formUrl = `http://127.0.0.1:${formPort}/start`;

  info(`Opening browser to create GitHub App '${opts.appName}'...`);
  info(`(If the browser doesn't open, visit: ${formUrl})`);
  openBrowser(formUrl);

  const s = spinner("Waiting for GitHub to redirect back...");

  let code: string;
  try {
    code = await callbackHandle.waitForCode(300_000);
    s.stop("Received authorization code");
  } catch (err) {
    s.stop();
    formServer.close();
    callbackHandle.shutdown();
    throw err;
  }

  formServer.close();

  // Exchange code for credentials
  info("Exchanging code for credentials...");
  const exchangeUrl = `${GITHUB_API}/app-manifests/${code}/conversions`;
  const credentials = (await apiRequest(exchangeUrl, "POST", "")) as Record<string, string>;

  // Save credentials
  savePem(opts.secretsDir, credentials.pem || "");
  saveWebhookSecret(opts.secretsDir, credentials.webhook_secret || "");
  saveClientSecret(opts.secretsDir, credentials.client_secret || "");

  const slug = credentials.slug || opts.appName;
  const htmlUrl = credentials.html_url || `${GITHUB_BASE}/settings/apps/${slug}`;

  success(`GitHub App '${slug}' created!`);
  info(`App settings: ${htmlUrl}`);

  callbackHandle.shutdown();

  // Open installation page so the user can install the app on their repos.
  // Installation IDs are resolved dynamically at runtime per-repo — we don't
  // store a single ID since the app can be installed across multiple orgs.
  info(`Opening installation page for '${slug}'...`);
  const installUrl = `${GITHUB_BASE}/apps/${slug}/installations/new`;
  openBrowser(installUrl);
  info("Install the app on the repos you want Syntropic137 to access.");

  return {
    id: Number(credentials.id) || 0,
    slug,
    pem: credentials.pem || "",
    webhook_secret: credentials.webhook_secret || "",
    client_id: credentials.client_id || "",
    client_secret: credentials.client_secret || "",
    html_url: htmlUrl,
  };
}
