import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Asset, Project } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

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

export async function purgeProjectResources(
  supabase: PortalSupabase,
  userId: string,
  project: Project,
) {
  const { data: assets } = await supabase
    .from("assets")
    .select("*")
    .eq("project_id", project.id);

  await purgeProjectStorageAssets(userId, project.id, (assets ?? []) as Asset[]);
  await purgeGeneratedProjectDir(project.slug);
}
