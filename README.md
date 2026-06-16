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
