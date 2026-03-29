#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliOptions, EnvValues } from "./types.js";
import {
  banner,
  summaryBox,
  step,
  info,
  success,
  fail,
  warn,
  bold,
  cyan,
  dim,
  prompt,
  promptSecret,
  confirm,
  setTotalSteps,
  interactiveMenu,
} from "./ui.js";
import type { MenuItem } from "./ui.js";
import { checkDocker, DockerService } from "./docker.js";
import { SecretsManager } from "./secrets.js";
import { ConfigManager } from "./config.js";
import { GitHubAppSetup } from "./manifest.js";
import {
  DEFAULT_INSTALL_DIR,
  DEFAULT_APP_NAME,
  DEFAULT_PORT,
  DEFAULT_APP_ENVIRONMENT,
  DEFAULT_VERSION,
  COMPOSE_FILE,
  TEMPLATE_FILES,
  CMD,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Version & paths
// ---------------------------------------------------------------------------

const PKG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf-8"),
).version as string;

const TEMPLATES_DIR = path.join(PKG_DIR, "templates");

// ---------------------------------------------------------------------------
// InitFlow — orchestrates the 10-step first-run setup
// ---------------------------------------------------------------------------

export class InitFlow {
  private readonly installDir: string;
  private readonly secretsDir: string;
  private readonly appName: string;
  private readonly config: ConfigManager;
  private readonly secrets: SecretsManager;

  constructor(private readonly opts: CliOptions) {
    this.installDir = opts.dir || DEFAULT_INSTALL_DIR;
    this.secretsDir = path.join(this.installDir, "secrets");
    this.appName = opts.name || DEFAULT_APP_NAME;
    this.config = new ConfigManager(this.installDir);
    this.secrets = new SecretsManager(this.secretsDir);
  }

  async run(): Promise<void> {
    banner();

    let steps = 10;
    if (this.opts.skipGithub) steps -= 1;
    if (this.opts.skipDocker) steps -= 3;
    setTotalSteps(steps);

    // Re-run safety: detect existing .env
    let reconfigure = false;
    if (this.config.exists()) {
      warn("Existing installation detected at " + this.installDir);
      const proceed = await confirm("Reconfigure from scratch?", false);
      if (!proceed) {
        info(`Skipping. Run \`${CMD.status}\` to check your stack.`);
        return;
      }
      reconfigure = true;

      // Tear down the old stack (including volumes) so the DB reinitializes
      // with fresh secrets. Old secrets are backed up to .bak files.
      if (!this.opts.skipDocker) {
        info("Stopping existing stack and removing volumes...");
        try {
          new DockerService(this.installDir).downWithVolumes();
          success("Old stack torn down");
        } catch {
          warn("Could not tear down old stack (may not be running). Continuing...");
        }
      }
    }

    // ── Step 1: Check Docker ────────────────────────────────────────────
    step("Checking Docker");
    if (!this.opts.skipDocker) {
      checkDocker();
    } else {
      info("Skipped (--skip-docker)");
    }

    // ── Step 2: Create directories ──────────────────────────────────────
    step("Creating install directory");
    fs.mkdirSync(this.installDir, { recursive: true });
    fs.mkdirSync(path.join(this.installDir, "init-db"), { recursive: true });
    fs.mkdirSync(path.join(this.installDir, "workspaces"), { recursive: true });
    success(this.installDir);

    // ── Step 3: Copy templates ──────────────────────────────────────────
    step("Copying templates");
    for (const tpl of TEMPLATE_FILES) {
      this.copyTemplate(tpl);
    }
    fs.chmodSync(path.join(this.installDir, "selfhost-entrypoint.sh"), 0o755);
    success("Templates copied");

    // ── Step 4: Generate secrets ────────────────────────────────────────
    step("Generating secrets");
    this.secrets.generate(reconfigure);

    // ── Step 5: Prompt for API key ──────────────────────────────────────
    step("Configuring LLM provider");
    const envValues: EnvValues = {
      APP_ENVIRONMENT: DEFAULT_APP_ENVIRONMENT,
      SYN_VERSION: DEFAULT_VERSION,
    };

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

    // ── Step 6: GitHub App Manifest flow ────────────────────────────────
    if (!this.opts.skipGithub) {
      step("Setting up GitHub App");
      console.log();
      info("This creates a GitHub App so Syntropic137 can interact with your repos.");
      info("A browser window will open — approve the app, then return here.");
      console.log();

      const proceed = await confirm("Create a GitHub App now?");
      if (proceed) {
        // Determine org scope
        let org = this.opts.org;
        if (!org) {
          const orgAnswer = await prompt(
            "GitHub org name (leave empty for personal account)",
          );
          if (orgAnswer) org = orgAnswer;
        }

        try {
          const setup = new GitHubAppSetup({
            appName: this.appName,
            webhookUrl: this.opts.webhookUrl,
            secretsDir: this.secretsDir,
            org,
          });
          const result = await setup.run();

          envValues.SYN_GITHUB_APP_ID = String(result.id);
          envValues.SYN_GITHUB_APP_NAME = result.slug;
          if (result.webhook_secret) {
            envValues.SYN_GITHUB_WEBHOOK_SECRET = result.webhook_secret;
          }
        } catch (err) {
          fail("GitHub App creation failed.");
          if (err instanceof Error) info(err.message);
          info(`You can set up GitHub integration later with \`${CMD.skipDocker}\`.`);
        }
      } else {
        info("Skipped. You can create a GitHub App later.");
      }
    }

    // ── Step 7: Write .env ──────────────────────────────────────────────
    step("Writing configuration");
    this.config.writeEnv(envValues, TEMPLATES_DIR);

    if (this.opts.skipDocker) {
      console.log();
      success("Templates written to " + this.installDir);
      info(`Run \`cd ${this.installDir} && docker compose -f ${COMPOSE_FILE} up -d\` to start.`);
      return;
    }

    // ── Steps 8–10: Docker ──────────────────────────────────────────────
    const docker = new DockerService(this.installDir);

    step("Pulling container images");
    docker.pull();

    step("Starting services");
    docker.up();

    step("Health check");
    const port = envValues.SYN_GATEWAY_PORT || DEFAULT_PORT;
    const healthy = await docker.waitForHealth(port);

    // ── Summary ─────────────────────────────────────────────────────────
    summaryBox({ healthy, port, installDir: this.installDir });
  }

