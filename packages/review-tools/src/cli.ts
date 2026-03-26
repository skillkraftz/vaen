#!/usr/bin/env node

import { captureScreenshots } from "./screenshot.js";

function parseArgs(args: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") continue; // skip bare -- separator from pnpm
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      parsed[key] = value;
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
vaen-screenshot — Capture review screenshots of a generated site

Usage:
  vaen-screenshot --url <url> --output <dir>

Options:
  --url      URL of the running site (e.g., http://localhost:3000)
  --output   Directory to save screenshots
  --help     Show this help message
`);
    process.exit(0);
  }

  const url = args.url;
  const outputDir = args.output;

  if (!url || !outputDir) {
    console.error("Error: --url and --output are required.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  console.log(`\n📸 vaen screenshot tool`);
  console.log(`   URL:    ${url}`);
  console.log(`   Output: ${outputDir}\n`);

  const captured = await captureScreenshots({ url, outputDir });

  console.log(`\n✅ Captured ${captured.length} screenshots:`);
  captured.forEach((f) => console.log(`   ${f}`));
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
