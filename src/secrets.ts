import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { success, info } from "./ui.js";

/** Secret files to generate during init. */
const SECRET_FILES = [
  "db-password.secret",
  "redis-password.secret",
  "minio-password.secret",
] as const;

/**
 * Generate cryptographically random secret files in the given directory.
 * Each file contains a 32-byte hex string (64 chars).
 * Files are chmod 600 (owner read/write only).
 *
 * @param force - When true, regenerate all secrets even if they already exist.
 *                Old secrets are backed up to `<name>.bak` before overwriting
 *                so the user can roll back if needed (e.g., database still
 *                holds the old password).
 */
export function generateSecrets(secretsDir: string, force = false): void {
  fs.mkdirSync(secretsDir, { recursive: true });

  for (const filename of SECRET_FILES) {
    const filePath = path.join(secretsDir, filename);
    if (fs.existsSync(filePath)) {
      if (!force) {
        info(`  ${filename} already exists, skipping`);
        continue;
      }
      // Back up the old secret before overwriting
      const bakPath = filePath + ".bak";
      fs.copyFileSync(filePath, bakPath);
      fs.chmodSync(bakPath, 0o600);
      info(`  Backed up ${filename} → ${filename}.bak`);
    }
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(filePath, secret, { mode: 0o600 });
    success(`Generated ${filename}`);
  }

  // Create empty PEM placeholder so Docker secrets don't fail
  const pemPath = path.join(secretsDir, "github-app-private-key.pem");
  if (!fs.existsSync(pemPath)) {
    fs.writeFileSync(pemPath, "", { mode: 0o600 });
  }
}

/**
 * Save a GitHub App private key PEM file.
 */
export function savePem(secretsDir: string, pem: string): string {
  const pemPath = path.join(secretsDir, "github-app-private-key.pem");
  fs.writeFileSync(pemPath, pem, { mode: 0o600 });
  success("Saved github-app-private-key.pem");
  return pemPath;
}

/**
 * Save a webhook secret to a text file.
 */
export function saveWebhookSecret(secretsDir: string, secret: string): void {
  const filePath = path.join(secretsDir, "github-webhook-secret.txt");
  fs.writeFileSync(filePath, secret, { mode: 0o600 });
}

/**
 * Save a client secret to a text file.
 */
export function saveClientSecret(secretsDir: string, secret: string): void {
  const filePath = path.join(secretsDir, "github-client-secret.txt");
  fs.writeFileSync(filePath, secret, { mode: 0o600 });
}