  // ── Private ───────────────────────────────────────────────────────────

  private copyTemplate(relativePath: string): void {
    const src = path.join(TEMPLATES_DIR, relativePath);
    const dest = path.join(this.installDir, relativePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ---------------------------------------------------------------------------
// CLI — arg parsing and command routing
// ---------------------------------------------------------------------------

export class CLI {
  private readonly opts: CliOptions;

  constructor(argv: string[]) {
    this.opts = CLI.parseArgs(argv);
  }

  async run(): Promise<void> {
    let command = this.opts.command;

    if (command === "menu") {
      command = await this.showMenu();
    }

    const dir = this.opts.dir || DEFAULT_INSTALL_DIR;

    switch (command) {
      case "init":
        await new InitFlow(this.opts).run();
        break;

      case "status":
        new DockerService(this.resolveDir(dir)).status();
        break;

      case "stop":
        new DockerService(this.resolveDir(dir)).stop();
        break;

      case "start":
        new DockerService(this.resolveDir(dir)).start();
        break;

      case "logs":
        new DockerService(this.resolveDir(dir)).logs();
        break;

      case "update":
        new DockerService(this.resolveDir(dir)).update();
        break;
    }
  }

  // ── Interactive menu ──────────────────────────────────────────────────

  private static readonly MENU_ITEMS: MenuItem[] = [
    { label: "init",    value: "init",   description: "Bootstrap a new Syntropic137 stack" },
    { label: "status",  value: "status", description: "Show container health" },
    { label: "start",   value: "start",  description: "Start the stack" },
    { label: "stop",    value: "stop",   description: "Stop the stack" },
    { label: "logs",    value: "logs",   description: "Tail container logs" },
    { label: "update",  value: "update", description: "Pull latest images and restart" },
  ];

  private async showMenu(): Promise<CliOptions["command"]> {
    banner();
    info(`v${VERSION}`);
    console.log();
    const choice = await interactiveMenu(
      CLI.MENU_ITEMS,
      "What would you like to do?",
    );
    console.log();
    return choice as CliOptions["command"];
  }

  // ── Arg parsing ───────────────────────────────────────────────────────

  static parseArgs(argv: string[]): CliOptions {
    const args = argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
      CLI.printHelp();
      process.exit(0);
    }
    if (args.includes("--version") || args.includes("-v")) {
      console.log(VERSION);
      process.exit(0);
    }

    const subcommands = ["init", "status", "stop", "start", "logs", "update", "help"] as const;
    type Subcommand = (typeof subcommands)[number];
    const firstArg = args[0];
    let command: CliOptions["command"] = "menu";

    if (firstArg && subcommands.includes(firstArg as Subcommand)) {
      if (firstArg === "help") {
        CLI.printHelp();
        process.exit(0);
      }
      command = firstArg as Subcommand;
    }

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

  private static printHelp(): void {
    console.log(`
  ${bold("syntropic137")} v${VERSION} — self-host setup CLI

  ${bold("USAGE")}
    ${CMD.init} [options]     Bootstrap a Syntropic137 stack
    ${CMD.status}             Show container health
    ${CMD.stop}               Stop the stack
    ${CMD.start}              Start the stack
    ${CMD.logs}               Tail container logs
    ${CMD.update}             Pull latest images and restart

  ${bold("OPTIONS")}
    --org <name>          GitHub org for the app (default: personal)
    --name <app-name>     GitHub App name (default: ${DEFAULT_APP_NAME})
    --dir <path>          Install directory (default: ~/.syntropic137)
    --skip-github         Skip GitHub App creation
    --skip-docker         Skip Docker pull/up (templates only)
    --webhook-url <url>   Webhook URL for the GitHub App
    -h, --help            Show this help
    -v, --version         Show version
`);
  }

  private resolveDir(dir: string): string {
    if (!fs.existsSync(dir)) {
      fail(`Install directory not found: ${dir}`);
      info(`Run \`${CMD.init}\` first.`);
      process.exit(1);
    }
    return dir;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible exports (used by tests)
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): CliOptions {
  return CLI.parseArgs(argv);
}

export async function runInit(opts: CliOptions): Promise<void> {
  return new InitFlow(opts).run();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await new CLI(process.argv).run();
}

// Guard: skip auto-run when loaded as a module (e.g. vitest)
const isDirectRun = process.argv[1]?.endsWith("cli.js") ?? false;
if (isDirectRun) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
