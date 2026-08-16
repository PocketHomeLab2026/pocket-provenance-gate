#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runBenchmark } from "./benchmark.js";
import { formatReport } from "./formatters.js";
import { ProvenanceGate } from "./gate.js";

const { version } = createRequire(import.meta.url)("../package.json");

function usage() {
  return `pocket-provenance-gate

Usage:
  pocket-provenance-gate verify --candidate FILE --evidence FILE [options]
  pocket-provenance-gate benchmark --corpus FILE [options]

Options:
  --required-level LEVEL       Minimum evidence level (default: local-self-test)
  --maximum-age-ms NUMBER      Maximum evidence age (default: 86400000)
  --maximum-future-skew-ms N   Allowed clock skew (default: 60000)
  --minimum-score NUMBER       Acceptance threshold from 0 to 1 (default: 0.7)
  --maximum-input-bytes N      Reject an input file before reading above 4194304 bytes
  --now NUMBER                 Fixed Unix epoch milliseconds for reproducible checks
  --format json|junit|sarif    Output format (default: json)
  --output FILE                Write output to a file instead of stdout
  --help                       Show this help
  --version                    Show the installed version
`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help") options.help = true;
    else if (token.startsWith("--")) {
      const value = rest[index + 1];
      if (value == null || value.startsWith("--")) throw new Error(`missing_value:${token}`);
      options[token.slice(2)] = value;
      index += 1;
    } else throw new Error(`unexpected_argument:${token}`);
  }
  return { command, options };
}

async function readJson(path, maximumInputBytes) {
  const absolutePath = resolve(path);
  const metadata = await stat(absolutePath);
  if (metadata.size > maximumInputBytes) throw new Error(`input_file_too_large:${path}`);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function numericOption(options, name, fallback) {
  if (options[name] == null) return fallback;
  const value = Number(options[name]);
  if (!Number.isFinite(value)) throw new Error(`invalid_number:--${name}`);
  return value;
}

async function verifyCommand(options) {
  if (!options.candidate || !options.evidence) throw new Error("candidate_and_evidence_required");
  const maximumInputBytes = numericOption(options, "maximum-input-bytes", 4_194_304);
  if (!Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 1) throw new Error("invalid_maximum_input_bytes");
  const candidate = await readJson(options.candidate, maximumInputBytes);
  const evidence = await readJson(options.evidence, maximumInputBytes);
  const now = numericOption(options, "now", Date.now());
  const gate = new ProvenanceGate({
    requiredLevel: options["required-level"] ?? "local-self-test",
    maximumAgeMs: numericOption(options, "maximum-age-ms", 86_400_000),
    maximumFutureSkewMs: numericOption(options, "maximum-future-skew-ms", 60_000),
    minimumScore: numericOption(options, "minimum-score", 0.7),
  }).evaluate(candidate, evidence, { now });
  return {
    kind: "verification",
    now,
    cases: [{
      id: "verification",
      description: "candidate satisfies the requested provenance policy",
      expectedAccepted: true,
      observedAccepted: gate.accepted,
      passed: gate.accepted,
      gate,
    }],
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "--version" || command === "version") {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  if (!command || options.help || command === "help") {
    process.stdout.write(usage());
    return 0;
  }
  let report;
  if (command === "verify") report = await verifyCommand(options);
  else if (command === "benchmark") {
    if (!options.corpus) throw new Error("benchmark_corpus_required");
    const maximumInputBytes = numericOption(options, "maximum-input-bytes", 4_194_304);
    if (!Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 1) throw new Error("invalid_maximum_input_bytes");
    report = runBenchmark(await readJson(options.corpus, maximumInputBytes));
  } else throw new Error(`unknown_command:${command}`);
  const output = formatReport(report, options.format ?? "json");
  if (options.output) await writeFile(resolve(options.output), output, "utf8");
  else process.stdout.write(output);
  return report.cases.every((item) => item.passed) ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`pocket-provenance-gate: ${String(error.message ?? error)}\n`);
  process.exitCode = 2;
}
