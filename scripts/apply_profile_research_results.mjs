import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeCompanies,
  domainFromUrl,
  expandCanonicalCompanies,
  normalizeUrl,
} from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_INPUT_PATH = path.join("data", "subagent_profile_research_results.json");
const DEFAULT_RECORDS_PATH = path.join("data", "subagent_profile_research_records.json");
const DEFAULT_REVIEW_QUEUE_PATH = path.join("data", "subagent_profile_research_review_queue.json");
const DEFAULT_BACKUP_DIR = path.join("data", "backups");
const SOURCE_NAMESPACE = "codex_subagent_profile_research";
const SOURCE_NAME = "Codex Subagent Web Research";
const SOURCE_TYPE = "manual_web_research";

const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const inputPath = valueAfter("--input") ?? DEFAULT_INPUT_PATH;
const recordsPath = valueAfter("--records") ?? DEFAULT_RECORDS_PATH;
const reviewQueuePath = valueAfter("--review-queue") ?? DEFAULT_REVIEW_QUEUE_PATH;
const backupDir = valueAfter("--backup-dir") ?? DEFAULT_BACKUP_DIR;
const retrievedAt = valueAfter("--retrieved-at") ?? new Date().toISOString();
const threshold = numberAfter("--threshold", 80);
const apply = args().has("--apply");
const dryRun = args().has("--dry-run") || !apply;
const replacePriorRows = args().has("--replace");
const skipBackup = args().has("--no-backup");
const inPlace = args().has("--in-place");

const existing = JSON.parse(await readFile(dbPath, "utf8"));
const researchResults = JSON.parse(await readFile(inputPath, "utf8"));

if (!Array.isArray(existing)) throw new Error(`${dbPath} must contain a JSON array`);
if (!Array.isArray(researchResults)) throw new Error(`${inputPath} must contain a JSON array`);

const expandedRows = expandCanonicalCompanies(existing);
const priorResearchRows = expandedRows.filter((row) => sourceNamespace(row) === SOURCE_NAMESPACE);
const nonResearchRows = expandedRows.filter((row) => sourceNamespace(row) !== SOURCE_NAMESPACE);

const acceptedRows = researchResults
  .filter((result) => isAcceptedResult(result, threshold))
  .map((result) => researchSourceRow(result, retrievedAt));
const candidateRows = researchResults
  .filter((result) => !isAcceptedResult(result, threshold))
  .map((result) => candidateSourceRow(result, retrievedAt));
const acceptedIds = new Set(acceptedRows.map((row) => row.source_record_id));

let currentResearchRows = acceptedRows;
let refreshedCanonical = existing;
let inPlaceUpdated = 0;
let unmatchedAccepted = [];
let skippedTrusted = 0;

if (inPlace) {
  const inPlaceResult = mergeInPlace(existing, acceptedRows, candidateRows);
  refreshedCanonical = inPlaceResult.companies;
  currentResearchRows = [...acceptedRows, ...candidateRows];
  inPlaceUpdated = inPlaceResult.updated;
  unmatchedAccepted = inPlaceResult.unmatched;
  skippedTrusted = inPlaceResult.skippedTrusted;
} else {
  const retainedRows = replacePriorRows
    ? []
    : priorResearchRows.filter((row) => !acceptedIds.has(row.source_record_id));
  currentResearchRows = [...retainedRows, ...acceptedRows, ...candidateRows];
  refreshedCanonical = canonicalizeCompanies([...nonResearchRows, ...currentResearchRows], {
    retrievedAt,
  });
}

const reviewQueue = researchResults
  .filter((result) => !isAcceptedResult(result, threshold))
  .map((result) => ({
    company_name: result.company_name ?? null,
    country: result.country ?? null,
    proposed_website_url: result.proposed_website_url ?? null,
    proposed_short_description: cleanDescription(result.proposed_short_description),
    evidence_urls: normalizeEvidenceUrls(result.evidence_urls),
    confidence: numericConfidence(result.confidence),
    status: result.status ?? null,
    notes: result.notes ?? null,
  }));

