import { performance } from "node:perf_hooks";
import { createEvidence, ProvenanceGate } from "../src/gate.js";

const now = 1_800_000_000_000;
let blackHole = 0;

function buildInput(count) {
  const evidence = Array.from({ length: count }, (_, index) => createEvidence({
    id: `evidence-${index}`,
    level: "local-self-test",
    source: "performance-benchmark",
    observedAt: now,
    payload: { passed: true, index, detail: "fixed-size-payload" },
  }));
  const candidate = {
    output: `all ${count} checks passed`,
    evidenceIds: evidence.map((record) => record.id),
    claims: evidence.map((record) => ({ text: `check ${record.id} passed`, evidenceIds: [record.id] })),
  };
  return { candidate, evidence };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(operation, iterations, samples = 5) {
  const warmup = Math.max(3, Math.ceil(iterations / 20));
  for (let index = 0; index < warmup; index += 1) blackHole ^= operation();
  const elapsed = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) blackHole ^= operation();
    elapsed.push((performance.now() - startedAt) / iterations);
  }
  return median(elapsed);
}

const scenarios = [
  { evidenceCount: 1, iterations: 5_000 },
  { evidenceCount: 10, iterations: 1_000 },
  { evidenceCount: 100, iterations: 100 },
  { evidenceCount: 1_000, iterations: 10 },
];

const results = scenarios.map(({ evidenceCount, iterations }) => {
  const input = buildInput(evidenceCount);
  const encoded = JSON.stringify(input);
  const gate = new ProvenanceGate({
    maximumEvidenceRecords: evidenceCount,
    maximumCandidateEvidenceIds: evidenceCount,
    maximumClaims: evidenceCount,
  });
  const passThroughMs = measure(() => {
    const parsed = JSON.parse(encoded);
    return parsed.candidate.output.length + parsed.evidence.length;
  }, iterations);
  let accepted = 0;
  let gatedExecutions = 0;
  const gatedMs = measure(() => {
    const parsed = JSON.parse(encoded);
    const result = gate.evaluate(parsed.candidate, parsed.evidence, { now });
    gatedExecutions += 1;
    if (result.accepted) accepted += 1;
    return result.score === 1 ? 1 : 0;
  }, iterations);
  return {
    evidenceCount,
    inputBytes: Buffer.byteLength(encoded),
    iterationsPerSample: iterations,
    passThroughMs: Number(passThroughMs.toFixed(6)),
    gatedMs: Number(gatedMs.toFixed(6)),
    addedMs: Number((gatedMs - passThroughMs).toFixed(6)),
    gatedOperationsPerSecond: Math.round(1_000 / gatedMs),
    validAcceptanceRate: accepted / gatedExecutions,
  };
});

const overload = buildInput(1_001);
const overloadGate = new ProvenanceGate();
let observedLoadShed = false;
const overloadGateOnlyMs = measure(() => {
  const result = overloadGate.evaluate(overload.candidate, overload.evidence, { now });
  observedLoadShed ||= result.loadShed;
  return result.loadShed ? 1 : 0;
}, 20_000);

const report = {
  kind: "performance-benchmark",
  version: "pocket-provenance-performance-v1",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  methodology: "median of five samples; both normal paths include identical JSON.parse cost",
  results,
  overload: {
    evidenceCount: 1_001,
    gateOnlyMs: Number(overloadGateOnlyMs.toFixed(6)),
    loadShedBeforeDigest: observedLoadShed,
  },
  warning: "Microbenchmarks vary by hardware and runtime; compare absolute latency and rerun locally.",
  blackHole,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (results.some((item) => item.validAcceptanceRate !== 1) || !observedLoadShed) process.exitCode = 1;
