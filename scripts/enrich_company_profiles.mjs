import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeCompanies,
  domainFromUrl,
  expandCanonicalCompanies,
  normalizeUrl,
} from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_ENRICHMENT_ROWS_PATH = path.join("data", "web_profile_enrichment_records.json");
const DEFAULT_REVIEW_QUEUE_PATH = path.join("data", "web_profile_enrichment_review_queue.json");
const DEFAULT_BACKUP_DIR = path.join("data", "backups");
const ENRICHMENT_NAMESPACE = "web_profile_enrichment";
const ENRICHMENT_SOURCE_NAME = "Automated Web Profile Enrichment";
const USER_AGENT = "RoboticsMarketAtlas/0.2 company-profile-enrichment";
const MAX_SNIPPET_BYTES = 160 * 1024;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 9000;
const HIGH_CONFIDENCE_SCORE = 78;

const LEGAL_SUFFIXES = new Set([
  "ab",
  "ag",
  "aps",
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

const ROBOTICS_TERMS = [
  "robot",
  "robotics",
  "automation",
  "autonomous",
  "machine vision",
  "industrial vision",
  "cobot",
  "drone",
  "amr",
  "warehouse",
  "manufacturing",
];

const DIRECTORY_HOSTS = [
  "alchemistaccelerator.com",
  "automate-uk.com",
  "automate.org",
  "crunchbase.com",
  "cordis.europa.eu",
  "eic.ec.europa.eu",
  "facebook.com",
  "github.com",
  "hax.co",
  "linkedin.com",
  "massrobotics.org",
  "odenserobotics.dk",
  "openalex.org",
  "pitchbook.com",
  "playbook.vc",
  "robopgh.org",
  "rosindustrial.org",
  "sosv.com",
  "startupsg.gov.sg",
  "techstars.com",
  "theorg.com",
  "tracxn.com",
  "twitter.com",
  "wikidata.org",
  "wikipedia.org",
  "ycombinator.com",
  "youtube.com",
];

const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const enrichmentRowsPath = valueAfter("--enrichment-rows") ?? DEFAULT_ENRICHMENT_ROWS_PATH;
const reviewQueuePath = valueAfter("--review-queue") ?? DEFAULT_REVIEW_QUEUE_PATH;
const backupDir = valueAfter("--backup-dir") ?? DEFAULT_BACKUP_DIR;
const retrievedAt = valueAfter("--retrieved-at") ?? new Date().toISOString();
const concurrency = numberAfter("--concurrency", DEFAULT_CONCURRENCY);
const timeoutMs = numberAfter("--timeout-ms", DEFAULT_TIMEOUT_MS);
const limit = valueAfter("--limit") ? numberAfter("--limit", null) : null;
const companyFilter = valueAfter("--company");
const countryFilter = valueAfter("--country");
const includeExisting = args().has("--include-existing");
const apply = args().has("--apply");
const dryRun = args().has("--dry-run") || !apply;
const useSearch = !args().has("--no-search");
const maxDirectCandidates = numberAfter("--max-direct-candidates", 8);
const verbose = args().has("--verbose");
const replacePriorRows = args().has("--replace");
const skipBackup = args().has("--no-backup");

const existing = JSON.parse(await readFile(dbPath, "utf8"));
if (!Array.isArray(existing)) {
  throw new Error(`${dbPath} must contain a JSON array`);
}

const expandedRows = expandCanonicalCompanies(existing);
const priorEnrichmentRows = expandedRows.filter((row) => sourceNamespace(row) === ENRICHMENT_NAMESPACE);
const nonEnrichmentRows = expandedRows.filter((row) => sourceNamespace(row) !== ENRICHMENT_NAMESPACE);
const baselineCanonical = canonicalizeCompanies(nonEnrichmentRows, { retrievedAt });

let candidates = baselineCanonical.filter((company) =>
  includeExisting ? true : needsProfileEnrichment(company),
);
if (companyFilter) {
  const needle = normalizeText(companyFilter);
  candidates = candidates.filter((company) => normalizeText(company.company_name) === needle);
}
if (countryFilter) {
  candidates = candidates.filter((company) => (company.country ?? []).includes(countryFilter));
}
if (limit !== null) {
  candidates = candidates.slice(0, Math.max(0, limit));
}

const results = await mapWithConcurrency(candidates, concurrency, (company) =>
  enrichCompany(company, {
    maxDirectCandidates,
    retrievedAt,
    timeoutMs,
    useSearch,
  }),
);

const acceptedRows = results
  .filter((result) => result.accepted)
  .map((result) => enrichmentSourceRow(result, retrievedAt));
const acceptedIds = new Set(acceptedRows.map((row) => row.source_record_id));
const retainedRows = replacePriorRows
  ? []
  : priorEnrichmentRows.filter((row) => !acceptedIds.has(row.source_record_id));
const currentEnrichmentRows = [...retainedRows, ...acceptedRows];
const refreshedCanonical = canonicalizeCompanies([...nonEnrichmentRows, ...currentEnrichmentRows], {
  retrievedAt,
});

const reviewQueue = results
  .filter((result) => !result.accepted || result.review_candidates.length)
  .map((result) => ({
    company_name: result.company.company_name,
    canonical_company_id: result.company.canonical_company_id ?? result.company.company_id,
    existing_website_url: result.company.website_url ?? null,
    existing_short_description: result.company.short_description ?? null,
    accepted: result.accepted,
    accepted_url: result.accepted_url ?? null,
    accepted_score: result.accepted_score ?? null,
    accepted_description: result.accepted_description ?? null,
    notes: result.notes,
    candidates: result.review_candidates.slice(0, 8),
  }));

let backupPath = null;
if (!dryRun) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  await mkdir(path.dirname(enrichmentRowsPath), { recursive: true });
  await mkdir(path.dirname(reviewQueuePath), { recursive: true });
  if (!skipBackup) {
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${path.basename(dbPath, ".json")}.${fileSafeTimestamp(retrievedAt)}.json`);
    await copyFile(dbPath, backupPath);
  }
  await writeFile(dbPath, `${JSON.stringify(refreshedCanonical, null, 2)}\n`);
  await writeFile(enrichmentRowsPath, `${JSON.stringify(currentEnrichmentRows, null, 2)}\n`);
  await writeFile(reviewQueuePath, `${JSON.stringify(reviewQueue, null, 2)}\n`);
}

const summary = {
  mode: dryRun ? "dry_run" : "apply",
  searched: results.length,
  accepted: acceptedRows.length,
  review_queue: reviewQueue.length,
  search_provider: searchProviderName(),
  needs_profile_enrichment_total: baselineCanonical.filter(needsProfileEnrichment).length,
  backup_path: backupPath,
};

console.log(JSON.stringify(summary, null, 2));
if (dryRun && verbose) {
  console.log(JSON.stringify(reviewQueue.slice(0, 20), null, 2));
}
if (!dryRun) {
  if (backupPath) console.log(`Backed up previous canonical companies to ${backupPath}`);
  console.log(`Wrote ${refreshedCanonical.length} canonical companies to ${dbPath}`);
  console.log(`Wrote ${currentEnrichmentRows.length} enrichment source rows to ${enrichmentRowsPath}`);
  console.log(`Wrote ${reviewQueue.length} review queue rows to ${reviewQueuePath}`);
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

function needsProfileEnrichment(company) {
  if (hasTrustedNotionWebsite(company)) return false;
  return (
    !company.website_url ||
    ["missing", "invalid_url", "local_url", "directory_profile_url"].includes(company.website_status) ||
    isMissingDescription(company.short_description)
  );
}

function isMissingDescription(value) {
  const text = String(value ?? "").trim();
  return !text || /^no description\.?$/i.test(text);
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

async function enrichCompany(company, options) {
  const searchCandidates = options.useSearch ? await searchForCompany(company) : [];
  const directCandidates = directWebsiteCandidates(company, options.maxDirectCandidates);
  const existingCandidates = existingWebsiteCandidates(company);
  const rawCandidates = [...existingCandidates, ...searchCandidates, ...directCandidates];
  const candidates = uniqueCandidates(rawCandidates).filter((candidate) => !isDirectoryUrl(candidate.url));
  const evaluated = [];

  for (const candidate of candidates) {
    const evaluation = await evaluateCandidate(company, candidate, options.timeoutMs);
    evaluated.push(evaluation);
    if (evaluation.score >= HIGH_CONFIDENCE_SCORE) break;
  }

  evaluated.sort((a, b) => b.score - a.score || a.url.length - b.url.length);
  const best = evaluated[0];
  const accepted = Boolean(
    best &&
      best.score >= HIGH_CONFIDENCE_SCORE &&
      (best.website_url || best.short_description),
  );

  return {
    company,
    accepted,
    accepted_url: accepted ? best.website_url : null,
    accepted_score: accepted ? best.score : null,
    accepted_description: accepted ? best.short_description : null,
    accepted_candidate: accepted ? best : null,
    notes: accepted
      ? best.reasons.join("; ")
      : evaluated.length
        ? `Best candidate scored ${best.score}: ${best.url}`
        : "No candidate website could be evaluated.",
    review_candidates: evaluated.map((candidate) => ({
      url: candidate.url,
      final_url: candidate.final_url,
      score: candidate.score,
      title: candidate.title,
      description: candidate.short_description,
      reasons: candidate.reasons,
      source: candidate.source,
      http_status: candidate.http_status,
      error: candidate.error,
    })),
  };
}

function existingWebsiteCandidates(company) {
  return company.website_url
    ? [
        {
          url: company.website_url,
          source: "existing_website_url",
          baseScore: 20,
        },
      ]
    : [];
}

function directWebsiteCandidates(company, limit) {
  const slugs = companyDomainSlugs(company.company_name);
  const tlds = tldsForCompany(company);
  const candidates = [];

  for (const slug of slugs) {
    for (const tld of tlds) {
      candidates.push({
        url: `https://www.${slug}.${tld}`,
        source: "direct_domain_guess",
        expectedSlug: slug,
        baseScore: 26,
      });
      candidates.push({
        url: `https://${slug}.${tld}`,
        source: "direct_domain_guess",
        expectedSlug: slug,
        baseScore: 24,
      });
    }
  }

  return candidates.slice(0, limit);
}

