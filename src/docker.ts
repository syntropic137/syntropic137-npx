import { execFileSync, execSync } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import { fail, info, spinner, success, warn } from "./ui.js";

const COMPOSE_FILE = "docker-compose.syntropic137.yaml";

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
 * Check that Docker is installed, running, and Compose v2.20+ is available.
 * Exits the process on failure.
 */
export function checkDocker(): void {
  // Check docker is installed
  try {
    execFileSync("docker", ["info"], { stdio: "pipe" });
  } catch {
    fail("Docker is not installed or not running.");
    info("Install Docker: https://docs.docker.com/get-docker/");
    process.exit(1);
  }

  // Check docker compose v2
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
  if (major < 2 || (major === 2 && minor < 20)) {
    fail(`Docker Compose v2.20+ required (found v${version.join(".")}).`);
    info("Update Docker Desktop or install the latest Compose plugin.");
    process.exit(1);
  }

  success(`Docker Compose v${version.join(".")} detected`);
}

/**
 * Run `docker compose pull` in the install directory.
 */
export function composePull(installDir: string): void {
  const s = spinner("Pulling images...");
  try {
    execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "pull"], {
      cwd: installDir,
      stdio: "pipe",
    });
    s.stop("Images pulled");
  } catch (err) {
    s.stop();
    fail("Failed to pull images. Check your internet connection and GHCR access.");
    if (err instanceof Error) info(err.message);
    process.exit(1);
  }
}

/**
 * Run `docker compose up -d` in the install directory.
 */
export function composeUp(installDir: string): void {
  try {
    execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d"], {
      cwd: installDir,
      stdio: "pipe",
    });
    success("Containers started");
  } catch (err) {
    fail("Failed to start containers.");
    if (err instanceof Error) info(err.message);
    process.exit(1);
  }
}

/**
 * Run `docker compose down` in the install directory.
 */
export function composeDown(installDir: string): void {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "down"], {
    cwd: installDir,
    stdio: "inherit",
  });
}

/**
 * Run `docker compose stop` in the install directory.
 */
export function composeStop(installDir: string): void {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "stop"], {
    cwd: installDir,
    stdio: "inherit",
  });
}

/**
 * Run `docker compose start` in the install directory.
 */
export function composeStart(installDir: string): void {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "start"], {
    cwd: installDir,
    stdio: "inherit",
  });
}

/**
 * Run `docker compose logs` in the install directory.
 */
export function composeLogs(installDir: string): void {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "logs", "--tail", "100", "-f"], {
    cwd: installDir,
    stdio: "inherit",
  });
}

/**
 * Run `docker compose ps` for status.
 */
export function composeStatus(installDir: string): void {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "ps"], {
    cwd: installDir,
    stdio: "inherit",
  });
}

/**
 * Pull latest images and restart.
 */
export function composeUpdate(installDir: string): void {
  info("Pulling latest images...");
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "pull"], {
    cwd: installDir,
    stdio: "inherit",
  });
  info("Restarting with new images...");
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d"], {
    cwd: installDir,
    stdio: "inherit",
  });
  success("Update complete");
}

/**
 * Poll the gateway health endpoint until it returns 200 or timeout.
 */
export async function waitForHealth(
  port: string | number = 8137,
  timeoutMs = 120_000,
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
    await new Promise((r) => setTimeout(r, 2000));
  }

  s.stop();
  warn("Health check timed out — services may still be starting.");
  info("Run `syntropic137 status` to check container health.");
  return false;
}
