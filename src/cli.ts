#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { CliOptions, EnvValues } from "./types.js";
import {
  banner,
  step,
  info,
  success,
  fail,
  warn,
  bold,
  cyan,
  dim,
  green,
  prompt,
  promptSecret,
  confirm,
  setTotalSteps,
} from "./ui.js";
import { checkDocker, composePull, composeUp, composeStop, composeStart, composeLogs, composeStatus, composeUpdate, waitForHealth } from "./docker.js";
import { generateSecrets } from "./secrets.js";
import { writeEnvFile, envExists } from "./config.js";
import { runManifestFlow } from "./manifest.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const PKG_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf-8"),
).version as string;

const TEMPLATES_DIR = path.join(PKG_DIR, "templates");
const DEFAULT_DIR = path.join(os.homedir(), ".syntropic137");

// ---------------------------------------------------------------------------
// Arg parsing (zero dependencies)
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  // Check for help/version first
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  // Determine command
  const firstArg = args[0];
  const subcommands = ["status", "stop", "start", "logs", "update"] as const;
  type Subcommand = (typeof subcommands)[number];
  let command: CliOptions["command"] = "init";

  if (firstArg && subcommands.includes(firstArg as Subcommand)) {
    command = firstArg as Subcommand;
  }

  // Parse flags
  const opts: CliOptions = { command };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--org":
        opts.org = args[++i];
        break;
      case "--name":
        opts.name = args[++i];
        break;
      case "--dir":
        opts.dir = args[++i];
        break;
      case "--skip-github":
        opts.skipGithub = true;
        break;
      case "--skip-docker":
        opts.skipDocker = true;
        break;
      case "--webhook-url":
        opts.webhookUrl = args[++i];
        break;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
  ${bold("syntropic137")} v${VERSION} — self-host setup CLI

  ${bold("USAGE")}
    npx syntropic137 init [options]     Bootstrap a Syntropic137 stack
    syntropic137 status                 Show container health
    syntropic137 stop                   Stop the stack
    syntropic137 start                  Start the stack
    syntropic137 logs                   Tail container logs
    syntropic137 update                 Pull latest images and restart

  ${bold("OPTIONS")}
    --org <name>          GitHub org for the app (default: personal)
    --name <app-name>     GitHub App name (default: syntropic137)
    --dir <path>          Install directory (default: ~/.syntropic137)
    --skip-github         Skip GitHub App creation
    --skip-docker         Skip Docker pull/up (templates only)
    --webhook-url <url>   Webhook URL for the GitHub App
    -h, --help            Show this help
    -v, --version         Show version