function companyDomainSlugs(name) {
  const tokens = companyDomainSlugTokens(name);
  const compact = tokens.join("");
  const hyphen = tokens.join("-");
  return uniqueValues([compact, hyphen].filter((value) => value.length >= 3));
}

function companyDomainSlugTokens(name) {
  const tokens = normalizeText(name)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !LEGAL_SUFFIXES.has(token));
  const collapsed = collapseAcronymTokens(tokens);
  const distinctive = collapsed.filter(
    (token) =>
      token.length >= 3 ||
      /\d/.test(token) ||
      (!GENERIC_NAME_TOKENS.has(token) && token.length >= 2),
  );
  return distinctive.length ? distinctive : collapsed.filter((token) => token.length >= 3);
}

function collapseAcronymTokens(tokens) {
  const collapsed = [];
  let index = 0;
  while (index < tokens.length) {
    if (/^[a-z]$/.test(tokens[index])) {
      let acronym = tokens[index];
      let next = index + 1;
      while (next < tokens.length && /^[a-z]$/.test(tokens[next])) {
        acronym += tokens[next];
        next += 1;
      }
      if (acronym.length >= 2) {
        collapsed.push(acronym);
        index = next;
        continue;
      }
    }
    collapsed.push(tokens[index]);
    index += 1;
  }
  return collapsed;
}

