import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the portal audit harness.
 *
 * `pnpm portal:audit` runs the modular `portal-*.spec.ts` suite:
 * - the original project workflow audit
 * - broader business-surface coverage across sales, delivery, and admin pages
 *
 * Hosted deployment verification remains a separate explicit path via:
 * `pnpm --filter @vaen/portal smoke:hosted`
 *
 * The audit specs capture full-page screenshots at each major milestone.
 * Run with: pnpm portal:audit
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  use: {
    baseURL: process.env.PORTAL_URL ?? "http://localhost:3100",
    trace: "off",
    screenshot: "off", // we take manual screenshots at each step
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "desktop-audit",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
