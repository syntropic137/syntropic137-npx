import { execFileSync } from "node:child_process";
import * as http from "node:http";
import { fail, info, spinner, success, warn } from "./ui.js";
import {
  COMPOSE_FILE,
  MIN_COMPOSE_VERSION,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
  CMD,
} from "./constants.js";
import { syncTemplate } from "./templates.js";

/**
 * Parse a Docker Compose version string like "Docker Compose version v2.29.1"
 * and return [major, minor, patch].
 */
export function parseComposeVersion(output: string): [number, number, number] | null {
  const match = output.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]!, 10), parseInt(match[2]!, 10), parseInt(match[3]!, 10)];
}

/**
 * Manages Docker Compose lifecycle for a Syntropic137 installation.
 *
 * Each instance is bound to a specific install directory.
 */
export class DockerService {
  constructor(private readonly installDir: string) {}

  /** Run `docker compose pull`. */
  pull(): void {
    const s = spinner("Pulling images...");
    try {
      this.compose(["pull"], "pipe");
      s.stop("Images pulled");
    } catch (err) {
      s.stop();
      fail("Failed to pull images. Check your internet connection and GHCR access.");
      if (err instanceof Error) info(err.message);
      process.exit(1);
    }
  }

  /** Run `docker compose up -d`. Returns true if successful. */
  up(): boolean {
    try {
      this.compose(["up", "-d"], "pipe");
      success("Containers started");
      return true;
    } catch (err) {
      warn("Some containers may have failed to start.");
      if (err instanceof Error) info(err.message);
      info(`Run \`${CMD.status}\` to check container health.`);
      return false;
    }
  }

  /** Run `docker compose down`. */
  down(): void {
    this.compose(["down"], "inherit");
  }

  /** Run `docker compose down -v` — removes containers AND volumes. */
  downWithVolumes(): void {
    this.compose(["down", "-v"], "inherit");
  }

  /** Run `docker compose stop`. */
  stop(): void {
    this.compose(["stop"], "inherit");
  }

  /** Pull latest images and start the stack (creates containers if needed). */
  start(): void {
    info("Starting stack...");
    this.pullAndUp();
  }

  /** Run `docker compose logs --tail 100 -f`. */
  logs(): void {
    this.compose(["logs", "--tail", "100", "-f"], "inherit");
  }

  /** Run `docker compose ps`. */
  status(): void {
    this.compose(["ps"], "inherit");
  }

  /** Update compose template, pull latest images, and restart. */
  update(templatesDir?: string): void {
    if (templatesDir) {
      syncTemplate(templatesDir, this.installDir, COMPOSE_FILE);
    }
    info("Updating stack...");
    this.pullAndUp();
    success("Update complete");
  }

  /** Poll the gateway health endpoint until 200 or timeout. */
  async waitForHealth(
    port: string | number = 8137,
    timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
  ): Promise<boolean> {
    const s = spinner("Waiting for services to be healthy...");
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const ok = await new Promise<boolean>((resolve) => {
          const req = http.request(
            { hostname: "127.0.0.1", port: Number(port), path: "/health", timeout: 3000 },
            (res) => {
              res.resume();
              resolve(res.statusCode === 200);
            },
          );
          req.on("error", () => resolve(false));
          req.on("timeout", () => {
            req.destroy();
            resolve(false);
          });
          req.end();
        });
        if (ok) {
          s.stop("Services healthy");
          return true;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
    }

    s.stop();
    warn("Health check timed out — services may still be starting.");
    info(`Run \`${CMD.status}\` to check container health.`);
    return false;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private pullAndUp(): void {
    info("Pulling latest images...");
    this.compose(["pull"], "inherit");
    this.compose(["up", "-d"], "inherit");
  }

  private compose(args: string[], stdio: "pipe" | "inherit"): void {
    execFileSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
      cwd: this.installDir,
      stdio,
    });
  }
}

// ---------------------------------------------------------------------------
// Static check (no install dir needed)
// ---------------------------------------------------------------------------

/**
 * Check that Docker is installed, running, and Compose v2.20+ is available.
 * Exits the process on failure.
 */
export function checkDocker(): void {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe" });
  } catch {
    fail("Docker is not installed or not running.");
    info("Install Docker: https://docs.docker.com/get-docker/");
    process.exit(1);
  }

  let versionOutput: string;
  try {
    versionOutput = execFileSync("docker", ["compose", "version"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    fail("Docker Compose v2 plugin is not installed.");
    info("Docker Compose v1 (docker-compose) is not supported.");
    info("Install Docker Compose v2: https://docs.docker.com/compose/install/");
    process.exit(1);
  }

  const version = parseComposeVersion(versionOutput);
  if (!version) {
    warn("Could not parse Docker Compose version. Continuing...");
    return;
  }

  const [major, minor] = version;
  const [reqMajor, reqMinor] = MIN_COMPOSE_VERSION;
  if (major < reqMajor || (major === reqMajor && minor < reqMinor)) {
    fail(`Docker Compose v2.20+ required (found v${version.join(".")}).`);
    info("Update Docker Desktop or install the latest Compose plugin.");
    process.exit(1);
  }

  success(`Docker Compose v${version.join(".")} detected`);
}

