import * as crypto from "node:crypto";
import * as https from "node:https";
import { execFile, spawn } from "node:child_process";
import { findFreePort, startCallbackServer, buildAutoSubmitForm, startFormServer } from "./server.js";
import { SecretsManager } from "./secrets.js";
import { info, success, warn, spinner, dim, cyan, bold } from "./ui.js";
import type { ManifestResult, AppPermissions } from "./types.js";
import {
  GITHUB_BASE,
  GITHUB_API,
  PROJECT_URL,
  MANIFEST_TIMEOUT_MS,
} from "./constants.js";

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
  "installation",
  "installation_repositories",
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
// Manifest builder (pure function — no class needed)
// ---------------------------------------------------------------------------

export interface ManifestOptions {
  appName: string;
  redirectUrl: string;
  webhookUrl?: string;
}

export function buildManifest(opts: ManifestOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: opts.appName,
    url: PROJECT_URL,
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

export function openBrowser(url: string): void {
  // Fire-and-forget: ignore stdio and swallow errors so a missing helper
  // (e.g. xdg-open on minimal Linux) never crashes or hangs the CLI.
  const opts = { stdio: "ignore" as const };
  if (process.platform === "darwin") {
    spawn("open", [url], opts).on("error", () => {}).unref();
  } else if (process.platform === "win32") {
    // `start` is a shell builtin — use cmd.exe with the URL as a separate arg
    spawn("cmd.exe", ["/c", "start", "", url], opts).on("error", () => {}).unref();
  } else {
    spawn("xdg-open", [url], opts).on("error", () => {}).unref();
  }
}

// ---------------------------------------------------------------------------
// GitHubAppSetup — orchestrates the full manifest flow
// ---------------------------------------------------------------------------

export interface GitHubAppSetupOptions {
  appName: string;
  webhookUrl?: string;
  secretsDir: string;
  org?: string;
}

/**
 * Orchestrates the GitHub App Manifest creation flow:
 *
 * 1. Start callback + form servers on ephemeral ports
 * 2. Open browser → user approves → GitHub redirects back
 * 3. Exchange temporary code for credentials
 * 4. Save PEM, webhook secret, client secret to disk
 * 5. Open installation page
 */
export class GitHubAppSetup {
  private readonly secrets: SecretsManager;

  constructor(private readonly opts: GitHubAppSetupOptions) {
    this.secrets = new SecretsManager(opts.secretsDir);
  }

  async run(): Promise<ManifestResult> {
    const callbackPort = await findFreePort();
    const formPort = await findFreePort();

    const redirectUrl = `http://127.0.0.1:${callbackPort}/callback`;
    const manifest = buildManifest({
      appName: this.opts.appName,
      redirectUrl,
      webhookUrl: this.opts.webhookUrl,
    });
    const manifestJson = JSON.stringify(manifest);

    // CSRF state
    const csrfState = crypto.randomBytes(16).toString("base64url");

    // Build GitHub target URL
    const createUrl = this.opts.org
      ? `${GITHUB_BASE}/organizations/${this.opts.org}/settings/apps/new`
      : `${GITHUB_BASE}/settings/apps/new`;

    // Start servers
    const callbackHandle = startCallbackServer(callbackPort, csrfState);
    const formHtml = buildAutoSubmitForm(createUrl, manifestJson, csrfState);
    const formServer = startFormServer(formPort, formHtml);
    const formUrl = `http://127.0.0.1:${formPort}/start`;

    info(`Opening browser to create GitHub App ${bold(`'${this.opts.appName}'`)}...`);
    info(dim(`(If the browser doesn't open, visit: ${formUrl})`));
    openBrowser(formUrl);
    console.log();

    const s = spinner("Waiting for GitHub to redirect back...");

    let code: string;
    try {
      code = await callbackHandle.waitForCode(MANIFEST_TIMEOUT_MS);
      s.stop("Received authorization code");
    } catch (err) {
      s.stop();
      formServer.close();
      callbackHandle.shutdown();
      throw err;
    }

    formServer.close();

    try {
      // Exchange code for credentials
      const sx = spinner("Exchanging code for credentials...");
      const exchangeUrl = `${GITHUB_API}/app-manifests/${code}/conversions`;
      const credentials = (await apiRequest(exchangeUrl, "POST", "")) as Record<string, string>;
      sx.stop("Credentials received");

      // Save credentials
      this.secrets.savePem(credentials.pem || "");
      this.secrets.saveWebhookSecret(credentials.webhook_secret || "");
      this.secrets.saveClientSecret(credentials.client_secret || "");

      const slug = credentials.slug || this.opts.appName;
      const settingsUrl = `${GITHUB_BASE}/settings/apps/${slug}`;


      // ── Success summary ───────────────────────────────────────────────
      console.log();
      success(`GitHub App ${bold(`'${slug}'`)} created!`);
      console.log();
      info(`${dim("Settings:")}  ${cyan(settingsUrl)}`);
      info(`${dim("Tip:")}       Add a logo → ${cyan(settingsUrl)} → "Display information"`);
      console.log();

      // Open installation page
      const installUrl = `${GITHUB_BASE}/apps/${slug}/installations/new`;
      info(`Opening installation page...`);
      info(`Install the app on the repos you want Syntropic137 to access.`);
      openBrowser(installUrl);

      return {
        id: Number(credentials.id) || 0,
        slug,
        pem: credentials.pem || "",
        webhook_secret: credentials.webhook_secret || "",
        client_id: credentials.client_id || "",
        client_secret: credentials.client_secret || "",
        html_url: settingsUrl,
      };
    } finally {
      callbackHandle.shutdown();
    }
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible free function
// ---------------------------------------------------------------------------

export interface ManifestFlowOptions {
  appName: string;
  webhookUrl?: string;
  secretsDir: string;
  org?: string;
}

export async function runManifestFlow(opts: ManifestFlowOptions): Promise<ManifestResult> {
  return new GitHubAppSetup(opts).run();
}
