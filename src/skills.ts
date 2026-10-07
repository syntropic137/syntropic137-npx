import { execFileSync } from "node:child_process";
import { info, success, warn, prompt, confirm } from "./ui.js";
import {
  SKILLS_REPO,
  SKILLS_CLI_PACKAGE,
  DEFAULT_SKILL_AGENTS,
  SKILL_AGENT_ID_RE,
  SKILLS_INSTALL_TIMEOUT_MS,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Agent skills install (harness-agnostic, via the `skills` CLI)
// ---------------------------------------------------------------------------

/** project: installs into the current directory. user: installs user-wide (`-g`). */
export type SkillsScope = "project" | "user";

/**
 * Parse a comma or space separated list of agent ids.
 *
 * Returns null if any id is not a plain lowercase slug. This is the only
 * user input that reaches the spawned argv, so it must never start with `-`
 * (which the skills CLI would read as a flag) or carry anything else.
 */
export function parseAgentList(input: string): string[] | null {
  const ids = input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) return null;
  if (!ids.every((id) => SKILL_AGENT_ID_RE.test(id))) return null;
  return [...new Set(ids)];
}

/** Map a scope answer to a scope. Anything unrecognised is project scope. */
export function parseScope(input: string): SkillsScope {
  const answer = input.trim().toLowerCase();
  return answer === "u" || answer === "user" || answer === "g" || answer === "global"
    ? "user"
    : "project";
}

/**
 * Build the argv passed to `npx`. Never a shell string: each element is one
 * argument, so nothing in it is interpreted by a shell.
 */
export function buildSkillsArgs(agents: readonly string[], scope: SkillsScope): string[] {
  const args = ["--yes", SKILLS_CLI_PACKAGE, "add", SKILLS_REPO, "--skill", "*"];
  for (const agent of agents) {
    args.push("-a", agent);
  }
  args.push("-y");
  if (scope === "user") args.push("-g");
  return args;
}

/** Copy-pasteable shell form of the same command, for the manual fallback. */
export function manualSkillsCommand(agents: readonly string[], scope: SkillsScope): string {
  const quoted = buildSkillsArgs(agents, scope).map((a) => (a === "*" ? "'*'" : a));
  return ["npx", ...quoted].join(" ");
}

/**
 * Run the skills CLI. Never throws: on any failure (npx missing, network,
 * non-zero exit, timeout) it warns, prints the manual command, and returns false.
 */
export function installSkills(
  agents: readonly string[],
  scope: SkillsScope,
  cwd: string = process.cwd(),
): boolean {
  const where = scope === "user" ? "user-wide" : `project ${cwd}`;
  info(`Installing Syntropic137 skills for ${agents.join(", ")} (${where})...`);
  try {
    execFileSync("npx", buildSkillsArgs(agents, scope), {
      cwd,
      stdio: "pipe",
      timeout: SKILLS_INSTALL_TIMEOUT_MS,
    });
    success("Agent skills installed");
    return true;
  } catch (err) {
    warn("Could not install agent skills. Setup will continue.");
    if (err instanceof Error) info(err.message);
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    if (stderr) info(stderr);
    info("Install manually: " + manualSkillsCommand(agents, scope));
    return false;
  }
}

/**
 * Interactive flow: optionally confirm, choose agents and scope, install.
 * Returns true only if skills were installed.
 */
export async function promptAndInstallSkills(opts: { askFirst: boolean }): Promise<boolean> {
  const defaultsCmd = manualSkillsCommand(DEFAULT_SKILL_AGENTS, "project");

  if (!process.stdout.isTTY) {
    info("Non-interactive session; skipping agent skills.");
    info("Install later: " + defaultsCmd);
    return false;
  }

  info("Adds Syntropic137 skills to your coding agents (Claude Code, Codex, and others).");

  if (opts.askFirst) {
    const proceed = await confirm("Install the Syntropic137 agent skills? (recommended)");
    if (!proceed) {
      info("Skipped. Install later: " + defaultsCmd);
      return false;
    }
  }

  let agents: string[] | null = null;
  for (let attempt = 0; attempt < 3 && !agents; attempt++) {
    const answer = await prompt(
      "Agents (comma separated, e.g. claude-code, codex, gemini-cli)",
      DEFAULT_SKILL_AGENTS.join(","),
    );
    agents = parseAgentList(answer);
    if (!agents) warn("Agent ids are lowercase letters, digits and hyphens, like claude-code.");
  }
  if (!agents) {
    info("Skipped. Install later: " + defaultsCmd);
    return false;
  }

  info(`Project scope installs into the current directory: ${process.cwd()}`);
  const scope = parseScope(
    await prompt("Scope: project, or user (user-wide, -g)", "project"),
  );

  return installSkills(agents, scope);
}
