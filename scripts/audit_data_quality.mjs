import { readFile } from "node:fs/promises";
import path from "node:path";

const dbPath = valueAfter("--db") ?? path.join("data", "robotics_companies.json");
const rows = JSON.parse(await readFile(dbPath, "utf8"));
if (!Array.isArray(rows)) {
  throw new Error(`${dbPath} must contain a JSON array`);
}

const missingWebsite = rows.filter((company) => !meaningful(company.website_url));
const missingDescription = rows.filter((company) => !meaningful(company.short_description));
const websiteStatusCounts = countBy(rows, (company) => company.website_status ?? "(unchecked)");

console.log(`Companies: ${rows.length}`);
console.log(`Missing website_url: ${missingWebsite.length}`);
console.log(`Missing short_description: ${missingDescription.length}`);
console.log("Website status:");
console.log(JSON.stringify(sortCounts(websiteStatusCounts), null, 2));

console.log("Missing website_url by source:");
console.log(JSON.stringify(topCounts(countBySource(missingWebsite), 20), null, 2));

console.log("Missing short_description by source:");
console.log(JSON.stringify(topCounts(countBySource(missingDescription), 20), null, 2));

console.log("Missing website_url by country:");
console.log(JSON.stringify(topCounts(countByCountry(missingWebsite), 20), null, 2));

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function countBySource(companies) {
  const counts = {};
  for (const company of companies) {
    const names = new Set((company.source_records ?? []).map((source) => source.source_name).filter(Boolean));
    for (const name of names.size ? names : ["(missing source)"]) {
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

function countByCountry(companies) {
  const counts = {};
  for (const company of companies) {
    const countries = Array.isArray(company.country) && company.country.length ? company.country : ["(missing country)"];
    for (const country of countries) {
      counts[country] = (counts[country] ?? 0) + 1;
    }
  }
  return counts;
}

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function sortCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function topCounts(counts, limit) {
  return Object.fromEntries(Object.entries(sortCounts(counts)).slice(0, limit));
}

function meaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
