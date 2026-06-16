const SOURCE_NAME = "Petr Novikov Robotics Database";
const SOURCE_TYPE = "curated_public_database";
const SOURCE_CONFIDENCE = 80;

const URL_FIELDS = new Set(["website_url", "linkedin_url", "github_url"]);
const MULTI_VALUE_FIELDS = new Set([
  "product_type",
  "country",
  "state",
  "targeted_industries",
  "robot_or_automated_system_type",
  "hardware_component_type",
  "software_type",
  "accessory_type",
  "human_augmentation_device_type",
  "tags",
  "equipment_type",
  "people",
]);
const OBJECT_FIELDS = new Set(["website_preview", "legacy_website_preview"]);
const CONFLICT_EXCLUDED_FIELDS = new Set([
  "created_time",
  "last_edited_time",
  "notion_page_id",
  "notion_page_url",
  "website_preview",
  "legacy_website_preview",
]);
const SHARED_HOSTING_DOMAINS = new Set([
  "github.io",
  "google.com",
  "notion.site",
  "sites.google.com",
  "wixsite.com",
  "wordpress.com",
]);
const METADATA_FIELDS = new Set([
  "company_id",
  "canonical_company_id",
  "canonical_domain",
  "source_count",
  "source_id",
  "source_confidence",
  "source_created_time",
  "source_fields",
  "source_last_edited_time",
  "source_name",
  "source_namespace",
  "source_record_created_at",
  "source_record_id",
  "source_record_last_edited_at",
  "source_type",
  "source_url",
  "confidence",
  "extraction_method",
  "fields",
  "observed_fields",
  "retrieved_at",
  "sources",
  "source_records",
  "field_sources",
  "field_conflicts",
  "source_record_ids",
  "notion_page_ids",
  "notion_page_urls",
  "merged_from",
  "data_quality",
]);

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function canonicalizeCompanies(rows, options = {}) {
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const normalizedRows = dedupeInputRecords(rows.map((row) => normalizeInputRecord(row)));
  const groups = groupRows(normalizedRows);

  return groups
    .map((group) => mergeCompanyGroup(group, retrievedAt))
    .sort((a, b) => collator.compare(a.company_name ?? "", b.company_name ?? ""));
}

export function expandCanonicalCompanies(rows) {
  if (!rows.some((row) => Array.isArray(row.source_records))) {
    return rows.map((row) => stripCanonicalMetadata(row));
  }

  return rows.flatMap((row) => {
    if (!Array.isArray(row.source_records) || !row.source_records.length) {
      return [stripCanonicalMetadata(row)];
    }

    return row.source_records.map((source) => ({
      ...(source.observed_fields ?? {}),
      source_id: source.source_id,
      source_name: source.source_name,
      source_type: source.source_type,
      source_url: source.source_url,
      source_record_id: source.source_record_id,
      source_record_created_at: source.source_record_created_at,
      source_record_last_edited_at: source.source_record_last_edited_at,
      source_confidence: source.confidence,
      extraction_method: source.extraction_method,
      source_fields: source.fields,
      retrieved_at: source.retrieved_at,
      ...(source.source_id?.startsWith("notion:")
        ? {
            notion_page_id: source.source_record_id,
            notion_page_url: source.source_url,
            created_time: source.source_record_created_at,
            last_edited_time: source.source_record_last_edited_at,
          }
        : {}),
    }));
  });
}

export function normalizeUrl(value) {
  if (typeof value !== "string") return value ?? null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.pathname === "/") || url.pathname === "") {
      url.pathname = "";
    }

    let normalized = url.toString();
    if (normalized.endsWith("/") && url.pathname === "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return trimmed;
  }
}

export function domainFromUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized || typeof normalized !== "string") return null;

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeInputRecord(row) {
  const normalized = { ...row };

  for (const field of URL_FIELDS) {
    if (field in normalized) {
      normalized[field] = normalizeUrl(normalized[field]);
    }
  }

  for (const field of MULTI_VALUE_FIELDS) {
    normalized[field] = uniqueValues(Array.isArray(normalized[field]) ? normalized[field] : []);
    if (field === "country") {
      normalized[field] = uniqueValues(normalized[field].map(normalizeCountryValue));
    }
  }

  return normalized;
}

function normalizeCountryValue(value) {
  const normalized = typeof value === "string" ? value.trim() : value;
  const aliases = {
    USA: "United States",
    US: "United States",
    "U.S.": "United States",
    "United States of America": "United States",
    UK: "United Kingdom",
    "Republic of Korea": "South Korea",
    "Korea, Republic of": "South Korea",
    "Viet Nam": "Vietnam",
    Türkiye: "Turkey",
  };
  return aliases[normalized] ?? normalized;
}

