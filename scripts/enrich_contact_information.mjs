import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { domainFromUrl, normalizeUrl } from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_CONTACT_ROWS_PATH = path.join("data", "contact_enrichment_records.json");
const DEFAULT_REVIEW_QUEUE_PATH = path.join("data", "contact_enrichment_review_queue.json");

const USER_AGENT = "RoboticsMarketAtlas/0.3 contact-enrichment";
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 8500;
const MAX_SNIPPET_BYTES = 220 * 1024;
const MAX_LINKS_FROM_HOME = 8;
const MAX_PAGES_PER_COMPANY = 12;

const CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/contacts",
  "/about",
  "/about-us",
  "/company",
  "/team",
  "/leadership",
  "/management",
  "/press",
  "/media",
  "/newsroom",
  "/partners",
  "/sales",
  "/demo",
  "/request-demo",
  "/get-started",
  "/imprint",
  "/legal-notice",
  "/privacy",
];

const CONTACT_LINK_HINTS = [
  "contact",
  "about",
  "team",
  "leadership",
  "management",
  "press",
  "media",
  "newsroom",
  "partner",
  "sales",
  "demo",
  "quote",
  "inquiry",
  "imprint",
  "legal",
  "privacy",
];

const EMAIL_EXCLUDE_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|webm|pdf|zip)$/i;
const PERSONAL_EMAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "me.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
]);
const PLACEHOLDER_EMAIL_HOSTS = new Set([
  "company.com",
  "domain.com",
  "email.com",
  "example.com",
  "example.org",
  "test.com",
]);
const THIRD_PARTY_EMBED_EMAIL_HOSTS = [
  "hubspot.com",
  "hsforms.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wistia.com",
  "wixpress.com",
];

const EMAIL_PURPOSES = [
  ["sales", ["sales", "business", "bd", "commercial", "revenue"]],
  ["partnerships", ["partner", "partnership", "alliance", "ecosystem"]],
  ["press/media", ["press", "media", "pr", "communications", "comm", "news"]],
  ["support", ["support", "help", "service", "success", "care"]],
  ["careers", ["career", "jobs", "talent", "hiring", "hr", "recruiting"]],
  ["investor relations", ["investor", "ir"]],
  ["privacy/legal", ["privacy", "legal", "dpo", "compliance"]],
  ["general", ["hello", "hi", "info", "contact", "office", "mail", "enquiries", "inquiries", "automate"]],
];

const ROLE_PATTERNS = [
  "CEO",
  "Chief Executive Officer",
  "CTO",
  "Chief Technology Officer",
  "Founder",
  "Co-Founder",
  "Cofounder",
  "Chief Product Officer",
  "Chief Operating Officer",
  "VP Engineering",
  "Vice President Engineering",
  "Head of Engineering",
  "Head of Robotics",
  "Chief Scientist",
];

const args = new Set(process.argv.slice(2));
const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const contactRowsPath = valueAfter("--out") ?? DEFAULT_CONTACT_ROWS_PATH;
const reviewQueuePath = valueAfter("--review-queue") ?? DEFAULT_REVIEW_QUEUE_PATH;
const retrievedAt = valueAfter("--retrieved-at") ?? new Date().toISOString();
const concurrency = numberAfter("--concurrency", DEFAULT_CONCURRENCY);
const timeoutMs = numberAfter("--timeout-ms", DEFAULT_TIMEOUT_MS);
const limit = valueAfter("--limit") ? numberAfter("--limit", null) : null;
const offset = numberAfter("--offset", 0);
const checkpointSize = numberAfter("--checkpoint-size", 0);
const companyFilter = valueAfter("--company");
const countryFilter = valueAfter("--country");
const includeExisting = args.has("--include-existing");
const includeMissingWebsites = args.has("--include-missing-websites");
const replacePriorRows = args.has("--replace");
const dryRun = args.has("--dry-run");
const verbose = args.has("--verbose");

