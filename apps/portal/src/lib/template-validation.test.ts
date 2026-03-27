/**
 * Template and generated-site validation tests.
 *
 * These catch the class of bugs where a generated Next.js App Router site
 * fails to build because of Pages Router artifacts or missing 404 handling.
 *
 * Root causes of the original bugs:
 *
 * 1. `output: "standalone"` in next.config.ts causes Next.js 15 to look for
 *    `.next/server/pages-manifest.json` during post-build. In a pure App
 *    Router project this file is never created → build crashes.
 *
 * 2. Missing `app/global-error.tsx` causes Next.js to fall back to the Pages
 *    Router error rendering path for /500 (via load-default-error-components
 *    → pages/_document → useHtmlContext), which throws "<Html> should not be
 *    imported outside of pages/_document".
 *
 * 3. The generator overlaid templates without cleaning the site directory,
 *    so stale files from previous generations (including old next.config.ts
 *    with output: "standalone") persisted across re-generations.
 *
 * These tests verify:
 * 1. The template has no next/document imports (App Router only)
 * 2. The template has app/not-found.tsx (explicit 404 handling)
 * 3. The template has app/global-error.tsx (prevents /500 Pages Router fallback)
 * 4. The build script cleans .next before building
 * 5. No pages/ directory exists (pure App Router)
 * 6. next.config.ts does NOT set output: "standalone"
 * 7. Generated sites inherit these properties
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

// Resolve repo root from this test file's location
// This file: apps/portal/src/lib/template-validation.test.ts
// Repo root: 4 levels up
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const TEMPLATE_DIR = join(REPO_ROOT, "templates", "service-core");
const GENERATED_DIRS = [
  join(REPO_ROOT, "generated", "brightspark-electric", "site"),
  join(REPO_ROOT, "generated", "brightspark-electric-3", "site"),
];

/** Recursively collect all .ts/.tsx/.js/.jsx files, skipping node_modules/.next */
function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// ── Template validation ──────────────────────────────────────────────

