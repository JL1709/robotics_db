import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeCompanies } from "./company_normalization.mjs";

const SOURCE_URL = "https://petrnovikov.notion.site/";
const API_BASE = "https://petrnovikov.notion.site/api/v3";
const NOTION_CLIENT_VERSION = "23.13.20260615.2346";

const PAGE_ID = "cabb6b9c-1937-4b9e-8c7b-4b2e1fb48c0b";
const COLLECTION_ID = "aeb69882-af63-4817-a35d-2c825eef7290";
const TABLE_VIEW_ID = "54628715-b17c-4b0f-9c5f-61743ab24bb8";

const OUTPUT_PATH =
  process.argv[2] ?? path.join("data", "robotics_companies.json");

const FIELD_DEFS = {
  title: { key: "company_name", type: "text" },
  "iCo:": { key: "short_description", type: "text" },
  skoW: { key: "product_type", type: "multi_select" },
  MMDu: { key: "website_url", type: "url" },
  HbXx: { key: "linkedin_url", type: "url" },
  "[FB@": { key: "github_url", type: "url" },
  "\\TY:": { key: "founded", type: "number" },
  "=zjt": { key: "country", type: "multi_select" },
  "P[Hs": { key: "state", type: "multi_select" },
  "_;;<": { key: "city", type: "text" },
  "[FJG": { key: "targeted_industries", type: "multi_select" },
  "=OcS": { key: "robot_or_automated_system_type", type: "multi_select" },
  "Gp=]": { key: "hardware_component_type", type: "multi_select" },
  "\\B@c": { key: "software_type", type: "multi_select" },
  "rL_]": { key: "accessory_type", type: "multi_select" },
  "XN;V": { key: "human_augmentation_device_type", type: "multi_select" },
  "Zy<f": { key: "affiliations", type: "text" },
  jYRI: { key: "status", type: "select" },
  ";kWY": { key: "highlighted", type: "checkbox" },
  "?lo[": { key: "website_preview", type: "file" },

  // Legacy/deleted schema properties that still contain useful public data.
  SAeP: { key: "tags", type: "multi_select" },
  "mY>|": { key: "possibly_irrelevant", type: "checkbox" },
  pjJE: { key: "remote_first", type: "checkbox" },
  ysen: { key: "not_enough_info", type: "checkbox" },
  "|bbP": { key: "equipment_type", type: "multi_select" },
  LPGM: { key: "legacy_website_preview", type: "file" },
};

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