function tldsForCompany(company) {
  const countries = new Set(company.country ?? []);
  const tlds = ["com", "ai", "io", "co"];
  if (countries.has("Germany")) tlds.push("de");
  if (countries.has("United Kingdom")) tlds.push("co.uk", "uk");
  if (countries.has("France")) tlds.push("fr");
  if (countries.has("Japan")) tlds.push("jp", "co.jp");
  if (countries.has("China")) tlds.push("cn", "com.cn");
  if (countries.has("Canada")) tlds.push("ca");
  if (countries.has("Australia")) tlds.push("com.au", "au");
  return uniqueValues(tlds);
}

async function searchForCompany(company) {
  if (process.env.BRAVE_SEARCH_API_KEY) {
    return braveSearch(company);
  }
  return [];
}

async function braveSearch(company) {
  const query = searchQuery(company);
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("extra_snippets", "true");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!response.ok) {
    console.warn(`Brave search failed for ${company.company_name}: ${response.status}`);
    return [];
  }

  const json = await response.json();
  return (json.web?.results ?? [])
    .map((result) => ({
      url: result.url,
      source: "brave_search",
      baseScore: 18,
      search_title: htmlToText(result.title ?? ""),
      search_description: htmlToText(
        [result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" "),
      ),
    }))
    .filter((candidate) => candidate.url);
}

function searchQuery(company) {
  const parts = [`"${company.company_name}"`, "official website"];
  const tags = [
    ...(company.product_type ?? []),
    ...(company.targeted_industries ?? []),
    ...(company.tags ?? []),
  ].join(" ");
  if (/robot|automation|vision|manufacturing|drone|autonomous/i.test(tags)) {
    parts.push("robotics OR automation");
  }
  if (company.country?.[0]) parts.push(company.country[0]);
  return parts.join(" ");
}

