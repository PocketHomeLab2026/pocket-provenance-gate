function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeReport(report) {
  if (!report || !Array.isArray(report.cases)) throw new TypeError("report_cases_required");
  return {
    ...report,
    total: report.cases.length,
    passed: report.cases.filter((item) => item.passed).length,
    failed: report.cases.filter((item) => !item.passed).length,
  };
}

export function formatJson(report) {
  return `${JSON.stringify(normalizeReport(report), null, 2)}\n`;
}

export function formatJUnit(report) {
  const normalized = normalizeReport(report);
  const testcases = normalized.cases.map((item) => {
    const header = `  <testcase classname="pocket-provenance-gate" name="${xmlEscape(item.id)}">`;
    if (item.passed) return `${header}</testcase>`;
    const reasons = item.gate?.reasons?.join(", ") || item.error || "expectation_mismatch";
    return `${header}<failure message="${xmlEscape(reasons)}">${xmlEscape(JSON.stringify(item.gate ?? item))}</failure></testcase>`;
  }).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="pocket-provenance-gate" tests="${normalized.total}" failures="${normalized.failed}">`,
    testcases,
    "</testsuite>",
    "",
  ].join("\n");
}

function sarifRuleId(item) {
  const reason = item.gate?.reasons?.[0] ?? item.error ?? "expectation_mismatch";
  return `provenance/${String(reason).replaceAll(/[^A-Za-z0-9._/-]/g, "-")}`;
}

export function formatSarif(report) {
  const normalized = normalizeReport(report);
  const failures = normalized.cases.filter((item) => !item.passed);
  const ruleIds = [...new Set(failures.map(sarifRuleId))];
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "pocket-provenance-gate",
          informationUri: "https://github.com/PocketHomeLab2026/pocket-provenance-gate",
          rules: ruleIds.map((id) => ({ id, shortDescription: { text: id.replace("provenance/", "") } })),
        },
      },
      results: failures.map((item) => ({
        ruleId: sarifRuleId(item),
        level: "error",
        message: { text: `${item.id}: ${(item.gate?.reasons ?? [item.error ?? "expectation_mismatch"]).join(", ")}` },
        properties: {
          caseId: item.id,
          candidateDigest: item.gate?.candidateDigest ?? null,
          score: item.gate?.score ?? null,
        },
      })),
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

export function formatReport(report, format = "json") {
  if (format === "json") return formatJson(report);
  if (format === "junit") return formatJUnit(report);
  if (format === "sarif") return formatSarif(report);
  throw new Error(`unsupported_format:${format}`);
}
