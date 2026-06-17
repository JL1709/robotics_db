import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { domainFromUrl } from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_CONTACTS_PATH = path.join("data", "contact_enrichment_records.json");

const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const contactsPath = valueAfter("--contacts") ?? DEFAULT_CONTACTS_PATH;
const outputPath = valueAfter("--out") ?? dbPath;
const noBackup = args().has("--no-backup");
const mergedAt = valueAfter("--merged-at") ?? new Date().toISOString();

const dbRows = JSON.parse(await readFile(dbPath, "utf8"));
const contactRows = JSON.parse(await readFile(contactsPath, "utf8"));

if (!Array.isArray(dbRows)) throw new Error(`${dbPath} must contain a JSON array`);
if (!Array.isArray(contactRows)) throw new Error(`${contactsPath} must contain a JSON array`);

const contactIndex = buildContactIndex(contactRows);
let matched = 0;
let missing = 0;
let duplicateIdentityMatches = 0;

const mergedRows = dbRows.map((company) => {
  const contact = bestContactForCompany(company, contactIndex);
  if (!contact) {
    missing += 1;
    return company;
  }

  matched += 1;
  if (matchedContactCount(company, contactIndex) > 1) duplicateIdentityMatches += 1;

  return mergeContact(company, contact, mergedAt);
});

if (!noBackup && outputPath === dbPath) {
  const stamp = mergedAt.replace(/[:.]/g, "-");
  const backupPath = path.join("data", "backups", `robotics_companies_before_contact_merge_${stamp}.json`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(dbPath, backupPath);
  console.log(`Backup written to ${backupPath}`);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(mergedRows, null, 2)}\n`);

const summary = {
  db_rows: dbRows.length,
  contact_rows: contactRows.length,
  merged_rows: mergedRows.length,
  matched,
  missing,
  duplicate_identity_matches: duplicateIdentityMatches,
  rows_with_contact_enrichment: mergedRows.filter((row) => row.contact_enrichment).length,
  rows_with_contact_email: mergedRows.filter((row) => row.contact_email_count > 0).length,
  rows_with_contact_form: mergedRows.filter((row) => row.contact_form_count > 0).length,
  rows_with_contact_phone: mergedRows.filter((row) => row.contact_phone_count > 0).length,
};

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote merged DB to ${outputPath}`);

