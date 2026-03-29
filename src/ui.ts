import * as readline from "node:readline";

// ---------------------------------------------------------------------------
// ANSI color helpers (no dependencies)
// ---------------------------------------------------------------------------

const isColorSupported =
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0" &&
  (process.stdout.isTTY ?? false);

const esc = (code: string) => (isColorSupported ? `\x1b[${code}m` : "");

export const bold = (s: string) => `${esc("1")}${s}${esc("22")}`;
export const dim = (s: string) => `${esc("2")}${s}${esc("22")}`;
export const green = (s: string) => `${esc("32")}${s}${esc("39")}`;
export const yellow = (s: string) => `${esc("33")}${s}${esc("39")}`;
export const red = (s: string) => `${esc("31")}${s}${esc("39")}`;
export const cyan = (s: string) => `${esc("36")}${s}${esc("39")}`;

// ---------------------------------------------------------------------------
// Step counter
// ---------------------------------------------------------------------------

let currentStep = 0;
let totalSteps = 10;

export function setTotalSteps(n: number): void {
  totalSteps = n;
}

export function step(msg: string): void {
  currentStep++;
  console.log(`\n  ${dim(`[${currentStep}/${totalSteps}]`)} ${bold(msg)}`);
}

export function info(msg: string): void {
  console.log(`  ${msg}`);
}

export function success(msg: string): void {
  console.log(`  ${green("✓")} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`  ${yellow("!")} ${msg}`);
}

export function fail(msg: string): void {
  console.error(`  ${red("✗")} ${msg}`);
}

// ---------------------------------------------------------------------------
// Spinner (uses \r overwrite — no dependency)
// ---------------------------------------------------------------------------

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  update(msg: string): void;
  stop(msg?: string): void;
}

export function spinner(msg: string): Spinner {
  let i = 0;
  let text = msg;
  const timer = setInterval(() => {
    const frame = FRAMES[i % FRAMES.length]!;
    process.stdout.write(`\r  ${cyan(frame)} ${text}`);
    i++;
  }, 80);

  return {
    update(m: string) {
      text = m;
    },
    stop(final?: string) {
      clearInterval(timer);
      process.stdout.write("\r" + " ".repeat(text.length + 10) + "\r");
      if (final) {
        success(final);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Prompts (node:readline — no dependencies)
// ---------------------------------------------------------------------------

export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultValue ? ` ${dim(`[${defaultValue}]`)}` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Mute output for secret input
    process.stdout.write(`  ${question}: `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    let value = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(value);
      } else if (c === "\u0003") {
        // Ctrl+C
        process.exit(1);
      } else if (c === "\u007f" || c === "\b") {
        // Backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        value += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

export function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  return prompt(`${question} (${hint})`).then((answer) => {
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith("y");
  });
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export function banner(): void {
  console.log();
  console.log(bold("  Syntropic137 — Self-Host Setup"));
  console.log(dim("  ─────────────────────────────────"));
  console.log();
}
