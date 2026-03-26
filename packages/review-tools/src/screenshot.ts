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
