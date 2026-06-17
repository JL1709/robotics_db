import fs from 'node:fs';
import path from 'node:path';

const companiesPath = 'data/robotics_companies.json';
const manifestDir = 'data/preview_manifests';

const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf8'));
const byId = new Map(companies.map((company) => [company.company_id, company]));

const manifests = fs.existsSync(manifestDir)
  ? fs
      .readdirSync(manifestDir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => path.join(manifestDir, file))
  : [];

let rows = [];
for (const manifest of manifests) {
  rows = rows.concat(JSON.parse(fs.readFileSync(manifest, 'utf8')));
}

let applied = 0;
let skipped = 0;
for (const row of rows) {
  if (!row.preview_url || !['created', 'exists'].includes(row.status)) {
    skipped += 1;
    continue;
  }
  const company = byId.get(row.company_id);
  if (!company) {
    skipped += 1;
    continue;
  }
  company.website_preview = {
    name: `${company.company_name} website preview`,
    url: row.preview_url,
  };
  applied += 1;
}

fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2) + '\n');

const summary = rows.reduce(
  (acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  },
  { manifests: manifests.length, manifestRows: rows.length, applied, skipped },
);

console.log(JSON.stringify(summary, null, 2));