async function evaluateCandidate(company, candidate, timeoutMs) {
  const normalizedUrl = normalizeUrl(candidate.url);
  const base = {
    url: normalizedUrl,
    source: candidate.source,
    score: 0,
    reasons: [],
    search_title: candidate.search_title,
    search_description: candidate.search_description,
  };

  if (!normalizedUrl || !isHttpUrl(normalizedUrl) || isDirectoryUrl(normalizedUrl)) {
    return { ...base, error: "Not an acceptable HTTP(S) candidate URL." };
  }

  try {
    const response = await fetchWebsiteSnippet(normalizedUrl, timeoutMs);
    const page = pageProfile(response.snippet);
    const finalUrl = normalizeUrl(response.final_url);
    const finalDomain = domainFromUrl(finalUrl);
    const score = scoreCandidate(company, {
      ...candidate,
      finalUrl,
      page,
      response,
    });
    const description =
      isMissingDescription(company.short_description) && score.score >= 62
        ? bestDescription(page, candidate)
        : null;

    return {
      ...base,
      final_url: finalUrl,
      website_url: response.ok ? cleanHomepageUrl(finalUrl) : null,
      domain: finalDomain,
      http_status: response.http_status,
      title: page.title,
      short_description: description,
      score: score.score,
      reasons: score.reasons,
    };
  } catch (error) {
    return {
      ...base,
      error: error.name === "AbortError" ? "Request timed out." : error.message,
      score: candidate.baseScore ?? 0,
    };
  }
}

function scoreCandidate(company, candidate) {
  const reasons = [];
  let score = candidate.baseScore ?? 0;
  const finalDomain = domainFromUrl(candidate.finalUrl) ?? "";
  const domainText = normalizeText(finalDomain.replace(/\.[a-z.]+$/i, " "));
  const titleText = normalizeText(candidate.page.title);
  const pageText = normalizeText(`${candidate.page.title} ${candidate.page.description} ${candidate.page.bodyText}`);
  const searchText = normalizeText(`${candidate.search_title ?? ""} ${candidate.search_description ?? ""}`);
  const tokens = companyNameTokens(company.company_name);
  const criticalTokens = criticalCompanyNameTokens(company.company_name);
  const phrase = tokens.join(" ");
  const hasRoboticsContext = ROBOTICS_TERMS.some((term) => pageText.includes(term) || searchText.includes(term));

  if (criticalTokens.some((token) => token.length >= 4 && domainText.includes(token))) {
    score += 32;
    reasons.push("company-name token appears in hostname");
  }
  if (phrase && titleText.includes(phrase)) {
    score += 28;
    reasons.push("company name appears in page title");
  }
  if (phrase && pageText.includes(phrase)) {
    score += 22;
    reasons.push("company name appears in homepage text");
  }
  if (tokens.length >= 2) {
    const pageMatches = tokens.filter((token) => token.length >= 3 && pageText.includes(token));
    if (pageMatches.length >= Math.min(2, tokens.length)) {
      score += 15;
      reasons.push("multiple company-name tokens appear in homepage text");
    }
  }
  if (hasRoboticsContext) {
    score += 6;
    reasons.push("robotics or automation context appears in page/search text");
  }
  if (candidate.source === "direct_domain_guess") {
    const expectedSlug = normalizeText(candidate.expectedSlug).replace(/\s+/g, "");
    const finalCompactDomain = domainText.replace(/\s+/g, "");
    const domainStillMatchesGuess = expectedSlug && finalCompactDomain.includes(expectedSlug);

    if (!domainStillMatchesGuess) {
      score -= 65;
      reasons.push("final domain does not match the full guessed company slug");
    }
    if (criticalTokens.length <= 1 && !hasRoboticsContext && !(phrase && pageText.includes(phrase))) {
      score -= 35;
      reasons.push("single-token direct match lacks robotics context");
    }
    if (criticalTokens.length === 1 && criticalTokens[0].length <= 4 && !hasRoboticsContext) {
      score -= 30;
      reasons.push("short-name direct match is ambiguous");
    }
    if (!criticalTokens.length) {
      score -= 45;
      reasons.push("company name has no distinctive token for direct-domain acceptance");
    }
  }
  if (candidate.response.ok) {
    score += 8;
    reasons.push(`homepage returned HTTP ${candidate.response.http_status}`);
  } else {
    score -= 30;
    reasons.push(`candidate returned HTTP ${candidate.response.http_status}`);
  }
  if (isParkedOrForSale(candidate.page.bodyText, candidate.finalUrl)) {
    score -= 60;
    reasons.push("page appears parked or for sale");
  }
  if (isDirectoryUrl(candidate.finalUrl)) {
    score -= 80;
    reasons.push("candidate is a known directory/social/source profile");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
  };
}

