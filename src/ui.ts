import * as readline from "node:readline";
import { BIN, COMMANDS } from "./constants.js";

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
export const magenta = (s: string) => `${esc("35")}${s}${esc("39")}`;

// ---------------------------------------------------------------------------
// Box drawing
// ---------------------------------------------------------------------------

const BOX = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
} as const;

function boxLine(content: string, width: number): string {
  // Strip ANSI for length calculation
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - stripped.length);
  return `  ${dim(BOX.v)} ${content}${" ".repeat(padding)} ${dim(BOX.v)}`;
}

// ---------------------------------------------------------------------------
// Step counter
// ---------------------------------------------------------------------------

let currentStep = 0;
let totalSteps = 10;

export function setTotalSteps(n: number): void {
  totalSteps = n;
  currentStep = 0;
}

export function step(msg: string): void {
  currentStep++;
  const num = `${currentStep}`.padStart(2);
  const total = `${totalSteps}`;
  console.log();
  console.log(`  ${cyan(BOX.h + BOX.h)} ${dim(`${num}/${total}`)} ${bold(msg)}`);
}

export function info(msg: string): void {
  console.log(`  ${dim("   ")} ${msg}`);
}

export function success(msg: string): void {
  console.log(`  ${green("  ✓")} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`  ${yellow("  !")} ${msg}`);
}

export function fail(msg: string): void {
  console.error(`  ${red("  ✗")} ${msg}`);
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
    process.stdout.write(`\r  ${cyan("  " + frame)} ${text}`);
    i++;
  }, 80);

  return {
    update(m: string) {
      text = m;
    },
    stop(final?: string) {
      clearInterval(timer);
      process.stdout.write("\r" + " ".repeat(text.length + 12) + "\r");
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
    rl.question(`  ${cyan("  ?")} ${question}${suffix}: `, (answer) => {
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
    process.stdout.write(`  ${cyan("  ?")} ${question}: `);
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
  return prompt(`${question} ${dim(`(${hint})`)}`).then((answer) => {
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith("y");
  });
}

// ---------------------------------------------------------------------------
// Interactive menu (arrow keys + enter, no dependencies)
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  value: string;
  description: string;
}

// Entropy flair frames — subtle cycling diamond in the banner subtitle
const FLAIR_FRAMES = ["◇", "◈", "◆", "◈", "◇", "·", "◇", "◈"];

export interface FlairConfig {
  /** Lines above the menu save-point where the flair char lives */
  linesAboveSave: number;
  /** 1-based column of the flair character */
  col: number;
}

export function interactiveMenu(
  items: MenuItem[],
  title?: string,
  flair?: FlairConfig,
): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const out = process.stdout;
    const wasRaw = stdin.isRaw;
    const isTTY = out.isTTY ?? false;

    let selected = 0;
    let flairIdx = 0;

    function renderItems() {
      // Move cursor to saved position and clear everything below it
      out.write("\x1b[u\x1b[J");
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const pointer = i === selected ? cyan("  ❯ ") : "    ";
        const label = i === selected ? bold(item.label) : item.label;
        const desc = dim(item.description);
        out.write(`${pointer}${label}  ${desc}\n`);
      }
    }

    function updateFlair() {
      if (!flair || !isTTY) return;
      flairIdx++;
      const ch = FLAIR_FRAMES[flairIdx % FLAIR_FRAMES.length]!;
      // Move up from current position to the flair line, update char, move back
      const linesUp = items.length + flair.linesAboveSave;
      out.write(
        `\x1b[${linesUp}F` +      // move up N lines (to start of line)
        `\x1b[${flair.col}G` +    // move to column
        cyan(ch) +                  // write the flair char
        `\x1b[${linesUp}E`         // move back down N lines
      );
    }

    // Print title once (never redrawn)
    if (title) {
      out.write(`  ${bold(title)}\n\n`);
    }

    // Save cursor position — this is the anchor for all redraws
    out.write("\x1b[s");

    // Hide cursor and draw initial items
    out.write("\x1b[?25l");
    renderItems();

    // Animate the flair on a timer
    const flairTimer = (flair && isTTY)
      ? setInterval(updateFlair, 300)
      : null;

    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    function onData(key: string) {
      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + items.length) % items.length;
        renderItems();
      } else if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % items.length;
        renderItems();
      } else if (key === "\r" || key === "\n") {
        cleanup();
        resolve(items[selected]!.value);
      } else if (key === "\x03") {
        cleanup();
        process.exit(0);
      }
    }

    function cleanup() {
      if (flairTimer) clearInterval(flairTimer);
      stdin.removeListener("data", onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      out.write("\x1b[?25h");
    }

    stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

const LOGO = [
  "███████╗██╗   ██╗███╗   ██╗████████╗██████╗  ██████╗ ██████╗ ██╗ ██████╗ ██╗██████╗ ███████╗",
  "██╔════╝╚██╗ ██╔╝████╗  ██║╚══██╔══╝██╔══██╗██╔═══██╗██╔══██╗██║██╔════╝███║╚════██╗╚════██║",
  "███████╗ ╚████╔╝ ██╔██╗ ██║   ██║   ██████╔╝██║   ██║██████╔╝██║██║     ╚██║ █████╔╝    ██╔╝",
  "╚════██║  ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██╗██║   ██║██╔═══╝ ██║██║      ██║ ╚═══██╗   ██╔╝ ",
  "███████║   ██║   ██║ ╚████║   ██║   ██║  ██║╚██████╔╝██║     ██║╚██████╗ ██║██████╔╝   ██║  ",
  "╚══════╝   ╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝ ╚═════╝ ╚═╝╚═════╝    ╚═╝  ",
];

/**
 * Print the banner. Returns the number of lines printed (for flair positioning).
 */
export function banner(version?: string): number {
  const width = 92;
  const versionStr = version ? dim(`v${version}`) : "";
  const versionLen = version ? version.length + 1 : 0; // "v" + version
  const subtitleText = `  ${bold("Self-Host Setup CLI")}`;
  const subtitleStripped = 2 + 19; // "  " + "Self-Host Setup CLI"
  // Pad so version sits at the right edge: width - subtitle - version - flair(2) - gap(1)
  const gap = Math.max(1, width - subtitleStripped - versionLen - 2);
  const subtitle = `${FLAIR_FRAMES[0]} ${subtitleText}${" ".repeat(gap)}${versionStr}`;

  let lines = 0;
  console.log(); lines++;
  console.log(`  ${dim(BOX.tl + BOX.h.repeat(width + 2) + BOX.tr)}`); lines++;
  for (const line of LOGO) {
    console.log(boxLine(cyan(line), width)); lines++;
  }
  console.log(boxLine("", width)); lines++;
  console.log(boxLine(subtitle, width)); lines++;
  console.log(`  ${dim(BOX.bl + BOX.h.repeat(width + 2) + BOX.br)}`); lines++;
  console.log(); lines++;
  return lines;
}

// ---------------------------------------------------------------------------
// Summary box
// ---------------------------------------------------------------------------

export function summaryBox(opts: {
  healthy: boolean;
  port: string;
  installDir: string;
}): void {
  const width = 78;
  console.log();
  console.log(`  ${dim(BOX.tl + BOX.h.repeat(width + 2) + BOX.tr)}`);

  if (opts.healthy) {
    console.log(boxLine(green(bold("  Syntropic137 is running!")), width));
  } else {
    console.log(boxLine(cyan(bold("  Syntropic137 is starting up...")), width));
  }
  console.log(boxLine("", width));
  console.log(boxLine(`  Dashboard   ${cyan(`http://localhost:${opts.port}`)}`, width));
  console.log(boxLine(`  Directory   ${dim(opts.installDir)}`, width));
  console.log(boxLine("", width));
  console.log(boxLine(dim("  Commands:"), width));
  // Show bare command for interactive menu first
  console.log(boxLine(`    ${bold(BIN.padEnd(30))}${dim("Interactive menu")}`, width));
  for (const c of COMMANDS) {
    const cmd = `${BIN} ${c.name}`;
    console.log(boxLine(`    ${bold(cmd.padEnd(30))}${dim(c.description)}`, width));
  }

  console.log(`  ${dim(BOX.bl + BOX.h.repeat(width + 2) + BOX.br)}`);
  console.log();
}
