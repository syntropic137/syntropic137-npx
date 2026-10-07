import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Mocks: no network, no real subprocess, no real prompts
// ---------------------------------------------------------------------------

vi.mock("./ui.js", () => ({
  banner: vi.fn(),
  setupOverview: vi.fn(),
  summaryBox: vi.fn(),
  step: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  fail: vi.fn(),
  warn: vi.fn(),
  bold: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  green: (s: string) => s,
  yellow: (s: string) => s,
  // Accept the default for every prompt unless a test overrides it.
  prompt: vi.fn((_q: string, d?: string) => Promise.resolve(d ?? "")),
  promptSecret: vi.fn().mockResolvedValue(""),
  confirm: vi.fn().mockResolvedValue(true),
  interactiveMenu: vi.fn(),
  setTotalSteps: vi.fn(),
}));

vi.mock("./docker.js", () => ({
  checkDocker: vi.fn(),
  DockerService: vi.fn(),
}));

vi.mock("./manifest.js", () => ({
  GitHubAppSetup: vi.fn(),
  openBrowser: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(Buffer.from("")),
  execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

vi.mock("./templates.js", async () => {
  const actual = await vi.importActual<typeof import("./templates.js")>("./templates.js");
  return {
    ...actual,
    syncTemplate: vi.fn().mockImplementation(
      (_tplDir: string, installDir: string, relativePath: string) => {
        const dest = path.join(installDir, relativePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, "");
      },
    ),
  };
});

import {
  buildSkillsArgs,
  installSkills,
  manualSkillsCommand,
  parseAgentList,
  parseScope,
  promptAndInstallSkills,
} from "./skills.js";
import { prompt, confirm, warn, info } from "./ui.js";
import { runInit } from "./cli.js";
import { SKILLS_CLI_PACKAGE, SKILLS_REPO } from "./constants.js";

const mockExec = vi.mocked(execFileSync);

/** All npx invocations, as [file, argv] pairs. */
function npxCalls(): Array<[string, readonly string[]]> {
  return mockExec.mock.calls
    .filter((c) => c[0] === "npx")
    .map((c) => [c[0], c[1] as readonly string[]]);
}

let tmpDir: string;
let originalIsTTY: boolean | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockReturnValue(Buffer.from(""));
  tmpDir = path.join(os.tmpdir(), `s137-skills-test-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Exact argv
// ---------------------------------------------------------------------------

describe("buildSkillsArgs", () => {
  it("default agents, project scope: no -g", () => {
    expect(buildSkillsArgs(["claude-code", "codex"], "project")).toEqual([
      "--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
      "--skill", "*", "-a", "claude-code", "-a", "codex", "-y",
    ]);
  });

  it("default agents, user scope: ends with -g", () => {
    expect(buildSkillsArgs(["claude-code", "codex"], "user")).toEqual([
      "--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
      "--skill", "*", "-a", "claude-code", "-a", "codex", "-y", "-g",
    ]);
  });

  it("single other agent, project scope", () => {
    expect(buildSkillsArgs(["gemini-cli"], "project")).toEqual([
      "--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
      "--skill", "*", "-a", "gemini-cli", "-y",
    ]);
  });

  it("pins the skills CLI to an exact version", () => {
    expect(SKILLS_CLI_PACKAGE).toMatch(/^skills@\d+\.\d+\.\d+$/);
  });
});

describe("manualSkillsCommand", () => {
  it("quotes the glob so a shell does not expand it", () => {
    expect(manualSkillsCommand(["claude-code", "codex"], "user")).toBe(
      `npx --yes ${SKILLS_CLI_PACKAGE} add ${SKILLS_REPO} --skill '*' -a claude-code -a codex -y -g`,
    );
  });
});

describe("parseAgentList", () => {
  it("accepts comma and space separated ids, deduplicated", () => {
    expect(parseAgentList("claude-code, codex gemini-cli,codex")).toEqual([
      "claude-code", "codex", "gemini-cli",
    ]);
  });

  it.each([["-g"], ["--global"], ["codex;rm -rf ~"], ["$(id)"], ["Claude"], [""], [" , "]])(
    "rejects %j",
    (input) => {
      expect(parseAgentList(input)).toBeNull();
    },
  );
});

describe("parseScope", () => {
  it.each([["user"], ["u"], ["g"], ["global"], [" USER "]])("%j is user scope", (input) => {
    expect(parseScope(input)).toBe("user");
  });

  it.each([["project"], ["p"], [""], ["something else"]])("%j is project scope", (input) => {
    expect(parseScope(input)).toBe("project");
  });
});

// ---------------------------------------------------------------------------
// Spawned argv through the interactive flow
// ---------------------------------------------------------------------------

describe("promptAndInstallSkills spawns the exact argv", () => {
  it("defaults: claude-code + codex, project scope, cwd, no shell", async () => {
    expect(await promptAndInstallSkills({ askFirst: true })).toBe(true);
    expect(npxCalls()).toEqual([[
      "npx",
      ["--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
        "--skill", "*", "-a", "claude-code", "-a", "codex", "-y"],
    ]]);
    const opts = mockExec.mock.calls[0]![2] as { cwd?: string; shell?: unknown };
    expect(opts.cwd).toBe(process.cwd());
    expect(opts.shell).toBeUndefined();
  });

  it("user scope only when chosen: adds -g", async () => {
    vi.mocked(prompt)
      .mockResolvedValueOnce("claude-code,codex")
      .mockResolvedValueOnce("user");
    await promptAndInstallSkills({ askFirst: true });
    expect(npxCalls()[0]![1]).toEqual([
      "--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
      "--skill", "*", "-a", "claude-code", "-a", "codex", "-y", "-g",
    ]);
  });

  it("other agents, project scope", async () => {
    vi.mocked(prompt)
      .mockResolvedValueOnce("gemini-cli, cursor")
      .mockResolvedValueOnce("project");
    await promptAndInstallSkills({ askFirst: true });
    expect(npxCalls()[0]![1]).toEqual([
      "--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
      "--skill", "*", "-a", "gemini-cli", "-a", "cursor", "-y",
    ]);
  });

  it("re-prompts on an invalid agent id and never spawns it", async () => {
    vi.mocked(prompt)
      .mockResolvedValueOnce("-g")
      .mockResolvedValueOnce("codex")
      .mockResolvedValueOnce("project");
    await promptAndInstallSkills({ askFirst: true });
    expect(npxCalls()[0]![1]).toEqual([
      "--yes", "skills@1.7.0", "add", "syntropic137/syntropic137-skills",
      "--skill", "*", "-a", "codex", "-y",
    ]);
  });

  it("declining spawns nothing", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);
    expect(await promptAndInstallSkills({ askFirst: true })).toBe(false);
    expect(npxCalls()).toEqual([]);
  });

  it("non-interactive session spawns nothing", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(await promptAndInstallSkills({ askFirst: true })).toBe(false);
    expect(npxCalls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Failure never fails setup
// ---------------------------------------------------------------------------

describe("skills install failure", () => {
  it("installSkills returns false, warns, and prints the manual command", () => {
    mockExec.mockImplementation(() => {
      throw new Error("spawn npx ENOENT");
    });
    expect(installSkills(["claude-code", "codex"], "project")).toBe(false);
    expect(vi.mocked(warn)).toHaveBeenCalled();
    expect(vi.mocked(info)).toHaveBeenCalledWith(
      "Install manually: " + manualSkillsCommand(["claude-code", "codex"], "project"),
    );
  });

  it("a failing skills install does not fail init: setup completes and .env is written", async () => {
    mockExec.mockImplementation((file: string) => {
      if (file === "npx") throw new Error("npx skills exited with code 1");
      return Buffer.from("");
    });
    await expect(
      runInit({ command: "init", dir: tmpDir, skipDocker: true, skipGithub: true }),
    ).resolves.toBeUndefined();
    expect(npxCalls()).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, ".env"))).toBe(true);
    expect(vi.mocked(info)).toHaveBeenCalledWith(
      "Install manually: " + manualSkillsCommand(["claude-code", "codex"], "project"),
    );
  });
});
