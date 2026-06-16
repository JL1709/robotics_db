import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeCompanies, expandCanonicalCompanies } from "./company_normalization.mjs";

const DEFAULT_PATH = path.join("data", "robotics_companies.json");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const inputPath = process.argv[2]?.startsWith("--") ? DEFAULT_PATH : process.argv[2] ?? DEFAULT_PATH;
const outputPath = argValue("--out") ?? inputPath;
const retrievedAt = argValue("--retrieved-at") ?? new Date().toISOString();

const raw = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(raw)) {
  throw new Error(`${inputPath} must contain a JSON array`);
}

const sourceRows = expandCanonicalCompanies(raw);
const canonical = canonicalizeCompanies(sourceRows, { retrievedAt });

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(canonical, null, 2)}\n`);

const duplicateGroups = canonical.filter((company) => company.source_count > 1);
const statusCounts = canonical.reduce((counts, company) => {
  const status = company.status ?? "(missing)";
  counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}, {});

console.log(
  `Normalized ${sourceRows.length} source records from ${raw.length} input rows into ${canonical.length} canonical companies at ${outputPath}`,
);
console.log(`Merged duplicate groups: ${duplicateGroups.length}`);
console.log(JSON.stringify(statusCounts, null, 2));