function dedupeInputRecords(rows) {
  const recordsBySourceId = new Map();

  for (const row of rows) {
    const id = sourceId(row);
    const existing = recordsBySourceId.get(id);
    if (!existing || inputRecordScore(row) > inputRecordScore(existing)) {
      recordsBySourceId.set(id, row);
    }
  }

  return [...recordsBySourceId.values()];
}

function inputRecordScore(row) {
  let score = sourceRecordScore(row) * 100;

  for (const [field, value] of Object.entries(row)) {
    if (!METADATA_FIELDS.has(field) && isMeaningful(value)) score += 1;
  }

  return score;
}

function groupRows(rows) {
  const parents = rows.map((_, index) => index);
  const keyOwners = new Map();

  rows.forEach((row, index) => {
    for (const key of identityKeys(row)) {
      const owner = keyOwners.get(key);
      if (owner === undefined) {
        keyOwners.set(key, index);
      } else {
        unionGroups(parents, owner, index);
      }
    }
  });

  const groups = new Map();
  rows.forEach((row, index) => {
    const root = findGroupParent(parents, index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  });

  return [...groups.values()];
}

function unionGroups(parents, left, right) {
  const leftRoot = findGroupParent(parents, left);
  const rightRoot = findGroupParent(parents, right);
  if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
}

function findGroupParent(parents, index) {
  if (parents[index] !== index) {
    parents[index] = findGroupParent(parents, parents[index]);
  }
  return parents[index];
}

function identityKeys(row) {
  const keys = [];
  const domain = domainFromUrl(row.website_url);
  const name = normalizeName(row.company_name);
  if (domain && !isSharedHostingDomain(domain)) keys.push(`domain:${domain}`);
  if (domain) {
    const domainName = normalizeNameForSharedDomain(row.company_name);
    if (domainName) keys.push(`domain-name:${domain}:${domainName}`);
    else keys.push(`domain:${domain}`);
  }

  const linkedinSlug = companySlugFromLinkedIn(row.linkedin_url);
  if (linkedinSlug) keys.push(`linkedin:${linkedinSlug}`);
  if (name) keys.push(`name:${name}`);
  if (!keys.length) keys.push(`source:${sourceId(row)}`);

  return uniqueValues(keys);
}

function companySlugFromLinkedIn(value) {
  if (!value || typeof value !== "string") return null;

  try {
    const url = new URL(normalizeUrl(value));
    if (!url.hostname.includes("linkedin.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const companyIndex = parts.indexOf("company");
    return companyIndex >= 0 ? parts[companyIndex + 1]?.toLowerCase() ?? null : null;
  } catch {
    return null;
  }
}

function isSharedHostingDomain(domain) {
  return [...SHARED_HOSTING_DOMAINS].some((sharedDomain) =>
    domain === sharedDomain || domain.endsWith(`.${sharedDomain}`),
  );
}

function normalizeName(value) {
  const raw = String(value ?? "");
  const asciiName = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sarl|bv|pte|plc|corp|corporation|co|company)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (asciiName) return asciiName;

  return raw
    .normalize("NFKC")
    .replace(/[（(][^（）()]*[）)]/g, " ")
    .replace(/[\s,，.。·•・、]+/g, "")
    .trim()
    .toLowerCase();
}

function normalizeNameForSharedDomain(value) {
  const base = normalizeName(value);
  const withoutDescriptors = base
    .replace(/\ba s\b/g, " ")
    .replace(/\b(ai|automation|foundation|international|io|robot|robots|robotics|technologies|technology)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  return withoutDescriptors || base;
}

function mergeCompanyGroup(group, retrievedAt) {
  const sorted = [...group].sort((a, b) => sourceRecordScore(b) - sourceRecordScore(a));
  const primary = sorted[0];
  const fieldKeys = sourceFieldKeys(sorted);
  const canonical = {};

  for (const field of fieldKeys) {
    canonical[field] = mergeField(field, sorted);
  }

  canonical.notion_page_id = primary.notion_page_id ?? sourceId(primary);
  canonical.notion_page_url = primary.notion_page_url ?? primary.source_url;
  canonical.notion_page_ids = uniqueValues(
    sorted.map((row) => row.notion_page_id).filter(Boolean),
  );
  canonical.notion_page_urls = uniqueValues(
    sorted.map((row) => row.notion_page_url).filter(Boolean),
  );
  canonical.source_record_ids = uniqueValues(sorted.map(sourceId));
  canonical.canonical_domain = domainFromUrl(canonical.website_url);
  canonical.canonical_company_id = canonical.canonical_domain
    ? `domain:${canonical.canonical_domain}`
    : `name:${normalizeName(canonical.company_name)}`;
  canonical.company_id = canonical.canonical_company_id;

  const sources = sorted.map((row) => buildSource(row, fieldKeys, retrievedAt));
  canonical.source_records = sources;
  canonical.source_count = sources.length;
  canonical.field_sources = buildFieldSources(fieldKeys, sorted);

  const conflicts = buildFieldConflicts(fieldKeys, sorted);
  if (Object.keys(conflicts).length) canonical.field_conflicts = conflicts;

  if (sorted.length > 1) {
    canonical.merged_from = sorted.map((row) => ({
      source_id: sourceId(row),
      notion_page_id: row.notion_page_id,
      notion_page_url: row.notion_page_url,
      source_url: row.source_url,
      company_name: row.company_name,
    }));
  }

  const dataQuality = buildDataQuality(canonical, sorted);
  if (Object.keys(dataQuality).length) canonical.data_quality = dataQuality;

  return removeEmptyOptionalFields(canonical);
}

function sourceFieldKeys(rows) {
  const keys = new Set();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (METADATA_FIELDS.has(key)) continue;
      if (isMeaningful(value)) keys.add(key);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function sourceRecordScore(row) {
  let score = 0;
  if (row.status === "Listed") score += 100;
  if (typeof row.founded === "number") score += 15;
  if (Array.isArray(row.country) && row.country.length) score += 15;
  if (row.city) score += 5;
  if (row.website_url) score += 10;
  if (row.linkedin_url) score += 5;
  if (row.github_url) score += 3;
  if (row.short_description) score += Math.min(20, row.short_description.length / 12);
  if (row.last_edited_time) score += Math.min(5, Date.parse(row.last_edited_time) / 10 ** 13);
  return score;
}

function mergeField(field, rows) {
  if (field === "notion_page_id" || field === "notion_page_url") {
    return rows[0][field];
  }
  if (field === "created_time") return minIso(rows.map((row) => row.created_time));
  if (field === "last_edited_time") return maxIso(rows.map((row) => row.last_edited_time));
  if (field === "status") return rows.some((row) => row.status === "Listed") ? "Listed" : firstValue(rows, field);
  if (MULTI_VALUE_FIELDS.has(field)) return uniqueValues(rows.flatMap((row) => row[field] ?? []));
  if (URL_FIELDS.has(field)) return bestUrl(rows.map((row) => row[field]).filter(Boolean));
  if (field === "highlighted" || field === "possibly_irrelevant" || field === "remote_first" || field === "not_enough_info") {
    return rows.some((row) => row[field] === true);
  }
  if (field === "short_description") return bestText(rows.map((row) => row[field]));
  if (OBJECT_FIELDS.has(field)) return firstValue(rows, field);

  return firstValue(rows, field);
}

function firstValue(rows, field) {
  for (const row of rows) {
    const value = row[field];
    if (isMeaningful(value)) return value;
  }
  return null;
}

function bestText(values) {
  const meaningful = values.filter(isMeaningful);
  if (!meaningful.length) return null;
  return meaningful.sort((a, b) => String(b).length - String(a).length)[0];
}

function bestUrl(values) {
  const normalized = uniqueValues(values.map(normalizeUrl).filter(Boolean));
  if (!normalized.length) return null;
  return normalized.sort((a, b) => urlScore(b) - urlScore(a) || a.length - b.length)[0];
}

function urlScore(value) {
  try {
    const url = new URL(value);
    let score = 0;
    if (url.protocol === "https:") score += 10;
    if (!url.pathname || url.pathname === "/") score += 5;
    if (!url.hostname.startsWith("www.")) score += 2;
    return score;
  } catch {
    return 0;
  }
}

function buildSource(row, fieldKeys, retrievedAt) {
  const observedFields = Object.fromEntries(
    fieldKeys
      .filter((field) => isMeaningful(row[field]))
      .map((field) => [field, row[field]]),
  );

  return {
    source_id: sourceId(row),
    source_name: row.source_name ?? SOURCE_NAME,
    source_type: row.source_type ?? SOURCE_TYPE,
    source_url: row.source_url ?? row.notion_page_url,
    source_record_id: row.source_record_id ?? row.notion_page_id,
    source_record_created_at:
      row.source_record_created_at ?? row.source_created_time ?? row.created_time ?? null,
    source_record_last_edited_at:
      row.source_record_last_edited_at ??
      row.source_last_edited_time ??
      row.last_edited_time ??
      null,
    retrieved_at: retrievedAt,
    confidence: row.source_confidence ?? SOURCE_CONFIDENCE,
    extraction_method: row.extraction_method ?? "notion_internal_api",
    fields: Object.keys(observedFields),
    observed_fields: observedFields,
  };
}

function buildFieldSources(fieldKeys, rows) {
  const fieldSources = {};

  for (const field of fieldKeys) {
    const sourceIds = rows
      .filter((row) => isMeaningful(row[field]))
      .map(sourceId);
    if (sourceIds.length) fieldSources[field] = uniqueValues(sourceIds);
  }

  return fieldSources;
}

function buildFieldConflicts(fieldKeys, rows) {
  const conflicts = {};

  for (const field of fieldKeys) {
    if (CONFLICT_EXCLUDED_FIELDS.has(field)) continue;
    if (MULTI_VALUE_FIELDS.has(field)) continue;
    const valueGroups = new Map();

    for (const row of rows) {
      const value = normalizeFieldValue(field, row[field]);
      if (!isMeaningful(value)) continue;
      const key = stableValueKey(value);
      if (!valueGroups.has(key)) {
        valueGroups.set(key, {
          value,
          source_ids: [],
        });
      }
      valueGroups.get(key).source_ids.push(sourceId(row));
    }

    if (valueGroups.size > 1) conflicts[field] = [...valueGroups.values()];
  }

  return conflicts;
}

function normalizeFieldValue(field, value) {
  if (URL_FIELDS.has(field)) return normalizeUrl(value);
  if (field === "created_time" || field === "last_edited_time") return value ?? null;
  if (typeof value === "string") return value.trim();
  return value ?? null;
}

function stableValueKey(value) {
  if (typeof value === "string") return value.toLowerCase();
  return JSON.stringify(value);
}

function buildDataQuality(canonical, sourceRows) {
  const quality = {};
  const missing = [];

  for (const field of ["company_name", "website_url", "linkedin_url", "country", "founded"]) {
    if (!isMeaningful(canonical[field])) missing.push(field);
  }

  if (missing.length) quality.missing_fields = missing;
  if (sourceRows.length > 1) quality.merged_duplicate_source_records = sourceRows.length;

  const normalizedUrlFields = [];
  for (const field of URL_FIELDS) {
    const changed = sourceRows.some((row) => {
      if (!isMeaningful(row[field])) return false;
      return row[field] !== normalizeUrl(row[field]);
    });
    if (changed) normalizedUrlFields.push(field);
  }
  if (normalizedUrlFields.length) quality.normalized_url_fields = normalizedUrlFields;

  return quality;
}

function sourceId(row) {
  if (row.source_id) return row.source_id;
  if (row.source_namespace && row.source_record_id) {
    return `${row.source_namespace}:${row.source_record_id}`;
  }
  if (row.notion_page_id) return `notion:${row.notion_page_id}`;
  return `unknown:${normalizeName(row.company_name) || domainFromUrl(row.website_url) || "record"}`;
}

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(isMeaningful);
  return true;
}

function uniqueValues(values) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    if (!isMeaningful(value)) continue;
    const key = typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(typeof value === "string" ? value.trim() : value);
  }

  return unique;
}

function minIso(values) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime());
  if (!timestamps.length) return null;
  return new Date(Math.min(...timestamps)).toISOString();
}

function maxIso(values) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime());
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function removeEmptyOptionalFields(company) {
  const cleaned = {};

  for (const [key, value] of Object.entries(company)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && !value.length && !MULTI_VALUE_FIELDS.has(key)) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      !Object.keys(value).length &&
      key !== "field_sources"
    ) {
      continue;
    }
    cleaned[key] = value;
  }

  return cleaned;
}

function stripCanonicalMetadata(row) {
  const sourceRow = { ...row };

  for (const field of [
    "canonical_company_id",
    "canonical_domain",
    "company_id",
    "data_quality",
    "field_conflicts",
    "field_sources",
    "merged_from",
    "notion_page_ids",
    "notion_page_urls",
    "source_count",
    "source_record_ids",
    "source_records",
    "sources",
  ]) {
    delete sourceRow[field];
  }

  return sourceRow;
}
