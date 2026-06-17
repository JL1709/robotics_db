import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  '/Users/julianludt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);

const dataPath = 'data/robotics_companies.json';
const outputDir = 'previews';
const manifestDir = 'data/preview_manifests';
const start = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 25);
const workerName = process.argv[4] ?? `worker-${start}-${count}`;

if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1) {
  throw new Error('Usage: node scripts/generate_website_previews.mjs <start> <count> <workerName>');
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(manifestDir, { recursive: true });

const companies = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const missingPreview = companies.filter((company) => company.website_url && !company.website_preview?.url);
const slice = missingPreview.slice(start, start + count);

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
});

const results = [];

for (const company of slice) {
  const fileName = `${company.company_id}.jpg`;
  const relativeUrl = `./previews/${fileName}`;
  const filePath = path.join(outputDir, fileName);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    results.push({
      company_id: company.company_id,
      company_name: company.company_name,
      website_url: company.website_url,
      preview_url: relativeUrl,
      status: 'exists',
    });
    continue;
  }

  const page = await context.newPage();
  try {
    await page.route('**/*', (route) => {
      const request = route.request();
      const type = request.resourceType();
      if (['media', 'font'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(company.website_url, {
      waitUntil: 'domcontentloaded',
      timeout: 18000,
    });
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: filePath,
      type: 'jpeg',
      quality: 62,
      fullPage: false,
    });

    results.push({
      company_id: company.company_id,
      company_name: company.company_name,
      website_url: company.website_url,
      preview_url: relativeUrl,
      status: 'created',
    });
  } catch (error) {
    results.push({
      company_id: company.company_id,
      company_name: company.company_name,
      website_url: company.website_url,
      preview_url: null,
      status: 'failed',
      error: error.message,
    });
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  } finally {
    await page.close();
  }
}

await context.close();
await browser.close();

const manifestPath = path.join(manifestDir, `${workerName}.json`);
fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2) + '\n');

const summary = results.reduce(
  (acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  },
  { total: results.length },
);

console.log(JSON.stringify({ workerName, start, count, manifestPath, ...summary }, null, 2));
