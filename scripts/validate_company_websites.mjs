import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeCompanies,
  domainFromUrl,
  expandCanonicalCompanies,
  normalizeUrl,
} from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_VALIDATION_ROWS_PATH = path.join("data", "website_validation_records.json");
const VALIDATION_NAMESPACE = "website_validation";
const VALIDATION_SOURCE_NAME = "Automated Website Validation";
const USER_AGENT = "RoboticsMarketAtlas/0.1 website-validation";
const MAX_SNIPPET_BYTES = 96 * 1024;
const LEGAL_SUFFIXES = new Set([
  "a",
  "ab",
  "ag",
  "aps",
  "as",
  "bv",
  "co",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "inc",
  "incorporated",
  "kk",
  "limited",
  "llc",
  "ltd",
  "oy",
  "oyj",
  "plc",
  "pte",
  "sa",
  "sarl",
  "srl",
]);
const GENERIC_NAME_TOKENS = new Set([
  "ai",
  "automation",
  "autonomous",
  "robot",
  "robotics",
  "solution",
  "solutions",
  "system",
  "systems",
  "tech",
  "technologies",
  "technology",
]);

const args = new Set(process.argv.slice(2));
const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const validationRowsPath = valueAfter("--validation-rows") ?? DEFAULT_VALIDATION_ROWS_PATH;
const retrievedAt = valueAfter("--retrieved-at") ?? new Date().toISOString();
const concurrency = numberAfter("--concurrency", 16);
const timeoutMs = numberAfter("--timeout-ms", 6500);
const limit = valueAfter("--limit") ? numberAfter("--limit", null) : null;
const countryFilter = valueAfter("--country");
const dryRun = args.has("--dry-run");
const rebuildFromValidationRows = args.has("--rebuild-from-validation-rows");

const existing = JSON.parse(await readFile(dbPath, "utf8"));
if (!Array.isArray(existing)) {
  throw new Error(`${dbPath} must contain a JSON array`);
}

const expandedRows = expandCanonicalCompanies(existing);
const priorValidationRows = expandedRows.filter((row) => sourceNamespace(row) === VALIDATION_NAMESPACE);
const sourceRows = expandedRows.filter((row) => sourceNamespace(row) !== VALIDATION_NAMESPACE);
const baselineCanonical = canonicalizeCompanies(sourceRows, { retrievedAt });

if (rebuildFromValidationRows) {
  const savedValidationRows = JSON.parse(await readFile(validationRowsPath, "utf8"));
  if (!Array.isArray(savedValidationRows)) {
    throw new Error(`${validationRowsPath} must contain a JSON array`);
  }
  const currentValidationRows = savedValidationRows.map((row) => ({
    ...row,
    source_record_id: validationRecordId(row),
  }));
  const refreshedCanonical = canonicalizeCompanies([...sourceRows, ...currentValidationRows], { retrievedAt });

  if (!dryRun) {
    await mkdir(path.dirname(dbPath), { recursive: true });
    await mkdir(path.dirname(validationRowsPath), { recursive: true });
    await writeFile(dbPath, `${JSON.stringify(refreshedCanonical, null, 2)}\n`);
    await writeFile(validationRowsPath, `${JSON.stringify(currentValidationRows, null, 2)}\n`);
  }

  console.log(`Rebuilt ${currentValidationRows.length} validation rows${dryRun ? " (dry run)" : ""}`);
  console.log(JSON.stringify(countBy(currentValidationRows, (row) => row.website_status), null, 2));
  if (!dryRun) {
    console.log(`Wrote ${refreshedCanonical.length} canonical companies to ${dbPath}`);
    console.log(`Wrote ${currentValidationRows.length} validation source rows to ${validationRowsPath}`);
  }
  process.exit(0);
}

let candidates = baselineCanonical;
if (countryFilter) {
  candidates = candidates.filter((company) => (company.country ?? []).includes(countryFilter));
}
if (limit !== null) {
  candidates = candidates.slice(0, Math.max(0, limit));
}

const validationResults = await mapWithConcurrency(candidates, concurrency, (company) =>
  validateCompanyWebsite(company, retrievedAt, timeoutMs),
);
const validationRows = validationResults.map((result) => validationSourceRow(result, retrievedAt));
const validatedIds = new Set(validationRows.map((row) => row.source_record_id));
const keepPriorRows = limit !== null || countryFilter;
const retainedValidationRows = keepPriorRows
  ? priorValidationRows.filter((row) => !validatedIds.has(row.source_record_id))
  : [];
const currentValidationRows = [...retainedValidationRows, ...validationRows];
const refreshedCanonical = canonicalizeCompanies([...sourceRows, ...currentValidationRows], { retrievedAt });