let backupPath = null;
if (!dryRun) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  await mkdir(path.dirname(recordsPath), { recursive: true });
  await mkdir(path.dirname(reviewQueuePath), { recursive: true });
  if (!skipBackup) {
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${path.basename(dbPath, ".json")}.${fileSafeTimestamp(retrievedAt)}.json`);
    await copyFile(dbPath, backupPath);
  }
  await writeFile(dbPath, `${JSON.stringify(refreshedCanonical, null, 2)}\n`);
  await writeFile(recordsPath, `${JSON.stringify(currentResearchRows, null, 2)}\n`);
  await writeFile(reviewQueuePath, `${JSON.stringify(reviewQueue, null, 2)}\n`);
}

console.log(JSON.stringify({
  mode: dryRun ? "dry_run" : "apply",
  input_results: researchResults.length,
  accepted: acceptedRows.length,
  candidates: candidateRows.length,
  in_place: inPlace,
  in_place_updated: inPlaceUpdated,
  unmatched_accepted: unmatchedAccepted.length,
  skipped_trusted_notion: skippedTrusted,
  review_queue: reviewQueue.length,
  threshold,
  canonical_companies: refreshedCanonical.length,
  backup_path: backupPath,
}, null, 2));

function isAcceptedResult(result, minimumConfidence) {
  const confidence = numericConfidence(result.confidence);
  const websiteUrl = normalizeUrl(result.proposed_website_url);
  const description = cleanDescription(result.proposed_short_description);
  return result.status === "accepted" && confidence >= minimumConfidence && Boolean(websiteUrl || description);
}

function researchSourceRow(result, checkedAt) {
  const websiteUrl = normalizeUrl(result.proposed_website_url);
  const description = cleanDescription(result.proposed_short_description);
  const evidenceUrls = normalizeEvidenceUrls(result.evidence_urls);
  const sourceUrl = evidenceUrls[0] ?? websiteUrl;
  const confidence = numericConfidence(result.confidence);

  return compactRecord({
    company_name: String(result.company_name ?? "").trim(),
    website_url: websiteUrl,
    short_description: description,
    website_checked_at: checkedAt,
    website_confidence: confidence,
    website_final_url: websiteUrl,
    website_status: websiteUrl ? "verified" : undefined,
    website_validation_notes: [result.notes, evidenceUrls.length ? `Evidence: ${evidenceUrls.join(", ")}` : ""]
      .filter(Boolean)
      .join("; "),
    profile_review_status: "verified",
    source_namespace: SOURCE_NAMESPACE,
    source_record_id: researchRecordId(result),
    source_name: SOURCE_NAME,
    source_type: SOURCE_TYPE,
    source_url: sourceUrl,
    source_confidence: confidence,
    extraction_method: "codex_subagent_web_research",
    retrieved_at: checkedAt,
  });
}

function candidateSourceRow(result, checkedAt) {
  const websiteUrl = normalizeUrl(result.proposed_website_url);
  const description = cleanDescription(result.proposed_short_description);
  const evidenceUrls = normalizeEvidenceUrls(result.evidence_urls);
  const sourceUrl = evidenceUrls[0] ?? websiteUrl;
  const confidence = numericConfidence(result.confidence);
  const status = result.status === "not_found" ? "not_found" : "needs_review";

  return compactRecord({
    company_name: String(result.company_name ?? "").trim(),
    candidate_website_url: websiteUrl,
    candidate_short_description: description,
    candidate_confidence: confidence,
    candidate_status: result.status ?? "uncertain",
    candidate_evidence_urls: evidenceUrls,
    candidate_notes: result.notes,
    profile_review_status: status,
    source_namespace: SOURCE_NAMESPACE,
    source_record_id: researchRecordId(result),
    source_name: SOURCE_NAME,
    source_type: SOURCE_TYPE,
    source_url: sourceUrl,
    source_confidence: confidence,
    extraction_method: "codex_subagent_web_research_candidate",
    retrieved_at: checkedAt,
  });
}

function mergeInPlace(companies, verifiedRows, candidateRowsToMerge) {
  const indexByName = new Map();
  companies.forEach((company, index) => {
    indexByName.set(normalizeCompanyName(company.company_name), index);
  });

  const merged = companies.map((company) => structuredClone(company));
  const unmatched = [];
  let updated = 0;
  let skippedTrusted = 0;

  for (const row of verifiedRows) {
    const index = indexByName.get(normalizeCompanyName(row.company_name));
    if (index === undefined) {
      unmatched.push(row.company_name);
      continue;
    }
    if (hasTrustedNotionWebsite(merged[index])) {
      skippedTrusted += 1;
      continue;
    }

    merged[index] = mergeCompanyInPlace(merged[index], row);
    updated += 1;
  }

  for (const row of candidateRowsToMerge) {
    const index = indexByName.get(normalizeCompanyName(row.company_name));
    if (index === undefined) continue;
    if (hasTrustedNotionWebsite(merged[index])) {
      skippedTrusted += 1;
      continue;
    }
    merged[index] = mergeCompanyInPlace(merged[index], row);
  }

  return { companies: merged, updated, unmatched, skippedTrusted };
}

function mergeCompanyInPlace(company, row) {
  const sourceRecord = canonicalSourceRecord(row);
  const sourceId = sourceRecord.source_id;
  const observed = sourceRecord.observed_fields;
  const fields = sourceRecord.fields;
  const merged = { ...company };

  for (const [field, value] of Object.entries(observed)) {
    if (field === "company_name") continue;
    if (field === "short_description" && !isMissingDescription(merged.short_description)) continue;
    if (value !== undefined && value !== null && value !== "") merged[field] = value;
  }

  if (observed.website_url) {
    const domain = domainFromUrl(observed.website_url);
    if (domain) {
      merged.canonical_domain = domain;
      merged.canonical_company_id = `domain:${domain}`;
      merged.company_id = merged.canonical_company_id;
    }
  }

  const sourceRecords = Array.isArray(merged.source_records) ? [...merged.source_records] : [];
  const existingIndex = sourceRecords.findIndex((source) => source.source_id === sourceId);
  if (existingIndex >= 0) {
    sourceRecords[existingIndex] = sourceRecord;
  } else {
    sourceRecords.push(sourceRecord);
  }
  merged.source_records = sourceRecords;
  merged.source_count = sourceRecords.length;
  merged.source_record_ids = uniqueValues([...(merged.source_record_ids ?? []), sourceId]);

  const fieldSources = { ...(merged.field_sources ?? {}) };
  for (const field of fields) {
    fieldSources[field] = uniqueValues([...(fieldSources[field] ?? []), sourceId]);
  }
  merged.field_sources = fieldSources;

  return merged;
}

function canonicalSourceRecord(row) {
  const observedFields = {};
  for (const field of [
    "company_name",
    "website_url",
    "short_description",
    "website_checked_at",
    "website_confidence",
    "website_final_url",
    "website_status",
    "website_validation_notes",
  ]) {
    if (row[field] !== undefined && row[field] !== null && row[field] !== "") {
      observedFields[field] = row[field];
    }
  }
  for (const field of [
    "candidate_website_url",
    "candidate_short_description",
    "candidate_confidence",
    "candidate_status",
    "candidate_evidence_urls",
    "candidate_notes",
    "profile_review_status",
  ]) {
    if (row[field] !== undefined && row[field] !== null && row[field] !== "") {
      observedFields[field] = row[field];
    }
  }

  return {
    source_id: `${SOURCE_NAMESPACE}:${row.source_record_id}`,
    source_name: row.source_name,
    source_type: row.source_type,
    source_url: row.source_url,
    source_record_id: row.source_record_id,
    source_record_created_at: null,
    source_record_last_edited_at: null,
    retrieved_at: row.retrieved_at,
    confidence: row.source_confidence,
    extraction_method: row.extraction_method,
    fields: Object.keys(observedFields).sort((a, b) => a.localeCompare(b)),
    observed_fields: observedFields,
  };
}

function normalizeEvidenceUrls(value) {
  return uniqueValues((Array.isArray(value) ? value : []).map(normalizeUrl).filter(Boolean));
}

function cleanDescription(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 20) return null;
  return text.length > 240 ? `${text.slice(0, 237).replace(/\s+\S*$/, "")}...` : text;
}

function numericConfidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function isMissingDescription(value) {
  const text = String(value ?? "").trim();
  return !text || /^no description\.?$/i.test(text);
}

function normalizeCompanyName(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|pvt|private|llp|gmbh|ag|sa|sarl|bv|pte|plc|corp|corporation|co|company)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function hasTrustedNotionWebsite(company) {
  const normalizedWebsiteUrl = normalizeUrl(company.website_url);
  if (!normalizedWebsiteUrl) return false;
  return (company.source_records ?? []).some((source) => {
    if (!isTrustedNotionSource(source)) return false;
    const observedUrl = normalizeUrl(source.observed_fields?.website_url);
    return observedUrl && observedUrl === normalizedWebsiteUrl;
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

function researchRecordId(result) {
  const raw = [
    result.company_name,
    normalizeUrl(result.proposed_website_url),
    cleanDescription(result.proposed_short_description),
  ]
    .filter(Boolean)
    .join("|");
  return `${slugify(raw).slice(0, 96)}-${stableHash(raw)}`;
}

function compactRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && !value.trim()) return false;
      if (Array.isArray(value) && !value.length) return false;
      return true;
    }),
  );
}

function sourceNamespace(row) {
  if (row.source_namespace) return row.source_namespace;
  if (row.source_id?.includes(":")) return row.source_id.split(":")[0];
  return null;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function args() {
  return new Set(process.argv.slice(2));
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function numberAfter(name, fallback) {
  const value = valueAfter(name);
  if (value === null || value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${name} must be a number`);
  return numeric;
}

function fileSafeTimestamp(value) {
  return String(value).replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-|-$/g, "");
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "record";
}

function stableHash(value) {
  let hash = 5381;
  for (const character of String(value ?? "")) {
    hash = (hash * 33) ^ character.charCodeAt(0);
  }
  return (hash >>> 0).toString(36);
}
