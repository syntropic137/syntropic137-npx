import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const DEFAULT_INSTALL_DIR = path.join(os.homedir(), ".syntropic137");
export const COMPOSE_FILE = "docker-compose.syntropic137.yaml";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_APP_NAME = "syntropic137";
export const DEFAULT_PORT = "8137";
export const DEFAULT_APP_ENVIRONMENT = "selfhost";
export const DEFAULT_VERSION = "latest";

// ---------------------------------------------------------------------------
// CLI command reference (single source of truth for all user-facing commands)
// ---------------------------------------------------------------------------

export const BIN = "npx @syntropic137/setup";

export interface CommandDef {
  name: string;
  description: string;
  /** Shown in help text after the command, e.g. "[options]" */
  args?: string;
}

/**
 * All available CLI commands. The menu, help text, and summary box
 * all derive from this single list.
 */
export const COMMANDS: readonly CommandDef[] = [
  { name: "init",   description: "Bootstrap a Syntropic137 stack", args: "[options]" },
  { name: "status", description: "Show container health" },
  { name: "start",  description: "Start the stack" },
  { name: "stop",   description: "Stop the stack" },
  { name: "logs",   description: "Tail container logs" },
  { name: "update", description: "Pull latest images and restart" },
  { name: "plugin", description: "Install or update the Claude Code plugin" },
  { name: "github-app", description: "Open GitHub App settings in your browser" },
] as const;

/** Shorthand lookup: CMD.init → "npx @syntropic137/setup init" */
export const CMD = Object.fromEntries([
  ...COMMANDS.map((c) => [c.name, `${BIN} ${c.name}`]),
  ["skipDocker", `${BIN} init --skip-docker`],
]) as Record<string, string>;

// ---------------------------------------------------------------------------
// Template files to copy during init
// ---------------------------------------------------------------------------

export const TEMPLATE_FILES = [
  "docker-compose.syntropic137.yaml",
  "selfhost-entrypoint.sh",
  "selfhost.env.example",
  "init-db/01-create-databases.sql",
] as const;

// ---------------------------------------------------------------------------
// Secret file names
// ---------------------------------------------------------------------------

export const SECRET_FILES = [
  "db-password.secret",
  "redis-password.secret",
  "minio-password.secret",
] as const;

export const PEM_FILE = "github-app-private-key.pem";
export const WEBHOOK_SECRET_FILE = "github-webhook-secret.txt";
export const CLIENT_SECRET_FILE = "github-client-secret.txt";

// ---------------------------------------------------------------------------
// Claude Code plugin
// ---------------------------------------------------------------------------

export const CLAUDE_PLUGIN_REPO = "syntropic137/syntropic137-claude-plugin";
export const CLAUDE_PLUGIN_NAME = "syntropic137";
/** Full name@source used by `claude plugin update` */
export const CLAUDE_PLUGIN_FULL = "syntropic137@syntropic137";

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export const GITHUB_BASE = "https://github.com";
export const GITHUB_SLUG_RE = /^[a-zA-Z0-9-]+$/;
export const GITHUB_API = "https://api.github.com";
export const PROJECT_URL = "https://github.com/syntropic137/syntropic137";

// ---------------------------------------------------------------------------
// Docker health check
// ---------------------------------------------------------------------------

export const MIN_COMPOSE_VERSION: [number, number] = [2, 20];
export const HEALTH_CHECK_TIMEOUT_MS = 120_000;
export const HEALTH_CHECK_INTERVAL_MS = 2_000;
export const MANIFEST_TIMEOUT_MS = 300_000;