function pageProfile(html) {
  const paragraphs = [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanDescription(match[1]))
    .filter(Boolean);

  return {
    title: htmlToText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    description: metaContent(html, "description") || metaPropertyContent(html, "og:description"),
    paragraphs,
    bodyText: htmlToText(html).slice(0, 12000),
  };
}

function metaContent(html, name) {
  return metaAttributeContent(html, "name", name);
}

function metaPropertyContent(html, property) {
  return metaAttributeContent(html, "property", property);
}

function metaAttributeContent(html, attribute, expectedValue) {
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (attributeValue(tag, attribute).toLowerCase() !== expectedValue.toLowerCase()) continue;
    const content = attributeValue(tag, "content");
    if (content) return htmlToText(content);
  }
  return "";
}

function attributeValue(tag, attribute) {
  const pattern = new RegExp(`${escapeRegExp(attribute)}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return String(tag).match(pattern)?.[2] ?? "";
}

function bestDescription(page, candidate) {
  const options = [
    page.description,
    paragraphDescription(page.paragraphs),
    candidate.search_description,
    candidate.search_title,
  ]
    .map(cleanDescription)
    .filter(Boolean);
  return options[0] ?? null;
}

function paragraphDescription(paragraphs) {
  return (
    paragraphs.find((paragraph) => /robot|automation|vision|manufactur|industrial|drone|autonomous/i.test(paragraph)) ??
    paragraphs[0] ??
    null
  );
}

function cleanDescription(value) {
  const text = htmlToText(value)
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .replace(/\s+-\s+Official Website\s*$/i, "")
    .trim();
  if (text.length < 30) return null;
  if (/^(home|homepage|official site)$/i.test(text)) return null;
  return text.length > 420 ? `${text.slice(0, 417).replace(/\s+\S*$/, "")}...` : text;
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
    // Already closed streams are fine.
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

function enrichmentSourceRow(result, checkedAt) {
  const best = result.accepted_candidate;
  const fields = {
    company_name: result.company.company_name,
    website_url: best.website_url,
    short_description: best.short_description,
    website_checked_at: checkedAt,
    website_confidence: best.score,
    website_final_url: best.final_url,
    website_http_status: best.http_status,
    website_status: "verified",
    website_validation_notes: best.reasons.join("; "),
  };

  return compactRecord({
    ...fields,
    source_namespace: ENRICHMENT_NAMESPACE,
    source_record_id: enrichmentRecordId(result),
    source_name: ENRICHMENT_SOURCE_NAME,
    source_type: "automated_data_enrichment",
    source_url: best.final_url ?? best.website_url,
    source_confidence: best.score,
    extraction_method: `${best.source}_homepage_fetch_and_name_match`,
    retrieved_at: checkedAt,
  });
}

function enrichmentRecordId(result) {
  const raw = [
    result.company.canonical_company_id ?? result.company.company_id,
    result.company.company_name,
    result.accepted_url,
  ]
    .filter(Boolean)
    .join("|");
  return `${slugify(raw).slice(0, 96)}-${stableHash(raw)}`;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    const key = domainFromUrl(url) ?? url;
    if (!url || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...candidate, url });
  }
  return unique;
}

function cleanHomepageUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return normalized;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDirectoryUrl(value) {
  const host = domainFromUrl(value);
  if (!host) return false;
  return DIRECTORY_HOSTS.some((directoryHost) => host === directoryHost || host.endsWith(`.${directoryHost}`));
}

function isParkedOrForSale(text, finalUrl) {
  return /\b(domain (?:is )?for sale|buy this domain|this domain may be for sale|parkingcrew|sedo\.com|afternic|dan\.com|hugedomains|namecheap parking|godaddy parked)\b/i.test(
    `${finalUrl} ${text}`,
  );
}

function companyNameTokens(value) {
  const tokens = normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !LEGAL_SUFFIXES.has(token));
  const strongTokens = tokens.filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token));
  return strongTokens.length ? strongTokens : tokens.filter((token) => token.length >= 3);
}

function criticalCompanyNameTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .filter((token) => !GENERIC_NAME_TOKENS.has(token));
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueValues(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    if (!value) continue;
    const key = String(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function sourceNamespace(row) {
  if (row.source_namespace) return row.source_namespace;
  if (typeof row.source_id === "string" && row.source_id.includes(":")) return row.source_id.split(":")[0];
  return null;
}

function searchProviderName() {
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  return "none";
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
