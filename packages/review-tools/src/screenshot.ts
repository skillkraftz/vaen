import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ScreenshotOptions {
  url: string;
  outputDir: string;
  pages?: Array<{ path: string; name: string }>;
}

const defaultPages = [
  { path: "/", name: "homepage" },
  { path: "/contact", name: "contact" },
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

export async function captureScreenshots(
  options: ScreenshotOptions
): Promise<string[]> {
  const { url, outputDir, pages = defaultPages } = options;

  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const captured: string[] = [];

  try {
    for (const page of pages) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const browserPage = await context.newPage();

        const fullUrl = `${url.replace(/\/$/, "")}${page.path}`;
        console.log(`  Capturing ${page.name} (${viewport.name}) — ${fullUrl}`);

        await browserPage.goto(fullUrl, { waitUntil: "networkidle" });

        // Wait for fonts to finish loading (runs in browser context)
        await browserPage.evaluate("document.fonts.ready");

        // Wait for all stylesheets to load and apply.
        // Checks that every <link rel="stylesheet"> has loaded its sheet,
        // then forces a layout reflow + paint via requestAnimationFrame.
        // Passed as a string because this runs in the browser context —
        // TypeScript's Node-targeted compiler doesn't have DOM types.
        await browserPage.evaluate(`new Promise((resolve) => {
          var links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
          var pending = links.filter(function(link) {
            try { return !link.sheet; } catch(e) { return true; }
          });
          function waitForPaint() {
            void document.body.offsetHeight;
            requestAnimationFrame(function() {
              requestAnimationFrame(function() { resolve(); });
            });
          }
          if (pending.length === 0) {
            waitForPaint();
          } else {
            var loaded = 0;
            pending.forEach(function(link) {
              link.addEventListener("load", function() {
                loaded++;
                if (loaded === pending.length) waitForPaint();
              });
              link.addEventListener("error", function() {
                loaded++;
                if (loaded === pending.length) waitForPaint();
              });
            });
            setTimeout(waitForPaint, 5000);
          }
        })`);

        // Final settle — let CSS transitions, lazy-loaded images,
        // and any deferred rendering complete
        await browserPage.waitForTimeout(3000);

        const filename = `${page.name}-${viewport.name}.png`;
        const filepath = join(outputDir, filename);

        await browserPage.screenshot({
          path: filepath,
          fullPage: true,
        });

        captured.push(filepath);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return captured;
}
