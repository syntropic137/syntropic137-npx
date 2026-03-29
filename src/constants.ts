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

const BIN = "npx syntropic137";

export const CMD = {
  init:       `${BIN} init`,
  status:     `${BIN} status`,
  stop:       `${BIN} stop`,
  start:      `${BIN} start`,
  logs:       `${BIN} logs`,
  update:     `${BIN} update`,
  initFirst:  `${BIN} init`,
  skipDocker: `${BIN} init --skip-docker`,
} as const;

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
// GitHub
// ---------------------------------------------------------------------------

export const GITHUB_BASE = "https://github.com";
export const GITHUB_API = "https://api.github.com";
export const PROJECT_URL = "https://github.com/syntropic137/syntropic137";

// ---------------------------------------------------------------------------
// Docker health check
// ---------------------------------------------------------------------------

export const MIN_COMPOSE_VERSION: [number, number] = [2, 20];
export const HEALTH_CHECK_TIMEOUT_MS = 120_000;
export const HEALTH_CHECK_INTERVAL_MS = 2_000;
export const MANIFEST_TIMEOUT_MS = 300_000;
