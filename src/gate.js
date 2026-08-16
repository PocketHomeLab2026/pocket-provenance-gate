import { createHash } from "node:crypto";

export const EVIDENCE_LEVELS = Object.freeze([
  "synthetic",
  "local-self-test",
  "emulator",
  "live-device",
  "cloud-staging",
  "production",
]);

function canonicalize(value, ancestors) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_json_number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("unsupported_json_value");
  if (ancestors.has(value)) throw new TypeError("circular_json_value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("plain_json_object_required");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return canonicalize(value, new Set());
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function createEvidence({ id, level, source, observedAt, payload }) {
  if (typeof id !== "string" || !id.trim()) throw new Error("invalid_evidence_id");
  if (!EVIDENCE_LEVELS.includes(level)) throw new Error("unknown_evidence_level");
  if (typeof source !== "string" || !source.trim()) throw new Error("invalid_evidence_source");
  if (!Number.isSafeInteger(observedAt)) throw new Error("invalid_evidence_timestamp");
  const record = { id, level, source, observedAt, payload };
  return { ...record, digest: digest(record) };
}

export function verifyEvidence(record) {
  try {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    if (typeof record.id !== "string" || !record.id.trim()) return false;
    if (!EVIDENCE_LEVELS.includes(record.level)) return false;
    if (typeof record.source !== "string" || !record.source.trim()) return false;
    if (!Number.isSafeInteger(record.observedAt)) return false;
    if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/u.test(record.digest)) return false;
    const { digest: claimedDigest, ...body } = record;
    return claimedDigest === digest(body);
  } catch {
    return false;
  }
}

function levelIndex(level) {
  return EVIDENCE_LEVELS.indexOf(level);
}