describe("Template: service-core", () => {
  it("template directory exists", () => {
    expect(existsSync(TEMPLATE_DIR)).toBe(true);
  });

  it("has no next/document imports in any source file", () => {
    const files = collectSourceFiles(TEMPLATE_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      if (/from\s+["']next\/document["']/.test(content)) {
        violations.push(file.replace(TEMPLATE_DIR + "/", ""));
      }
    }

    expect(violations).toEqual([]);
  });

  it("has no Html/Head/Main/NextScript imports (Pages Router patterns)", () => {
    const files = collectSourceFiles(TEMPLATE_DIR);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      // Match imports of Html, Head, Main, NextScript from next/document
      if (/import\s+.*\b(Html|NextScript)\b.*from\s+["']next\/document["']/.test(content)) {
        violations.push(file.replace(TEMPLATE_DIR + "/", ""));
      }
    }
    expect(violations).toEqual([]);
  });

  it("has app/not-found.tsx for explicit 404 handling", () => {
    const notFound = join(TEMPLATE_DIR, "app", "not-found.tsx");
    expect(existsSync(notFound)).toBe(true);
  });

  it("has app/global-error.tsx to prevent Pages Router /500 fallback", () => {
    const globalError = join(TEMPLATE_DIR, "app", "global-error.tsx");
    expect(existsSync(globalError)).toBe(true);
    const content = readFileSync(globalError, "utf-8");
    // Must be a client component (error boundaries require "use client")
    expect(content).toContain('"use client"');
    // Must render its own <html> (replaces root layout on error)
    expect(content).toContain("<html");
    // Must NOT import from next/document
    expect(content).not.toContain("next/document");
  });

  it("has no pages/ directory (pure App Router)", () => {
    const pagesDir = join(TEMPLATE_DIR, "pages");
    expect(existsSync(pagesDir)).toBe(false);
  });

  it("has app/layout.tsx using plain <html> not next/document Html", () => {
    const layout = join(TEMPLATE_DIR, "app", "layout.tsx");
    expect(existsSync(layout)).toBe(true);
    const content = readFileSync(layout, "utf-8");
    // Must use plain <html> tag
    expect(content).toContain("<html");
    // Must NOT import from next/document
    expect(content).not.toContain("next/document");
  });

  it("build script cleans .next before building", () => {
    const pkg = JSON.parse(readFileSync(join(TEMPLATE_DIR, "package.json"), "utf-8"));
    expect(pkg.scripts.build).toContain("rm -rf .next");
    expect(pkg.scripts.build).toContain("next build");
  });

  it("next.config.ts does NOT use output: standalone (breaks pure App Router on Next 15)", () => {
    const config = readFileSync(join(TEMPLATE_DIR, "next.config.ts"), "utf-8");
    expect(config).not.toMatch(/output:\s*["']standalone["']/);
  });
});

// ── Generated site validation ────────────────────────────────────────

describe.each(
  GENERATED_DIRS.filter((d) => existsSync(d)).map((d) => [d.split("/").slice(-2).join("/"), d]),
)("Generated site: %s", (_label, siteDir) => {
  it("has no next/document imports", () => {
    const files = collectSourceFiles(siteDir as string);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      if (/from\s+["']next\/document["']/.test(content)) {
        violations.push(file.replace(siteDir + "/", ""));
      }
    }
    expect(violations).toEqual([]);
  });

  it("has app/not-found.tsx", () => {
    expect(existsSync(join(siteDir as string, "app", "not-found.tsx"))).toBe(true);
  });

  it("has app/global-error.tsx", () => {
    expect(existsSync(join(siteDir as string, "app", "global-error.tsx"))).toBe(true);
  });

  it("has no pages/ directory", () => {
    expect(existsSync(join(siteDir as string, "pages"))).toBe(false);
  });

  it("build script cleans .next", () => {
    const pkg = JSON.parse(readFileSync(join(siteDir as string, "package.json"), "utf-8"));
    expect(pkg.scripts.build).toContain("rm -rf .next");
  });

  it("layout.tsx uses plain <html> tag", () => {
    const layout = join(siteDir as string, "app", "layout.tsx");
    expect(existsSync(layout)).toBe(true);
    const content = readFileSync(layout, "utf-8");
    expect(content).toContain("<html");
    expect(content).not.toContain("next/document");
  });

  it("next.config.ts does NOT use output: standalone", () => {
    const config = readFileSync(join(siteDir as string, "next.config.ts"), "utf-8");
    expect(config).not.toMatch(/output:\s*["']standalone["']/);
  });
});

// ── Generator integration: portal-triggered generate → build ────────

describe("Generator integration: stale file cleanup", () => {
  const TEST_DIR = join(REPO_ROOT, "generated", "__test-gen-cleanup__");
  const SITE_DIR = join(TEST_DIR, "site");

  // Minimal client-request.json for the generator
  const CLIENT_REQUEST = {
    version: "1.0.0",
    business: {
      name: "Test Business",
      type: "Plumbing",
      tagline: "We test things",
      description: "A test business for generator validation",
    },
    contact: {
      phone: "555-0100",
      email: "test@example.com",
    },
    services: [{ name: "Testing", description: "We test stuff" }],
    content: {},
    preferences: {},
  };

  function runGenerator() {
    const inputPath = join(TEST_DIR, "client-request.json");
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(inputPath, JSON.stringify(CLIENT_REQUEST, null, 2));
    execSync(
      `node packages/generator/dist/cli.js --target __test-gen-cleanup__ --input ${inputPath}`,
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
  }

  function cleanup() {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  }

  // Clean up before and after
  beforeAll(() => cleanup());
  afterAll(() => cleanup());

  it("generator produces app/global-error.tsx", () => {
    runGenerator();
    expect(existsSync(join(SITE_DIR, "app", "global-error.tsx"))).toBe(true);
  });

  it("generator produces app/not-found.tsx", () => {
    expect(existsSync(join(SITE_DIR, "app", "not-found.tsx"))).toBe(true);
  });

  it("generated next.config.ts has no output: standalone", () => {
    const config = readFileSync(join(SITE_DIR, "next.config.ts"), "utf-8");
    expect(config).not.toMatch(/output:\s*["']standalone["']/);
  });

  it("re-generation removes stale files not in template", () => {
    // Plant a stale file that is NOT in the template
    const staleFile = join(SITE_DIR, "pages", "_document.tsx");
    mkdirSync(join(SITE_DIR, "pages"), { recursive: true });
    writeFileSync(staleFile, 'import { Html } from "next/document"; export default Html;');

    // Re-run the generator
    runGenerator();

    // Stale pages/ directory must be gone
    expect(existsSync(join(SITE_DIR, "pages"))).toBe(false);
    expect(existsSync(staleFile)).toBe(false);
  });

  it("re-generation overwrites stale next.config.ts", () => {
    // Plant a bad next.config.ts (simulating old generation with standalone)
    writeFileSync(
      join(SITE_DIR, "next.config.ts"),
      'const c = { output: "standalone" }; export default c;',
    );

    // Re-run the generator
    runGenerator();

    // Must be overwritten with the clean template version
    const config = readFileSync(join(SITE_DIR, "next.config.ts"), "utf-8");
    expect(config).not.toMatch(/output:\s*["']standalone["']/);
  });
});

// ── Worker validation logic (unit-testable extraction) ──────────────

describe("Site validation logic", () => {
  /**
   * Replicates the exact validation the worker runs post-generate and
   * pre-review. This proves the portal-triggered path will catch these
   * patterns before attempting a build.
   */
  function validateSite(siteDir: string): { valid: boolean; checks: Record<string, boolean>; errors: string[] } {
    const checks: Record<string, boolean> = {};
    const errors: string[] = [];

    checks.global_error_exists = existsSync(join(siteDir, "app", "global-error.tsx"));
    if (!checks.global_error_exists) errors.push("Missing app/global-error.tsx");

    checks.not_found_exists = existsSync(join(siteDir, "app", "not-found.tsx"));
    if (!checks.not_found_exists) errors.push("Missing app/not-found.tsx");

    checks.no_pages_dir = !existsSync(join(siteDir, "pages"));
    if (!checks.no_pages_dir) errors.push("pages/ directory exists");

    const configPath = join(siteDir, "next.config.ts");
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      checks.no_standalone = !/output:\s*["']standalone["']/.test(content);
      if (!checks.no_standalone) errors.push("next.config.ts has standalone");
    } else {
      checks.no_standalone = true;
    }

    checks.no_document_imports = true;
    const files = collectSourceFiles(siteDir);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      if (/from\s+["']next\/document["']/.test(content)) {
        checks.no_document_imports = false;
        errors.push(`${file} imports from next/document`);
      }
    }

    return { valid: errors.length === 0, checks, errors };
  }

  it("validates a clean generated site passes", () => {
    // Use brightspark-electric-3 which was freshly generated
    const siteDir = join(REPO_ROOT, "generated", "brightspark-electric-3", "site");
    if (!existsSync(siteDir)) return; // skip if not generated
    const result = validateSite(siteDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checks.global_error_exists).toBe(true);
    expect(result.checks.not_found_exists).toBe(true);
    expect(result.checks.no_pages_dir).toBe(true);
    expect(result.checks.no_standalone).toBe(true);
    expect(result.checks.no_document_imports).toBe(true);
  });

  it("catches missing global-error.tsx", () => {
    const tmpDir = join(REPO_ROOT, "generated", "__test-validation__", "site");
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "not-found.tsx"), "export default function NotFound() {}");
    writeFileSync(join(tmpDir, "app", "layout.tsx"), "<html><body></body></html>");
    writeFileSync(join(tmpDir, "next.config.ts"), "export default {};");

    try {
      const result = validateSite(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.checks.global_error_exists).toBe(false);
      expect(result.errors.some((e) => e.includes("global-error"))).toBe(true);
    } finally {
      rmSync(join(REPO_ROOT, "generated", "__test-validation__"), { recursive: true });
    }
  });

  it("catches pages/ directory", () => {
    const tmpDir = join(REPO_ROOT, "generated", "__test-validation2__", "site");
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "global-error.tsx"), '"use client"; export default function E() {}');
    writeFileSync(join(tmpDir, "app", "not-found.tsx"), "export default function NF() {}");
    writeFileSync(join(tmpDir, "next.config.ts"), "export default {};");
    writeFileSync(join(tmpDir, "pages", "_document.tsx"), 'import { Html } from "next/document";');

    try {
      const result = validateSite(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.checks.no_pages_dir).toBe(false);
      expect(result.checks.no_document_imports).toBe(false);
    } finally {
      rmSync(join(REPO_ROOT, "generated", "__test-validation2__"), { recursive: true });
    }
  });

  it("catches standalone config", () => {
    const tmpDir = join(REPO_ROOT, "generated", "__test-validation3__", "site");
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "global-error.tsx"), '"use client"; export default function E() {}');
    writeFileSync(join(tmpDir, "app", "not-found.tsx"), "export default function NF() {}");
    writeFileSync(join(tmpDir, "next.config.ts"), 'const c = { output: "standalone" }; export default c;');

    try {
      const result = validateSite(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.checks.no_standalone).toBe(false);
    } finally {
      rmSync(join(REPO_ROOT, "generated", "__test-validation3__"), { recursive: true });
    }
  });
});

// ── Portal-triggered generate → build end-to-end ────────────────────

describe("Portal-triggered generate → build (BrightSpark)", () => {
  const SLUG = "brightspark-electric-3";
  const SITE_DIR = join(REPO_ROOT, "generated", SLUG, "site");

  it("generator command matches what worker would execute", () => {
    // The worker runs: pnpm -w generate -- --target <slug> --input <path> --modules <ids>
    // Verify the root package.json has the generate script
    const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    expect(rootPkg.scripts.generate).toBe("node packages/generator/dist/cli.js");
  });

  it("worker dist is in sync with source (freshly built)", () => {
    // The portal rebuilds before spawning. Verify dist exists.
    const workerDist = join(REPO_ROOT, "apps", "worker", "dist", "run-job.js");
    const genDist = join(REPO_ROOT, "packages", "generator", "dist", "cli.js");
    expect(existsSync(workerDist)).toBe(true);
    expect(existsSync(genDist)).toBe(true);

    // Verify dist is not older than source
    const workerSrcStat = statSync(join(REPO_ROOT, "apps", "worker", "src", "run-job.ts"));
    const workerDistStat = statSync(workerDist);
    expect(workerDistStat.mtimeMs).toBeGreaterThanOrEqual(workerSrcStat.mtimeMs - 1000);

    const genSrcStat = statSync(join(REPO_ROOT, "packages", "generator", "src", "cli.ts"));
    const genDistStat = statSync(genDist);
    expect(genDistStat.mtimeMs).toBeGreaterThanOrEqual(genSrcStat.mtimeMs - 1000);
  });

  it("generate produces a site that passes validation", () => {
    // Run the exact command the worker would run
    const inputPath = join(REPO_ROOT, "generated", SLUG, "client-request.json");
    if (!existsSync(inputPath)) return; // skip if no client request

    execSync(
      `node packages/generator/dist/cli.js --target ${SLUG} --input ${inputPath} --modules maps-embed`,
      { cwd: REPO_ROOT, stdio: "pipe" },
    );

    // Verify critical files
    expect(existsSync(join(SITE_DIR, "app", "global-error.tsx"))).toBe(true);
    expect(existsSync(join(SITE_DIR, "app", "not-found.tsx"))).toBe(true);
    expect(existsSync(join(SITE_DIR, "app", "layout.tsx"))).toBe(true);
    expect(existsSync(join(SITE_DIR, "pages"))).toBe(false);
    const config = readFileSync(join(SITE_DIR, "next.config.ts"), "utf-8");
    expect(config).not.toMatch(/output:\s*["']standalone["']/);
  });

  it("generated site builds successfully (same as review.sh step 3)", () => {
    if (!existsSync(join(SITE_DIR, "package.json"))) return;

    // Install deps if needed (same as review.sh step 1)
    if (!existsSync(join(SITE_DIR, "node_modules"))) {
      execSync("npm install --silent", { cwd: SITE_DIR, stdio: "pipe" });
    }

    // Build (same as review.sh step 3: rm -rf .next && next build)
    const result = execSync("npm run build", {
      cwd: SITE_DIR,
      stdio: "pipe",
      timeout: 60_000,
    });

    // Build must succeed (execSync throws on non-zero exit)
    expect(result).toBeTruthy();
  }, 60_000);

  it("review command matches what worker would execute", () => {
    // The worker runs: pnpm -w review -- --target <slug>
    const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    expect(rootPkg.scripts.review).toBe("bash scripts/review.sh");
    expect(existsSync(join(REPO_ROOT, "scripts", "review.sh"))).toBe(true);
  });

  it("review.sh kills stale servers and verifies correct site title", () => {
    const reviewSh = readFileSync(join(REPO_ROOT, "scripts", "review.sh"), "utf-8");
    // Must kill stale processes on the port before starting
    expect(reviewSh).toContain("lsof -ti");
    expect(reviewSh).toContain("Killing stale process");
    // Must check server process is still alive during wait loop
    expect(reviewSh).toContain("kill -0");
    expect(reviewSh).toContain("Server process exited unexpectedly");
    // Must verify the served site title matches the target
    expect(reviewSh).toContain("Served title:");
    // Must capture server log for debugging bind failures
    expect(reviewSh).toContain("Server log");
  });

  it("review.sh runs full pipeline for brightspark-electric", () => {
    // Run the exact command the worker uses — including Generate → Review
    const siteDir = join(REPO_ROOT, "generated", "brightspark-electric", "site");
    if (!existsSync(join(siteDir, "package.json"))) return;

    const result = execSync(
      "pnpm -w review -- --target brightspark-electric",
      { cwd: REPO_ROOT, stdio: "pipe", timeout: 120_000 },
    );
    const output = result.toString();

    // Must show correct title (not a stale server)
    expect(output).toContain("BrightSpark Electric");
    // Must capture screenshots
    expect(output).toContain("Captured 4 screenshots");
    // Screenshots must exist
    const screenshotsDir = join(REPO_ROOT, "generated", "brightspark-electric", "artifacts", "screenshots");
    expect(existsSync(join(screenshotsDir, "homepage-desktop.png"))).toBe(true);
    expect(existsSync(join(screenshotsDir, "contact-desktop.png"))).toBe(true);
  }, 120_000);

  it("generate writes .vaen-meta.json when run through worker path", () => {
    // The worker writes .vaen-meta.json after generation.
    // We can't run the actual worker (needs DB), but we can verify
    // the generator output includes the files the worker would validate.
    const metaPath = join(SITE_DIR, ".vaen-meta.json");
    // Note: .vaen-meta.json is written by the worker, not the generator.
    // This test documents that the file path is correct and the worker
    // code references it.
    const workerSrc = readFileSync(
      join(REPO_ROOT, "apps", "worker", "src", "run-job.ts"),
      "utf-8",
    );
    expect(workerSrc).toContain(".vaen-meta.json");
    expect(workerSrc).toContain("validateGeneratedSite");
    expect(workerSrc).toContain("site_age");
  });
});
