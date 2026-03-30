import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerSrcDir = join(__dirname, "..", "src");

test("run-job CLI is guarded so imports do not execute it", () => {
  const source = readFileSync(join(workerSrcDir, "run-job.ts"), "utf8");

  assert.match(source, /function isRunJobCliEntrypoint\(\)/);
  assert.match(source, /if \(isRunJobCliEntrypoint\(\)\) \{/);
  assert.ok(!source.includes("\nmain().catch(("), "run-job.ts should not call main() unconditionally");
});

test("poller continues to import the reusable job runner directly", () => {
  const source = readFileSync(join(workerSrcDir, "poll.ts"), "utf8");

  assert.match(source, /import \{ runJobById \} from "\.\/run-job\.js";/);
  assert.match(source, /main\(\)\.catch\(\(error\) => \{/);
});