const dbRows = JSON.parse(await readFile(dbPath, "utf8"));
if (!Array.isArray(dbRows)) {
  throw new Error(`${dbPath} must contain a JSON array`);
}

const priorRows = await readJsonArrayIfExists(contactRowsPath);
const priorIdentityKeys = identityKeySet(priorRows);

let candidates = dbRows
  .filter((company) => company.company_name)
  .filter((company) =>
    includeMissingWebsites
      ? true
      : company.website_url && isUsableCompanyWebsite(company.website_url),
  )
  .filter((company) => includeExisting || !hasKnownIdentity(company, priorIdentityKeys));

if (companyFilter) {
  const needle = normalizeText(companyFilter);
  candidates = candidates.filter((company) => normalizeText(company.company_name) === needle);
}
if (countryFilter) {
  candidates = candidates.filter((company) => (company.country ?? []).includes(countryFilter));
}

candidates = candidates
  .sort((a, b) => candidatePriority(b) - candidatePriority(a) || byName(a, b))
  .slice(offset, limit === null ? undefined : offset + Math.max(0, limit));

let results = [];
let enrichedRows = [];
let outputRows = replacePriorRows ? [] : [...priorRows];
let reviewQueue = [];

if (!dryRun && checkpointSize > 0) {
  await mkdir(path.dirname(contactRowsPath), { recursive: true });
  await mkdir(path.dirname(reviewQueuePath), { recursive: true });

  for (let start = 0; start < candidates.length; start += checkpointSize) {
    const chunk = candidates.slice(start, start + checkpointSize);
    const chunkResults = await mapWithConcurrency(chunk, concurrency, (company) =>
      enrichCompanyContacts(company, { retrievedAt, timeoutMs }),
    );
    const chunkRows = chunkResults.map((result) => result.record);
    const chunkKeys = identityKeySet(chunkRows);

    results = [...results, ...chunkResults];
    enrichedRows = [...enrichedRows, ...chunkRows];
    outputRows = [
      ...outputRows.filter((row) => !hasKnownIdentity(row, chunkKeys)),
      ...chunkRows,
    ].sort(byName);
    reviewQueue = outputRows
      .filter((row) => shouldReview(row))
      .map((record) => reviewQueueRow({ record }));

    await writeFile(contactRowsPath, `${JSON.stringify(outputRows, null, 2)}\n`);
    await writeFile(reviewQueuePath, `${JSON.stringify(reviewQueue, null, 2)}\n`);

    console.log(
      JSON.stringify({
        checkpoint: Math.min(start + checkpointSize, candidates.length),
        selected: candidates.length,
        total_contact_rows: outputRows.length,
        current_review_queue: reviewQueue.length,
      }),
    );
  }
} else {
  results = await mapWithConcurrency(candidates, concurrency, (company) =>
    enrichCompanyContacts(company, { retrievedAt, timeoutMs }),
  );

  enrichedRows = results.map((result) => result.record);
  const enrichedKeys = identityKeySet(enrichedRows);
  const retainedRows = replacePriorRows
    ? []
    : priorRows.filter((row) => !hasKnownIdentity(row, enrichedKeys));
  outputRows = [...retainedRows, ...enrichedRows].sort(byName);
  reviewQueue = results
    .filter((result) => shouldReview(result.record))
    .map((result) => reviewQueueRow(result));

  if (!dryRun) {
    await mkdir(path.dirname(contactRowsPath), { recursive: true });
    await mkdir(path.dirname(reviewQueuePath), { recursive: true });
    await writeFile(contactRowsPath, `${JSON.stringify(outputRows, null, 2)}\n`);
    await writeFile(reviewQueuePath, `${JSON.stringify(reviewQueue, null, 2)}\n`);
  }
}