function args() {
  return new Set(process.argv.slice(2));
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function buildContactIndex(rows) {
  const index = new Map();

  for (const row of rows) {
    for (const key of identityKeys(row)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
  }

  return index;
}

function bestContactForCompany(company, index) {
  const candidates = uniqueObjects(
    identityKeys(company).flatMap((key) => index.get(key) ?? []),
    (row) => contactRecordKey(row),
  );
  return candidates.sort((a, b) => contactScore(b) - contactScore(a) || byName(a, b))[0] ?? null;
}

function matchedContactCount(company, index) {
  return uniqueObjects(
    identityKeys(company).flatMap((key) => index.get(key) ?? []),
    (row) => contactRecordKey(row),
  ).length;
}

function mergeContact(company, contact, mergedAt) {
  const contactEnrichment = buildContactEnrichment(contact, mergedAt);
  const contactSource = buildContactSource(company, contactEnrichment, mergedAt);
  const sourceRecords = [
    ...(Array.isArray(company.source_records)
      ? company.source_records.filter((source) => !String(source.source_id ?? "").startsWith("contact_enrichment:"))
      : []),
    contactSource,
  ];
  const contactSourceId = contactSource.source_id;

  return {
    ...company,
    contact_enrichment: contactEnrichment,
    contact_best_outreach_channel: contact.contact_summary?.best_outreach_channel ?? null,
    contact_quality: contact.contact_summary?.quality ?? "low",
    contact_email_count: contact.emails?.length ?? 0,
    contact_form_count: contact.forms?.length ?? 0,
    contact_phone_count: contact.phones?.length ?? 0,
    contact_people_count: contact.people?.length ?? 0,
    source_records: sourceRecords,
    source_count: sourceRecords.length,
    source_record_ids: uniqueValues([
      ...(Array.isArray(company.source_record_ids) ? company.source_record_ids : []),
      contactSource.source_record_id,
    ]),
    field_sources: {
      ...(company.field_sources ?? {}),
      contact_enrichment: [contactSourceId],
      contact_best_outreach_channel: [contactSourceId],
      contact_quality: [contactSourceId],
      contact_email_count: [contactSourceId],
      contact_form_count: [contactSourceId],
      contact_phone_count: [contactSourceId],
      contact_people_count: [contactSourceId],
    },
  };
}

function buildContactEnrichment(contact, mergedAt) {
  return {
    source_company_name: contact.company_name,
    source_contact_record_id: contactRecordKey(contact),
    source_retrieved_at: contact.retrieved_at ?? null,
    merged_at: mergedAt,
    contact_summary: contact.contact_summary ?? {},
    people: contact.people ?? [],
    emails: contact.emails ?? [],
    phones: contact.phones ?? [],
    forms: contact.forms ?? [],
    addresses: contact.addresses ?? [],
    inferred_emails: contact.inferred_emails ?? [],
    page_sources: contact.page_sources ?? [],
    extraction_notes: contact.extraction_notes ?? [],
  };
}

function buildContactSource(company, contactEnrichment, mergedAt) {
  const sourceRecordId = contactEnrichment.source_contact_record_id;
  const sourceId = `contact_enrichment:${sourceRecordId}`;
  const observedFields = {
    company_name: company.company_name,
    website_url: company.website_url ?? null,
    contact_enrichment: contactEnrichment,
    contact_best_outreach_channel:
      contactEnrichment.contact_summary?.best_outreach_channel ?? null,
    contact_quality: contactEnrichment.contact_summary?.quality ?? "low",
    contact_email_count: contactEnrichment.emails.length,
    contact_form_count: contactEnrichment.forms.length,
    contact_phone_count: contactEnrichment.phones.length,
    contact_people_count: contactEnrichment.people.length,
  };

  return {
    source_id: sourceId,
    source_name: "Automated Contact Enrichment",
    source_type: "automated_contact_enrichment",
    source_url: company.website_url ?? company.notion_page_url ?? null,
    source_record_id: sourceRecordId,
    source_record_created_at: null,
    source_record_last_edited_at: contactEnrichment.source_retrieved_at,
    retrieved_at: mergedAt,
    confidence: contactConfidence(contactEnrichment.contact_summary?.quality),
    extraction_method: "official_website_contact_extraction",
    fields: Object.keys(observedFields).filter((field) => isMeaningful(observedFields[field])),
    observed_fields: removeEmpty(observedFields),
  };
}

function contactConfidence(quality) {
  if (quality === "high") return 85;
  if (quality === "medium") return 60;
  return 25;
}

function contactScore(row) {
  const quality = row.contact_summary?.quality;
  let score = quality === "high" ? 1000 : quality === "medium" ? 500 : 100;
  score += (row.emails?.length ?? 0) * 20;
  score += (row.forms?.length ?? 0) * 6;
  score += (row.phones?.length ?? 0) * 4;
  score += (row.people?.length ?? 0) * 3;
  return score;
}

function contactRecordKey(row) {
  return (
    row.canonical_company_id ??
    row.company_id ??
    row.notion_page_id ??
    (row.canonical_domain ? `domain:${row.canonical_domain}` : null) ??
    (domainFromUrl(row.website_url) ? `domain:${domainFromUrl(row.website_url)}` : null) ??
    `name:${normalizeText(row.company_name)}`
  );
}

function identityKeys(row) {
  return uniqueValues([
    row.canonical_company_id,
    row.company_id,
    row.notion_page_id,
    row.canonical_domain ? `domain:${row.canonical_domain}` : null,
    domainFromUrl(row.website_url) ? `domain:${domainFromUrl(row.website_url)}` : null,
    normalizeText(row.company_name) ? `name:${normalizeText(row.company_name)}` : null,
  ]);
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

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(isMeaningful);
  return true;
}

function removeEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => isMeaningful(fieldValue)),
  );
}
