import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Asset } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";

export function getGeneratedProjectDir(slug: string) {
  return join(process.cwd(), "../..", "generated", slug);
}

export async function purgeGeneratedProjectDir(slug: string) {
  await rm(getGeneratedProjectDir(slug), { recursive: true, force: true }).catch(() => {});
}

export async function purgeProjectStorageAssets(
  userId: string,
  projectId: string,
  assets: Asset[],
) {
  const intakePaths = assets
    .filter((asset) => asset.asset_type !== "review_screenshot")
    .map((asset) => asset.storage_path);

  if (intakePaths.length > 0) {
    const admin = createAdminClient();
    await admin.storage.from("intake-assets").remove(intakePaths);
  }

  const screenshotPaths = assets
    .filter((asset) => asset.asset_type === "review_screenshot")
    .map((asset) => asset.storage_path);

  if (screenshotPaths.length > 0) {
    const admin = createAdminClient();
    await admin.storage.from("review-screenshots").remove(screenshotPaths);
  }

  const userPrefix = `${userId}/${projectId}/`;
  if (intakePaths.length === 0) {
    const admin = createAdminClient();
    const { data } = await admin.storage.from("intake-assets").list(`${userId}/${projectId}`);
    const extraPaths = (data ?? []).map((entry) => `${userPrefix}${entry.name}`);
    if (extraPaths.length > 0) {
      await admin.storage.from("intake-assets").remove(extraPaths);
    }
  }
}
