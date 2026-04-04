import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Package root and templates directory
// ---------------------------------------------------------------------------

/** Absolute path to the package root (one level above src/). */
export const PKG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Absolute path to the bundled templates directory. */
export const TEMPLATES_DIR = path.join(PKG_DIR, "templates");

// ---------------------------------------------------------------------------
// Template utilities
// ---------------------------------------------------------------------------

/**
 * Copy a single template file from the package's templates directory
 * to a target install directory, creating parent dirs as needed.
 */
export function syncTemplate(
  templatesDir: string,
  installDir: string,
  relativePath: string,
): void {
  const src = path.join(templatesDir, relativePath);
  const dest = path.join(installDir, relativePath);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
