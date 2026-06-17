# Robotics Market Atlas

Static dashboard for exploring the extracted robotics company database.

## Run

```bash
./run_app.sh
```

Then open:

```text
http://localhost:5177/
```

The script automatically stops any process already listening on port `5177`
before starting the app. To use a different port:

```bash
PORT=8080 ./run_app.sh
```

## Data

- `data/robotics_companies.json` contains the extracted company records.
- `data/public_source_records.json` contains the latest raw public-source
  observations that feed canonicalization.
- `data/website_validation_records.json` contains automated website QA source
  observations, one per canonical company.
- `data/web_profile_enrichment_records.json` contains accepted automated
  website and description enrichment rows.
- `data/web_profile_enrichment_review_queue.json` contains rejected or
  lower-confidence enrichment candidates for manual review.
- `data/subagent_profile_research_results.json` contains accepted structured
  results from the 100-company Codex subagent web-research experiment.
- `data/subagent_profile_research_records.json` contains the provenance rows
  imported from those subagent results.
- `data/world-countries.geojson` powers the local world choropleth map.
- `vendor/d3.v7.min.js` is vendored locally for the map projection and SVG path
  rendering.
- `scripts/extract_notion_robotics_companies.mjs` refreshes the JSON from the public Notion source.
- `scripts/normalize_robotics_companies.mjs` canonicalizes an existing JSON file,
  adds source provenance, normalizes URLs, and merges high-confidence duplicates.
- `scripts/ingest_public_sources.mjs` enriches the database from free public
  robotics directories and startup portfolios. The current pass ingests
  MassRobotics residents, OSRA members, ROS-Industrial current members, A3
  Automate companies, JARA members, TAIROA group members, Odense Robotics
  members, StartupSG robotics startups, Y Combinator robotics search results,
  Techstars robotics/drones portfolio matches, HAX robotics startups, J-Startup
  robotics startups, SOSV robotics portfolio companies, Plug and Play robotics
  startup matches, Alchemist robotics matches, Berkeley SkyDeck robotics
  matches, Entrepreneur First robotics portfolio cards, World Robot Conference
  past highlight exhibits, CeMAT ASIA robotics/logistics automation exhibitors,
  Automate UK/BARA product-finder categories, Pittsburgh Robotics Network
  members, Silicon Valley Robotics members, Wikipedia robotics company
  lists/categories, and Wikidata robotics-industry companies. It also attempts
  lower-confidence discovery evidence from UKRI Gateway to Research robotics
  organisations, OpenAlex company institutions, EIC Fund robot-keyword portfolio
  cards, CORDIS robotics project organisations, and China-focused MediaWiki
  robotics company search results when those public sources are reachable.
  Extracted raw source observations are written to
  `data/public_source_records.json`; refreshed public-source namespaces replace
  older observations from the same source so stale false positives do not remain
  in the canonical DB.
- `scripts/validate_company_websites.mjs` checks each canonical `website_url`,
  follows redirects, detects missing/local/directory-profile/parked/broken
  websites, and writes validation facts back as source records.
- `scripts/enrich_company_profiles.mjs` searches for missing company websites
  and descriptions, validates candidate homepages, writes accepted enrichment
  source rows, and keeps a review queue for uncertain matches. Apply runs back
  up the previous canonical JSON in `data/backups/` before rewriting it.
- `scripts/apply_profile_research_results.mjs` imports structured manual or
  subagent web-research results. Use `--in-place` for conservative updates that
  preserve the current canonical company count. High-confidence accepted results
  update verified website fields; uncertain and not-found results are preserved
  as candidate/review fields such as `candidate_website_url`,
  `candidate_confidence`, and `profile_review_status`.
- `scripts/trust_notion_websites.mjs` marks website URLs supplied by the trusted
  Petr Novikov Notion source as verified with `website_confidence: 99`.
- `scripts/audit_data_quality.mjs` prints repeatable missing-field and website
  status audits by source and country.
- Company records keep the original flat dashboard fields, plus provenance fields:
  - `company_id` / `canonical_company_id`: stable canonical identifier.
  - `canonical_domain`: normalized website domain when available.
  - `source_records`: source evidence attached to the company.
  - `field_sources`: source IDs behind each populated field.
  - `field_conflicts`: conflicting scalar values to review instead of discard.
- The dashboard opens on the modern market view (`1990+`) by default. Use
  `All records` or `Legacy industrials` in the Founded filter to inspect older
  industrial automation companies such as Bosch Rexroth.

To re-normalize the current file without refetching Notion:

```bash
node scripts/normalize_robotics_companies.mjs data/robotics_companies.json
```

To refresh the public-source enrichment pass:

```bash
node scripts/ingest_public_sources.mjs
```

To validate company websites and attach website QA provenance:

```bash
node scripts/validate_company_websites.mjs
```

To rebuild canonical records from existing validation rows without another
network sweep:

```bash
node scripts/validate_company_websites.mjs --rebuild-from-validation-rows
```

To audit current data quality:

```bash
node scripts/audit_data_quality.mjs
```

To test profile enrichment for one company:

```bash
node scripts/enrich_company_profiles.mjs --company "1stVision Inc." --dry-run --verbose
```

To apply a conservative batch using direct homepage candidates only:

```bash
node scripts/enrich_company_profiles.mjs --limit 75 --apply --replace --no-search
```

For broader discovery, set `BRAVE_SEARCH_API_KEY` so the script can use web
search results before falling back to direct homepage guesses:

```bash
BRAVE_SEARCH_API_KEY=... node scripts/enrich_company_profiles.mjs --limit 500 --apply
```

To import accepted Codex subagent web-research results without re-canonicalizing
the full database:

```bash
node scripts/apply_profile_research_results.mjs --input data/subagent_profile_research_results.json --apply --threshold 80 --in-place
```

To re-apply the trusted Notion website rule:

```bash
node scripts/trust_notion_websites.mjs
```
