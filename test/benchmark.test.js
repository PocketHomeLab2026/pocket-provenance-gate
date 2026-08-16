import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runBenchmark } from "../src/benchmark.js";

test("the public adversarial corpus passes every declared expectation", async () => {
  const corpus = JSON.parse(await readFile(new URL("../benchmarks/corpus.json", import.meta.url), "utf8"));
  const report = runBenchmark(corpus);
  assert.ok(report.cases.length >= 25);
  assert.deepEqual(report.cases.filter((item) => !item.passed).map((item) => item.id), []);
  assert.ok(report.cases.some((item) => item.id.includes("tampered")));
  assert.ok(report.cases.some((item) => item.id.includes("stale")));
  assert.ok(report.cases.some((item) => item.id.includes("production")));
});
