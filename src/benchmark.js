import { createEvidence, ProvenanceGate } from "./gate.js";

function materializeEvidence(definition) {
  if (definition.record) return structuredClone(definition.record);
  const record = createEvidence(definition.spec);
  return definition.mutate ? { ...record, ...definition.mutate } : record;
}

export function runBenchmark(corpus) {
  if (!corpus || corpus.version !== "pocket-provenance-benchmark-v1" || !Array.isArray(corpus.cases)) {
    throw new Error("invalid_benchmark_corpus");
  }
  if (!Number.isSafeInteger(corpus.now)) throw new Error("invalid_benchmark_now");
  const cases = corpus.cases.map((item) => {
    try {
      const evidence = (item.evidence ?? []).map(materializeEvidence);
      const gate = new ProvenanceGate(item.gate ?? {}).evaluate(item.candidate, evidence, { now: corpus.now });
      const passed = gate.accepted === item.expectedAccepted
        && (item.expectedReasons ?? []).every((reason) => gate.reasons.includes(reason));
      return {
        id: item.id,
        description: item.description,
        expectedAccepted: item.expectedAccepted,
        observedAccepted: gate.accepted,
        passed,
        gate,
      };
    } catch (error) {
      return {
        id: item.id,
        description: item.description,
        expectedAccepted: item.expectedAccepted,
        observedAccepted: false,
        passed: item.expectedError === String(error.message ?? error),
        error: String(error.message ?? error),
      };
    }
  });
  return {
    kind: "benchmark",
    corpusVersion: corpus.version,
    now: corpus.now,
    cases,
  };
}
