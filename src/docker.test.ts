import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseComposeVersion, checkDocker } from "./docker.js";

// Mock UI to silence output
vi.mock("./ui.js", () => ({
  fail: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";

const mockExecFileSync = vi.mocked(execFileSync);

describe("parseComposeVersion", () => {
  it("parses standard version string", () => {
    expect(parseComposeVersion("Docker Compose version v2.29.1")).toEqual([2, 29, 1]);
  });

  it("parses without v prefix", () => {
    expect(parseComposeVersion("Docker Compose version 2.20.0")).toEqual([2, 20, 0]);
  });

  it("returns null for garbage input", () => {
    expect(parseComposeVersion("not a version")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseComposeVersion("")).toBeNull();
  });

  it("handles single-digit versions", () => {
    expect(parseComposeVersion("v2.0.0")).toEqual([2, 0, 0]);
  });

  it("handles large version numbers", () => {
    expect(parseComposeVersion("v2.100.33")).toEqual([2, 100, 33]);
  });
});

describe("checkDocker", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("succeeds with Compose v2.20+", () => {
    mockExecFileSync.mockImplementation((_cmd: string, args?: readonly string[], opts?: unknown) => {
      if (args?.[0] === "info") return Buffer.from("");
      // When encoding is specified, execFileSync returns a string
      if (args?.[0] === "compose") return "Docker Compose version v2.29.1";
      return Buffer.from("");
    });

    expect(() => checkDocker()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits when docker info fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("docker not found");
    });

    expect(() => checkDocker()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when Compose version is below 2.20", () => {
    mockExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.[0] === "info") return Buffer.from("");
      if (args?.[0] === "compose") return "Docker Compose version v2.19.0";
      return Buffer.from("");
    });

    expect(() => checkDocker()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when Compose plugin is missing", () => {
    let callCount = 0;
    mockExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Buffer.from(""); // docker info succeeds
      throw new Error("compose not found"); // docker compose version fails
    });

    expect(() => checkDocker()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
