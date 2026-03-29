import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { generateSecrets, savePem, saveWebhookSecret, saveClientSecret } from "./secrets.js";

// Mock UI to silence output
vi.mock("./ui.js", () => ({
  success: vi.fn(),
  info: vi.fn(),
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `s137-secrets-test-${crypto.randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateSecrets", () => {
  it("creates all three secret files", () => {
    generateSecrets(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "db-password.secret"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "redis-password.secret"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "minio-password.secret"))).toBe(true);
  });

  it("files contain 64-char hex strings", () => {
    generateSecrets(tmpDir);

    for (const name of ["db-password.secret", "redis-password.secret", "minio-password.secret"]) {
      const content = fs.readFileSync(path.join(tmpDir, name), "utf-8");
      expect(content).toHaveLength(64);
      expect(content).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("sets mode 0o600 on files", () => {
    generateSecrets(tmpDir);

    for (const name of ["db-password.secret", "redis-password.secret", "minio-password.secret"]) {
      const stat = fs.statSync(path.join(tmpDir, name));
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("does not overwrite existing files", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const existing = path.join(tmpDir, "db-password.secret");
    fs.writeFileSync(existing, "keep-this-value");

    generateSecrets(tmpDir);

    expect(fs.readFileSync(existing, "utf-8")).toBe("keep-this-value");
  });

  it("creates empty PEM placeholder", () => {
    generateSecrets(tmpDir);

    const pemPath = path.join(tmpDir, "github-app-private-key.pem");
    expect(fs.existsSync(pemPath)).toBe(true);
    expect(fs.readFileSync(pemPath, "utf-8")).toBe("");
  });

  it("creates secrets dir if it does not exist", () => {
    const nested = path.join(tmpDir, "deep", "secrets");
    generateSecrets(nested);

    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(path.join(nested, "db-password.secret"))).toBe(true);
  });
});

describe("savePem", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("writes PEM content and returns path", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----";
    const result = savePem(tmpDir, pem);

    expect(result).toBe(path.join(tmpDir, "github-app-private-key.pem"));
    expect(fs.readFileSync(result, "utf-8")).toBe(pem);
  });

  it("sets mode 0o600", () => {
    savePem(tmpDir, "test");
    const stat = fs.statSync(path.join(tmpDir, "github-app-private-key.pem"));
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("saveWebhookSecret", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("writes to github-webhook-secret.txt", () => {
    saveWebhookSecret(tmpDir, "wh-secret-123");
    const content = fs.readFileSync(path.join(tmpDir, "github-webhook-secret.txt"), "utf-8");
    expect(content).toBe("wh-secret-123");
  });
});

describe("saveClientSecret", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("writes to github-client-secret.txt", () => {
    saveClientSecret(tmpDir, "client-secret-456");
    const content = fs.readFileSync(path.join(tmpDir, "github-client-secret.txt"), "utf-8");
    expect(content).toBe("client-secret-456");
  });
});
