/**
 * Supabase client for the worker process.
 *
 * Uses the service_role key to bypass RLS, allowing the worker
 * to read pending jobs and update status/results for any project.
 */

import { createClient } from "@supabase/supabase-js";

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing environment variable: ${key}. ` +
        `Set it in apps/worker/.env or pass it to the process.`,
    );
  }
  return val;
}

export function createWorkerClient() {
  return createClient(
    getEnvOrThrow("SUPABASE_URL"),
    getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
  );
}
