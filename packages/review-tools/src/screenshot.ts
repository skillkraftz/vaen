import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ScreenshotOptions {
  url: string;
  outputDir: string;
  siteDir?: string;
  pages?: Array<{ path: string; name: string }>;
}

export interface RuntimeConfigDiagnostics {
  timestamp: string;
  route: string;
  process_cwd: string;
  configured_path: string | null;
  resolved_config_path: string;
  config_exists: boolean;
  config_sha256: string | null;
  business_name: string | null;
  seo_title: string | null;
  hero_headline: string | null;
  expected_business_name: string | null;
  runtime_config_status: "matched" | "mismatched" | "unknown";
}

export interface CaptureProbe {
  page_name: string;
  route_path: string;
  viewport: string;
  screenshot_file: string;
  screenshot_path: string;
  html_snapshot_path: string | null;
  url: string;
  final_url: string;
  title: string;
  h1: string | null;
  body_text_snippet: string;
  body_text_hash: string;
  html_hash: string;
  runtime_config: RuntimeConfigDiagnostics | null;
}

export interface CaptureResult {
  screenshots: string[];
  probePath: string;
  expectedContent: {
    config_path: string | null;
    business_name: string | null;
    seo_title: string | null;
    hero_headline: string | null;
    contact_heading: string | null;
  };
  contentVerification: {
    status: "matched" | "mismatched" | "unknown";
    expected_business_name: string | null;
    observed_home_title: string | null;
    observed_home_h1: string | null;
    mismatches: string[];
  };
  runtimeConfigVerification: {
    status: "matched" | "mismatched" | "unknown";
    expected_business_name: string | null;
    runtime_business_name: string | null;
    runtime_config_path: string | null;
    runtime_cwd: string | null;
    route: string | null;
    mismatches: string[];
  };
  captures: CaptureProbe[];
}

const defaultPages = [
  { path: "/", name: "homepage" },
  { path: "/contact", name: "contact" },
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readExpectedContent(siteDir?: string): Promise<CaptureResult["expectedContent"]> {
  if (!siteDir) {
    return {
      config_path: null,
      business_name: null,
      seo_title: null,
      hero_headline: null,
      contact_heading: null,
    };
  }

  const configPath = join(siteDir, "config.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, any>;
    const businessName = parsed.business?.name ?? null;
    return {
      config_path: configPath,
      business_name: businessName,
      seo_title: parsed.seo?.title ?? null,
      hero_headline: parsed.hero?.headline ?? null,
      contact_heading: businessName ? `Contact ${businessName}` : null,
    };
  } catch {
    return {
      config_path: configPath,
      business_name: null,
      seo_title: null,
      hero_headline: null,
      contact_heading: null,
    };
  }
}

async function fetchRuntimeConfig(
  baseUrl: string,
  routePath: string,
): Promise<RuntimeConfigDiagnostics | null> {
  const runtimeUrl = new URL("/api/vaen-runtime", baseUrl);
  runtimeUrl.searchParams.set("route", routePath);

  try {
    const response = await fetch(runtimeUrl, {
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as RuntimeConfigDiagnostics;
  } catch {
    return null;
  }
}

export async function captureScreenshots(
  options: ScreenshotOptions
): Promise<CaptureResult> {
  const { url, outputDir, siteDir, pages = defaultPages } = options;

  await mkdir(outputDir, { recursive: true });
  const expectedContent = await readExpectedContent(siteDir);

  const browser = await chromium.launch();
  const captured: string[] = [];
  const probes: CaptureProbe[] = [];
  const htmlSnapshotPaths = new Set<string>();

  try {
    for (const page of pages) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          serviceWorkers: "block",
        });
        await context.setExtraHTTPHeaders({
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
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

        const title = await browserPage.title();
        const h1 = await browserPage.locator("h1").first().textContent().catch(() => null);
        const bodyText = await browserPage.locator("body").innerText().catch(() => "");
        const bodyTextSnippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 500);
        const html = await browserPage.content();
        const runtimeConfig = await fetchRuntimeConfig(url, page.path);
        let htmlSnapshotPath: string | null = null;
        if (!htmlSnapshotPaths.has(page.name)) {
          htmlSnapshotPath = join(outputDir, `${page.name}.html`);
          await writeFile(htmlSnapshotPath, html, "utf-8");
          htmlSnapshotPaths.add(page.name);
        }

        await browserPage.screenshot({
          path: filepath,
          fullPage: true,
        });

        captured.push(filepath);
        probes.push({
          page_name: page.name,
          route_path: page.path,
          viewport: viewport.name,
          screenshot_file: filename,
          screenshot_path: filepath,
          html_snapshot_path: htmlSnapshotPath,
          url: fullUrl,
          final_url: browserPage.url(),
          title,
          h1,
          body_text_snippet: bodyTextSnippet,
          body_text_hash: sha256(bodyText),
          html_hash: sha256(html),
          runtime_config: runtimeConfig,
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const homeDesktop = probes.find(
    (probe) => probe.page_name === "homepage" && probe.viewport === "desktop",
  ) ?? probes.find((probe) => probe.page_name === "homepage") ?? null;
  const mismatches: string[] = [];
  if (expectedContent.business_name) {
    const observedTitle = homeDesktop?.title ?? "";
    const observedH1 = homeDesktop?.h1 ?? "";
    const titleMatch = observedTitle.includes(expectedContent.business_name);
    const h1Match = observedH1.includes(expectedContent.business_name);
    const bodyMatch = (homeDesktop?.body_text_snippet ?? "").includes(expectedContent.business_name);
    if (!titleMatch) mismatches.push("Homepage title does not include expected business name.");
    if (!h1Match && !bodyMatch) mismatches.push("Homepage heading/body does not include expected business name.");
  }

  const contentVerification: CaptureResult["contentVerification"] = {
    status:
      expectedContent.business_name == null
        ? "unknown"
        : mismatches.length === 0
          ? "matched"
          : "mismatched",
    expected_business_name: expectedContent.business_name,
    observed_home_title: homeDesktop?.title ?? null,
    observed_home_h1: homeDesktop?.h1 ?? null,
    mismatches,
  };

  const homeRuntime = homeDesktop?.runtime_config ?? null;
  const runtimeMismatches: string[] = [];
  if (expectedContent.business_name) {
    if (!homeRuntime) {
      runtimeMismatches.push("Runtime config diagnostics were not available for homepage.");
    } else {
      if (homeRuntime.business_name !== expectedContent.business_name) {
        runtimeMismatches.push("Runtime business name does not match expected business name.");
      }
      if (!homeRuntime.config_exists) {
        runtimeMismatches.push("Runtime config file did not exist at resolved path.");
      }
    }
  }
  const runtimeConfigVerification: CaptureResult["runtimeConfigVerification"] = {
    status:
      expectedContent.business_name == null
        ? "unknown"
        : runtimeMismatches.length === 0
          ? "matched"
          : "mismatched",
    expected_business_name: expectedContent.business_name,
    runtime_business_name: homeRuntime?.business_name ?? null,
    runtime_config_path: homeRuntime?.resolved_config_path ?? null,
    runtime_cwd: homeRuntime?.process_cwd ?? null,
    route: homeRuntime?.route ?? null,
    mismatches: runtimeMismatches,
  };

  const probePath = join(outputDir, "review-probe.json");
  const result: CaptureResult = {
    screenshots: captured,
    probePath,
    expectedContent,
    contentVerification,
    runtimeConfigVerification,
    captures: probes,
  };
  await writeFile(probePath, JSON.stringify(result, null, 2) + "\n", "utf-8");

  return result;
}
