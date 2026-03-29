import { execSync, spawn } from "node:child_process";
import { join } from "node:path";

export function shouldUseLocalWorkerSpawn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VAEN_ENABLE_LOCAL_WORKER_SPAWN === "true";
}

export function spawnWorker(jobId: string): void {
  const repoRoot = join(process.cwd(), "../..");

  try {
    execSync(
      "pnpm --filter @vaen/worker --filter @vaen/generator --filter @vaen/review-tools build",
      { cwd: repoRoot, stdio: "pipe", timeout: 30_000 },
    );
  } catch (err) {
    console.error("[portal] Pre-spawn build failed:", err instanceof Error ? err.message : err);
  }

  const workerScript = join(repoRoot, "apps", "worker", "dist", "run-job.js");

  const child = spawn("node", [workerScript, jobId], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  child.unref();
}
