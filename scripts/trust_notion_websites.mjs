import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeUrl } from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_BACKUP_DIR = path.join("data", "backups");

const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const backupDir = valueAfter("--backup-dir") ?? DEFAULT_BACKUP_DIR;
const retrievedAt = valueAfter("--retrieved-at") ?? new Date().toISOString();
const dryRun = args().has("--dry-run");
const skipBackup = args().has("--no-backup");

const companies = JSON.parse(await readFile(dbPath, "utf8"));
if (!Array.isArray(companies)) throw new Error(`${dbPath} must contain a JSON array`);

let updated = 0;
const trusted = companies.map((company) => {
  if (!hasTrustedNotionWebsite(company)) return company;
  updated += 1;
  return {
    ...company,
    website_final_url: company.website_final_url ?? normalizeUrl(company.website_url),
    website_status: "verified",
    website_confidence: 99,
    website_checked_at: retrievedAt,
    website_validation_notes: "Website URL comes from the trusted Petr Novikov Notion source.",
  };
});

let backupPath = null;
if (!dryRun) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  if (!skipBackup) {
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${path.basename(dbPath, ".json")}.${fileSafeTimestamp(retrievedAt)}.json`);
    await copyFile(dbPath, backupPath);
  }
  await writeFile(dbPath, `${JSON.stringify(trusted, null, 2)}\n`);
}

console.log(JSON.stringify({
  mode: dryRun ? "dry_run" : "apply",
  trusted_notion_websites: updated,
  total_companies: trusted.length,
  backup_path: backupPath,
}, null, 2));

function hasTrustedNotionWebsite(company) {
  const normalizedWebsiteUrl = normalizeUrl(company.website_url);
  if (!normalizedWebsiteUrl) return false;
  return (company.source_records ?? []).some((source) => {
    if (!isTrustedNotionSource(source)) return false;
    const observedUrl = normalizeUrl(source.observed_fields?.website_url);
    return Boolean(observedUrl);
  });
}

function isTrustedNotionSource(source) {
  return (
    source?.source_name === "Petr Novikov Robotics Database" ||
    String(source?.source_id ?? "").startsWith("notion:") ||
    String(source?.source_url ?? "").includes("petrnovikov.notion.site") ||
    String(source?.observed_fields?.notion_page_url ?? "").includes("petrnovikov.notion.site")
  );
}

function args() {
  return new Set(process.argv.slice(2));
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fileSafeTimestamp(value) {
  return String(value).replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-|-$/g, "");
}
