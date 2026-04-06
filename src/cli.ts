#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { CliOptions, EnvValues } from "./types.js";
import {
  banner,
  setupOverview,
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
import { GitHubAppSetup, openBrowser } from "./manifest.js";
import {
  DEFAULT_INSTALL_DIR,
  DEFAULT_APP_NAME,
  DEFAULT_PORT,
  DEFAULT_APP_ENVIRONMENT,
  COMPOSE_FILE,
  TEMPLATE_FILES,
  CMD,
  BIN,
  COMMANDS,
  CLAUDE_PLUGIN_REPO,
  CLAUDE_PLUGIN_NAME,
  CLAUDE_PLUGIN_FULL,
  GITHUB_BASE,
  GITHUB_SLUG_RE,
} from "./constants.js";
import { PKG_DIR, TEMPLATES_DIR, syncTemplate } from "./templates.js";

// ---------------------------------------------------------------------------
// Version & paths
// ---------------------------------------------------------------------------

const _pkg = JSON.parse(
  fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf-8"),
);
const VERSION = _pkg.version as string;
const PLATFORM_VERSION: string = _pkg.syntropic137?.platformVersion ?? VERSION;

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
    let steps = 12;
    if (this.opts.skipGithub) steps -= 1;
    if (this.opts.skipDocker) steps -= 3;
    setTotalSteps(steps);

    // ── Pre-setup overview ─────────────────────────────────────────────
    setupOverview({
      skipGithub: this.opts.skipGithub ?? false,
      skipDocker: this.opts.skipDocker ?? false,
    });

    // Re-run safety: detect existing .env
    let reconfigure = false;
    if (this.config.exists()) {
      warn("Existing installation detected at " + this.installDir);
      const proceed = await confirm("Reconfigure from scratch?", false);
      if (!proceed) {
        if (this.opts.skipDocker) {
          info(`Docker steps skipped (--skip-docker). Run \`${CMD.start}\` to start the stack manually.`);
        } else {
          // Offer to just bring the stack up from existing config
          const startStack = await confirm("Start the stack from existing config?", true);
          if (startStack) {
            checkDocker();
            try {
              const docker = new DockerService(this.installDir);
              docker.start();
              await docker.waitForHealth();
            } catch (err) {
              warn("Could not start the stack.");
              if (err instanceof Error) info(err.message);
              info(`Restart manually: ${CMD.start}`);
            }
          } else {
            info(`Run \`${CMD.start}\` to start the stack, or \`${CMD.status}\` to check health.`);
          }
        }
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
      SYN_VERSION: PLATFORM_VERSION,
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
          if (org) {
            envValues.SYN_GITHUB_APP_ORG = org;
          }
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

    // ── Step 7: Claude Code plugin ───────────────────────────────────────
    step("Claude Code plugin");
    await this.installClaudePlugin();

    // ── Step 8: Syntropic137 CLI ─────────────────────────────────────────
    step("Syntropic137 CLI");
    await this.installCli();

    // ── Step 9: Write .env ──────────────────────────────────────────────
    step("Writing configuration");
    this.config.writeEnv(envValues, TEMPLATES_DIR);

    if (this.opts.skipDocker) {
      console.log();
      success("Templates written to " + this.installDir);
      info(`Run \`cd ${this.installDir} && docker compose -f ${COMPOSE_FILE} up -d\` to start.`);
      return;
    }

    // ── Steps 10–12: Docker ──────────────────────────────────────────────
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
    syncTemplate(TEMPLATES_DIR, this.installDir, relativePath);
  }

  private async installCli(): Promise<void> {
    if (!process.stdout.isTTY) return; // Skip in non-interactive/CI environments

    const targetRange = `~${PLATFORM_VERSION}`; // same major.minor, patch >= platform
    const installed = InitFlow.getInstalledCliVersion();

    if (installed) {
      // Version compatibility: major.minor must match; patch drift is allowed.
      // The NPX CLI can independently bump patch versions between platform releases.
      // Only major.minor alignment is enforced — see version-invariant docs.
      const [iMajor, iMinor] = installed.split(".").map(Number);
      const [pMajor, pMinor] = PLATFORM_VERSION.split(".").map(Number);
      if (iMajor === pMajor && iMinor === pMinor) {
        success(`syn CLI ${installed} (matches platform ${PLATFORM_VERSION})`);
        return;
      }
      warn(`syn CLI ${installed} does not match platform ${PLATFORM_VERSION}`);
      const proceed = await confirm(`Update to @syntropic137/cli@${targetRange}?`);
      if (!proceed) { info("Skipped."); return; }
    } else {
      info("The syn CLI lets you manage workflows, triggers, and executions.");
      const proceed = await confirm(`Install @syntropic137/cli@${targetRange}? (recommended)`);
      if (!proceed) {
        info("Skipped. Install later: npm install -g @syntropic137/cli");
        return;
      }
    }

    try {
      execFileSync("npm", ["install", "-g", `@syntropic137/cli@${targetRange}`], { stdio: "pipe" });
      success("syn CLI installed");
    } catch (err) {
      warn("Could not install syn CLI.");
      if (err instanceof Error) info(err.message);
      info(`Install manually: npm install -g @syntropic137/cli@${targetRange}`);
    }
  }

  /** Get installed syn CLI version, or null if not found. */
  static getInstalledCliVersion(): string | null {
    try {
      const output = execFileSync("syn", ["version"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      // Expected output like "0.19.7" or "syn-cli 0.19.7"
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private async installClaudePlugin(): Promise<void> {
    // Check if claude CLI is available
    if (!InitFlow.hasClaudeCli()) {
      info("Claude Code CLI not found — skipping plugin install.");
      info("Install later: " + CMD.plugin);
      return;
    }

    const installed = InitFlow.isPluginInstalled();
    info("Adds slash commands and platform knowledge to Claude Code.");

    if (installed) {
      const proceed = await confirm("Update the Claude Code plugin?");
      if (!proceed) { info("Skipped."); return; }
    } else {
      const proceed = await confirm("Install the Claude Code plugin? (recommended)");
      if (!proceed) {
        info("Skipped. Install later: " + CMD.plugin);
        return;
      }
    }

    InitFlow.syncPlugin(installed);
  }

  /** Check if `claude` CLI is on PATH. */
  static hasClaudeCli(): boolean {
    try {
      execFileSync("claude", ["--version"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if the syntropic137 plugin is already installed. */
  static isPluginInstalled(): boolean {
    try {
      const output = execFileSync("claude", ["plugin", "list"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      return output.includes(`${CLAUDE_PLUGIN_NAME}@`);
    } catch {
      return false;
    }
  }

  /** Install or update the Claude Code plugin. */
  static syncPlugin(isInstalled: boolean): void {
    try {
      if (isInstalled) {
        // Refresh marketplace clone first (claude plugin update doesn't do this automatically)
        try {
          execFileSync("claude", ["plugin", "marketplace", "update", CLAUDE_PLUGIN_NAME], { stdio: "pipe" });
        } catch (err) {
          warn("Could not refresh marketplace cache; attempting plugin update anyway.");
          if (err instanceof Error) info(err.message);
        }
        execFileSync("claude", ["plugin", "update", CLAUDE_PLUGIN_FULL], { stdio: "pipe" });
        success("Claude Code plugin updated");
      } else {
        execFileSync("claude", ["plugin", "marketplace", "add", CLAUDE_PLUGIN_REPO], { stdio: "pipe" });
        execFileSync("claude", ["plugin", "install", CLAUDE_PLUGIN_NAME], { stdio: "pipe" });
        success("Claude Code plugin installed");
      }
    } catch (err) {
      const action = isInstalled ? "update" : "install";
      warn(`Could not ${action} Claude Code plugin.`);
      if (err instanceof Error) info(err.message);
      info("Install manually: claude plugin marketplace add " + CLAUDE_PLUGIN_REPO);
    }
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

    const fromMenu = command === "menu";
    if (fromMenu) {
      command = await this.showMenu();
    }

    // Show banner on direct CLI invocations (menu already shows its own)
    if (!fromMenu) {
      banner(PLATFORM_VERSION);
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
        new DockerService(this.resolveDir(dir)).update(TEMPLATES_DIR);
        break;

      case "plugin":
        CLI.pluginSync();
        break;

      case "github-app":
        await this.githubApp(dir);
        break;

      case "tunnel":
        await this.tunnel(dir);
        break;

      case "cli":
        CLI.cliSync();
        break;
    }
  }

  private static cliSync(): void {
    const targetRange = `~${PLATFORM_VERSION}`;
    const installed = InitFlow.getInstalledCliVersion();

    if (installed) {
      // Major.minor compatibility only — patch drift is expected because the
      // NPX package may publish patch bumps independently of platform releases.
      // See version-invariant docs for the full policy.
      const [iMajor, iMinor] = installed.split(".").map(Number);
      const [pMajor, pMinor] = PLATFORM_VERSION.split(".").map(Number);
      if (iMajor === pMajor && iMinor === pMinor) {
        success(`syn CLI ${installed} (compatible with platform ${PLATFORM_VERSION})`);
        return;
      }
      warn(`syn CLI ${installed} is not compatible with platform ${PLATFORM_VERSION}`);
    }

    info(`Installing @syntropic137/cli@${targetRange}...`);
    try {
      execFileSync("npm", ["install", "-g", `@syntropic137/cli@${targetRange}`], { stdio: "pipe" });
      success("syn CLI installed");
    } catch (err) {
      fail("Could not install syn CLI.");
      if (err instanceof Error) info(err.message);
      const execErr = err as { stderr?: Buffer | string; stdout?: Buffer | string };
      const stderr = execErr.stderr?.toString().trim();
      const stdout = execErr.stdout?.toString().trim();
      if (stderr) info(stderr);
      if (stdout) info(stdout);
      info(`Install manually: npm install -g @syntropic137/cli@${targetRange}`);
      process.exit(1);
    }
  }

  private static pluginSync(): void {
    if (!InitFlow.hasClaudeCli()) {
      fail("Claude Code CLI not found.");
      info("Install Claude Code: https://docs.anthropic.com/en/docs/claude-code");
      process.exit(1);
    }

    const installed = InitFlow.isPluginInstalled();
    InitFlow.syncPlugin(installed);
  }

  // ── GitHub App management ────────────────────────────────────────────

  private async githubApp(dir: string): Promise<void> {
    const installDir = this.resolveDir(dir);
    const config = new ConfigManager(installDir);
    const env = config.readEnv();
    const slug = env.SYN_GITHUB_APP_NAME;

    if (!slug) {
      fail("No GitHub App configured.");
      info(`Run \`${CMD.init}\` to create one, or set SYN_GITHUB_APP_NAME in .env.`);
      process.exit(1);
    }

    if (!GITHUB_SLUG_RE.test(slug)) {
      fail(`Invalid GitHub App slug: ${slug}`);
      process.exit(1);
    }

    const org = this.opts.org || env.SYN_GITHUB_APP_ORG;
    if (org && !GITHUB_SLUG_RE.test(org)) {
      fail(`Invalid GitHub org name: ${org}`);
      process.exit(1);
    }

    const settingsBase = org
      ? `${GITHUB_BASE}/organizations/${org}/settings/apps/${slug}`
      : `${GITHUB_BASE}/settings/apps/${slug}`;
    const pages: MenuItem[] = [
      { label: "General settings",  value: settingsBase,                  description: "Logo, name, description, callback URLs" },
      { label: "Permissions",       value: `${settingsBase}/permissions`, description: "Repository and org permissions" },
      { label: "Installations",     value: `${GITHUB_BASE}/apps/${slug}/installations/new`, description: "Add or manage repo access" },
    ];

    info(`GitHub App: ${bold(slug)}`);
    console.log();

    const url = await interactiveMenu(pages, "What would you like to open?");
    console.log();
    info(`Opening ${cyan(url)}`);
    openBrowser(url);
  }

  // ── Tunnel setup ─────────────────────────────────────────────────────

  private async tunnel(dir: string): Promise<void> {
    const installDir = this.resolveDir(dir);
    const config = new ConfigManager(installDir);

    console.log();
    info(bold("Remote Access Setup"));
    console.log();
    info("A tunnel exposes your local Syntropic137 instance to the internet,");
    info("enabling GitHub webhooks and full event coverage (60+ event types).");
    info(`Without a tunnel, only ${bold("17")} event types work (via polling).`);
    console.log();

    const providers: MenuItem[] = [
      {
        label: "Cloudflare Tunnel",
        value: "cloudflare",
        description: "Free, production-ready (recommended)",
      },
      {
        label: "Tailscale Funnel",
        value: "tailscale",
        description: "Coming soon",
      },
      {
        label: "ngrok",
        value: "ngrok",
        description: "Coming soon",
      },
    ];

    const provider = await interactiveMenu(providers, "Choose a tunnel provider:");
    console.log();

    if (provider !== "cloudflare") {
      info(`${bold(providers.find((p) => p.value === provider)!.label)} support is not yet available.`);
      info("Track progress at the linked GitHub issue.");
      info(`In the meantime, use ${cyan("Cloudflare Tunnel")} (free tier available).`);
      return;
    }

    // ── Cloudflare Tunnel flow ──────────────────────────────────────────
    info(bold("Cloudflare Tunnel Setup"));
    console.log();
    info("Prerequisites:");
    info("  1. A Cloudflare account (free tier works)");
    info("  2. A domain added to Cloudflare DNS");
    info("  3. A tunnel created via the Cloudflare dashboard or CLI");
    console.log();
    info("Create a tunnel: https://one.dash.cloudflare.com → Networks → Tunnels");
    info("Point it to: http://syn-gateway:8137 (internal Docker service)");
    console.log();

    const token = await promptSecret("Cloudflare Tunnel token");
    if (!token) {
      warn("No token provided. You can set CLOUDFLARE_TUNNEL_TOKEN in .env later.");
      return;
    }

    const hostname = await prompt("Public hostname (e.g. syn.example.com)");
    if (!hostname) {
      warn("No hostname provided. You can set SYN_PUBLIC_HOSTNAME in .env later.");
      return;
    }

    // Read existing .env values, merge tunnel config, and rewrite
    const env = config.readEnv();
    const existingProfiles = (env.COMPOSE_PROFILES ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (!existingProfiles.includes("tunnel")) existingProfiles.push("tunnel");
    env.COMPOSE_PROFILES = existingProfiles.join(",");
    env.CLOUDFLARE_TUNNEL_TOKEN = token;
    env.SYN_PUBLIC_HOSTNAME = hostname;
    config.writeEnv(env as EnvValues, TEMPLATES_DIR);

    console.log();
    success("Tunnel configuration saved");
    info(`  COMPOSE_PROFILES=tunnel`);
    info(`  SYN_PUBLIC_HOSTNAME=${hostname}`);
    console.log();

    // Offer to restart the stack so the tunnel container starts
    const restart = await confirm("Restart the stack now to activate the tunnel?");
    if (restart) {
      try {
        const docker = new DockerService(installDir);
        docker.stop();
        docker.start();
        success("Stack restarted with tunnel enabled");
      } catch (err) {
        warn("Could not restart the stack.");
        if (err instanceof Error) info(err.message);
        info(`Restart manually: ${CMD.start}`);
      }
    } else {
      info(`Restart when ready: ${CMD.start}`);
    }

    console.log();
    info(bold("Next steps:"));
    info(`  1. Verify the tunnel: open ${cyan(`https://${hostname}`)}`);
    info(`  2. Update your GitHub App webhook URL to ${cyan(`https://${hostname}/api/v1/github/webhooks`)}`);
    info(`  3. Run ${cyan(CMD["github-app"])} to open GitHub App settings`);
  }

  // ── Interactive menu ──────────────────────────────────────────────────

  private async showMenu(): Promise<CliOptions["command"]> {
    banner(PLATFORM_VERSION);
    // Flair target = subtitle line in banner. From the save point (after title+blank),
    // count up: blank(1) + title(1) + blank-after-banner(1) + bottom-border(1) + url(1) + subtitle(1) = 6
    const flairLinesAboveSave = 6;
    const menuItems: MenuItem[] = COMMANDS.map((c) => ({
      label: c.name,
      value: c.name,
      description: c.description,
    }));
    const choice = await interactiveMenu(
      menuItems,
      "What would you like to do?",
      { linesAboveSave: flairLinesAboveSave, col: 5 },
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

    const subcommands = ["init", "status", "stop", "start", "logs", "update", "plugin", "github-app", "tunnel", "cli", "help"] as const;
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
    // Build usage lines dynamically from COMMANDS
    const usageLines = COMMANDS.map((c) => {
      const cmd = `${BIN} ${c.name}${c.args ? " " + c.args : ""}`;
      return `    ${cmd.padEnd(34)}${c.description}`;
    }).join("\n");

    console.log(`
  ${bold("syntropic137")} v${VERSION} — self-host setup CLI

  ${bold("USAGE")}
    ${BIN.padEnd(34)}Interactive menu
${usageLines}

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

// Guard: skip auto-run when loaded as a module (e.g. vitest).
// When run via npx, argv[1] is the bin symlink (e.g. .bin/syntropic137),
// not cli.js — so we check for both.
const entryArg = process.argv[1] ?? "";
const isDirectRun =
  entryArg.endsWith("cli.js") || entryArg.endsWith("syntropic137");
if (isDirectRun) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