if (!dryRun) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  await mkdir(path.dirname(validationRowsPath), { recursive: true });
  await writeFile(dbPath, `${JSON.stringify(refreshedCanonical, null, 2)}\n`);
  await writeFile(validationRowsPath, `${JSON.stringify(currentValidationRows, null, 2)}\n`);
}

const statusCounts = countBy(validationRows, (row) => row.website_status);
const allStatusCounts = countBy(currentValidationRows, (row) => row.website_status);
console.log(`Validated ${validationRows.length} companies${dryRun ? " (dry run)" : ""}`);
console.log(JSON.stringify(statusCounts, null, 2));
if (keepPriorRows) {
  console.log(`Validation rows retained from previous runs: ${retainedValidationRows.length}`);
  console.log(JSON.stringify(allStatusCounts, null, 2));
}
if (!dryRun) {
  console.log(`Wrote ${refreshedCanonical.length} canonical companies to ${dbPath}`);
  console.log(`Wrote ${currentValidationRows.length} validation source rows to ${validationRowsPath}`);
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

async function validateCompanyWebsite(company, checkedAt, requestTimeoutMs) {
  const websiteUrl = typeof company.website_url === "string" ? normalizeUrl(company.website_url) : null;
  const base = {
    company_name: company.company_name,
    canonical_company_id: company.canonical_company_id ?? company.company_id,
    website_url: websiteUrl,
    website_checked_at: checkedAt,
  };

  if (!websiteUrl) {
    return result(base, "missing", 0, "No website_url is present.");
  }
  if (hasTrustedNotionWebsite(company, websiteUrl)) {
    return result(
      { ...base, website_final_url: websiteUrl },
      "verified",
      99,
      "Website URL comes from the trusted Petr Novikov Notion source.",
    );
  }
  if (!isHttpUrl(websiteUrl)) {
    return result(base, "invalid_url", 0, "website_url is not an HTTP(S) URL.");
  }
  if (isLocalUrl(websiteUrl)) {
    return result(base, "local_url", 0, "website_url points at localhost or a private loopback host.");
  }
  if (isDirectoryProfileUrl(company, websiteUrl)) {
    return result(base, "directory_profile_url", 10, "website_url points at a known source/directory profile domain.");
  }

  try {
    const response = await fetchWebsiteSnippet(websiteUrl, requestTimeoutMs);
    const finalUrl = normalizeUrl(response.final_url);
    const responseBase = {
      ...base,
      website_final_url: finalUrl,
      website_http_status: response.http_status,
    };

    if (finalUrl && isLocalUrl(finalUrl)) {
      return result(responseBase, "local_url", 0, "Final URL redirects to localhost or a private loopback host.");
    }
    if (finalUrl && isDirectoryProfileUrl(company, finalUrl)) {
      return result(responseBase, "directory_profile_url", 10, "Final URL points at a known source/directory profile domain.");
    }
    if (!response.ok) {
      return result(
        responseBase,
        "broken",
        15,
        `HTTP request failed with ${response.http_status}${response.status_text ? ` ${response.status_text}` : ""}.`,
      );
    }
    if (isParkedOrForSale(response.snippet, finalUrl)) {
      return result(responseBase, "parked_or_for_sale", 20, "Page appears to be parked, for sale, or domain-holding content.");
    }

    const evidence = websiteOwnershipEvidence(company, finalUrl, response.snippet);
    if (evidence.length) {
      return result(responseBase, "verified", 90, evidence.join("; "));
    }

    return result(
      responseBase,
      "reachable_unmatched",
      60,
      "Website is reachable, but the first page did not expose a strong company-name match.",
    );
  } catch (error) {
    return result(base, "broken", 15, error.name === "AbortError" ? "Request timed out." : error.message);
  }
}

function result(base, status, confidence, notes) {
  return {
    ...base,
    website_status: status,
    website_confidence: confidence,
    website_validation_notes: notes,
  };
}

async function fetchWebsiteSnippet(url, requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": USER_AGENT,
      },
    });

    return {
      ok: response.ok,
      http_status: response.status,
      status_text: response.statusText,
      final_url: response.url,
      snippet: await readResponseSnippet(response, MAX_SNIPPET_BYTES),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseSnippet(response, maxBytes) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (totalBytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.byteLength;
  }

  try {
    await reader.cancel();
  } catch {
    // Some streams are already closed after the final read.
  }

  const merged = new Uint8Array(Math.min(totalBytes, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.slice(0, Math.max(0, maxBytes - offset));
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= maxBytes) break;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function websiteOwnershipEvidence(company, finalUrl, snippet) {
  const evidence = [];
  const host = domainFromUrl(finalUrl) ?? "";
  const hostText = host.replace(/[^a-z0-9]+/gi, " ").toLowerCase();
  const title = htmlToText(String(snippet ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const pageText = htmlToText(snippet).toLowerCase();
  const tokens = companyNameTokens(company.company_name);
  const phrase = tokens.join(" ");

  if (tokens.some((token) => token.length >= 4 && hostText.includes(token))) {
    evidence.push("company-name token appears in hostname");
  }
  if (phrase && normalizeText(title).includes(phrase)) {
    evidence.push("company name appears in page title");
  }
  if (phrase && pageText.includes(phrase)) {
    evidence.push("company name appears in homepage text");
  }
  if (tokens.length >= 2) {
    const matchedTokens = tokens.filter((token) => token.length >= 3 && pageText.includes(token));
    if (matchedTokens.length >= Math.min(2, tokens.length)) {
      evidence.push("multiple company-name tokens appear in homepage text");
    }
  }

  return evidence;
}

function validationSourceRow(validation, checkedAt) {
  const sourceRecordId = validationRecordId(validation);

  return compactRecord({
    company_name: validation.company_name,
    website_url: validation.website_url,
    website_status: validation.website_status,
    website_final_url: validation.website_final_url,
    website_checked_at: validation.website_checked_at,
    website_http_status: validation.website_http_status,
    website_confidence: validation.website_confidence,
    website_validation_notes: validation.website_validation_notes,
    source_namespace: VALIDATION_NAMESPACE,
    source_record_id: sourceRecordId,
    source_name: VALIDATION_SOURCE_NAME,
    source_type: "automated_data_quality_check",
    source_url: validation.website_url,
    source_confidence: validation.website_confidence,
    extraction_method: "http_fetch_redirect_and_homepage_name_check",
    retrieved_at: checkedAt,
  });
}

function validationRecordId(validation) {
  const raw = [
    validation.canonical_company_id,
    validation.company_name,
    validation.website_url,
  ]
    .filter(Boolean)
    .join("|") || "company";
  const slug = slugify(raw);
  const readable = slug && !["name", "domain", "company"].includes(slug) ? slug : "company";
  return `${readable.slice(0, 100)}-${stableHash(raw)}`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

function isDirectoryProfileUrl(company, value) {
  const host = domainFromUrl(value);
  if (!host) return false;
  const sourceHosts = new Set(
    (company.source_records ?? [])
      .map((source) => domainFromUrl(source.source_url))
      .filter(Boolean),
  );

  return sourceHosts.has(host) && isKnownDirectoryHost(host);
}

function isKnownDirectoryHost(host) {
  const directoryHosts = [
    "45bwzj1sgc-dsn.algolia.net",
    "8gbms7c94riane0lp-1.a1.typesense.net",
    "alchemistaccelerator.com",
    "api.membershipworks.com",
    "automate-uk.com",
    "automate.org",
    "cordis.europa.eu",
    "eic.ec.europa.eu",
    "hax.co",
    "jara.jp",
    "massrobotics.org",
    "odenserobotics.dk",
    "openalex.org",
    "osralliance.org",
    "playbook.vc",
    "robopgh.org",
    "rosindustrial.org",
    "sosv.com",
    "startupsg.gov.sg",
    "tairoa.org.tw",
    "techstars.com",
    "wikidata.org",
    "wikipedia.org",
    "worldrobotconference.com",
    "ycombinator.com",
  ];

  return directoryHosts.some((directoryHost) => host === directoryHost || host.endsWith(`.${directoryHost}`));
}

function isParkedOrForSale(snippet, finalUrl) {
  const text = `${finalUrl} ${htmlToText(snippet)}`;
  return /\b(domain (?:is )?for sale|buy this domain|this domain may be for sale|parkingcrew|sedo\.com|afternic|dan\.com|hugedomains|namecheap parking|godaddy parked|undeveloped\.com)\b/i.test(text);
}

function companyNameTokens(value) {
  const tokens = normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !LEGAL_SUFFIXES.has(token));
  const strongTokens = tokens.filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token));
  return strongTokens.length ? strongTokens : tokens.filter((token) => token.length >= 3);
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function htmlToText(value) {
  return decodeHtml(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sourceNamespace(row) {
  if (row.source_namespace) return row.source_namespace;
  if (typeof row.source_id === "string" && row.source_id.includes(":")) return row.source_id.split(":")[0];
  return null;
}

function hasTrustedNotionWebsite(company, websiteUrl) {
  const normalizedWebsiteUrl = normalizeUrl(websiteUrl);
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

async function mapWithConcurrency(items, maxConcurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function compactRecord(record) {
  const compact = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    compact[key] = value;
  }
  return compact;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
