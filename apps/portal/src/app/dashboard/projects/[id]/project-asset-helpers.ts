import { createClient } from "@/lib/supabase/server";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

export async function downloadRevisionAssetsToSite(
  supabase: PortalSupabase,
  revisionId: string | null,
  siteDir: string,
): Promise<Array<{ url: string; alt: string }>> {
  if (!revisionId) return [];

  const imagesDir = join(siteDir, "public", "images");

  await rm(imagesDir, { recursive: true, force: true });
  await mkdir(imagesDir, { recursive: true });

  let attachedAssetIds: string[] = [];
  try {
    const { data: revAssets } = await supabase
      .from("revision_assets")
      .select("asset_id, role, sort_order")
      .eq("revision_id", revisionId)
      .order("sort_order", { ascending: true });

    attachedAssetIds = (revAssets ?? []).map((ra) => ra.asset_id);
  } catch {
    // revision_assets table may not exist yet
  }

  let assets: Array<{ id: string; file_name: string; storage_path: string; category: string }> = [];
  if (attachedAssetIds.length > 0) {
    const { data } = await supabase
      .from("assets")
      .select("id, file_name, storage_path, category")
      .in("id", attachedAssetIds);
    assets = (data ?? []).filter((asset) => asset.category === "image");
  }

  const galleryImages: Array<{ url: string; alt: string }> = [];

  for (const asset of assets) {
    try {
      const { data, error } = await supabase.storage
        .from("intake-assets")
        .download(asset.storage_path);

      if (error || !data) {
        console.error(`Failed to download asset ${asset.file_name}:`, error?.message);
        continue;
      }

      const localPath = join(imagesDir, asset.file_name);
      const buffer = Buffer.from(await data.arrayBuffer());
      await writeFile(localPath, buffer);

      galleryImages.push({
        url: `/images/${asset.file_name}`,
        alt: asset.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
      });
    } catch (err) {
      console.error(`Error downloading asset ${asset.file_name}:`, err);
    }
  }

  return galleryImages;
}

export function categorizeFile(mimeType: string): string {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return "document";
  return "general";
}
