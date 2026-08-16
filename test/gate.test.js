import test from "node:test";
import assert from "node:assert/strict";
import { createEvidence, ProvenanceGate, verifyEvidence } from "../src/gate.js";

test("tampering is visible and blocks acceptance", () => {
  const now = Date.now();
  const evidence = createEvidence({ id: "run-1", level: "live-device", source: "instrumentation", observedAt: now, payload: { passed: true } });
  assert.equal(verifyEvidence(evidence), true);
  assert.equal(verifyEvidence({ ...evidence, payload: { passed: false } }), false);
  const candidate = { output: "passed", evidenceIds: ["run-1"], claims: [{ text: "device passed", evidenceIds: ["run-1"] }] };
  const result = new ProvenanceGate({ requiredLevel: "live-device" }).evaluate(candidate, [{ ...evidence, payload: { passed: false } }], { now });
  assert.equal(result.accepted, false);
});

test("a local self-test cannot prove a production claim", () => {
  const now = Date.now();
  const evidence = createEvidence({ id: "local", level: "local-self-test", source: "node:test", observedAt: now, payload: { passed: true } });
  const candidate = { output: "production works", evidenceIds: ["local"], claims: [{ text: "production works", evidenceIds: ["local"] }] };
  const result = new ProvenanceGate({ requiredLevel: "production" }).evaluate(candidate, [evidence], { now });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("required_level_not_met:production"));
});

test("fully linked evidence passes and deterministic selection prefers it", () => {
  const now = Date.now();
  const evidence = createEvidence({ id: "prod", level: "production", source: "acceptance", observedAt: now, payload: { code: 200 } });
  const good = { output: "verified", evidenceIds: ["prod"], claims: [{ text: "verified", evidenceIds: ["prod"] }] };
  const weak = { output: "guess", evidenceIds: [], claims: [{ text: "guess", evidenceIds: [] }] };
  const chosen = new ProvenanceGate({ requiredLevel: "production" }).choose([weak, good], [evidence], { now });
  assert.equal(chosen.selected.candidate.output, "verified");
});

