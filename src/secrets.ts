import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { success, info } from "./ui.js";
import {
  SECRET_FILES,
  PEM_FILE,
  WEBHOOK_SECRET_FILE,
  CLIENT_SECRET_FILE,
} from "./constants.js";

/**
 * Manages cryptographic secrets for a Syntropic137 installation.
 *
 * Each instance is bound to a specific secrets directory and provides
 * methods to generate, save, and back up secret files.
 */
export class SecretsManager {
  constructor(private readonly secretsDir: string) {}

  /**
   * Generate cryptographically random secret files.
   * Each file contains a 32-byte hex string (64 chars), chmod 600.
   *
   * @param force — regenerate all secrets even if they exist;
   *                old values are backed up to `<name>.bak`.
   */
  generate(force = false): void {
    fs.mkdirSync(this.secretsDir, { recursive: true });

    for (const filename of SECRET_FILES) {
      const filePath = path.join(this.secretsDir, filename);
      if (fs.existsSync(filePath)) {
        if (!force) {
          info(`  ${filename} already exists, skipping`);
          continue;
        }
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
    const pemPath = path.join(this.secretsDir, PEM_FILE);
    if (!fs.existsSync(pemPath)) {
      fs.writeFileSync(pemPath, "", { mode: 0o600 });
    }
  }

  /** Save a GitHub App private key PEM file. Returns the file path. */
  savePem(pem: string): string {
    const pemPath = path.join(this.secretsDir, PEM_FILE);
    fs.writeFileSync(pemPath, pem, { mode: 0o600 });
    success(`Saved ${PEM_FILE}`);
    return pemPath;
  }

  /** Save a webhook secret to a text file. */
  saveWebhookSecret(secret: string): void {
    const filePath = path.join(this.secretsDir, WEBHOOK_SECRET_FILE);
    fs.writeFileSync(filePath, secret, { mode: 0o600 });
  }

  /** Save a client secret to a text file. */
  saveClientSecret(secret: string): void {
    const filePath = path.join(this.secretsDir, CLIENT_SECRET_FILE);
    fs.writeFileSync(filePath, secret, { mode: 0o600 });
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible free functions (delegate to a one-off instance)
// ---------------------------------------------------------------------------

export function generateSecrets(secretsDir: string, force = false): void {
  new SecretsManager(secretsDir).generate(force);
}

export function savePem(secretsDir: string, pem: string): string {
  return new SecretsManager(secretsDir).savePem(pem);
}

export function saveWebhookSecret(secretsDir: string, secret: string): void {
  new SecretsManager(secretsDir).saveWebhookSecret(secret);
}

export function saveClientSecret(secretsDir: string, secret: string): void {
  new SecretsManager(secretsDir).saveClientSecret(secret);
}
