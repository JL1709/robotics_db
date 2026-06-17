# Robotics Market Atlas

Static dashboard for exploring the robotics company database.

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

- `data/robotics_companies.json` is the only company data file used by the app.
- The file is intentionally lean and contains only dashboard fields, app-owned
  `company_id`, `source_name`, `source_url`, website fields, website preview
  images, source metadata, and robotics classification fields.
- `data/world-countries.geojson` is retained only as the map geometry asset for
  the dashboard's world map.
- `vendor/d3.v7.min.js` is retained only for map projection and SVG rendering.
- Backups, source-record archives, enrichment queues, and pipeline outputs are
  intentionally not kept in this repo.
- The dashboard opens on the modern market view (`1990+`) by default. Use
  `All records` or `Legacy industrials` in the Founded filter to inspect older
  industrial automation companies such as Bosch Rexroth.
