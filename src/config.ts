import * as fs from "node:fs";
import * as path from "node:path";
import type { EnvValues } from "./types.js";
import { success } from "./ui.js";

/**
 * Read the .env template from the embedded templates, substitute collected
 * values, and write the final .env file.
 */
export function writeEnvFile(
  installDir: string,
  values: EnvValues,
  templateDir: string,
): void {
  const templatePath = path.join(templateDir, "selfhost.env.example");
  let template = fs.readFileSync(templatePath, "utf-8");

  // Replace known keys in the template
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    // Match lines like KEY= or KEY=default
    const regex = new RegExp(`^(${key})=.*$`, "m");
    if (regex.test(template)) {
      template = template.replace(regex, `$1=${value}`);
    } else {
      // Append if not in template
      template += `\n${key}=${value}\n`;
    }
  }

  const envPath = path.join(installDir, ".env");
  fs.writeFileSync(envPath, template, { mode: 0o600 });
  success("Wrote .env");
}

/**
 * Read an existing .env file into a key-value map.
 */
export function readEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf-8");
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    result[key] = value;
  }
  return result;
}

/**
 * Check if an .env file already exists in the install directory.
 */
export function envExists(installDir: string): boolean {
  return fs.existsSync(path.join(installDir, ".env"));
}
