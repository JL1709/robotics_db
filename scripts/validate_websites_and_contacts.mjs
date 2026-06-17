import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_DATA_PATH = 'data/robotics_companies.json';
const DEFAULT_OUTPUT_DIR = 'data/website_contact_validation';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 RoboticsMarketAtlasValidation/1.0';

const BAD_WEBSITE_STATUSES = new Set([
  'missing',
  'invalid_url',
  'local_url',
  'directory_profile_url',
  'broken',
  'parked_or_for_sale',
  'not_found',
]);

const TRUSTED_KEEP_SOURCES = new Set(['Petr Novikov Robotics Database']);

const CONTACT_HINTS = [
  'contact',
  'about',
  'team',
  'support',
  'sales',
  'privacy',
  'impressum',
  'legal',
  'company',
];

const PARKED_PATTERNS = [
  /\bdomain (?:is )?for sale\b/i,
  /\bbuy this domain\b/i,
  /\bthis domain is parked\b/i,
  /\bparkingcrew\b/i,
  /\bsedo domain parking\b/i,
  /\bafternic\b/i,
  /\bdan\.com\b/i,
  /\bhugedomains\b/i,
  /\bnamebright\b/i,
  /\brelated searches\b/i,
];

const ROBOTICS_PATTERNS = [
  /\brobot(?:ics|s)?\b/i,
  /\bautomation\b/i,
  /\bautonomous\b/i,
  /\bcobot\b/i,
  /\bmechatronic/i,
  /\bdrone(?:s)?\b/i,
  /\buav\b/i,
  /\bamr\b/i,
  /\bagv\b/i,
  /\bmanipulator\b/i,
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SOCIAL_OR_DIRECTORY_HOSTS = new Set([
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'github.com',
  'crunchbase.com',
  'wikipedia.org',
  'wikidata.org',
]);

const args = parseArgs(process.argv.slice(2));
const dataPath = args.data ?? DEFAULT_DATA_PATH;
const outputDir = args.outputDir ?? DEFAULT_OUTPUT_DIR;
const manifestDir = path.join(outputDir, 'manifests');
const start = parseInteger(args.start, 0);
const limit = parseInteger(args.limit, null);
const concurrency = Math.max(1, parseInteger(args.concurrency, 8));
const timeoutMs = Math.max(3000, parseInteger(args.timeoutMs, 12000));
const maxPages = Math.max(1, parseInteger(args.maxPages, 5));
const batchName = args.batch ?? `batch-${start}-${limit ?? 'all'}-${Date.now()}`;
const mergeOnly = Boolean(args.mergeOnly);

fs.mkdirSync(manifestDir, { recursive: true });

if (mergeOnly) {
  mergeManifests();
} else {
  await runBatch();
}

async function runBatch() {
  const companies = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const sliceEnd = limit == null ? companies.length : Math.min(companies.length, start + limit);
  const selected = companies.slice(start, sliceEnd);
  const results = [];
  let nextIndex = 0;
  let completed = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
      while (nextIndex < selected.length) {
        const localIndex = nextIndex;
        nextIndex += 1;
        const company = selected[localIndex];
        const datasetIndex = start + localIndex;
        try {
          results[localIndex] = await validateCompany(company, datasetIndex);
        } catch (error) {
          results[localIndex] = failureResult(company, datasetIndex, 'validator_error', error);
        }
        completed += 1;
        if (completed % 25 === 0 || completed === selected.length) {
          console.error(
            JSON.stringify({
              batchName,
              completed,
              total: selected.length,
              lastCompanyId: company.company_id,
            }),
          );
        }
      }
    }),
  );

  const manifestPath = path.join(manifestDir, `${safeFileName(batchName)}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(results.map(cleanResult), null, 2) + '\n');
  mergeManifests();

  console.log(
    JSON.stringify(
      {
        batchName,
        start,
        limit: selected.length,
        concurrency,
        manifestPath,
        outputPath: path.join(outputDir, 'results.json'),
        summary: summarize(results),
      },
      null,
      2,
    ),
  );
}

async function validateCompany(company, datasetIndex) {
  const checkedAt = new Date().toISOString();
  const base = {
    company_id: company.company_id,
    company_name: company.company_name,
    dataset_index: datasetIndex,
    source_name: company.source_name ?? null,
    source_url: company.source_url ?? null,
    input_website_url: company.website_url ?? null,
    prior_website_status: company.website_status ?? null,
    prior_website_confidence: company.website_confidence ?? null,
    checked_at: checkedAt,
    validation_status: null,
    website_reachable: false,
    belongs_to_company: false,
    final_url: null,
    http_status: null,
    page_title: null,
    evidence: [],
    warnings: [],
    contact_emails: [],
    contact_pages_checked: [],
    email_sources: [],
    notes: null,
  };

  const normalizedUrl = normalizeUrl(company.website_url);
  if (!normalizedUrl) {
    return {
      ...base,
      validation_status: 'missing_website',
      notes: 'No valid http(s) website_url present.',
    };
  }

  if (isDirectoryOrSocialUrl(normalizedUrl)) {
    return {
      ...base,
      validation_status: 'wrong_company',
      final_url: normalizedUrl,
      notes: 'Website URL points to a social, directory, or non-owned profile host.',
    };
  }

  const pages = [];
  const home = await fetchPage(normalizedUrl);
  pages.push(home);

  base.final_url = home.final_url;
  base.http_status = home.status;
  base.website_reachable = home.ok;

  if (!home.ok) {
    return {
      ...base,
      validation_status: classifyFetchFailure(home),
      warnings: home.error ? [home.error] : [],
      notes: 'Homepage did not return a usable HTML response.',
    };
  }

  base.page_title = extractTitle(home.html);
  const homeText = htmlToText(home.html);
  const parked = isParkedPage(home.html, homeText, home.final_url);
  if (parked) {
    return {
      ...base,
      validation_status: 'parked_or_for_sale',
      warnings: ['Parked-domain language detected.'],
      contact_pages_checked: pageSummaries(pages),
      notes: 'Reachable page appears to be parked, expired, or for sale.',
    };
  }

  const contactLinks = findContactLinks(home.html, home.final_url).slice(0, Math.max(0, maxPages - 1));
  for (const link of contactLinks) {
    await sleep(100);
    const page = await fetchPage(link);
    pages.push(page);
  }

  const ownership = scoreOwnership(company, normalizedUrl, pages);
  const emailData = collectEmails(company, pages);
  const validationStatus = decideValidationStatus(company, ownership, home);

  return {
    ...base,
    validation_status: validationStatus,
    website_reachable: true,
    belongs_to_company: validationStatus === 'verified_owned',
    final_url: home.final_url,
    http_status: home.status,
    page_title: extractTitle(home.html),
    evidence: ownership.evidence,
    warnings: [...ownership.warnings, ...emailData.warnings],
    contact_emails: emailData.contact_emails,
    contact_pages_checked: pageSummaries(pages),
    email_sources: emailData.email_sources,
    notes: ownership.notes,
  };
}

async function fetchPage(inputUrl) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(inputUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.8',
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const html = contentType.includes('text/html') || contentType.includes('application/xhtml')
      ? await response.text()
      : '';
    return {
      input_url: inputUrl,
      final_url: response.url,
      status: response.status,
      ok: response.ok && Boolean(html),
      content_type: contentType,
      elapsed_ms: Date.now() - startedAt,
      html,
      error: response.ok && !html ? `Non-HTML response: ${contentType || 'unknown content type'}` : null,
    };
  } catch (error) {
    return {
      input_url: inputUrl,
      final_url: inputUrl,
      status: null,
      ok: false,
      content_type: null,
      elapsed_ms: Date.now() - startedAt,
      html: '',
      error: error.name === 'AbortError' ? 'Request timed out.' : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function scoreOwnership(company, originalUrl, pages) {
  const evidence = [];
  const warnings = [];
  const goodPages = pages.filter((page) => page.ok);
  const combinedText = goodPages.map((page) => `${extractTitle(page.html)} ${htmlToText(page.html)}`).join(' ');
  const textForMatch = normalizeForMatch(combinedText);
  const companyName = company.company_name ?? '';
  const nameTokens = significantTokens(companyName);
  const domainTokens = domainNameTokens(originalUrl);
  const finalDomainTokens = domainNameTokens(goodPages[0]?.final_url ?? originalUrl);
  const sourceHost = hostname(company.source_url);
  const originalHost = hostname(originalUrl);
  const finalHost = hostname(goodPages[0]?.final_url ?? originalUrl);

  const matchedNameTokens = nameTokens.filter((token) => textForMatch.includes(token));
  if (matchedNameTokens.length >= Math.min(2, nameTokens.length) && matchedNameTokens.length > 0) {
    evidence.push({
      type: 'company_name_match',
      detail: `Matched visible company-name tokens: ${matchedNameTokens.join(', ')}`,
    });
  }

  const domainNameMatch = domainTokens.some((token) => token.length >= 4 && nameTokens.includes(token));
  if (domainNameMatch) {
    evidence.push({
      type: 'domain_name_match',
      detail: `Website domain token overlaps with company name: ${originalHost}`,
    });
  }

  const finalDomainNameMatch = finalDomainTokens.some(
    (token) => token.length >= 4 && nameTokens.includes(token),
  );
  if (finalDomainNameMatch && finalHost !== originalHost) {
    evidence.push({
      type: 'final_domain_name_match',
      detail: `Redirect target domain token overlaps with company name: ${finalHost}`,
    });
  }

  if (sourceHost && sameRegistrableDomain(sourceHost, finalHost)) {
    evidence.push({
      type: 'source_domain_match',
      detail: `Source URL host matches final website host: ${sourceHost}`,
    });
  }

  const productEvidence = [
    ...(company.product_type ?? []),
    ...(company.robot_or_automated_system_type ?? []),
    ...(company.targeted_industries ?? []),
    ...(company.tags ?? []),
  ]
    .flatMap(significantTokens)
    .filter((token) => token.length >= 5)
    .slice(0, 25);
  const matchedProductTokens = [...new Set(productEvidence.filter((token) => textForMatch.includes(token)))];
  if (matchedProductTokens.length >= 2 || ROBOTICS_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    evidence.push({
      type: 'robotics_context',
      detail: matchedProductTokens.length
        ? `Matched robotics/product tokens: ${matchedProductTokens.slice(0, 8).join(', ')}`
        : 'Robotics or automation language appears on the site.',
    });
  }

  if (!sameRegistrableDomain(originalHost, finalHost)) {
    const allowedRedirect = domainTokens.some((token) => finalDomainTokens.includes(token));
    if (!allowedRedirect) {
      warnings.push(`Redirected from ${originalHost} to unrelated-looking host ${finalHost}.`);
    }
  }

  if (evidence.length === 0) {
    warnings.push('No strong company ownership evidence found in visible homepage/contact text.');
  }

  return {
    evidence,
    warnings,
    notes: evidence.length
      ? `Found ${evidence.length} ownership signal(s).`
      : 'Reachable site, but ownership is not established.',
  };
}

function decideValidationStatus(company, ownership, home) {
  if (!home.ok) return classifyFetchFailure(home);
  if (BAD_WEBSITE_STATUSES.has(company.website_status) && ownership.evidence.length < 2) {
    return 'ambiguous';
  }
  const hasNameOrDomain = ownership.evidence.some((item) =>
    ['company_name_match', 'domain_name_match', 'final_domain_name_match', 'source_domain_match'].includes(
      item.type,
    ),
  );
  const hasContext = ownership.evidence.some((item) => item.type === 'robotics_context');
  if (hasNameOrDomain && (hasContext || ownership.evidence.length >= 2)) return 'verified_owned';
  if (hasNameOrDomain) return 'ambiguous';
  return 'reachable_unmatched';
}

function collectEmails(company, pages) {
  const byEmail = new Map();
  const warnings = [];
  const siteHost = hostname(pages.find((page) => page.ok)?.final_url ?? company.website_url);
  const siteDomain = registrableDomain(siteHost);

  for (const page of pages) {
    if (!page.ok || !page.html) continue;
    const candidates = extractEmails(page.html);
    for (const email of candidates) {
      if (isNoisyEmail(email)) {
        warnings.push(`Rejected noisy email candidate: ${email}`);
        continue;
      }
      const emailDomain = email.split('@')[1].toLowerCase();
      const confidence = siteDomain && registrableDomain(emailDomain) === siteDomain ? 'high' : 'medium';
      const type = classifyEmail(email);
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          type,
          confidence,
          sources: [],
        });
      }
      byEmail.get(email).sources.push(page.final_url);
    }
  }

  const contact_emails = [...byEmail.values()]
    .map((item) => ({
      ...item,
      sources: [...new Set(item.sources)].slice(0, 5),
    }))
    .sort((a, b) => emailRank(a) - emailRank(b) || a.email.localeCompare(b.email));

  return {
    contact_emails,
    email_sources: contact_emails.flatMap((item) =>
      item.sources.map((source_url) => ({
        email: item.email,
        source_url,
        type: item.type,
        confidence: item.confidence,
      })),
    ),
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}

function extractEmails(html) {
  const decoded = decodeHtmlEntities(html)
    .replace(/\\u0040/gi, '@')
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*/gi, '.')
    .replace(/\s*\(\s*dot\s*\)\s*/gi, '.');
  const matches = decoded.match(EMAIL_RE) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase().replace(/^mailto:/, '')))];
}

function findContactLinks(html, baseUrl) {
  const links = [];
  const anchorRe = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html))) {
    const href = decodeHtmlEntities(match[1]).trim();
    const text = htmlToText(match[2]).toLowerCase();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const absolute = absolutizeUrl(href, baseUrl);
    if (!absolute) continue;
    if (!sameRegistrableDomain(hostname(absolute), hostname(baseUrl))) continue;
    const urlText = absolute.toLowerCase();
    if (CONTACT_HINTS.some((hint) => text.includes(hint) || urlText.includes(hint))) {
      links.push(stripHash(absolute));
    }
  }
  return [...new Set(links)];
}

function pageSummaries(pages) {
  return pages.map((page) => ({
    url: page.input_url,
    final_url: page.final_url,
    http_status: page.status,
    ok: page.ok,
    title: page.html ? extractTitle(page.html) : null,
    error: page.error,
    elapsed_ms: page.elapsed_ms,
  }));
}

function classifyFetchFailure(page) {
  if (page.status === 404 || page.status === 410) return 'broken';
  if (page.status && page.status >= 400) return 'broken';
  if (page.error?.includes('timed out')) return 'broken';
  return 'broken';
}

function isParkedPage(html, text, finalUrl) {
  const combined = `${extractTitle(html)} ${text} ${finalUrl}`;
  return PARKED_PATTERNS.some((pattern) => pattern.test(combined));
}

function isDirectoryOrSocialUrl(url) {
  const host = hostname(url);
  return [...SOCIAL_OR_DIRECTORY_HOSTS].some((badHost) => host === badHost || host.endsWith(`.${badHost}`));
}

function isNoisyEmail(email) {
  if (!email || email.length > 120) return true;
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico)$/i.test(email)) return true;
  if (/\.(please|contact|email|mail|phone|tel|address|visit|click|here|for|and|or|to|the|this|that|with|from)$/i.test(email)) {
    return true;
  }
  if (/^(example|test|yourname|name|email|user|username|you|john|jane|firstname|lastname)@/i.test(email)) {
    return true;
  }
  if (/@(?:example|test|domain|company|email)\./i.test(email)) return true;
  if (email.includes('sentry.io') || email.includes('wixpress.com')) return true;
  return false;
}

function classifyEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  if (/(privacy|legal|dpo|gdpr|compliance)/.test(local)) return 'privacy';
  if (/(sales|business|commercial|inquiries|enquiries)/.test(local)) return 'sales';
  if (/(support|help|service|customer)/.test(local)) return 'support';
  if (/(press|media|^pr$|news)/.test(local)) return 'press';
  if (/(career|jobs|recruit|hr|talent)/.test(local)) return 'careers';
  if (/(info|contact|hello|general|office|admin)/.test(local)) return 'general';
  return 'unknown';
}

function emailRank(item) {
  const typeRank = {
    general: 0,
    sales: 1,
    support: 2,
    press: 3,
    unknown: 4,
    privacy: 5,
    careers: 6,
  };
  const confidenceRank = item.confidence === 'high' ? 0 : 1;
  return confidenceRank * 10 + (typeRank[item.type] ?? 9);
}

function normalizeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'null' || text === 'undefined') return null;
  if (/^(mailto|tel|javascript):/i.test(text)) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function absolutizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function stripHash(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

function hostname(url) {
  try {
    return new URL(normalizeUrl(url) ?? url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function registrableDomain(host) {
  const parts = String(host ?? '').replace(/^www\./, '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const secondLevelSuffixes = new Set(['co', 'com', 'net', 'org', 'ac', 'gov']);
  const suffix = parts.at(-2);
  if (secondLevelSuffixes.has(suffix) && parts.at(-1)?.length === 2 && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function sameRegistrableDomain(a, b) {
  const domainA = registrableDomain(a);
  const domainB = registrableDomain(b);
  return Boolean(domainA && domainB && domainA === domainB);
}

function domainNameTokens(url) {
  const domain = registrableDomain(hostname(url)).split('.')[0] ?? '';
  return significantTokens(domain.replace(/[-_]/g, ' '));
}

function significantTokens(value) {
  const stop = new Set([
    'inc',
    'ltd',
    'llc',
    'co',
    'corp',
    'corporation',
    'company',
    'limited',
    'gmbh',
    'aps',
    'as',
    'ag',
    'sa',
    'srl',
    'pte',
    'plc',
    'robotics',
    'robot',
    'automation',
    'technology',
    'technologies',
    'systems',
    'group',
  ]);
  return normalizeForMatch(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stop.has(token));
}

function normalizeForMatch(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).slice(0, 240) : null;
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

function failureResult(company, datasetIndex, status, error) {
  return {
    company_id: company.company_id,
    company_name: company.company_name,
    dataset_index: datasetIndex,
    input_website_url: company.website_url ?? null,
    checked_at: new Date().toISOString(),
    validation_status: status,
    website_reachable: false,
    belongs_to_company: false,
    final_url: null,
    http_status: null,
    page_title: null,
    evidence: [],
    warnings: [error.message],
    contact_emails: [],
    contact_pages_checked: [],
    email_sources: [],
    notes: 'Validator failed before completing this row.',
  };
}

function mergeManifests() {
  const files = fs
    .readdirSync(manifestDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const byId = new Map();
  for (const file of files) {
    const rows = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf8'));
    for (const row of rows) {
      byId.set(row.company_id, cleanResult(row));
    }
  }
  const rows = [...byId.values()].sort((a, b) => a.dataset_index - b.dataset_index);
  const outputPath = path.join(outputDir, 'results.json');
  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2) + '\n');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        manifests: files.length,
        rows: rows.length,
        summary: summarize(rows),
      },
      null,
      2,
    ) + '\n',
  );
  if (mergeOnly) {
    console.log(JSON.stringify({ outputPath, summaryPath, rows: rows.length, summary: summarize(rows) }, null, 2));
  }
}

function summarize(rows) {
  const counts = {};
  const retention = {};
  let emails = 0;
  for (const row of rows) {
    counts[row.validation_status] = (counts[row.validation_status] ?? 0) + 1;
    retention[row.retention_recommendation] = (retention[row.retention_recommendation] ?? 0) + 1;
    emails += row.contact_emails?.length ?? 0;
  }
  return { counts, retention, contact_email_count: emails };
}

function cleanResult(row) {
  const contact_emails = (row.contact_emails ?? [])
    .filter((item) => !isNoisyEmail(item.email))
    .map((item) => ({
      ...item,
      sources: [...new Set(item.sources ?? [])],
    }));
  const emailSet = new Set(contact_emails.map((item) => item.email));
  return {
    ...row,
    trusted_source_keep: TRUSTED_KEEP_SOURCES.has(row.source_name),
    retention_recommendation: getRetentionRecommendation(row),
    contact_emails,
    email_sources: (row.email_sources ?? []).filter((item) => emailSet.has(item.email)),
  };
}

function getRetentionRecommendation(row) {
  if (TRUSTED_KEEP_SOURCES.has(row.source_name)) return 'keep_trusted_source';
  if (row.validation_status === 'verified_owned') return 'keep_verified_website';
  if (row.validation_status === 'ambiguous') return 'review';
  return 'remove_or_research';
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseInteger(value, fallback) {
  if (value == null || value === true) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
}
