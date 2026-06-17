const app = document.querySelector("#app");

const FACETS = [
  { key: "country", label: "Countries", limit: 18 },
  { key: "product_type", label: "Product type", limit: 18 },
  { key: "targeted_industries", label: "Industries", limit: 20 },
  { key: "robot_or_automated_system_type", label: "Robot type", limit: 18 },
  { key: "software_type", label: "Software type", limit: 14 },
  { key: "hardware_component_type", label: "Hardware type", limit: 14 },
  { key: "tags", label: "Tags", limit: 18 },
];

const MODERN_START_YEAR = 1990;
const STARTUP_START_YEAR = 2015;
const RESULT_PAGE_SIZE = 72;
const TEXT_INPUT_RENDER_DELAY = 160;
const MAP_WIDTH = 960;
const MAP_HEIGHT = 430;
const BAD_WEBSITE_STATUSES = new Set([
  "missing",
  "invalid_url",
  "local_url",
  "directory_profile_url",
  "broken",
  "parked_or_for_sale",
  "not_found",
]);

const MAP_COUNTRY_ALIASES = new Map([
  ["United States", "United States of America"],
  ["USA", "United States of America"],
  ["U.S.", "United States of America"],
  ["UK", "United Kingdom"],
  ["Republic of Korea", "South Korea"],
  ["Korea, Republic of", "South Korea"],
  ["Viet Nam", "Vietnam"],
  ["Czech Republic", "Czechia"],
]);

const SORTS = [
  { value: "name", label: "Company name" },
  { value: "founded_desc", label: "Newest founded" },
  { value: "founded_asc", label: "Oldest founded" },
  { value: "country", label: "Country" },
];

const state = {
  search: "",
  facets: Object.fromEntries(FACETS.map((facet) => [facet.key, new Set()])),
  facetSearch: Object.fromEntries(FACETS.map((facet) => [facet.key, ""])),
  websiteConfidenceMin: 0,
  yearMode: "modern",
  yearFrom: null,
  yearTo: null,
  sort: "name",
  view: "cards",
  resultLimit: RESULT_PAGE_SIZE,
  selectedId: null,
  compareIds: new Set(),
  compareOpen: false,
  filtersOpen: false,
  filtersCollapsed: false,
};

let companies = [];
let byId = new Map();
let worldGeoJson = null;
let worldCountryNames = null;
let mapCountryValues = null;
let yearBounds = { min: 1900, max: new Date().getFullYear() };
let toastTimer = null;
let textInputRenderTimer = null;

init();

async function init() {
  try {
    const response = await fetch("./data/robotics_companies.json");
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }

    companies = (await response.json()).map(normalizeCompany);
    byId = new Map(companies.map((company) => [company.company_id, company]));
    yearBounds = getYearBounds(companies);
    await loadWorldMapData();
    applyYearMode("modern");
    render();
  } catch (error) {
    app.innerHTML = `
      <div class="boot">
        <div>
          <strong>Could not load dashboard data</strong>
          <span>${escapeHtml(error.message)}</span>
        </div>
      </div>
    `;
  }
}

async function loadWorldMapData() {
  try {
    const response = await fetch("./data/world-countries.geojson");
    if (!response.ok) {
      throw new Error(`Failed to load map data: ${response.status}`);
    }
    worldGeoJson = await response.json();
    worldCountryNames = null;
    mapCountryValues = null;
  } catch (error) {
    console.warn(error);
  }
}