async function post(endpoint, payload) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "notion-client-version": NOTION_CLIENT_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${endpoint} failed: ${response.status} ${body}`);
  }

  return response.json();
}

function richTextToPlain(value) {
  if (!Array.isArray(value)) return null;

  const text = value
    .map((part) => (Array.isArray(part) ? part[0] ?? "" : ""))
    .join("");

  return text === "" ? null : text;
}

function linksFromRichText(value) {
  if (!Array.isArray(value)) return [];

  const links = [];
  for (const part of value) {
    if (!Array.isArray(part) || !Array.isArray(part[1])) continue;
    for (const decoration of part[1]) {
      if (decoration?.[0] === "a" && typeof decoration[1] === "string") {
        links.push(decoration[1]);
      }
    }
  }

  return links;
}

function rawProperty(properties, id) {
  return properties?.[id] ?? null;
}

function propertyText(properties, id) {
  const raw = rawProperty(properties, id);
  if (!raw) return null;
  return richTextToPlain(raw);
}

function propertyUrl(properties, id) {
  const raw = rawProperty(properties, id);
  if (!raw) return null;
  return linksFromRichText(raw)[0] ?? propertyText(properties, id);
}

function propertyNumber(properties, id) {
  const value = propertyText(properties, id);
  if (value === null) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function propertyCheckbox(properties, id) {
  const value = propertyText(properties, id);
  if (value === null) return null;

  const lower = value.trim().toLowerCase();
  if (lower === "yes" || lower === "true") return true;
  if (lower === "no" || lower === "false") return false;
  return value;
}

function propertyMultiSelect(properties, id) {
  const value = propertyText(properties, id);
  if (value === null) return [];

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function propertyFile(properties, id) {
  const raw = rawProperty(properties, id);
  if (!raw) return null;

  return {
    name: propertyText(properties, id),
    url: linksFromRichText(raw)[0] ?? null,
  };
}

function normalizeProperty(properties, id, type) {
  if (type === "checkbox") return propertyCheckbox(properties, id);
  if (type === "file") return propertyFile(properties, id);
  if (type === "multi_select") return propertyMultiSelect(properties, id);
  if (type === "number") return propertyNumber(properties, id);
  if (type === "url") return propertyUrl(properties, id);
  return propertyText(properties, id);
}

function notionPageUrl(id) {
  return `${SOURCE_URL}${id.replaceAll("-", "")}`;
}

function normalizePage(page, schema, deletedSchema) {
  const properties = page.properties ?? {};
  const company = {
    notion_page_id: page.id,
    notion_page_url: notionPageUrl(page.id),
    created_time: page.created_time
      ? new Date(page.created_time).toISOString()
      : null,
    last_edited_time: page.last_edited_time
      ? new Date(page.last_edited_time).toISOString()
      : null,
  };

  for (const [id, { key, type }] of Object.entries(FIELD_DEFS)) {
    const value = normalizeProperty(properties, id, type);
    if (type === "multi_select" || value !== null) {
      company[key] = value;
    }
  }

  const mappedIds = new Set(Object.keys(FIELD_DEFS));
  const unmapped = {};

  for (const id of Object.keys(properties).sort()) {
    if (mappedIds.has(id)) continue;

    const schemaEntry = schema[id] ?? deletedSchema[id] ?? {};
    const label = schemaEntry.name ?? id;
    unmapped[label] = normalizeProperty(properties, id, schemaEntry.type);
  }

  if (Object.keys(unmapped).length > 0) {
    company.unmapped_properties = unmapped;
  }

  return company;
}

async function main() {
  const pageChunk = await post("loadPageChunk", {
    pageId: PAGE_ID,
    limit: 100,
    cursor: { stack: [] },
    chunkNumber: 0,
    verticalColumns: false,
  });

  const collection =
    pageChunk.recordMap.collection[COLLECTION_ID].value.value;
  const schema = collection.schema ?? {};
  const deletedSchema = collection.deleted_schema ?? {};

  const queryResult = await post("queryCollection", {
    collectionId: COLLECTION_ID,
    collectionViewId: TABLE_VIEW_ID,
    query: {
      sort: [{ property: "title", direction: "ascending" }],
      aggregations: [{ property: "title", aggregator: "count" }],
    },
    loader: {
      type: "reducer",
      reducers: {
        collection_group_results: {
          type: "results",
          limit: 1000,
          loadContentCover: true,
        },
      },
      searchQuery: "",
      userTimeZone: "America/Los_Angeles",
    },
  });

  const blockIds =
    queryResult.result.reducerResults.collection_group_results.blockIds;
  const rawCompanies = blockIds
    .map((id) => queryResult.recordMap.block[id]?.value?.value)
    .filter((page) => page?.type === "page" && page.parent_id === COLLECTION_ID)
    .map((page) => normalizePage(page, schema, deletedSchema));
  const companies = canonicalizeCompanies(rawCompanies).sort((a, b) =>
    collator.compare(a.company_name ?? "", b.company_name ?? ""),
  );

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(companies, null, 2)}\n`);

  console.log(
    `Wrote ${companies.length} canonical companies from ${rawCompanies.length} source records to ${OUTPUT_PATH}`,
  );
  const mergedCount = companies.filter((company) => company.source_count > 1).length;
  console.log(`Merged duplicate groups: ${mergedCount}`);
  const statusCounts = companies.reduce((counts, company) => {
    const status = company.status ?? "(missing)";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify(statusCounts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
