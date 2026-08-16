import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, createEvidence, ProvenanceGate, verifyEvidence } from "../src/gate.js";

const now = 1_800_000_000_000;

function candidate(id = "evidence-1") {
  return {
    output: "verified",
    evidenceIds: [id],
    claims: [{ text: "verified", evidenceIds: [id] }],
  };
}

function evidence(id = "evidence-1") {
  return createEvidence({ id, level: "local-self-test", source: "node:test", observedAt: now, payload: { passed: true } });
}

test("duplicate evidence identities fail closed", () => {
  const result = new ProvenanceGate().evaluate(candidate("duplicate"), [evidence("duplicate"), evidence("duplicate")], { now });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("duplicate_evidence_ids"));
});

test("duplicate references cannot inflate candidate or claim support", () => {
  const record = evidence();
  const duplicateCandidate = { ...candidate(), evidenceIds: [record.id, record.id] };
  const candidateResult = new ProvenanceGate().evaluate(duplicateCandidate, [record], { now });
  assert.ok(candidateResult.reasons.includes("duplicate_candidate_evidence_ids"));

  const duplicateClaim = { ...candidate(), claims: [{ text: "verified", evidenceIds: [record.id, record.id] }] };
  const claimResult = new ProvenanceGate().evaluate(duplicateClaim, [record], { now });
  assert.ok(claimResult.reasons.includes("duplicate_claim_evidence_ids"));
});

test("future, stale, and missing evidence have distinct reasons", () => {
  const future = createEvidence({ id: "future", level: "local-self-test", source: "clock", observedAt: now + 60_001, payload: {} });
  const stale = createEvidence({ id: "stale", level: "local-self-test", source: "clock", observedAt: now - 86_400_001, payload: {} });
  assert.ok(new ProvenanceGate().evaluate(candidate("future"), [future], { now }).reasons.includes("future_evidence"));
  assert.ok(new ProvenanceGate().evaluate(candidate("stale"), [stale], { now }).reasons.includes("stale_evidence"));
  assert.ok(new ProvenanceGate().evaluate(candidate("missing"), [], { now }).reasons.includes("missing_evidence_records"));
});

test("empty outputs and claimless candidates are rejected", () => {
  const record = evidence();
  assert.ok(new ProvenanceGate().evaluate({ ...candidate(), output: " " }, [record], { now }).reasons.includes("empty_output"));
  assert.ok(new ProvenanceGate().evaluate({ ...candidate(), claims: [] }, [record], { now }).reasons.includes("no_claims"));
});

test("canonical JSON rejects ambiguous non-JSON values and cycles", () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non_finite_json_number/u);
  assert.throws(() => canonicalJson({ value: undefined }), /unsupported_json_value/u);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /circular_json_value/u);
});

test("verifyEvidence returns false instead of throwing on hostile input", () => {
  const hostile = new Proxy({}, { get() { throw new Error("hostile_getter"); } });
  assert.equal(verifyEvidence(hostile), false);
});

test("configured input limits fail closed", () => {
  const records = [evidence("first"), evidence("second")];
  const result = new ProvenanceGate({ maximumEvidenceRecords: 1 }).evaluate(candidate("first"), records, { now });
  assert.equal(result.accepted, false);
  assert.equal(result.loadShed, true);
  assert.equal(result.candidateDigest, null);
  assert.ok(result.reasons.includes("input_limits_exceeded:evidence_records"));
});