function normalizeCompany(company) {
  const normalized = { ...company };
  for (const facet of FACETS) {
    normalized[facet.key] = Array.isArray(company[facet.key])
      ? company[facet.key].filter(Boolean)
      : [];
  }

  normalized.country = [
    ...new Set(normalized.country.map(normalizeMapCountryName).filter(Boolean)),
  ];
  normalized.state = Array.isArray(company.state) ? company.state : [];
  normalized.product_type = Array.isArray(company.product_type)
    ? company.product_type
    : [];
  normalized.website_confidence_score = getWebsiteConfidenceScore(company);
  normalized.founded =
    typeof company.founded === "number" && Number.isFinite(company.founded)
      ? company.founded
      : null;
  normalized.website_preview_url = company.website_preview?.url ?? null;
  normalized.search_blob = [
    company.company_name,
    company.short_description,
    company.website_url,
    company.website_status,
    company.website_final_url,
    company.website_validation_notes,
    company.source_name,
    company.source_url,
    `website confidence ${normalized.website_confidence_score}`,
    company.linkedin_url,
    company.city,
    normalized.country.join(" "),
    normalized.state.join(" "),
    normalized.product_type.join(" "),
    normalized.targeted_industries.join(" "),
    normalized.robot_or_automated_system_type.join(" "),
    normalized.hardware_component_type.join(" "),
    normalized.software_type.join(" "),
    normalized.tags.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return normalized;
}

function getYearBounds(rows) {
  const years = rows
    .map((company) => company.founded)
    .filter((year) => typeof year === "number");
  return {
    min: Math.min(...years),
    max: Math.max(...years),
  };
}

function render(options = {}) {
  const filtered = getFilteredCompanies();
  const sorted = sortCompanies(filtered);
  const selected = state.selectedId ? byId.get(state.selectedId) : null;
  const compareCompanies = [...state.compareIds]
    .map((id) => byId.get(id))
    .filter(Boolean);

  app.innerHTML = `
    <div class="app-shell${state.filtersCollapsed ? " filters-collapsed" : ""}">
      ${renderTopbar(filtered)}
      <div class="dashboard-grid">
        ${renderFilters(filtered)}
        <main class="main-stage">
          ${renderMetrics(filtered)}
          ${renderCharts(filtered)}
          ${renderResults(sorted)}
        </main>
      </div>
      ${renderCompareTray(compareCompanies)}
      ${renderDrawer(selected)}
      ${renderCompareModal(compareCompanies)}
      <div class="toast" id="toast"></div>
    </div>
  `;

  bindEvents();
  restoreFocus(options.focus);
}

function renderTopbar(filtered) {
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">${icon("network")}</div>
        <div>
          <span class="brand-title">Robotics Market Atlas</span>
          <span class="brand-meta">${filtered.length.toLocaleString()} of ${companies.length.toLocaleString()} companies</span>
        </div>
      </div>
      <label class="global-search">
        ${icon("search")}
        <input id="global-search" value="${escapeAttr(state.search)}" placeholder="Search companies, tags, domains, descriptions" autocomplete="off" />
      </label>
      <div class="top-actions">
        <button class="tool-button mobile-filter-button" id="open-filters" type="button">${icon("filter")}Filters</button>
        <button class="tool-button" data-export="json" type="button">${icon("download")}JSON</button>
        <button class="tool-button" data-export="csv" type="button">${icon("download")}CSV</button>
        <button class="ghost-button" id="reset-filters" type="button">${icon("refresh")}Reset</button>
      </div>
      ${renderActiveFilters()}
    </header>
  `;
}

function renderFilters(filtered) {
  const classes = [
    "filter-rail",
    state.filtersOpen ? "is-open" : "",
    state.filtersCollapsed ? "is-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const activeCount = getActiveFilterCount();

  return `
    <aside class="${classes}" id="filter-rail">
      <div class="filter-compact">
        <button class="icon-button" id="expand-filter-rail" type="button" aria-label="Expand filters" title="Expand filters">${icon("sidebarExpand")}</button>
        <span class="filter-compact-label">Filters</span>
        ${activeCount ? `<span class="filter-compact-count" aria-label="${activeCount} active filters">${activeCount}</span>` : ""}
      </div>
      <div class="filter-expanded">
        <div class="filter-head">
          <h2>Filters</h2>
          <div class="filter-head-actions">
            <button class="icon-button desktop-filter-button" id="collapse-filter-rail" type="button" aria-label="Collapse filters" title="Collapse filters">${icon("sidebarCollapse")}</button>
            <button class="icon-button mobile-filter-button" id="close-filters" type="button" aria-label="Close filters">${icon("x")}</button>
          </div>
        </div>
        <div class="filter-panel">
          <section class="filter-section">
            <div class="section-head"><h3>Founded</h3></div>
            <div class="facet-list year-mode-list">
              ${renderYearModeOption("modern", `Modern ${MODERN_START_YEAR}+`)}
              ${renderYearModeOption("startup", `Startups ${STARTUP_START_YEAR}+`)}
              ${renderYearModeOption("legacy", `Legacy <${MODERN_START_YEAR}`)}
              ${renderYearModeOption("all", "All records")}
            </div>
            <div class="year-grid">
              <label class="field-label">From
                <input id="year-from" type="number" min="${yearBounds.min}" max="${yearBounds.max}" value="${state.yearFrom}" />
              </label>
              <label class="field-label">To
                <input id="year-to" type="number" min="${yearBounds.min}" max="${yearBounds.max}" value="${state.yearTo}" />
              </label>
            </div>
          </section>

          ${renderWebsiteConfidenceFilter()}
          ${FACETS.map((facet) => renderFacet(facet)).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderWebsiteConfidenceFilter() {
  const value = state.websiteConfidenceMin;
  return `
    <section class="filter-section">
      <div class="section-head">
        <h3>Website confidence</h3>
        <div class="section-actions">
          ${value ? `<button class="tiny-button" id="clear-website-confidence" type="button">Clear</button>` : ""}
          <span class="count-pill">${value}+</span>
        </div>
      </div>
      <div class="confidence-control">
        <input id="website-confidence-range" type="range" min="0" max="100" step="5" value="${value}" aria-label="Minimum website confidence" />
        <label class="confidence-number">
          <span>Minimum</span>
          <input id="website-confidence-min" type="number" min="0" max="100" step="1" value="${value}" aria-label="Minimum website confidence value" />
        </label>
      </div>
    </section>
  `;
}

function renderYearModeOption(mode, label) {
  const checked = state.yearMode === mode ? " checked" : "";
  return `
    <label class="facet-row">
      <input type="radio" name="year-mode" data-year-mode="${mode}" value="${mode}"${checked} />
      <span class="facet-name">${escapeHtml(label)}</span>
      <span class="facet-count">${yearModeCount(mode)}</span>
    </label>
  `;
}

function renderFacet(facet) {
  const selected = state.facets[facet.key];
  const search = state.facetSearch[facet.key].trim().toLowerCase();
  const counts = facetCounts(facet.key);
  const options = [...counts.entries()]
    .filter(([value]) => !search || value.toLowerCase().includes(search))
    .sort((a, b) => sortFacetOptions(facet.key, a, b))
    .slice(0, selected.size > 0 ? Math.max(facet.limit, selected.size) : facet.limit);

  const selectedOptions = [...selected]
    .filter((value) => !options.some(([option]) => option === value))
    .map((value) => [value, counts.get(value) ?? 0]);
  const finalOptions = [...selectedOptions, ...options];

  return `
    <section class="filter-section">
      <div class="section-head">
        <h3>${escapeHtml(facet.label)}</h3>
        <div class="section-actions">
          ${selected.size ? `<button class="tiny-button" data-clear-facet="${facet.key}" type="button">Clear</button>` : ""}
          <span class="count-pill">${selected.size || counts.size}</span>
        </div>
      </div>
      <input class="facet-search" data-facet-search="${facet.key}" value="${escapeAttr(state.facetSearch[facet.key])}" placeholder="Filter ${escapeAttr(facet.label.toLowerCase())}" />
      <div class="facet-list">
        ${
          finalOptions.length
            ? finalOptions
                .map(([value, count]) => {
                  const checked = selected.has(value) ? " checked" : "";
                  return `
                    <label class="facet-row">
                      <input type="checkbox" data-facet="${facet.key}" value="${escapeAttr(value)}"${checked} />
                      <span class="facet-name" title="${escapeAttr(value)}">${escapeHtml(value)}</span>
                      <span class="facet-count">${count}</span>
                    </label>
                  `;
                })
                .join("")
            : `<div class="empty-filters">No values</div>`
        }
      </div>
    </section>
  `;
}

function renderMetrics(filtered) {
  const countryCount = uniqueValues(filtered, "country").size;
  const medianFounded = median(
    filtered
      .map((company) => company.founded)
      .filter((year) => typeof year === "number"),
  );
  const newest = [...filtered]
    .filter((company) => typeof company.founded === "number")
    .sort((a, b) => b.founded - a.founded)[0];

  return `
    <section class="metric-grid">
      ${metric("Companies", filtered.length.toLocaleString(), `${percentage(filtered.length, companies.length)} of dataset`)}
      ${metric("Countries", countryCount.toLocaleString(), topValue(filtered, "country") ? `Top: ${topValue(filtered, "country")}` : "No country data")}
      ${metric("Median founded", medianFounded ?? "n/a", newest ? `Newest company: ${newest.company_name}, founded ${newest.founded}` : "No year data")}
    </section>
  `;
}

function metric(label, value, sub) {
  return `
    <article class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(String(value))}</div>
      <div class="metric-sub">${escapeHtml(sub)}</div>
    </article>
  `;
}

function renderCharts(filtered) {
  const productCounts = topCounts(filtered, "product_type", 8);
  const countryCounts = topCounts(filtered, "country", 10);
  const industryCounts = topCounts(filtered, "targeted_industries", 10);
  const timeline = foundedTimeline(filtered);
  const segments = getSegments(filtered);

  return `
    <section class="analytics-grid">
      ${renderWorldMapPanel(filtered)}
      <div class="panel">
        <div class="panel-head">
          <h2>Product Mix</h2>
          <span class="panel-subtitle">${productCounts.length} categories</span>
        </div>
        ${renderBars(productCounts)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Geography</h2>
          <span class="panel-subtitle">Top countries</span>
        </div>
        ${renderBars(countryCounts)}
      </div>
      <div class="panel wide-panel">
        <div class="panel-head">
          <h2>Founding Timeline</h2>
          <span class="panel-subtitle">${timeline.total} companies with year data</span>
        </div>
        ${renderTimeline(timeline)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Industry Demand</h2>
          <span class="panel-subtitle">Top segments</span>
        </div>
        ${renderBars(industryCounts)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Signal Map</h2>
          <span class="panel-subtitle">Current slice</span>
        </div>
        <div class="segment-grid">
          ${segments
            .map(
              (segment, index) => `
                <div class="segment ${["teal", "amber", "coral"][index % 3]}">
                  <b>${segment.count.toLocaleString()}</b>
                  <span>${escapeHtml(segment.label)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderWorldMapPanel(filtered) {
  const stats = getWorldMapStats(filtered);
  const topCountry = stats.top[0];

  return `
    <div class="panel wide-panel world-map-panel">
      <div class="panel-head">
        <h2>Global Footprint</h2>
        <span class="panel-subtitle">${formatCount(stats.countryCount, "market")}</span>
      </div>
      <div class="world-map-layout">
        <div class="world-map-frame">
          ${renderWorldMap(stats, filtered.length)}
        </div>
        <aside class="world-map-side" aria-label="Country concentration">
          <div class="map-stat-grid">
            <div class="map-stat">
              <span>Top market</span>
              <b>${escapeHtml(topCountry?.label ?? "n/a")}</b>
              <em>${formatCount(topCountry?.count ?? 0, "company")}</em>
            </div>
            <div class="map-stat">
              <span>Countries</span>
              <b>${stats.countryCount.toLocaleString()}</b>
              <em>${formatCount(filtered.length, "company")}</em>
            </div>
          </div>
          ${renderMapLegend(stats.max)}
          <div class="map-rank-list">
            ${stats.top
              .slice(0, 7)
              .map(
                (item) => `
                  <button class="map-rank-button${isMapCountrySelected(item.label) ? " is-active" : ""}" type="button" data-map-country-filter="${escapeAttr(item.label)}">
                    <span>${escapeHtml(item.label)}</span>
                    <b>${item.count.toLocaleString()}</b>
                  </button>
                `,
              )
              .join("")}
          </div>
        </aside>
      </div>
    </div>
  `;
}

function renderWorldMap(stats, totalCompanies) {
  if (!window.d3 || !worldGeoJson?.features?.length) {
    return `<div class="empty-state"><b>No map data</b><span>Country view unavailable</span></div>`;
  }

  const features = worldGeoJson.features.filter(
    (feature) => worldFeatureCountryName(feature) !== "Antarctica",
  );
  const featureCollection = { type: "FeatureCollection", features };
  const projection = d3.geoNaturalEarth1().fitExtent(
    [
      [18, 12],
      [MAP_WIDTH - 18, MAP_HEIGHT - 16],
    ],
    featureCollection,
  );
  const path = d3.geoPath(projection);
  const graticule = d3.geoGraticule10();

  return `
    <svg class="world-map" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" role="img" aria-label="World map of robotics companies">
      <path class="map-sphere" d="${escapeAttr(path({ type: "Sphere" }))}"></path>
      <path class="map-graticule" d="${escapeAttr(path(graticule))}"></path>
      ${features
        .map((feature) => {
          const country = worldFeatureCountryName(feature);
          const count = stats.counts.get(country) ?? 0;
          const canFilter = getDatasetCountriesForMapCountry(country).length > 0;
          const selected = isMapCountrySelected(country);
          const classes = [
            "map-country",
            count ? "has-data" : "",
            canFilter ? "is-filterable" : "",
            selected ? "is-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = count
            ? `${country}: ${count.toLocaleString()} companies, ${percentage(count, totalCompanies)} of current slice`
            : `${country}: no companies in current slice`;

          return `
            <path
              class="${classes}"
              d="${escapeAttr(path(feature))}"
              fill="${heatColor(count, stats.max)}"
              ${canFilter ? `data-map-country="${escapeAttr(country)}" role="button" tabindex="0"` : ""}
              aria-label="${escapeAttr(label)}"
            >
              <title>${escapeHtml(label)}</title>
            </path>
          `;
        })
        .join("")}
    </svg>
  `;
}

function renderMapLegend(max) {
  const stops = [0.2, 0.45, 0.7, 1];
  return `
    <div class="map-legend" aria-label="Company concentration scale">
      <div class="legend-swatches">
        ${stops
          .map((stop) => `<span style="background:${heatColor(Math.max(1, max * stop), max)}"></span>`)
          .join("")}
      </div>
      <div class="legend-axis">
        <span>Lower</span>
        <span>Higher</span>
      </div>
    </div>
  `;
}

function renderBars(items) {
  if (!items.length) {
    return `<div class="empty-state"><b>No data</b><span>Adjust filters</span></div>`;
  }

  const max = Math.max(...items.map((item) => item.count), 1);
  return `
    <div class="bar-list">
      ${items
        .map(
          (item) => `
            <div class="bar-row">
              <div class="bar-label" title="${escapeAttr(item.label)}">${escapeHtml(item.label)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(item.count / max) * 100}%"></div></div>
              <div class="bar-value">${item.count.toLocaleString()}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTimeline(timeline) {
  if (!timeline.points.length) {
    return `<div class="empty-state"><b>No year data</b><span>Adjust filters</span></div>`;
  }

  const max = Math.max(...timeline.points.map((point) => point.count), 1);
  return `
    <div class="timeline">
      ${timeline.points
        .map((point) => {
          const height = Math.max(5, (point.count / max) * 100);
          return `<div class="timeline-bar" style="height:${height}%" data-label="${point.year}: ${point.count}"></div>`;
        })
        .join("")}
    </div>
    <div class="timeline-axis">
      <span>${timeline.points[0].year}</span>
      <span>${timeline.points[Math.floor(timeline.points.length / 2)].year}</span>
      <span>${timeline.points[timeline.points.length - 1].year}</span>
    </div>
  `;
}

function getActiveFilterCount() {
  let count = 0;
  if (state.search.trim()) count += 1;
  if (state.yearMode !== "all") count += 1;
  if (state.websiteConfidenceMin > 0) count += 1;
  for (const facet of FACETS) count += state.facets[facet.key].size;
  return count;
}

function renderActiveFilters() {
  const groups = [];
  if (state.search.trim()) {
    groups.push({
      label: "Search",
      values: [{ label: state.search.trim(), action: "search" }],
    });
  }

  if (state.yearMode !== "all") {
    groups.push({
      label: "Founded",
      values: [{ label: getYearFilterValueLabel(), action: "year" }],
    });
  }

  if (state.websiteConfidenceMin > 0) {
    groups.push({
      label: "Website confidence",
      values: [{ label: `${state.websiteConfidenceMin}+/100`, action: "websiteConfidence" }],
    });
  }

  for (const facet of FACETS) {
    const values = [...state.facets[facet.key]].map((value) => ({
      label: value,
      action: "facet",
      facet: facet.key,
      value,
    }));

    if (values.length) {
      groups.push({
        label: facet.label,
        values,
      });
    }
  }

  return `
    <section class="active-filter-strip">
      <span class="active-filter-label">Active filters</span>
      ${
        groups.length
          ? groups.map(renderActiveFilterGroup).join("")
          : `<span class="empty-filters">None</span>`
      }
      ${groups.length ? `<button class="tiny-button clear-all-filters" id="clear-all-filters" type="button">Reset filters</button>` : ""}
    </section>
  `;
}

function renderActiveFilterGroup(group) {
  return `
    <span class="active-filter-group">
      <span class="active-filter-group-label">${escapeHtml(group.label)}:</span>
      ${group.values
        .map(
          (value) => `
            <span class="active-filter-value">
              ${escapeHtml(value.label)}
              <button type="button" data-chip-action="${value.action}" data-chip-facet="${escapeAttr(value.facet ?? "")}" data-chip-value="${escapeAttr(value.value ?? "")}" aria-label="Remove ${escapeAttr(value.label)} filter">x</button>
            </span>
          `,
        )
        .join("")}
    </span>
  `;
}

function getYearFilterValueLabel() {
  if (state.yearMode === "modern") return `modern market (${MODERN_START_YEAR}+)`;
  if (state.yearMode === "startup") return `startups (${STARTUP_START_YEAR}+)`;
  if (state.yearMode === "legacy") return `legacy industrials (<${MODERN_START_YEAR})`;
  return `${state.yearFrom}-${state.yearTo}`;
}

function renderResults(rows) {
  const visibleRows = rows.slice(0, state.resultLimit);
  const remaining = Math.max(0, rows.length - visibleRows.length);

  return `
    <section class="results-panel">
      <div class="results-head">
        <div>
          <h2>Companies</h2>
          <span class="panel-subtitle">Showing ${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()} matching records</span>
        </div>
        <div class="results-tools">
          <select id="sort-select" aria-label="Sort companies">
            ${SORTS.map(
              (sort) =>
                `<option value="${sort.value}" ${state.sort === sort.value ? "selected" : ""}>${sort.label}</option>`,
            ).join("")}
          </select>
          <div class="view-toggle" aria-label="View mode">
            <button type="button" class="${state.view === "cards" ? "is-active" : ""}" data-view="cards" aria-label="Card view">${icon("grid")}</button>
            <button type="button" class="${state.view === "table" ? "is-active" : ""}" data-view="table" aria-label="Table view">${icon("table")}</button>
          </div>
        </div>
      </div>
      ${
        rows.length
          ? state.view === "cards"
            ? renderCards(visibleRows)
            : renderTable(visibleRows)
          : `<div class="empty-state"><b>No companies match</b><span>Relax a filter or reset the view</span></div>`
      }
      ${remaining ? renderLoadMore(remaining) : ""}
    </section>
  `;
}

function renderLoadMore(remaining) {
  const nextCount = Math.min(RESULT_PAGE_SIZE, remaining);
  return `
    <div class="results-footer">
      <button class="primary-button" id="load-more-results" type="button">
        ${icon("grid")}Load ${nextCount.toLocaleString()} more
      </button>
      <span class="panel-subtitle">${remaining.toLocaleString()} still hidden for faster browsing</span>
    </div>
  `;
}

function renderCards(rows) {
  return `
    <div class="card-grid">
      ${rows.map(renderCard).join("")}
    </div>
  `;
}

function renderCard(company) {
  const chips = [
    {
      value: `Website ${company.website_confidence_score}/100`,
      tone: confidenceTone(company.website_confidence_score),
    },
    ...company.product_type.slice(0, 2).map((value) => ({ value, tone: "teal" })),
    ...company.targeted_industries.slice(0, 2).map((value) => ({ value, tone: "amber" })),
    ...company.country.slice(0, 1).map((value) => ({ value, tone: "coral" })),
  ].slice(0, 5);

  return `
    <article class="company-card" role="button" tabindex="0" data-open-company="${company.company_id}">
      <div class="card-cover">
        ${company.website_preview_url ? `<img src="${escapeAttr(company.website_preview_url)}" alt="" loading="lazy" onerror="this.remove()" />` : ""}
      </div>
      <div class="card-body">
        <div class="company-title-row">
          <h3>${escapeHtml(company.company_name)}</h3>
          <span class="company-year">${company.founded ?? "n/a"}</span>
        </div>
        <p class="description">${escapeHtml(company.short_description ?? "No description.")}</p>
        <div class="chip-row">
          ${chips.map((chip) => `<span class="data-chip ${chip.tone}">${escapeHtml(chip.value)}</span>`).join("")}
        </div>
        <div class="card-foot">
          <span>${escapeHtml(company.city || company.country[0] || "Location n/a")}</span>
          ${renderMiniWebsiteLink(company)}
        </div>
      </div>
    </article>
  `;
}

function renderTable(rows) {
  return `
    <div class="table-wrap">
      <table class="company-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Description</th>
            <th>Product</th>
            <th>Industry</th>
            <th>Country</th>
            <th>Founded</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (company) => `
                <tr data-open-company="${company.company_id}">
                  <td class="table-company">${escapeHtml(company.company_name)}</td>
                  <td class="table-description">${escapeHtml(company.short_description ?? "")}</td>
                  <td>${chipList(company.product_type.slice(0, 3), "teal")}</td>
                  <td>${chipList(company.targeted_industries.slice(0, 3), "amber")}</td>
                  <td>${escapeHtml(company.country.join(", ") || "n/a")}</td>
                  <td>${company.founded ?? "n/a"}</td>
                  <td>${renderMiniWebsiteLink(company)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDrawer(company) {
  const open = company ? " is-open" : "";
  if (!company) {
    return `<div class="drawer-overlay${open}" id="drawer-overlay"></div>`;
  }

  const isCompared = state.compareIds.has(company.company_id);
  return `
    <div class="drawer-overlay${open}" id="drawer-overlay">
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="${escapeAttr(company.company_name)}">
        <div class="drawer-head">
          <div class="drawer-title">
            <h2>${escapeHtml(company.company_name)}</h2>
            <div class="drawer-sub">
              ${company.country.map((value) => `<span class="data-chip coral">${escapeHtml(value)}</span>`).join("")}
              ${company.founded ? `<span class="data-chip">${company.founded}</span>` : ""}
            </div>
          </div>
          <button class="icon-button" id="close-drawer" type="button" aria-label="Close">${icon("x")}</button>
        </div>
        <div class="drawer-content">
          <div class="drawer-cover">
            ${company.website_preview_url ? `<img src="${escapeAttr(company.website_preview_url)}" alt="" onerror="this.remove()" />` : ""}
          </div>
          <p class="drawer-copy">${escapeHtml(company.short_description ?? "No description.")}</p>
          <div class="link-grid">
            ${renderDrawerWebsiteLink(company)}
            ${
              company.linkedin_url
                ? `<a href="${escapeAttr(company.linkedin_url)}" target="_blank" rel="noreferrer">${icon("external")}LinkedIn</a>`
                : `<a aria-disabled="true">${icon("external")}LinkedIn</a>`
            }
            <a href="${escapeAttr(company.source_url)}" target="_blank" rel="noreferrer" title="${escapeAttr(company.source_name ?? "Source")}">${icon("database")}Source</a>
          </div>
          <button class="primary-button" id="toggle-compare" data-company-id="${company.company_id}" type="button">
            ${icon("compare")}${isCompared ? "Remove from compare" : "Add to compare"}
          </button>
          <div class="detail-grid">
            ${detail("Product type", company.product_type)}
            ${detail("Industries", company.targeted_industries)}
            ${detail("Robot type", company.robot_or_automated_system_type)}
            ${detail("Software type", company.software_type)}
            ${detail("Hardware type", company.hardware_component_type)}
            ${detail("Website status", formatWebsiteStatus(company.website_status))}
            ${detail("Website final URL", company.website_final_url)}
            ${detail("Website confidence", `${company.website_confidence_score}/100`)}
            ${detail("Source", company.source_name)}
            ${detail("Tags", company.tags)}
            ${detail("City", company.city)}
            ${detail("State", company.state)}
            ${detail("Affiliations", company.affiliations)}
          </div>
        </div>
      </aside>
    </div>
  `;
}

function hasCompanyWebsite(company) {
  return (
    typeof company.website_url === "string" &&
    /^https?:\/\//i.test(company.website_url.trim()) &&
    !BAD_WEBSITE_STATUSES.has(company.website_status)
  );
}

function renderMiniWebsiteLink(company) {
  if (!hasCompanyWebsite(company)) {
    return `<span class="mini-link is-disabled" aria-disabled="true">Site n/a</span>`;
  }
  return `<a class="mini-link" href="${escapeAttr(company.website_url)}" target="_blank" rel="noreferrer" data-stop>Site ${icon("external")}</a>`;
}

function renderDrawerWebsiteLink(company) {
  if (!hasCompanyWebsite(company)) {
    return `<a aria-disabled="true">${icon("external")}Website n/a</a>`;
  }
  return `<a href="${escapeAttr(company.website_url)}" target="_blank" rel="noreferrer">${icon("external")}Website</a>`;
}

function renderCompareTray(rows) {
  return `
    <div class="compare-tray ${rows.length ? "is-visible" : ""}">
      <div class="compare-list">
        ${rows
          .map(
            (company) => `
              <span class="compare-token">
                <span>${escapeHtml(company.company_name)}</span>
                <button type="button" data-remove-compare="${company.company_id}" aria-label="Remove">x</button>
              </span>
            `,
          )
          .join("")}
      </div>
      <div class="top-actions">
        <button class="ghost-button" id="clear-compare" type="button">Clear</button>
        <button class="primary-button" id="open-compare" type="button">${icon("compare")}Compare</button>
      </div>
    </div>
  `;
}

function renderCompareModal(rows) {
  const open = state.compareOpen ? " is-open" : "";
  return `
    <div class="modal-overlay${open}" id="compare-overlay">
      <section class="modal" role="dialog" aria-modal="true" aria-label="Company comparison">
        <div class="modal-head">
          <div class="modal-title">
            <h2>Compare Companies</h2>
            <span class="panel-subtitle">${rows.length} selected</span>
          </div>
          <button class="icon-button" id="close-compare" type="button" aria-label="Close">${icon("x")}</button>
        </div>
        <div class="modal-content">
          ${
            rows.length
              ? renderCompareTable(rows)
              : `<div class="empty-state"><b>No companies selected</b><span>Select companies from cards or detail views</span></div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderCompareTable(rows) {
  const fields = [
    ["Description", (company) => company.short_description],
    ["Website", (company) => company.website_url],
    ["Website status", (company) => formatWebsiteStatus(company.website_status)],
    ["Founded", (company) => company.founded ?? "n/a"],
    ["Country", (company) => company.country.join(", ")],
    ["Product type", (company) => company.product_type.join(", ")],
    ["Industries", (company) => company.targeted_industries.join(", ")],
    ["Robot type", (company) => company.robot_or_automated_system_type.join(", ")],
    ["Software type", (company) => company.software_type.join(", ")],
    ["Hardware type", (company) => company.hardware_component_type.join(", ")],
  ];

  return `
    <table class="compare-table">
      <thead>
        <tr>
          <th>Field</th>
          ${rows.map((company) => `<th>${escapeHtml(company.company_name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${fields
          .map(
            ([label, getter]) => `
              <tr>
                <th>${escapeHtml(label)}</th>
                ${rows.map((company) => `<td>${escapeHtml(String(getter(company) || "n/a"))}</td>`).join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function bindEvents() {
  document.querySelector("#global-search")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    resetResultLimit();
    scheduleTextInputRender("#global-search", event.target);
  });

  document.querySelector("#reset-filters")?.addEventListener("click", () => {
    resetFilters();
    render();
  });

  document.querySelector("#clear-all-filters")?.addEventListener("click", () => {
    resetFilters();
    render();
  });

  document.querySelector("#open-filters")?.addEventListener("click", () => {
    state.filtersOpen = true;
    render();
  });

  document.querySelector("#close-filters")?.addEventListener("click", () => {
    state.filtersOpen = false;
    render();
  });

  document.querySelector("#collapse-filter-rail")?.addEventListener("click", () => {
    state.filtersCollapsed = true;
    render();
  });

  document.querySelector("#expand-filter-rail")?.addEventListener("click", () => {
    state.filtersCollapsed = false;
    render();
  });

  document.querySelector("#year-from")?.addEventListener("change", (event) => {
    state.yearFrom = clampYear(event.target.value, yearBounds.min);
    if (state.yearFrom > state.yearTo) state.yearTo = state.yearFrom;
    state.yearMode = getYearModeForRange(state.yearFrom, state.yearTo);
    resetResultLimit();
    render();
  });

  document.querySelector("#year-to")?.addEventListener("change", (event) => {
    state.yearTo = clampYear(event.target.value, yearBounds.max);
    if (state.yearTo < state.yearFrom) state.yearFrom = state.yearTo;
    state.yearMode = getYearModeForRange(state.yearFrom, state.yearTo);
    resetResultLimit();
    render();
  });

  document.querySelectorAll("[data-year-mode]").forEach((button) => {
    button.addEventListener("change", () => {
      applyYearMode(button.dataset.yearMode);
      resetResultLimit();
      render();
    });
  });

  const setWebsiteConfidence = (value) => {
    state.websiteConfidenceMin = clampConfidence(value);
    resetResultLimit();
  };

  const updateWebsiteConfidence = (value) => {
    setWebsiteConfidence(value);
    render();
  };

  document.querySelector("#website-confidence-range")?.addEventListener("input", (event) => {
    updateWebsiteConfidence(event.target.value);
  });

  document.querySelector("#website-confidence-min")?.addEventListener("input", (event) => {
    setWebsiteConfidence(event.target.value);
    scheduleTextInputRender("#website-confidence-min", event.target);
  });

  document.querySelector("#clear-website-confidence")?.addEventListener("click", () => {
    updateWebsiteConfidence(0);
  });

  document.querySelectorAll("[data-facet-search]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.facetSearch[input.dataset.facetSearch] = event.target.value;
      scheduleTextInputRender(
        `[data-facet-search="${cssEscape(input.dataset.facetSearch)}"]`,
        event.target,
      );
    });
  });

  document.querySelectorAll("[data-facet]").forEach((input) => {
    input.addEventListener("change", () => {
      const set = state.facets[input.dataset.facet];
      if (input.checked) set.add(input.value);
      else set.delete(input.value);
      resetResultLimit();
      render();
    });
  });

  document.querySelectorAll("[data-clear-facet]").forEach((button) => {
    button.addEventListener("click", () => {
      state.facets[button.dataset.clearFacet].clear();
      resetResultLimit();
      render();
    });
  });

  document.querySelectorAll("[data-chip-action]").forEach((button) => {
    button.addEventListener("click", () => {
      clearChip(button.dataset);
      resetResultLimit();
      render();
    });
  });

  document.querySelectorAll("[data-map-country], [data-map-country-filter]").forEach((element) => {
    const country = element.dataset.mapCountry ?? element.dataset.mapCountryFilter;
    const activate = () => {
      toggleMapCountryFilter(country);
      resetResultLimit();
      render();
    };

    element.addEventListener("click", activate);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });

  document.querySelector("#sort-select")?.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      resetResultLimit();
      render();
    });
  });

  document.querySelector("#load-more-results")?.addEventListener("click", () => {
    state.resultLimit += RESULT_PAGE_SIZE;
    render();
  });

  document.querySelectorAll("[data-open-company]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedId = element.dataset.openCompany;
      render();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        state.selectedId = element.dataset.openCompany;
        render();
      }
    });
  });

  document.querySelectorAll("[data-stop]").forEach((element) => {
    element.addEventListener("click", (event) => event.stopPropagation());
  });

  document.querySelector("#close-drawer")?.addEventListener("click", () => {
    state.selectedId = null;
    render();
  });

  document.querySelector("#drawer-overlay")?.addEventListener("click", (event) => {
    if (event.target.id === "drawer-overlay") {
      state.selectedId = null;
      render();
    }
  });

  document.querySelector("#toggle-compare")?.addEventListener("click", (event) => {
    toggleCompare(event.currentTarget.dataset.companyId);
    render();
  });

  document.querySelectorAll("[data-remove-compare]").forEach((button) => {
    button.addEventListener("click", () => {
      state.compareIds.delete(button.dataset.removeCompare);
      if (!state.compareIds.size) state.compareOpen = false;
      render();
    });
  });

  document.querySelector("#clear-compare")?.addEventListener("click", () => {
    state.compareIds.clear();
    state.compareOpen = false;
    render();
  });

  document.querySelector("#open-compare")?.addEventListener("click", () => {
    state.compareOpen = true;
    render();
  });

  document.querySelector("#close-compare")?.addEventListener("click", () => {
    state.compareOpen = false;
    render();
  });

  document.querySelector("#compare-overlay")?.addEventListener("click", (event) => {
    if (event.target.id === "compare-overlay") {
      state.compareOpen = false;
      render();
    }
  });

  document.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => exportFiltered(button.dataset.export));
  });

  document.body.classList.toggle("no-scroll", state.filtersOpen || Boolean(state.selectedId) || state.compareOpen);
}

function resetResultLimit() {
  state.resultLimit = RESULT_PAGE_SIZE;
}

function scheduleTextInputRender(selector, input) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  clearTimeout(textInputRenderTimer);
  textInputRenderTimer = setTimeout(() => {
    render({ focus: { selector, start, end } });
  }, TEXT_INPUT_RENDER_DELAY);
}

function restoreFocus(focus) {
  if (!focus) return;

  const input = document.querySelector(focus.selector);
  if (!input) return;

  input.focus({ preventScroll: true });
  if (typeof input.setSelectionRange === "function") {
    const valueLength = input.value.length;
    const start = Math.min(focus.start, valueLength);
    const end = Math.min(focus.end, valueLength);
    input.setSelectionRange(start, end);
  }
}

function getFilteredCompanies(ignoreFacet = null, options = {}) {
  const tokens = state.search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const yearIsFiltered =
    state.yearMode !== "all" ||
    state.yearFrom !== yearBounds.min ||
    state.yearTo !== yearBounds.max;

  return companies.filter((company) => {
    if (tokens.length && !tokens.every((token) => company.search_blob.includes(token))) {
      return false;
    }

    if (yearIsFiltered) {
      if (typeof company.founded !== "number") return false;
      if (company.founded < state.yearFrom || company.founded > state.yearTo) {
        return false;
      }
    }

    if (
      state.websiteConfidenceMin > 0 &&
      company.website_confidence_score < state.websiteConfidenceMin
    ) {
      return false;
    }

    for (const facet of FACETS) {
      if (facet.key === ignoreFacet) continue;
      const selected = state.facets[facet.key];
      if (selected.size && !company[facet.key].some((value) => selected.has(value))) {
        return false;
      }
    }

    return true;
  });
}

function sortCompanies(rows) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (state.sort === "founded_desc") {
      return (b.founded ?? -Infinity) - (a.founded ?? -Infinity) || byName(a, b);
    }
    if (state.sort === "founded_asc") {
      return (a.founded ?? Infinity) - (b.founded ?? Infinity) || byName(a, b);
    }
    if (state.sort === "country") {
      return (a.country[0] ?? "").localeCompare(b.country[0] ?? "") || byName(a, b);
    }
    return byName(a, b);
  });
  return sorted;
}

function byName(a, b) {
  return a.company_name.localeCompare(b.company_name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function facetCounts(key) {
  const base = getFilteredCompanies(key);
  const counts = new Map();
  for (const company of base) {
    for (const value of company[key] ?? []) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  for (const value of state.facets[key]) {
    if (!counts.has(value)) counts.set(value, 0);
  }

  return counts;
}

function sortFacetOptions(key, a, b) {
  return b[1] - a[1] || a[0].localeCompare(b[0]);
}

function uniqueValues(rows, key) {
  const values = new Set();
  for (const row of rows) {
    for (const value of row[key] ?? []) values.add(value);
  }
  return values;
}

function topCounts(rows, key, limit) {
  const counts = new Map();
  for (const row of rows) {
    for (const value of row[key] ?? []) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function getWorldMapStats(rows) {
  const counts = new Map();
  const names = getWorldCountryNames();

  for (const company of rows) {
    const countries = new Set(
      company.country
        .map(normalizeMapCountryName)
        .filter((country) => country && names.has(country)),
    );

    for (const country of countries) {
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }
  }

  const top = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    counts,
    top,
    countryCount: counts.size,
    max: Math.max(...counts.values(), 1),
  };
}

function getWorldCountryNames() {
  if (!worldCountryNames) {
    worldCountryNames = new Set(
      (worldGeoJson?.features ?? []).map(worldFeatureCountryName).filter(Boolean),
    );
  }
  return worldCountryNames;
}

function worldFeatureCountryName(feature) {
  return normalizeMapCountryName(
    feature?.properties?.ADMIN ||
      feature?.properties?.NAME_LONG ||
      feature?.properties?.NAME ||
      "",
  );
}

function normalizeMapCountryName(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "uni'") return null;
  return MAP_COUNTRY_ALIASES.get(trimmed) ?? trimmed;
}

function getMapCountryValues() {
  if (mapCountryValues) return mapCountryValues;

  mapCountryValues = new Map();
  for (const company of companies) {
    for (const value of company.country) {
      const country = normalizeMapCountryName(value);
      if (!country) continue;
      if (!mapCountryValues.has(country)) mapCountryValues.set(country, new Set());
      mapCountryValues.get(country).add(value);
    }
  }

  return mapCountryValues;
}

function getDatasetCountriesForMapCountry(country) {
  return [...(getMapCountryValues().get(country) ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function isMapCountrySelected(country) {
  return [...state.facets.country].some((value) => normalizeMapCountryName(value) === country);
}

function toggleMapCountryFilter(country) {
  const values = getDatasetCountriesForMapCountry(country);
  if (!values.length) return;

  const selected = values.every((value) => state.facets.country.has(value));
  for (const value of values) {
    if (selected) state.facets.country.delete(value);
    else state.facets.country.add(value);
  }
}

function heatColor(count, max) {
  if (!count) return "#ede6da";
  const intensity = Math.max(0.16, Math.sqrt(count / Math.max(max, 1)));
  return mixHex("#d9eeee", "#006d77", intensity);
}

function mixHex(from, to, amount) {
  const fromRgb = hexToRgb(from);
  const toRgb = hexToRgb(to);
  const rgb = fromRgb.map((channel, index) =>
    Math.round(channel + (toRgb[index] - channel) * amount),
  );
  return `rgb(${rgb.join(", ")})`;
}

function hexToRgb(value) {
  const normalized = value.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(normalized.slice(start, start + 2), 16));
}

function topValue(rows, key) {
  return topCounts(rows, key, 1)[0]?.label ?? null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function foundedTimeline(rows) {
  const modernStart = 1990;
  const counts = new Map();
  let beforeModern = 0;
  for (const company of rows) {
    if (typeof company.founded !== "number") continue;
    if (company.founded < modernStart) {
      beforeModern += 1;
      continue;
    }
    counts.set(company.founded, (counts.get(company.founded) ?? 0) + 1);
  }

  const points = beforeModern
    ? [{ year: `<${modernStart}`, count: beforeModern }]
    : [];
  for (let year = modernStart; year <= yearBounds.max; year += 1) {
    points.push({ year, count: counts.get(year) ?? 0 });
  }

  return {
    points,
    total: beforeModern + [...counts.values()].reduce((sum, count) => sum + count, 0),
  };
}

function getSegments(rows) {
  return [
    {
      label: "Humanoid and bipedal",
      count: rows.filter((company) => hasAny(company, [
        "Humanoid robot",
        "Humanoid robot - Mobile platform",
        "Bipedal robot",
        "Biped",
        "Humanoid",
      ])).length,
    },
    {
      label: "Drones and aerial systems",
      count: rows.filter((company) =>
        company.search_blob.includes("drone") || company.search_blob.includes("aerial"),
      ).length,
    },
    {
      label: "Warehouse and material handling",
      count: rows.filter((company) =>
        intersects(company.targeted_industries, [
          "Warehousing and storage",
          "Material handling",
          "Inventory management",
        ]),
      ).length,
    },
    {
      label: "Software and SaaS",
      count: rows.filter((company) =>
        intersects(company.product_type, [
          "Software",
          "Software as a service",
          "On-demand software development",
        ]),
      ).length,
    },
    {
      label: "Defense",
      count: rows.filter((company) => company.targeted_industries.includes("Defense")).length,
    },
    {
      label: "Healthcare",
      count: rows.filter((company) =>
        company.targeted_industries.includes("Healthcare"),
      ).length,
    },
  ];
}

function hasAny(company, values) {
  return [
    ...company.robot_or_automated_system_type,
    ...company.tags,
    ...company.product_type,
  ].some((value) => values.includes(value));
}

function intersects(values, selected) {
  return values.some((value) => selected.includes(value));
}

function percentage(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatCount(value, singular) {
  const plurals = {
    company: "companies",
  };
  const plural = plurals[singular] ?? `${singular}s`;
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function chipList(values, tone = "") {
  if (!values.length) return "n/a";
  return `<div class="chip-row">${values
    .map((value) => `<span class="data-chip ${tone}">${escapeHtml(value)}</span>`)
    .join("")}</div>`;
}

function detail(label, value) {
  const text = Array.isArray(value) ? value.join(", ") : value;
  return `
    <div class="detail-item">
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(text || "n/a")}</span>
    </div>
  `;
}

function formatWebsiteStatus(value) {
  return value ? String(value).replace(/_/g, " ") : null;
}

function getWebsiteConfidenceScore(company) {
  if (BAD_WEBSITE_STATUSES.has(company.website_status)) return 0;

  const websiteConfidence = clampConfidence(company.website_confidence);
  if (hasCompanyWebsite(company) && websiteConfidence > 0) return websiteConfidence;

  return 0;
}

function confidenceTone(score) {
  if (score >= 95) return "green";
  if (score >= 80) return "teal";
  if (score >= 50) return "blue";
  if (score > 0) return "amber";
  return "coral";
}

function clampConfidence(value) {
  const confidence = Number.parseInt(value, 10);
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, confidence));
}

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function applyYearMode(mode) {
  state.yearMode = mode;

  if (mode === "all") {
    state.yearFrom = yearBounds.min;
    state.yearTo = yearBounds.max;
    return;
  }

  if (mode === "startup") {
    state.yearFrom = Math.max(STARTUP_START_YEAR, yearBounds.min);
    state.yearTo = yearBounds.max;
    return;
  }

  if (mode === "legacy") {
    state.yearFrom = yearBounds.min;
    state.yearTo = Math.min(MODERN_START_YEAR - 1, yearBounds.max);
    return;
  }

  state.yearMode = "modern";
  state.yearFrom = Math.max(MODERN_START_YEAR, yearBounds.min);
  state.yearTo = yearBounds.max;
}

function getYearModeForRange(from, to) {
  if (from === yearBounds.min && to === yearBounds.max) return "all";
  if (from === Math.max(MODERN_START_YEAR, yearBounds.min) && to === yearBounds.max) {
    return "modern";
  }
  if (from === Math.max(STARTUP_START_YEAR, yearBounds.min) && to === yearBounds.max) {
    return "startup";
  }
  if (from === yearBounds.min && to === Math.min(MODERN_START_YEAR - 1, yearBounds.max)) {
    return "legacy";
  }
  return "custom";
}

function yearModeCount(mode) {
  return companies.filter((company) => {
    if (mode === "all") return true;
    if (typeof company.founded !== "number") return false;
    if (mode === "startup") return company.founded >= STARTUP_START_YEAR;
    if (mode === "legacy") return company.founded < MODERN_START_YEAR;
    return company.founded >= MODERN_START_YEAR;
  }).length;
}

function resetFilters() {
  state.search = "";
  state.facets = Object.fromEntries(FACETS.map((facet) => [facet.key, new Set()]));
  state.facetSearch = Object.fromEntries(FACETS.map((facet) => [facet.key, ""]));
  state.websiteConfidenceMin = 0;
  resetResultLimit();
  applyYearMode("modern");
}

function clearChip(dataset) {
  if (dataset.chipAction === "search") state.search = "";
  if (dataset.chipAction === "year") {
    applyYearMode("all");
  }
  if (dataset.chipAction === "websiteConfidence") {
    state.websiteConfidenceMin = 0;
  }
  if (dataset.chipAction === "facet") {
    state.facets[dataset.chipFacet]?.delete(dataset.chipValue);
  }
}

function toggleCompare(id) {
  if (state.compareIds.has(id)) {
    state.compareIds.delete(id);
    if (!state.compareIds.size) state.compareOpen = false;
    return;
  }

  if (state.compareIds.size >= 5) {
    showToast("Compare mode supports up to 5 companies.");
    return;
  }

  state.compareIds.add(id);
}

function exportFiltered(format) {
  const filtered = sortCompanies(getFilteredCompanies());
  if (format === "csv") {
    const csv = toCsv(filtered);
    download("robotics_companies_filtered.csv", csv, "text/csv");
  } else {
    const exportRows = filtered.map(({ search_blob, status, website_preview_url, ...company }) => company);
    download(
      "robotics_companies_filtered.json",
      `${JSON.stringify(exportRows, null, 2)}\n`,
      "application/json",
    );
  }
  showToast(`Exported ${filtered.length.toLocaleString()} companies.`);
}

function toCsv(rows) {
  const columns = [
    "company_name",
    "short_description",
    "product_type",
    "targeted_industries",
    "country",
    "state",
    "city",
    "founded",
    "website_url",
    "website_confidence_score",
    "website_status",
    "website_confidence",
    "linkedin_url",
    "source_name",
    "source_url",
  ];
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => {
        const value = Array.isArray(row[column])
          ? row[column].join("; ")
          : row[column] ?? "";
        return csvEscape(value);
      })
      .join(","),
  );
  return `${header}\n${body.join("\n")}\n`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function clampYear(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(yearBounds.max, Math.max(yearBounds.min, parsed));
}

function csvEscape(value) {
  const string = String(value);
  if (/[",\n]/.test(string)) return `"${string.replaceAll('"', '""')}"`;
  return string;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return value.replaceAll('"', '\\"');
}

function icon(name) {
  const icons = {
    network:
      '<path d="M12 3v5"/><path d="M6 12h12"/><path d="M6 12a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z"/><path d="M21 12a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z"/><path d="M15 21a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z"/><path d="m12 15v3"/><path d="m5.5 10.5 4-2"/><path d="m18.5 10.5-4-2"/>',
    search:
      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download:
      '<path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    refresh:
      '<path d="M20 11a8 8 0 0 0-14.7-4.4L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4.4L21 15"/><path d="M21 20v-5h-5"/>',
    filter:
      '<path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    grid:
      '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    table:
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M9 5v14"/>',
    external:
      '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    database:
      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    compare:
      '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 4v16"/><path d="m9 8 3-3 3 3"/><path d="m15 16-3 3-3-3"/>',
    sidebarCollapse:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m16 10-2 2 2 2"/>',
    sidebarExpand:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m14 10 2 2-2 2"/>',
  };

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${icons[name] ?? icons.search}
    </svg>
  `;
}
