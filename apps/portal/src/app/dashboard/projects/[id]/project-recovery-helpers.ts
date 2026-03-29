import { createClient } from "@/lib/supabase/server";
import { rm } from "node:fs/promises";
import { join } from "node:path";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

export async function removeGeneratedTargets(slug: string, targets: string[][]) {
  const repoRoot = join(process.cwd(), "../..");
  const generatedDir = join(repoRoot, "generated", slug);

  for (const target of targets) {
    await rm(join(generatedDir, ...target), { recursive: true, force: true }).catch(() => {});
  }
}

export async function deleteReviewScreenshotAssets(
  supabase: PortalSupabase,
  projectId: string,
) {
  await supabase
    .from("assets")
    .delete()
    .eq("project_id", projectId)
    .eq("asset_type", "review_screenshot");
}
