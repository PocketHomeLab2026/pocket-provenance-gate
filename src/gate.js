import { createHash } from "node:crypto";

export const EVIDENCE_LEVELS = Object.freeze([
  "synthetic",
  "local-self-test",
  "emulator",
  "live-device",
  "cloud-staging",
  "production",
]);

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function createEvidence({ id, level, source, observedAt, payload }) {
  if (!EVIDENCE_LEVELS.includes(level)) throw new Error("unknown_evidence_level");
  const record = { id, level, source, observedAt, payload };
  return { ...record, digest: digest(record) };
}

export function verifyEvidence(record) {
  if (!record || !EVIDENCE_LEVELS.includes(record.level)) return false;
  const { digest: claimedDigest, ...body } = record;
  return claimedDigest === digest(body);
}

function levelIndex(level) {
  return EVIDENCE_LEVELS.indexOf(level);
}

export class ProvenanceGate {
  constructor({ minimumScore = 0.7, maximumAgeMs = 86_400_000, requiredLevel = "local-self-test" } = {}) {
    if (!EVIDENCE_LEVELS.includes(requiredLevel)) throw new Error("unknown_required_level");
    this.minimumScore = minimumScore;
    this.maximumAgeMs = maximumAgeMs;
    this.requiredLevel = requiredLevel;
  }

  evaluate(candidate, evidenceRecords, { now = Date.now() } = {}) {
    const evidenceById = new Map(evidenceRecords.map((record) => [record.id, record]));
    const reasons = [];
    const linked = (candidate.evidenceIds ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
    const valid = linked.filter(verifyEvidence);
    if (valid.length !== linked.length) reasons.push("invalid_or_tampered_evidence");
    if (valid.length === 0) reasons.push("no_valid_evidence");
    const fresh = valid.filter((record) => Number.isSafeInteger(record.observedAt) && now - record.observedAt <= this.maximumAgeMs);
    if (fresh.length !== valid.length) reasons.push("stale_evidence");
    const requiredIndex = levelIndex(this.requiredLevel);
    const sufficient = fresh.filter((record) => levelIndex(record.level) >= requiredIndex);
    if (sufficient.length === 0) reasons.push(`required_level_not_met:${this.requiredLevel}`);

    const claims = Array.isArray(candidate.claims) ? candidate.claims : [];
    const supportedClaims = claims.filter((claim) => Array.isArray(claim.evidenceIds)
      && claim.evidenceIds.length > 0
      && claim.evidenceIds.every((id) => sufficient.some((record) => record.id === id)));
    if (supportedClaims.length !== claims.length) reasons.push("unsupported_claims");

    const evidenceScore = valid.length === 0 ? 0 : sufficient.length / valid.length;
    const claimScore = claims.length === 0 ? 0 : supportedClaims.length / claims.length;
    const completeness = typeof candidate.output === "string" && candidate.output.trim() ? 1 : 0;
    const score = evidenceScore * 0.45 + claimScore * 0.4 + completeness * 0.15;
    if (score < this.minimumScore) reasons.push("score_below_threshold");

    return {
      accepted: reasons.length === 0,
      score,
      reasons: [...new Set(reasons)],
      validEvidenceIds: valid.map((record) => record.id),
      sufficientEvidenceIds: sufficient.map((record) => record.id),
      candidateDigest: digest(candidate),
    };
  }

  choose(candidates, evidenceRecords, options) {
    const evaluated = candidates.map((candidate) => ({ candidate, gate: this.evaluate(candidate, evidenceRecords, options) }));
    evaluated.sort((a, b) => b.gate.score - a.gate.score || a.gate.candidateDigest.localeCompare(b.gate.candidateDigest));
    return { selected: evaluated.find((item) => item.gate.accepted) ?? null, evaluated };
  }
}

