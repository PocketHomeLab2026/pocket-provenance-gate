# Pocket Provenance Gate

[![test](https://github.com/PocketHomeLab2026/pocket-provenance-gate/actions/workflows/test.yml/badge.svg)](https://github.com/PocketHomeLab2026/pocket-provenance-gate/actions/workflows/test.yml)

AI orchestration frequently blurs different kinds of evidence. A passing local unit test does not prove a phone, cloud, or production path. This dependency-free library keeps those claims separate.

Features:

- canonical SHA-256 digests for evidence and candidate output;
- explicit evidence levels from synthetic probes through production acceptance;
- freshness, minimum-level, claim-linkage, and score checks;
- deterministic selection with a full rejection-reason trail;
- no model calls, network requests, or private telemetry.

Evidence levels form a minimum-observation ladder, not an automatic truth ladder. Applications should define what each acceptance test actually observes. A higher label cannot repair a weak or dishonest test.

License: MIT.
