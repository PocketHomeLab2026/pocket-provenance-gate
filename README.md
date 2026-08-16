# Pocket Provenance Gate

[![test](https://github.com/PocketHomeLab2026/pocket-provenance-gate/actions/workflows/test.yml/badge.svg)](https://github.com/PocketHomeLab2026/pocket-provenance-gate/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/pocket-provenance-gate.svg)](https://www.npmjs.com/package/pocket-provenance-gate)

Pocket Provenance Gate is a dependency-free quality gate for AI and automation results. It rejects claims that exceed the evidence actually linked to them: a local unit test cannot silently become proof of a phone, cloud, or production path.

It provides:

- canonical SHA-256 digests for evidence and candidate output;
- explicit evidence levels from synthetic probes through production acceptance;
- tamper, freshness, future-clock, minimum-level, claim-linkage, duplicate-identity, and input-bound checks;
- deterministic selection with a complete rejection-reason trail;
- a directly executable CLI with JSON, JUnit XML, and SARIF 2.1.0 reports;
- a composite GitHub Action;
- a public adversarial benchmark corpus;
- zero-queue application admission control and pre-read CLI file-size limits;
- no model calls, network requests, dependencies, or telemetry.

## Install

```bash
npm install --save-dev pocket-provenance-gate
```

Node.js 20 or newer is required.

## CLI

Verify one candidate against an evidence array:

```bash
npx pocket-provenance-gate verify \
  --candidate examples/candidate.json \
  --evidence examples/evidence.json \
  --required-level local-self-test \
  --format sarif \
  --output provenance-gate.sarif
```

Run the reproducible public corpus:

```bash
npx pocket-provenance-gate benchmark \
  --corpus benchmarks/corpus.json \
  --format junit \
  --output provenance-benchmark.xml
```

The bundled example uses a fixed timestamp, so reproduce it with `--now 1800000000000`. Real verification defaults to the current time.

Exit codes are stable:

| Code | Meaning |
| ---: | --- |
| `0` | The candidate was accepted, or every benchmark expectation passed. |
| `1` | The candidate was rejected, or a benchmark expectation failed. |
| `2` | The command, input, or configuration was invalid. |

## GitHub Action

```yaml
name: provenance

on: [push, pull_request]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: PocketHomeLab2026/pocket-provenance-gate@v0.2.0
        with:
          candidate: build/candidate.json
          evidence: build/evidence.json
          required-level: live-device
          format: sarif
          output: provenance-gate.sarif
```

The Action fails the step when the gate rejects the candidate. The report file is still suitable for CI artifacts or a later SARIF upload step.

## Library

```js
import { createEvidence, ProvenanceGate } from "pocket-provenance-gate";

const now = Date.now();
const evidence = createEvidence({
  id: "phone-run-42",
  level: "live-device",
  source: "android-instrumentation",
  observedAt: now,
  payload: { passed: true, device: "test-device" },
});

const candidate = {
  output: "The live-device acceptance check passed.",
  evidenceIds: [evidence.id],
  claims: [{
    text: "The live-device acceptance check passed.",
    evidenceIds: [evidence.id],
  }],
};

const result = new ProvenanceGate({ requiredLevel: "live-device" })
  .evaluate(candidate, [evidence], { now });

if (!result.accepted) {
  throw new Error(result.reasons.join(", "));
}
```

## Evidence levels

From lowest to highest minimum observation scope:

1. `synthetic`
2. `local-self-test`
3. `emulator`
4. `live-device`
5. `cloud-staging`
6. `production`

This is an observation ladder, not an automatic truth ladder. Applications must define what each test actually observes. A high label cannot repair a weak, misleading, or dishonest test.

## Public adversarial benchmark

[`benchmarks/corpus.json`](benchmarks/corpus.json) is deterministic and inspectable. Its current attack and boundary classes include:

- payload, source, digest, ID-binding, and unsigned-field tampering;
- local-to-production and synthetic-to-device evidence escalation;
- stale, future, malformed, boundary-age, and boundary-clock evidence;
- missing, undeclared, duplicate, and unsupported evidence references;
- duplicate evidence identities and reference-count inflation;
- empty output, missing claims, unknown evidence levels, and bounded-input exhaustion.

The corpus tests whether this implementation makes the declared decisions. It does not prove that every real-world attack has been discovered. New attack classes should be added as minimal failing cases, repaired, and then retained as regressions.

## Overload and traffic shedding

This package is a local evaluator, not a network firewall. Put network controls at the edge first: request-size limits, per-identity and per-address rate limits, connection limits, short timeouts, and a global concurrency ceiling. Do not forward rejected traffic to another public service; that can turn a defensive path into a traffic amplifier.

The library provides a zero-queue admission controller for the application layer:

```js
import { GateAdmissionController } from "pocket-provenance-gate/admission";

const admission = new GateAdmissionController({ maximumConcurrent: 4 });
const attempt = await admission.run(() => gate.evaluate(candidate, evidence));

if (!attempt.admitted) {
  // Return a tiny 429 or 503 response. No hashing or model work ran.
  return { status: 503, retryAfterMs: attempt.retryAfterMs };
}
```

The gate itself also returns `loadShed: true` before digest calculation when configured evidence or claim-count limits are exceeded. The CLI checks each input file's size before reading it; use `--maximum-input-bytes` to tune the default 4 MiB cap. These controls reduce application work but cannot absorb a link-saturating distributed denial-of-service attack; that remains the responsibility of the hosting edge or network provider.

## Performance benchmark

Run the public local comparison with:

```bash
npm run benchmark:performance
```

It compares an ordinary JSON parse-and-pass-through path with the same JSON parse followed by full gate evaluation at 1, 10, 100, and 1,000 linked evidence records. It also measures the early load-shed path above the default record limit. Results are machine-dependent microbenchmarks, so the report includes input sizes and absolute milliseconds instead of claiming a universal speed ratio. Valid fixtures must retain a `validAcceptanceRate` of `1`; overload is measured separately and is intentionally rejected.

## Security boundaries

- SHA-256 detects accidental or adversarial changes after a digest is created; it is not an identity signature. Use a trusted signature or MAC when the evidence producer is outside your trust boundary.
- The gate checks declared provenance structure. It cannot determine whether a dishonest producer fabricated the original observation.
- The CLI reads local files only and makes no network requests.
- Treat a rejected or errored check as fail-closed. Do not silently replace it with acceptance.

See [SECURITY.md](SECURITY.md) for responsible reporting.

License: MIT.
