import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "src/cli.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("CLI verifies the bundled example and reports JSON", () => {
  const result = run(["verify", "--candidate", "examples/candidate.json", "--evidence", "examples/evidence.json", "--now", "1800000000000"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, "verification");
  assert.equal(report.failed, 0);
});

test("CLI runs the public benchmark as JUnit", () => {
  const result = run(["benchmark", "--corpus", "benchmarks/corpus.json", "--format", "junit"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<testsuite/u);
  assert.match(result.stdout, /failures="0"/u);
});

test("CLI rejects invalid usage with exit code 2", () => {
  const result = run(["verify"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /candidate_and_evidence_required/u);
});

test("CLI exposes its package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.2.0");
});

test("CLI rejects an oversized file before parsing it", () => {
  const result = run(["benchmark", "--corpus", "benchmarks/corpus.json", "--maximum-input-bytes", "2"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /input_file_too_large/u);
});