export class ProvenanceGate {
  constructor({
    minimumScore = 0.7,
    maximumAgeMs = 86_400_000,
    maximumFutureSkewMs = 60_000,
    maximumEvidenceRecords = 1_000,
    maximumCandidateEvidenceIds = 1_000,
    maximumClaims = 1_000,
    maximumEvidenceIdsPerClaim = 100,
    requiredLevel = "local-self-test",
  } = {}) {
    if (!EVIDENCE_LEVELS.includes(requiredLevel)) throw new Error("unknown_required_level");
    if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) throw new Error("invalid_minimum_score");
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) throw new Error("invalid_maximum_age");
    if (!Number.isSafeInteger(maximumFutureSkewMs) || maximumFutureSkewMs < 0) throw new Error("invalid_future_skew");
    for (const [name, value] of Object.entries({ maximumEvidenceRecords, maximumCandidateEvidenceIds, maximumClaims, maximumEvidenceIdsPerClaim })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid_limit:${name}`);
    }
    this.minimumScore = minimumScore;
    this.maximumAgeMs = maximumAgeMs;
    this.maximumFutureSkewMs = maximumFutureSkewMs;
    this.maximumEvidenceRecords = maximumEvidenceRecords;
    this.maximumCandidateEvidenceIds = maximumCandidateEvidenceIds;
    this.maximumClaims = maximumClaims;
    this.maximumEvidenceIdsPerClaim = maximumEvidenceIdsPerClaim;
    this.requiredLevel = requiredLevel;
  }

  evaluate(candidate, evidenceRecords, { now = Date.now() } = {}) {
    if (!candidate || typeof candidate !== "object") throw new TypeError("candidate_object_required");
    if (!Array.isArray(evidenceRecords)) throw new TypeError("evidence_array_required");
    if (!Number.isSafeInteger(now)) throw new TypeError("safe_integer_now_required");
    const rawRequestedEvidenceIds = Array.isArray(candidate.evidenceIds) ? candidate.evidenceIds : [];
    const rawClaims = Array.isArray(candidate.claims) ? candidate.claims : [];
    const pressureReasons = [];
    if (evidenceRecords.length > this.maximumEvidenceRecords) pressureReasons.push("input_limits_exceeded:evidence_records");
    if (rawRequestedEvidenceIds.length > this.maximumCandidateEvidenceIds) pressureReasons.push("input_limits_exceeded:candidate_evidence_ids");
    if (rawClaims.length > this.maximumClaims) pressureReasons.push("input_limits_exceeded:claims");
    if (pressureReasons.length === 0 && rawClaims.some((claim) => Array.isArray(claim?.evidenceIds)
      && claim.evidenceIds.length > this.maximumEvidenceIdsPerClaim)) {
      pressureReasons.push("input_limits_exceeded:claim_evidence_ids");
    }
    if (pressureReasons.length > 0) {
      return {
        accepted: false,
        score: 0,
        reasons: pressureReasons,
        validEvidenceIds: [],
        sufficientEvidenceIds: [],
        missingEvidenceIds: [],
        candidateDigest: null,
        loadShed: true,
      };
    }
    const reasons = [];
    const evidenceIds = evidenceRecords.map((record) => record?.id).filter((id) => typeof id === "string");
    if (new Set(evidenceIds).size !== evidenceIds.length) reasons.push("duplicate_evidence_ids");
    const evidenceById = new Map(evidenceRecords.map((record) => [record?.id, record]));
    const requestedEvidenceIds = rawRequestedEvidenceIds;
    if (requestedEvidenceIds.some((id) => typeof id !== "string" || !id.trim())) reasons.push("invalid_candidate_evidence_ids");
    if (new Set(requestedEvidenceIds).size !== requestedEvidenceIds.length) reasons.push("duplicate_candidate_evidence_ids");
    const missingEvidenceIds = requestedEvidenceIds.filter((id) => !evidenceById.has(id));
    const linked = requestedEvidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
    if (missingEvidenceIds.length > 0) reasons.push("missing_evidence_records");
    if (linked.some((record) => !Number.isSafeInteger(record?.observedAt))) reasons.push("invalid_evidence_timestamp");
    const valid = linked.filter(verifyEvidence);
    if (valid.length !== linked.length) reasons.push("invalid_or_tampered_evidence");
    if (valid.length === 0) reasons.push("no_valid_evidence");
    const timestamped = valid;
    const notFuture = timestamped.filter((record) => record.observedAt <= now + this.maximumFutureSkewMs);
    if (notFuture.length !== timestamped.length) reasons.push("future_evidence");
    const fresh = notFuture.filter((record) => now - record.observedAt <= this.maximumAgeMs);
    if (fresh.length !== notFuture.length) reasons.push("stale_evidence");
    const requiredIndex = levelIndex(this.requiredLevel);
    const sufficient = fresh.filter((record) => levelIndex(record.level) >= requiredIndex);
    if (sufficient.length === 0) reasons.push(`required_level_not_met:${this.requiredLevel}`);

    const claims = rawClaims;
    if (claims.some((claim) => Array.isArray(claim?.evidenceIds)
      && new Set(claim.evidenceIds).size !== claim.evidenceIds.length)) reasons.push("duplicate_claim_evidence_ids");
    const supportedClaims = claims.filter((claim) => Array.isArray(claim?.evidenceIds)
      && claim.evidenceIds.length <= this.maximumEvidenceIdsPerClaim
      && claim.evidenceIds.length > 0
      && claim.evidenceIds.every((id) => sufficient.some((record) => record.id === id)));
    if (supportedClaims.length !== claims.length) reasons.push("unsupported_claims");
    if (claims.length === 0) reasons.push("no_claims");

    const evidenceScore = valid.length === 0 ? 0 : sufficient.length / valid.length;
    const claimScore = claims.length === 0 ? 0 : supportedClaims.length / claims.length;
    const completeness = typeof candidate.output === "string" && candidate.output.trim() ? 1 : 0;
    if (completeness === 0) reasons.push("empty_output");
    const score = evidenceScore * 0.45 + claimScore * 0.4 + completeness * 0.15;
    if (score < this.minimumScore) reasons.push("score_below_threshold");

    return {
      accepted: reasons.length === 0,
      score,
      reasons: [...new Set(reasons)],
      validEvidenceIds: valid.map((record) => record.id),
      sufficientEvidenceIds: sufficient.map((record) => record.id),
      missingEvidenceIds,
      candidateDigest: digest(candidate),
      loadShed: false,
    };
  }

  choose(candidates, evidenceRecords, options) {
    const evaluated = candidates.map((candidate) => ({ candidate, gate: this.evaluate(candidate, evidenceRecords, options) }));
    evaluated.sort((a, b) => b.gate.score - a.gate.score
      || (a.gate.candidateDigest ?? "").localeCompare(b.gate.candidateDigest ?? ""));
    return { selected: evaluated.find((item) => item.gate.accepted) ?? null, evaluated };
  }
}
