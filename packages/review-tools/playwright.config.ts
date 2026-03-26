import { defineConfig, devices } from "playwright/test";

/**
 * Playwright configuration for vaen review-tools.
 *
 * This config is used by the screenshot capture tool to define
 * viewports and browser settings. It can also be used directly
 * with `npx playwright test` if test specs are added later.
 *
 * The screenshot CLI (src/screenshot.ts) uses these same viewport
 * dimensions and browser settings programmatically.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "on",
  },

  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
      },
    },
  ],

  /* Pages captured by the screenshot CLI:
   *   - / (homepage)     → desktop + mobile
   *   - /contact         → desktop + mobile
   *
   * Output: 4 full-page screenshots per run.
   */
});