`);
}

// ---------------------------------------------------------------------------
// Init flow (10 steps)
// ---------------------------------------------------------------------------

export async function runInit(opts: CliOptions): Promise<void> {
  banner();

  const installDir = opts.dir || DEFAULT_DIR;
  const secretsDir = path.join(installDir, "secrets");
  const appName = opts.name || "syntropic137";

  // Determine total steps based on flags
  let steps = 10;
  if (opts.skipGithub) steps -= 1;
  if (opts.skipDocker) steps -= 3; // pull, up, health
  setTotalSteps(steps);

  // Re-run safety: detect existing .env
  if (envExists(installDir)) {
    warn("Existing installation detected at " + installDir);
    const proceed = await confirm("Reconfigure?", false);
    if (!proceed) {
      info("Skipping. Run `syntropic137 status` to check your stack.");
      return;
    }
  }

  // ── Step 1: Check Docker ──────────────────────────────────────────────
  step("Checking Docker");
  if (!opts.skipDocker) {
    checkDocker();
  } else {
    info("Skipped (--skip-docker)");
  }

  // ── Step 2: Create directory ──────────────────────────────────────────
  step("Creating install directory");
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(path.join(installDir, "init-db"), { recursive: true });
  fs.mkdirSync(path.join(installDir, "workspaces"), { recursive: true });
  success(installDir);

  // ── Step 3: Copy templates ────────────────────────────────────────────
  step("Copying templates");
  copyTemplate("docker-compose.syntropic137.yaml", installDir);
  copyTemplate("selfhost-entrypoint.sh", installDir);
  copyTemplate("selfhost.env.example", installDir);
  copyTemplate("init-db/01-create-databases.sql", path.join(installDir));
  // Make entrypoint executable
  fs.chmodSync(path.join(installDir, "selfhost-entrypoint.sh"), 0o755);
  success("Templates copied");

  // ── Step 4: Generate secrets ──────────────────────────────────────────
  step("Generating secrets");
  generateSecrets(secretsDir);

  // ── Step 5: Prompt for API key ────────────────────────────────────────
  step("Configuring LLM provider");
  const envValues: EnvValues = {
    APP_ENVIRONMENT: "selfhost",
    SYN_VERSION: "latest",
  };

  // Check for existing env vars
  const existingKey = process.env.ANTHROPIC_API_KEY || "";
  const existingOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN || "";

  if (existingOauth) {
    info("Found CLAUDE_CODE_OAUTH_TOKEN in environment");
    envValues.CLAUDE_CODE_OAUTH_TOKEN = existingOauth;
  } else if (existingKey) {
    info("Found ANTHROPIC_API_KEY in environment");
    envValues.ANTHROPIC_API_KEY = existingKey;
  } else {
    info("An Anthropic API key or Claude Code OAuth token is required.");
    info("Get a key at: https://console.anthropic.com/settings/keys");
    const apiKey = await promptSecret("ANTHROPIC_API_KEY");
    if (apiKey) {
      envValues.ANTHROPIC_API_KEY = apiKey;
    } else {
      warn("No API key provided. You can add it to .env later.");
    }
  }

  // ── Step 6: GitHub App Manifest flow ──────────────────────────────────
  if (!opts.skipGithub) {
    step("Setting up GitHub App");
    info("This creates a GitHub App via the manifest flow.");
    info("A browser window will open to complete the setup.");

    const proceed = await confirm("Create a GitHub App now?");
    if (proceed) {
      try {
        const result = await runManifestFlow({
          appName,
          webhookUrl: opts.webhookUrl,
          secretsDir,
          org: opts.org,
        });

        envValues.SYN_GITHUB_APP_ID = String(result.id);
        envValues.SYN_GITHUB_APP_NAME = result.slug;
        if (result.webhook_secret) {
          envValues.SYN_GITHUB_WEBHOOK_SECRET = result.webhook_secret;
        }
      } catch (err) {
        fail("GitHub App creation failed.");
        if (err instanceof Error) info(err.message);
        info("You can set up GitHub integration later with `syntropic137 init --skip-docker`.");
      }
    } else {
      info("Skipped. You can create a GitHub App later.");
    }
  }

  // ── Step 7: Write .env ────────────────────────────────────────────────
  step("Writing configuration");
  writeEnvFile(installDir, envValues, TEMPLATES_DIR);

  if (opts.skipDocker) {
    console.log();
    success("Templates written to " + installDir);
    info("Run `cd ${installDir} && docker compose -f docker-compose.syntropic137.yaml up -d` to start.");
    return;
  }

  // ── Step 8: Docker compose pull ───────────────────────────────────────
  step("Pulling container images");
  composePull(installDir);

  // ── Step 9: Docker compose up ─────────────────────────────────────────
  step("Starting services");
  composeUp(installDir);

  // ── Step 10: Health check ─────────────────────────────────────────────
  step("Health check");
  const port = envValues.SYN_GATEWAY_PORT || "8137";
  const healthy = await waitForHealth(port);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log();
  console.log(bold("  ─────────────────────────────────"));
  console.log();
  if (healthy) {
    console.log(`  ${green("Syntropic137 is running!")}`);
  } else {
    console.log(`  ${cyan("Syntropic137 is starting up...")}`);
  }
  console.log();
  console.log(`  Dashboard:  ${cyan(`http://localhost:${port}`)}`);
  console.log(`  Directory:  ${dim(installDir)}`);
  console.log();
  console.log(`  ${dim("Useful commands:")}`);
  console.log(`    syntropic137 status    ${dim("— container health")}`);
  console.log(`    syntropic137 logs      ${dim("— tail logs")}`);
  console.log(`    syntropic137 stop      ${dim("— stop the stack")}`);
  console.log(`    syntropic137 update    ${dim("— pull latest + restart")}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Template copy helper
// ---------------------------------------------------------------------------

function copyTemplate(relativePath: string, destDir: string): void {
  const src = path.join(TEMPLATES_DIR, relativePath);
  const dest = path.join(destDir, relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Subcommand routing
// ---------------------------------------------------------------------------

function resolveInstallDir(opts: CliOptions): string {
  const dir = opts.dir || DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    fail(`Install directory not found: ${dir}`);
    info("Run `npx syntropic137 init` first.");
    process.exit(1);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  switch (opts.command) {
    case "init":
      await runInit(opts);
      break;

    case "status":
      composeStatus(resolveInstallDir(opts));
      break;

    case "stop":
      composeStop(resolveInstallDir(opts));
      break;

    case "start":
      composeStart(resolveInstallDir(opts));
      break;

    case "logs":
      composeLogs(resolveInstallDir(opts));
      break;

    case "update":
      composeUpdate(resolveInstallDir(opts));
      break;
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