const summary = {
  mode: dryRun ? "dry_run" : "apply",
  db_rows: dbRows.length,
  prior_contact_rows: priorRows.length,
  selected: candidates.length,
  enriched_this_run: enrichedRows.length,
  total_contact_rows: outputRows.length,
  review_queue_this_run: reviewQueue.length,
  with_email_this_run: enrichedRows.filter((row) => row.emails.length > 0).length,
  with_personal_email_this_run: enrichedRows.filter((row) =>
    row.people.some((person) => person.email),
  ).length,
  with_form_this_run: enrichedRows.filter((row) => row.forms.length > 0).length,
  with_phone_this_run: enrichedRows.filter((row) => row.phones.length > 0).length,
  people_found_this_run: enrichedRows.reduce((sum, row) => sum + row.people.length, 0),
};

console.log(JSON.stringify(summary, null, 2));
if (verbose) {
  console.log(JSON.stringify(enrichedRows.slice(0, 10), null, 2));
}
if (!dryRun) {
  console.log(`Wrote ${outputRows.length} contact enrichment rows to ${contactRowsPath}`);
  console.log(`Wrote ${reviewQueue.length} review rows to ${reviewQueuePath}`);
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

async function readJsonArrayIfExists(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function candidatePriority(company) {
  let score = 0;
  if (company.status === "Listed") score += 20;
  if (company.website_status === "verified") score += 20;
  if (company.website_confidence) score += Math.min(20, Number(company.website_confidence) / 5);
  if (company.founded && company.founded >= 2010) score += 8;
  if ((company.country ?? []).includes("United States of America")) score += 3;
  return score;
}

async function enrichCompanyContacts(company, options) {
  if (!company.website_url || !isUsableCompanyWebsite(company.website_url)) {
    const reason = !company.website_url
      ? "No website_url is present; official-page contact enrichment was not possible."
      : "website_url is not a usable official HTTP(S) website; official-page contact enrichment was not possible.";
    return {
      company,
      record: emptyContactRecord(company, options.retrievedAt, reason),
      pages: [],
    };
  }

  const pages = [];
  const baseUrl = normalizeUrl(company.website_final_url || company.website_url);
  const home = await fetchPage(baseUrl, options.timeoutMs);
  if (home.ok) pages.push(home);

  const candidateUrls = candidateContactUrls(baseUrl, home).slice(0, MAX_PAGES_PER_COMPANY - pages.length);
  const pageResults = await mapWithConcurrency(candidateUrls, 3, (url) => fetchPage(url, options.timeoutMs));
  for (const page of pageResults) {
    if (page.ok && !pages.some((existing) => equivalentUrl(existing.url, page.url))) pages.push(page);
  }

  const pageSources = pages.map((page) => ({
    url: page.url,
    final_url: page.final_url,
    http_status: page.http_status,
    title: page.title,
  }));
  const emails = uniqueObjects(
    pages.flatMap((page) => extractEmails(page.html, page.final_url, company)),
    (email) => email.email,
  ).sort((a, b) => emailRank(b) - emailRank(a) || a.email.localeCompare(b.email));
  const phones = uniqueObjects(
    pages.flatMap((page) => extractPhones(page.text, page.final_url)),
    (phone) => normalizePhoneKey(phone.phone),
  ).slice(0, 8);
  const forms = uniqueObjects(
    pages.flatMap((page) => extractForms(page.html, page.final_url)),
    (form) => form.url,
  ).slice(0, 12);
  const people = uniqueObjects(
    pages.flatMap((page) => extractPeople(page.text, page.final_url)),
    (person) => `${normalizeText(person.name)}:${normalizeText(person.role)}`,
  ).slice(0, 12);

  const record = {
    company_name: company.company_name,
    company_id: company.company_id ?? null,
    canonical_company_id: company.canonical_company_id ?? company.company_id ?? null,
    canonical_domain: company.canonical_domain ?? domainFromUrl(company.website_url),
    notion_page_id: company.notion_page_id ?? null,
    notion_page_url: company.notion_page_url ?? null,
    website_url: company.website_url ?? null,
    website_final_url: company.website_final_url ?? null,
    linkedin_url: company.linkedin_url ?? null,
    country: Array.isArray(company.country) ? company.country : [],
    city: company.city ?? null,
    founded: company.founded ?? null,
    status: company.status ?? null,
    retrieved_at: options.retrievedAt,
    contact_summary: contactSummary({ emails, phones, forms, people }),
    people,
    emails,
    phones,
    forms,
    addresses: [],
    inferred_emails: [],
    page_sources: pageSources,
    extraction_notes: extractionNotes({ company, home, pages, emails, people, forms, phones }),
  };

  return { company, record, pages };
}

function emptyContactRecord(company, retrievedAt, reason) {
  const emptyContacts = { emails: [], phones: [], forms: [], people: [] };
  return {
    company_name: company.company_name,
    company_id: company.company_id ?? null,
    canonical_company_id: company.canonical_company_id ?? company.company_id ?? null,
    canonical_domain: company.canonical_domain ?? domainFromUrl(company.website_url),
    notion_page_id: company.notion_page_id ?? null,
    notion_page_url: company.notion_page_url ?? null,
    website_url: company.website_url ?? null,
    website_final_url: company.website_final_url ?? null,
    linkedin_url: company.linkedin_url ?? null,
    country: Array.isArray(company.country) ? company.country : [],
    city: company.city ?? null,
    founded: company.founded ?? null,
    status: company.status ?? null,
    retrieved_at: retrievedAt,
    contact_summary: contactSummary(emptyContacts),
    people: [],
    emails: [],
    phones: [],
    forms: [],
    addresses: [],
    inferred_emails: [],
    page_sources: [],
    extraction_notes: [
      reason,
      "Extracted 0 email(s), 0 phone(s), 0 form/contact link(s), 0 people.",
      "No personal email is inferred or guessed.",
    ],
  };
}

async function fetchPage(url, timeoutMs) {
  const normalized = normalizeUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(normalized, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": USER_AGENT,
      },
    });
    const html = await readResponseSnippet(response, MAX_SNIPPET_BYTES);
    return {
      ok: response.ok && isLikelyTextResponse(response),
      url: normalized,
      final_url: normalizeUrl(response.url),
      http_status: response.status,
      title: extractTitle(html),
      html,
      text: htmlToText(html),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      url: normalized,
      final_url: normalized,
      http_status: null,
      title: null,
      html: "",
      text: "",
      error: error.name === "AbortError" ? "Request timed out." : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseSnippet(response, maxBytes) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;

  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // Some runtimes throw when canceling an already-closed reader.
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isLikelyTextResponse(response) {
  const type = response.headers.get("content-type") ?? "";
  return !type || /text|html|xml|json|javascript/i.test(type);
}

function candidateContactUrls(baseUrl, home) {
  const urls = [];
  const parsed = safeUrl(baseUrl);
  if (!parsed) return urls;

  for (const route of CONTACT_PATHS) {
    urls.push(new URL(route, parsed.origin).toString());
  }
  if (home?.html) {
    for (const link of extractLinks(home.html, home.final_url)) {
      const href = link.href.toLowerCase();
      const label = normalizeText(`${link.text} ${link.href}`);
      if (!sameRegistrableHost(link.href, baseUrl)) continue;
      if (CONTACT_LINK_HINTS.some((hint) => label.includes(hint) || href.includes(hint))) {
        urls.push(link.href);
      }
    }
  }

  return uniqueValues(urls.map(normalizeUrl).filter(Boolean))
    .filter((url) => sameRegistrableHost(url, baseUrl))
    .filter((url) => !equivalentUrl(url, baseUrl))
    .slice(0, CONTACT_PATHS.length + MAX_LINKS_FROM_HOME);
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const href = resolveUrl(match[1], baseUrl);
    if (!href || !href.startsWith("http")) continue;
    links.push({ href: normalizeUrl(href), text: htmlToText(match[2]).slice(0, 120) });
  }
  return links;
}

function extractEmails(html, sourceUrl, company) {
  const emails = [];
  const companyDomain = domainFromUrl(company.website_url);
  const decodedHtml = decodeHtmlEntities(html);

  for (const match of decodedHtml.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const decoded = decodeCloudflareEmail(match[1]);
    if (decoded) emails.push(emailObject(decoded, sourceUrl, companyDomain, "cloudflare_protected_public_email"));
  }

  for (const match of decodedHtml.matchAll(/mailto:([^"'\s>?#]+)/gi)) {
    const decoded = safeDecodeURIComponent(match[1].split("?")[0]);
    if (decoded) emails.push(emailObject(decoded, sourceUrl, companyDomain, "mailto"));
  }

  const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const match of decodedHtml.matchAll(emailRe)) {
    emails.push(emailObject(match[0], sourceUrl, companyDomain, "visible_text_or_html"));
  }

  return emails
    .filter(Boolean)
    .filter((row) => isUsableEmail(row.email))
    .filter((row) => !isLikelyAssetEmail(row.email))
    .map((row) => ({
      ...row,
      confidence: row.type === "personal_public" ? "medium" : "high",
    }));
}

function emailObject(value, sourceUrl, companyDomain, extractionMethod) {
  let email = String(value ?? "")
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[),.;:]+$/g, "")
    .toLowerCase();
  email = email.replace(/^(?:(?:%20)+|20)+(?=[a-z])/i, "");
  email = email.replace(/^(?:u003e|u003c|x3e|x3c)+/i, "");
  if (!isUsableEmail(email)) return null;

  const [local, host] = email.split("@");
  const sourceDomain = domainFromUrl(sourceUrl);
  if (!isRelevantEmailHost(host, companyDomain, sourceDomain)) return null;
  return {
    email,
    type: classifyEmailType(local, host, companyDomain),
    purpose: classifyEmailPurpose(local),
    public_source_url: sourceUrl,
    confidence: "high",
    extraction_method: extractionMethod,
  };
}

function isRelevantEmailHost(host, companyDomain, sourceDomain) {
  if (!host || PLACEHOLDER_EMAIL_HOSTS.has(host)) return false;
  if (THIRD_PARTY_EMBED_EMAIL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    return false;
  }
  if (PERSONAL_EMAIL_HOSTS.has(host)) return true;
  if (companyDomain && (host === companyDomain || host.endsWith(`.${companyDomain}`))) return true;
  if (sourceDomain && (host === sourceDomain || host.endsWith(`.${sourceDomain}`))) return true;
  return false;
}

function classifyEmailType(local, host, companyDomain) {
  if (PERSONAL_EMAIL_HOSTS.has(host)) return "personal_public";
  if (companyDomain && host.endsWith(companyDomain) && !isRoleMailbox(local)) {
    return "person_or_unclassified_company";
  }
  return "generic_role";
}

function classifyEmailPurpose(local) {
  const normalized = normalizeText(local);
  for (const [purpose, hints] of EMAIL_PURPOSES) {
    if (hints.some((hint) => normalized.includes(hint))) return purpose;
  }
  return "unknown";
}

function isRoleMailbox(local) {
  const normalized = normalizeText(local);
  return EMAIL_PURPOSES.some(([, hints]) => hints.some((hint) => normalized.includes(hint)));
}

function isUsableEmail(value) {
  return /^[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+$/.test(value);
}

function isLikelyAssetEmail(value) {
  if (EMAIL_EXCLUDE_RE.test(value)) return true;
  const host = value.split("@")[1] ?? "";
  return (
    PLACEHOLDER_EMAIL_HOSTS.has(host) ||
    THIRD_PARTY_EMBED_EMAIL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
  );
}

function decodeCloudflareEmail(encoded) {
  if (!encoded || encoded.length < 4 || encoded.length % 2 !== 0) return null;
  const key = parseInt(encoded.slice(0, 2), 16);
  if (!Number.isFinite(key)) return null;

  let output = "";
  for (let index = 2; index < encoded.length; index += 2) {
    const code = parseInt(encoded.slice(index, index + 2), 16) ^ key;
    output += String.fromCharCode(code);
  }
  return output;
}

function extractPhones(text, sourceUrl) {
  const compactText = text.replace(/\s+/g, " ");
  const matches = compactText.match(/(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s.-]*){2,5}\d{2,4}/g) ?? [];
  return matches
    .map((phone) => phone.trim().replace(/\s+/g, " "))
    .filter((phone) => digitCount(phone) >= 8 && digitCount(phone) <= 16)
    .filter((phone) => !phone.trim().startsWith("+") || digitCount(phone) >= 10)
    .filter((phone) => !looksLikeYearOrDate(phone))
    .filter((phone) => !looksLikeSvgOrCssNumberRun(phone))
    .filter((phone) => /[+\-()]/.test(phone) || phoneContextLooksLikePhone(compactText, phone))
    .map((phone) => ({
      phone,
      purpose: "general",
      public_source_url: sourceUrl,
      confidence: "medium",
    }));
}

function digitCount(value) {
  return (String(value).match(/\d/g) ?? []).length;
}

function looksLikeYearOrDate(value) {
  const digits = String(value).replace(/\D/g, "");
  return /^20\d{2}/.test(digits) && digits.length <= 8;
}

function looksLikeSvgOrCssNumberRun(value) {
  const text = String(value);
  return text.includes(".") && !/[+()-]/.test(text);
}

function phoneContextLooksLikePhone(text, phone) {
  const index = text.indexOf(phone);
  if (index < 0) return false;
  const context = text.slice(Math.max(0, index - 80), index + phone.length + 80).toLowerCase();
  return /phone|tel|call|mobile|office|fax|\bt:\b|\bp:\b/.test(context);
}

function normalizePhoneKey(value) {
  return String(value).replace(/\D/g, "");
}

function extractForms(html, sourceUrl) {
  const forms = [];
  if (/<form\b/i.test(html)) {
    forms.push({
      label: "Form on page",
      url: sourceUrl,
      purpose: inferFormPurpose(sourceUrl),
      source_url: sourceUrl,
      confidence: "high",
    });
  }

  for (const link of extractLinks(html, sourceUrl)) {
    const text = normalizeText(`${link.text} ${link.href}`);
    if (
      hasTextTerm(text, "contact") ||
      hasTextTerm(text, "demo") ||
      hasTextTerm(text, "quote") ||
      hasTextTerm(text, "sales") ||
      hasTextTerm(text, "partner") ||
      hasTextTerm(text, "inquiry") ||
      text.includes("get started")
    ) {
      forms.push({
        label: link.text || "Contact link",
        url: link.href,
        purpose: inferFormPurpose(`${link.text} ${link.href}`),
        source_url: sourceUrl,
        confidence: "medium",
      });
    }
  }

  return forms;
}

function inferFormPurpose(value) {
  const text = normalizeText(value);
  if (hasTextTerm(text, "demo")) return "demo";
  if (hasTextTerm(text, "quote")) return "sales/quote";
  if (hasTextTerm(text, "partner")) return "partnerships";
  if (hasTextTerm(text, "press") || hasTextTerm(text, "media")) return "press/media";
  if (hasTextTerm(text, "sales")) return "sales";
  return "general/business inquiry";
}

function hasTextTerm(text, term) {
  return new RegExp(`\\b${escapeRegex(term)}\\b`).test(text);
}

function extractPeople(text, sourceUrl) {
  const normalized = text.replace(/\s+/g, " ");
  const people = [];
  const namePattern = "[A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){1,3}";
  const rolePattern = ROLE_PATTERNS.map(escapeRegex).join("|");
  const nameThenRole = new RegExp(`\\b(${namePattern})\\b\\s*(?:,|\\||-|–|—|:)?\\s*(${rolePattern})\\b`, "g");
  const roleThenName = new RegExp(`\\b(${rolePattern})\\b\\s*(?:,|\\||-|–|—|:)?\\s*(${namePattern})\\b`, "g");

  for (const match of normalized.matchAll(nameThenRole)) {
    people.push(personObject(match[1], match[2], sourceUrl));
  }
  for (const match of normalized.matchAll(roleThenName)) {
    people.push(personObject(match[2], match[1], sourceUrl));
  }

  return people.filter(Boolean).filter((person) => !isBadPersonName(person.name));
}

function personObject(name, role, sourceUrl) {
  const cleanName = cleanPersonName(name);
  const cleanRole = cleanRoleText(role);
  if (!cleanName || !cleanRole) return null;
  return {
    name: cleanName,
    role: cleanRole,
    seniority: seniorityFromRole(cleanRole),
    email: null,
    email_status: "not_found_publicly",
    linkedin_url: null,
    source_url: sourceUrl,
    source_type: "official_company_page",
    confidence: "medium",
  };
}

function cleanPersonName(value) {
  return String(value ?? "")
    .replace(/\b(?:Meet|About|Team|Leadership|Our|The|Officer|Founded)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRoleText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBadPersonName(value) {
  const text = normalizeText(value);
  return (
    text.length < 5 ||
    text.split(" ").length > 4 ||
    text.includes("privacy policy") ||
    text.includes("terms") ||
    text.includes("contact us") ||
    text.includes("read more") ||
    text.includes("learn more") ||
    text.includes("global robotics") ||
    text.includes("warehouse automation") ||
    /^(more|as|vice|officer|addverb|founder|co founder|company)\b/.test(text) ||
    /\b(founded|officer|president|vice)$/.test(text)
  );
}

function seniorityFromRole(role) {
  const text = normalizeText(role);
  if (text.includes("cto") || text.includes("technology") || text.includes("engineering") || text.includes("scientist")) {
    return "technical_executive";
  }
  if (text.includes("ceo") || text.includes("executive") || text.includes("president")) {
    return "executive";
  }
  if (text.includes("founder")) return "founder";
  return "leadership";
}

function contactSummary({ emails, phones, forms, people }) {
  const bestEmail = emails.find((email) =>
    ["sales", "partnerships", "general", "press/media"].includes(email.purpose),
  );
  const fallbackEmail = emails.find((email) => !["careers", "privacy/legal", "support"].includes(email.purpose));
  const selectedEmail = bestEmail ?? fallbackEmail;
  const bestForm = forms[0];
  const bestPhone = phones[0];
  const bestOutreachChannel = selectedEmail
    ? `${selectedEmail.email} (${selectedEmail.purpose})`
    : bestForm
      ? bestForm.url
      : bestPhone
        ? bestPhone.phone
        : null;

  return {
    best_outreach_channel: bestOutreachChannel,
    has_public_personal_email: emails.some((email) => email.type === "personal_public"),
    has_public_generic_email: emails.some((email) => email.type !== "personal_public"),
    has_contact_form: forms.length > 0,
    has_phone: phones.length > 0,
    has_people: people.length > 0,
    quality: emails.length && people.length ? "high" : emails.length || forms.length || phones.length ? "medium" : "low",
    notes: summaryNotes({ emails, phones, forms, people }),
  };
}

function summaryNotes({ emails, phones, forms, people }) {
  const notes = [];
  if (!emails.length) notes.push("No public email found in fetched official pages.");
  if (!people.length) notes.push("No leadership names confidently extracted from fetched pages.");
  if (forms.length) notes.push("Contact form or contact link found.");
  if (phones.length) notes.push("Phone number found.");
  return notes.join(" ");
}

function extractionNotes({ company, home, pages, emails, people, forms, phones }) {
  const notes = [];
  if (!home.ok) notes.push(`Homepage fetch failed: ${home.error ?? home.http_status ?? "unknown error"}.`);
  notes.push(`Fetched ${pages.length} official page(s).`);
  notes.push(`Extracted ${emails.length} email(s), ${phones.length} phone(s), ${forms.length} form/contact link(s), ${people.length} people.`);
  if (company.website_status && company.website_status !== "verified") {
    notes.push(`Website validation status is ${company.website_status}.`);
  }
  notes.push("No personal email is inferred or guessed.");
  return notes;
}

function reviewQueueRow(result) {
  const row = result.record;
  return {
    company_name: row.company_name,
    canonical_company_id: row.canonical_company_id,
    canonical_domain: row.canonical_domain,
    website_url: row.website_url,
    website_final_url: row.website_final_url,
    country: row.country,
    quality: row.contact_summary.quality,
    has_email: row.emails.length > 0,
    has_people: row.people.length > 0,
    has_form: row.forms.length > 0,
    has_phone: row.phones.length > 0,
    best_outreach_channel: row.contact_summary.best_outreach_channel,
    notes: row.extraction_notes,
    page_sources: row.page_sources,
  };
}

function shouldReview(row) {
  return row.contact_summary.quality === "low" || !row.emails.length || !row.people.length;
}

async function mapWithConcurrency(items, itemConcurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, itemConcurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function isUsableCompanyWebsite(value) {
  const url = safeUrl(normalizeUrl(value));
  if (!url) return false;
  return ["http:", "https:"].includes(url.protocol) && !isDirectoryHost(url.hostname);
}

function isDirectoryHost(hostname) {
  return /(^|\.)((linkedin|facebook|twitter|x|instagram|youtube|github|crunchbase|pitchbook|tracxn|theorg|wikidata|wikipedia)\.com|youtu\.be)$/i.test(
    hostname,
  );
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function resolveUrl(value, baseUrl) {
  try {
    if (/^(mailto|tel|javascript):/i.test(value)) return null;
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function sameRegistrableHost(left, right) {
  const leftHost = safeUrl(normalizeUrl(left))?.hostname.replace(/^www\./, "");
  const rightHost = safeUrl(normalizeUrl(right))?.hostname.replace(/^www\./, "");
  return Boolean(leftHost && rightHost && (leftHost === rightHost || leftHost.endsWith(`.${rightHost}`) || rightHost.endsWith(`.${leftHost}`)));
}

function equivalentUrl(left, right) {
  const leftUrl = safeUrl(normalizeUrl(left));
  const rightUrl = safeUrl(normalizeUrl(right));
  if (!leftUrl || !rightUrl) return false;
  return (
    leftUrl.origin.replace(/^https?:\/\/www\./, "https://") ===
      rightUrl.origin.replace(/^https?:\/\/www\./, "https://") &&
    stripTrailingSlash(leftUrl.pathname) === stripTrailingSlash(rightUrl.pathname)
  );
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/g, "") || "/";
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(htmlToText(match[1])).trim().slice(0, 160) : null;
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueObjects(values, keyFn) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value) continue;
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function emailRank(email) {
  const purposeRank = {
    sales: 9,
    partnerships: 8,
    general: 7,
    "press/media": 6,
    support: 4,
    "investor relations": 4,
    careers: 2,
    "privacy/legal": 1,
    unknown: 0,
  };
  return (purposeRank[email.purpose] ?? 0) + (email.type === "generic_role" ? 2 : 0);
}

function companyKey(company) {
  return (
    company.canonical_company_id ??
    company.company_id ??
    company.notion_page_id ??
    domainFromUrl(company.website_url) ??
    normalizeText(company.company_name)
  );
}

function identityKeys(company) {
  return uniqueValues([
    company.canonical_company_id,
    company.company_id,
    company.notion_page_id,
    company.canonical_domain ? `domain:${company.canonical_domain}` : null,
    domainFromUrl(company.website_url) ? `domain:${domainFromUrl(company.website_url)}` : null,
    normalizeText(company.company_name) ? `name:${normalizeText(company.company_name)}` : null,
  ]);
}

function identityKeySet(rows) {
  return new Set(rows.flatMap((row) => identityKeys(row)));
}

function hasKnownIdentity(company, knownKeys) {
  return identityKeys(company).some((key) => knownKeys.has(key));
}

function byName(a, b) {
  return String(a.company_name ?? "").localeCompare(String(b.company_name ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
