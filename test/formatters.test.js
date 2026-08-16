import test from "node:test";
import assert from "node:assert/strict";
import { formatJUnit, formatJson, formatSarif } from "../src/formatters.js";

const report = {
  kind: "verification",
  cases: [
    { id: "accepted", passed: true, gate: { accepted: true, reasons: [] } },
    { id: "rejected<&\"", passed: false, gate: { accepted: false, reasons: ["stale_evidence"], candidateDigest: "abc", score: 0.2 } },
  ],
};

test("JSON format includes deterministic totals", () => {
  const parsed = JSON.parse(formatJson(report));
  assert.equal(parsed.total, 2);
  assert.equal(parsed.passed, 1);
  assert.equal(parsed.failed, 1);
});

test("JUnit format escapes names and records failures", () => {
  const junit = formatJUnit(report);
  assert.match(junit, /tests="2" failures="1"/u);
  assert.match(junit, /rejected&lt;&amp;&quot;/u);
  assert.match(junit, /stale_evidence/u);
});

test("SARIF 2.1.0 contains one result per failed case", () => {
  const sarif = JSON.parse(formatSarif(report));
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].ruleId, "provenance/stale_evidence");
});
