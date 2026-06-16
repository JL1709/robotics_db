import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeCompanies,
  expandCanonicalCompanies,
  normalizeUrl,
} from "./company_normalization.mjs";

const DEFAULT_DB_PATH = path.join("data", "robotics_companies.json");
const DEFAULT_SOURCE_ROWS_PATH = path.join("data", "public_source_records.json");
const CACHE_DIR = path.join("/private/tmp", "robotics_db_source_cache");

const SOURCES = {
  massrobotics: {
    url: "https://www.massrobotics.org/startups/massrobotics-resident-startups/",
    cacheFile: "massrobotics_residents.html",
    legacyCacheFile: "/private/tmp/massrobotics_residents.html",
  },
  osra: {
    url: "https://osralliance.org/",
    cacheFile: "osra_home.html",
    legacyCacheFile: "/private/tmp/osra_home.html",
  },
  rosIndustrial: {
    url: "https://rosindustrial.org/current-members",
    cacheFile: "rosindustrial_current_members.html",
    legacyCacheFile: "/private/tmp/rosindustrial_current_members.html",
  },
  a3: {
    url: "https://www.automate.org/companies",
    cacheFile: "a3_companies.html",
    legacyCacheFile: "/private/tmp/a3_companies.html",
  },
  jaraRegular: {
    url: "https://www.jara.jp/e/list/regular.html",
    cacheFile: "jara_regular_members.html",
    legacyCacheFile: "/private/tmp/jara_regular.html",
  },
  jaraSupporting: {
    url: "https://www.jara.jp/e/list/supporting.html",
    cacheFile: "jara_supporting_members.html",
    legacyCacheFile: "/private/tmp/jara_supporting.html",
  },
  tairoaMembers: {
    url: "https://www.tairoa.org.tw/introduce/maMemberNameList.aspx?CategoryId=C",
    cacheFile: "tairoa_group_members.html",
    legacyCacheFile: "/private/tmp/tairoa_members.html",
  },
  wikipediaList: {
    url: "https://en.wikipedia.org/wiki/List_of_robotics_companies",
    cacheFile: "wikipedia_robotics_companies.html",
    legacyCacheFile: "/private/tmp/wiki_robotics_companies.html",
  },
  wikipediaCategory: {
    url: "https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Robotics_companies&cmlimit=500&format=json",
    cacheFile: "wikipedia_robotics_category.json",
  },
  wikidataRobotics: {
    url: "https://query.wikidata.org/sparql",
    cacheFile: "wikidata_robotics_industry.json",
  },
  ukriRoboticsOrganisations: {
    url: "https://gtr.ukri.org/gtr/api/organisations?q=robotics&s=100",
    cacheFile: "ukri_robotics_organisations.json",
    optional: true,
  },
  openAlexRoboticsCompanies: {
    url: "https://api.openalex.org/institutions?search=robotics&filter=type:company&per-page=100",
    cacheFile: "openalex_robotics_companies.json",
    optional: true,
  },
  eicFundRobotSearch: {
    url: "https://eic.ec.europa.eu/eic-fund/eic-fund-invested-companies_en?search=robot",
    cacheFile: "eic_fund_robot_search_pages.json",
    optional: true,
  },
  cordisRoboticsProjects: {
    url: "https://cordis.europa.eu/search",
    cacheFile: "cordis_robotics_projects.json",
    optional: true,
  },
  wikipediaChinaRoboticsSearch: {
    url: "https://zh.wikipedia.org/w/api.php",
    cacheFile: "wikipedia_china_robotics_search.json",
    optional: true,
  },
  wrcPastHighlightExhibits: {
    url: "https://www.worldrobotconference.com/208/",
    cacheFile: "world_robot_conference_past_highlight_exhibits.json",
    optional: true,
  },
  cematAsiaRoboticsExhibitors: {
    url: "https://service.cemat-asia.com/VSCENTER2/api/match/exhibitor",
    cacheFile: "cemat_asia_robotics_exhibitors.json",
    optional: true,
  },
  odenseRoboticsMembers: {
    url: "https://www.odenserobotics.dk/wp-json/or/v1/members?page=1&lang=en&searchString=",
    cacheFile: "odense_robotics_members.json",
    optional: true,
  },
  startupSgRobotics: {
    url: "https://www.startupsg.gov.sg/api/v0/search/profiles/startup?type=listing&q=robotics&from=0",
    cacheFile: "startupsg_robotics_startups.json",
    optional: true,
  },
  ycRoboticsStartups: {
    url: "https://45BWZJ1SGC-dsn.algolia.net/1/indexes/YCCompany_production/query",
    cacheFile: "yc_robotics_startups.json",
    optional: true,
  },
  techstarsRoboticsStartups: {
    url: "https://8gbms7c94riane0lp-1.a1.typesense.net/collections/companies/documents/search",
    cacheFile: "techstars_robotics_startups.json",
    optional: true,
  },
  haxRoboticsStartups: {
    url: "https://hax.co/startups/?_categories=robotics",
    cacheFile: "hax_robotics_startups.json",
    optional: true,
  },
  jStartupRobotics: {
    url: "https://www.j-startup.go.jp/en/startups/",
    cacheFile: "jstartup_robotics_startups.json",
    optional: true,
  },
  sosvRoboticsCompanies: {
    url: "https://sosv.com/wp-json/wp/v2/company",
    cacheFile: "sosv_robotics_companies.json",
    optional: true,
  },
  plugAndPlayRoboticsStartups: {
    url: "https://public.dxp.playbook.vc/.rest/delivery/startups/v1",
    cacheFile: "plug_and_play_robotics_startups.json",
    optional: true,
  },
  alchemistRoboticsStartups: {
    url: "https://vault.alchemistaccelerator.com/api/v1/alchemist_companies",
    cacheFile: "alchemist_robotics_startups.json",
    optional: true,
  },
  skydeckRoboticsStartups: {
    url: "https://CX8Z9EYL0S-dsn.algolia.net/1/indexes/sd_posts_companies/query",
    cacheFile: "skydeck_robotics_startups.json",
    optional: true,
  },
  entrepreneurFirstRoboticsPortfolio: {
    url: "https://www.joinef.com/portfolio/",
    cacheFile: "entrepreneur_first_portfolio.html",
    optional: true,
  },
  baraRobots: {
    url: "https://www.automate-uk.com/product-finder/robotics-vision/robots/robots/",
    cacheFile: "bara_robots.html",
    optional: true,
  },
  baraRobotIntegrators: {
    url: "https://www.automate-uk.com/product-finder/robotics-vision/robot-integrators/robot-integrators/",
    cacheFile: "bara_robot_integrators.html",
    optional: true,
  },
  pittsburghRoboticsMembers: {
    url: "https://www.robopgh.org/about/members",
    cacheFile: "pittsburgh_robotics_members.html",
    optional: true,
  },
  siliconValleyRoboticsMembers: {
    url: "https://api.membershipworks.com/v2/directory?dek=56010ae54f952e08608f91a8&_rf=Members",
    cacheFile: "silicon_valley_robotics_members.json",
    optional: true,
  },
};

const WIKIDATA_ROBOTICS_QUERY = `SELECT DISTINCT ?item ?itemLabel ?countryLabel ?website ?inception WHERE {
  ?item wdt:P31/wdt:P279* wd:Q4830453.
  ?item wdt:P452 wd:Q170978.
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 500`;

const MEDIAWIKI_CHINA_ROBOTICS_QUERIES = [
  { wiki: "zh", query: "机器人 公司" },
  { wiki: "zh", query: "機器人 公司" },
  { wiki: "en", query: "China robotics company" },
  { wiki: "en", query: "Chinese robotics company" },
];

const WRC_HIGHLIGHT_YEARS = ["2025", "2024", "2023", "2022", "2021", "2019", "2018", "2017", "2016", "2015"];
const CEMAT_ASIA_SHOWS = [
  { year: "2025", code: "cemat25", id: "2f726e31-6f0c-4c6c-8290-8cd3bb19178f", total: 965 },
  { year: "2024", code: "cemat24", id: "0ac57252-0c55-4915-b606-faac02f722a0", total: 913 },
  { year: "2023", code: "CEMAT22", id: "edc387bc-7925-4ba5-a17a-1a8ba5a310ef", total: 804 },
  { year: "2021", code: "cemat21", id: "6c3e777d-1746-42d5-a7bb-b647d1fe073a", total: 700 },
  { year: "2020", code: "cemat20", id: "4fa91f39-b4f5-40a0-8479-3771277a4686", total: 699 },
];
const CEMAT_ASIA_ROBOTICS_QUERIES = [
  { name: "机器人", label: "keyword: 机器人" },
  { name: "robot", label: "keyword: robot" },
  { name: "robotics", label: "keyword: robotics" },
  { name: "AGV", label: "keyword: AGV" },
  { name: "AMR", label: "keyword: AMR" },
  { name: "自动化", label: "keyword: 自动化" },
  { name: "智能物流", label: "keyword: 智能物流" },
  { type: "CE406", label: "category: CE406 logistics systems" },
];
const CORDIS_ROBOTICS_QUERIES = [
  "contenttype='project' AND robotics",
  "contenttype='project' AND robot",
  "contenttype='project' AND drone",
  "contenttype='project' AND \"industrial robotics\"",
  "contenttype='project' AND \"autonomous robots\"",
  "contenttype='project' AND \"surgical robot\"",
  "contenttype='project' AND \"agricultural robot\"",
];
const CORDIS_MAX_PAGES_PER_QUERY = 8;

const YC_ALGOLIA_APP_ID = "45BWZJ1SGC";
const YC_ALGOLIA_SEARCH_KEY =
  "NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE";
const YC_ROBOTICS_QUERIES = [
  "robotics",
  "robot",
  "drone",
  "autonomous robot",
  "autonomous systems",
  "warehouse automation",
  "industrial automation",
  "manufacturing automation",
  "surgical robot",
  "agricultural robot",
  "hardware robotics",
];

const TECHSTARS_TYPESENSE_SEARCH_KEY = "0QKFSu4mIDX9UalfCNQN4qjg2xmukDE0";
const TECHSTARS_ROBOTICS_QUERIES = [
  "robotics",
  "robot",
  "drone",
  "autonomous",
  "automation",
  "cobot",
  "agv",
  "amr",
  "uav",
  "warehouse",
];
const TECHSTARS_ROBOTICS_VERTICAL = "Robotics and Drones";
const PUBLIC_STARTUP_ROBOTICS_QUERIES = [
  "robotics",
  "robot",
  "drone",
  "autonomous robot",
  "autonomous systems",
  "warehouse robotics",
  "industrial robot",
  "surgical robot",
  "agricultural robot",
  "agv",
  "amr",
  "uav",
];
const SOSV_ROBOTICS_CATEGORY_ID = "1065";
const SKYDECK_ALGOLIA_APP_ID = "CX8Z9EYL0S";
const SKYDECK_ALGOLIA_SEARCH_KEY = "f0d707bec122756dc5359e01956323aa";

const MASS_TECH_LABELS = {
  ai: "AI",
  "ar-vr": "AR/VR",
  "arms-grippers": "Arms / Grippers",
  automation: "Automation",
  autonomy: "Autonomy",
  components: "Components",
  cybersecurity: "Cybersecurity",
  drones: "Drones",
  "education-stem": "Education / STEM",
  "ground-vehicles": "Ground Vehicles",
  healthcare: "Healthcare",
  marine: "Marine",
  research: "Research",
  sensors: "Sensors",
  software: "Software",
  telepresence: "Telepresence",
};

const MASS_INDUSTRY_LABELS = {
  agriculture: "Agriculture",
  apparel: "Apparel",
  automotive: "Automotive",
  biotechnology: "Biotechnology",
  chemicals: "Chemicals",
  communications: "Communications",
  construction: "Construction",
  consulting: "Consulting",
  consumer: "Consumer",
  defense: "Defense",
  "education-k-12": "Education (K-12)",
  electronics: "Electronics",
  "energy-utilities": "Energy & Utilities",
  engineering: "Engineering",
  entertainment: "Entertainment",
  environmental: "Environmental",
  "food-beverage": "Food & Beverage",
  government: "Government",
  healthcare: "Healthcare",
  hospitality: "Hospitality",
  logistics: "Logistics",
  "machinery-hardware": "Machinery / Hardware",
  manufacturing: "Manufacturing",
  "oil-gas": "Oil & Gas",
  recreation: "Recreation",
  "service-provider": "Service Provider",
  "transportation-shipping": "Transportation & Shipping",
  university: "University",
};

const OSRA_TIERS = new Set([
  "Platinum",
  "Gold",
  "Silver",
  "Bronze",
  "Associate",
  "Supporting Individual",
]);

const NON_COMPANY_ROS_TYPES =
  /\b(university|polytechnic|government|non-profit|research institute|standards organization|institute of higher learning|school|college|society|association|consortium)\b/i;
const COMMERCIAL_ROS_TYPES =
  /\b(company|corporation|manufacturer|provider|integrator|consult|engineering|oem|mnc|multinational|privately held|robotics company|software|services|equipment|conglomerate|startup)\b/i;

const args = new Set(process.argv.slice(2));
const dbPath = valueAfter("--db") ?? DEFAULT_DB_PATH;
const sourceRowsPath = valueAfter("--source-rows") ?? DEFAULT_SOURCE_ROWS_PATH;
const useCacheOnly = args.has("--cache-only");
const retrievedAt = valueAfter("--retrieved-at") ?? new Date().toISOString();

const existing = JSON.parse(await readFile(dbPath, "utf8"));
if (!Array.isArray(existing)) {
  throw new Error(`${dbPath} must contain a JSON array`);
}

const pages = {
  massrobotics: await loadSourceHtml("massrobotics"),
  osra: await loadSourceHtml("osra"),
  rosIndustrial: await loadSourceHtml("rosIndustrial"),
  a3: await loadSourceHtml("a3"),
  jaraRegular: await loadSourceHtml("jaraRegular"),
  jaraSupporting: await loadSourceHtml("jaraSupporting"),
  tairoaMembers: await loadSourceHtml("tairoaMembers"),
  baraRobots: await loadSourceHtml("baraRobots"),
  baraRobotIntegrators: await loadSourceHtml("baraRobotIntegrators"),
  pittsburghRoboticsMembers: await loadSourceHtml("pittsburghRoboticsMembers"),
  entrepreneurFirstRoboticsPortfolio: await loadSourceHtml("entrepreneurFirstRoboticsPortfolio"),
  wikipediaList: await loadSourceHtml("wikipediaList"),
};
const wikipediaCategory = await loadSourceJson("wikipediaCategory");
const wikidataRobotics = await loadSourceJson("wikidataRobotics", fetchWikidataRobotics);
const ukriRoboticsOrganisations = await loadSourceJson(
  "ukriRoboticsOrganisations",
  fetchUkriRoboticsOrganisations,
);
const openAlexRoboticsCompanies = await loadSourceJson("openAlexRoboticsCompanies");
const eicFundRobotSearch = await loadSourceJson("eicFundRobotSearch", fetchEicFundRobotSearch);
const cordisRoboticsProjects = await loadSourceJson("cordisRoboticsProjects", fetchCordisRoboticsProjects);
const wikipediaChinaRoboticsSearch = await loadSourceJson(
  "wikipediaChinaRoboticsSearch",
  fetchWikipediaChinaRoboticsSearch,
);
const wrcPastHighlightExhibits = await loadSourceJson("wrcPastHighlightExhibits", fetchWrcPastHighlightExhibits);
const cematAsiaRoboticsExhibitors = await loadSourceJson(
  "cematAsiaRoboticsExhibitors",
  fetchCematAsiaRoboticsExhibitors,
);
const odenseRoboticsMembers = await loadSourceJson("odenseRoboticsMembers", fetchOdenseRoboticsMembers);
const startupSgRobotics = await loadSourceJson("startupSgRobotics", fetchStartupSgRobotics);
const ycRoboticsStartups = await loadSourceJson("ycRoboticsStartups", fetchYcRoboticsStartups);
const techstarsRoboticsStartups = await loadSourceJson(
  "techstarsRoboticsStartups",
  fetchTechstarsRoboticsStartups,
);
const haxRoboticsStartups = await loadSourceJson("haxRoboticsStartups", fetchHaxRoboticsStartups);
const jStartupRobotics = await loadSourceJson("jStartupRobotics", fetchJStartupRobotics);
const sosvRoboticsCompanies = await loadSourceJson("sosvRoboticsCompanies", fetchSosvRoboticsCompanies);
const plugAndPlayRoboticsStartups = await loadSourceJson(
  "plugAndPlayRoboticsStartups",
  fetchPlugAndPlayRoboticsStartups,
);
const alchemistRoboticsStartups = await loadSourceJson(
  "alchemistRoboticsStartups",
  fetchAlchemistRoboticsStartups,
);
const skydeckRoboticsStartups = await loadSourceJson("skydeckRoboticsStartups", fetchSkydeckRoboticsStartups);
const siliconValleyRoboticsMembers = await loadSourceJson(
  "siliconValleyRoboticsMembers",
  fetchSiliconValleyRoboticsMembers,
);

const publicRows = [
  ...extractMassRobotics(pages.massrobotics),
  ...extractOsra(pages.osra),
  ...extractRosIndustrial(pages.rosIndustrial),
  ...extractA3(pages.a3),
  ...extractJaraMembers(pages.jaraRegular, {
    sourceKey: "jaraRegular",
    namespace: "jara_regular_member",
    sourceName: "Japan Robot Association Regular Members",
    tag: "JARA regular member",
    confidence: 76,
  }),
  ...extractJaraMembers(pages.jaraSupporting, {
    sourceKey: "jaraSupporting",
    namespace: "jara_supporting_member",
    sourceName: "Japan Robot Association Corporate Supporting Members",
    tag: "JARA corporate supporting member",
    confidence: 70,
  }),
  ...extractTairoaMembers(pages.tairoaMembers),
  ...extractWikipediaList(pages.wikipediaList),
  ...extractWikipediaCategory(wikipediaCategory),
  ...extractWikidataRobotics(wikidataRobotics),
  ...extractUkriRoboticsOrganisations(ukriRoboticsOrganisations),
  ...extractOpenAlexRoboticsCompanies(openAlexRoboticsCompanies),
  ...extractEicFundRobotSearch(eicFundRobotSearch),
  ...extractCordisRoboticsProjects(cordisRoboticsProjects),
  ...extractWikipediaChinaRoboticsSearch(wikipediaChinaRoboticsSearch),
  ...extractWrcPastHighlightExhibits(wrcPastHighlightExhibits),
  ...extractCematAsiaRoboticsExhibitors(cematAsiaRoboticsExhibitors),
  ...extractOdenseRoboticsMembers(odenseRoboticsMembers),
  ...extractStartupSgRobotics(startupSgRobotics),
  ...extractYcRoboticsStartups(ycRoboticsStartups),
  ...extractTechstarsRoboticsStartups(techstarsRoboticsStartups),
  ...extractHaxRoboticsStartups(haxRoboticsStartups),
  ...extractJStartupRobotics(jStartupRobotics),
  ...extractSosvRoboticsCompanies(sosvRoboticsCompanies),
  ...extractPlugAndPlayRoboticsStartups(plugAndPlayRoboticsStartups),
  ...extractAlchemistRoboticsStartups(alchemistRoboticsStartups),
  ...extractSkydeckRoboticsStartups(skydeckRoboticsStartups),
  ...extractEntrepreneurFirstRoboticsPortfolio(pages.entrepreneurFirstRoboticsPortfolio),
  ...extractBaraCategory(pages.baraRobots, {
    sourceKey: "baraRobots",
    namespace: "bara_robot",
    tag: "BARA robots category",
    sourceName: "Automate UK BARA Robots Product Finder",
  }),
  ...extractBaraCategory(pages.baraRobotIntegrators, {
    sourceKey: "baraRobotIntegrators",
    namespace: "bara_robot_integrator",
    tag: "BARA robot integrators category",
    sourceName: "Automate UK BARA Robot Integrators Product Finder",
  }),
  ...extractPittsburghRoboticsMembers(pages.pittsburghRoboticsMembers),
  ...extractSiliconValleyRoboticsMembers(siliconValleyRoboticsMembers),
];

const refreshedNamespaces = new Set(publicRows.map((row) => row.source_namespace).filter(Boolean));
const existingSourceRows = expandCanonicalCompanies(existing).filter(
  (row) => !refreshedNamespaces.has(row.source_namespace ?? sourceNamespaceFromId(row.source_id)),
);
const canonical = canonicalizeCompanies([...existingSourceRows, ...publicRows], { retrievedAt });

await mkdir(path.dirname(dbPath), { recursive: true });
await mkdir(path.dirname(sourceRowsPath), { recursive: true });
await writeFile(dbPath, `${JSON.stringify(canonical, null, 2)}\n`);
await writeFile(sourceRowsPath, `${JSON.stringify(publicRows, null, 2)}\n`);

const sourceCounts = countBy(publicRows, (row) => row.source_name);
const statusCounts = countBy(canonical, (row) => row.status ?? "(missing)");
const sourceBackedCompanies = canonical.filter((row) =>
  row.source_records?.some((source) => source.source_name !== "Petr Novikov Robotics Database"),
);

console.log(`Loaded ${existing.length} existing canonical companies`);
console.log(`Extracted ${publicRows.length} public source records`);
console.log(JSON.stringify(sourceCounts, null, 2));
console.log(`Wrote ${canonical.length} canonical companies to ${dbPath}`);
console.log(`Companies with at least one new public source: ${sourceBackedCompanies.length}`);
console.log(JSON.stringify(statusCounts, null, 2));
console.log(`Wrote extracted public rows to ${sourceRowsPath}`);

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function loadSourceHtml(key) {
  const source = SOURCES[key];
  const cachePath = path.join(CACHE_DIR, source.cacheFile);

  if (!useCacheOnly) {
    try {
      const response = await fetch(source.url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const html = await response.text();
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, html);
      return html;
    } catch (error) {
      console.warn(`Fetch failed for ${source.url}; falling back to cache: ${error.message}`);
    }
  }

  try {
    return await readFile(cachePath, "utf8");
  } catch (cacheError) {
    if (source.legacyCacheFile) {
      try {
        return await readFile(source.legacyCacheFile, "utf8");
      } catch {
        // Fall through to the optional-source handling below.
      }
    }
    if (source.optional) {
      console.warn(`No cache available for optional source ${source.url}; skipping: ${cacheError.message}`);
      return "";
    }
    throw cacheError;
  }
}

async function loadSourceJson(key, fetcher = fetchJsonSource) {
  const source = SOURCES[key];
  const cachePath = path.join(CACHE_DIR, source.cacheFile);

  if (!useCacheOnly) {
    try {
      const json = await fetcher(source);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, `${JSON.stringify(json, null, 2)}\n`);
      return json;
    } catch (error) {
      console.warn(`Fetch failed for ${source.url}; falling back to cache: ${error.message}`);
    }
  }

  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch (error) {
    if (source.optional) {
      console.warn(`No cache available for optional source ${source.url}; skipping: ${error.message}`);
      return {};
    }
    throw error;
  }
}

async function fetchJsonSource(source) {
  const response = await fetch(source.url, {
    headers: {
      accept: "application/json",
      "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchWikidataRobotics(source) {
  const url = new URL(source.url);
  url.searchParams.set("query", WIKIDATA_ROBOTICS_QUERY);
  const response = await fetch(url, {
    headers: {
      accept: "application/sparql-results+json",
      "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchUkriRoboticsOrganisations(source) {
  const first = await fetchUkriPage(source.url);
  const organisations = [...(first.organisation ?? [])];
  const totalPages = Math.min(Number(first.totalPages ?? 1), 25);

  for (let page = 2; page <= totalPages; page += 1) {
    const url = new URL(source.url);
    url.searchParams.set("p", String(page));
    const json = await fetchUkriPage(url);
    organisations.push(...(json.organisation ?? []));
  }

  return {
    ...first,
    organisation: organisations,
    fetchedPages: totalPages,
  };
}

async function fetchUkriPage(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.rcuk.gtr.json-v7",
      "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchEicFundRobotSearch(source) {
  const pages = [];
  for (let page = 0; page <= 15; page += 1) {
    const url = new URL(source.url);
    if (page > 0) url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const html = await response.text();
    if (!/class="ecl-card"/.test(html)) break;
    pages.push({ url: url.toString(), html });
  }

  return { pages };
}

async function fetchCordisRoboticsProjects(source) {
  const projectsById = new Map();
  const querySummaries = [];

  for (const query of CORDIS_ROBOTICS_QUERIES) {
    let fetched = 0;
    for (let page = 1; page <= CORDIS_MAX_PAGES_PER_QUERY; page += 1) {
      const url = new URL(source.url);
      url.searchParams.set("q", query);
      url.searchParams.set("p", String(page));
      url.searchParams.set("num", "10");
      url.searchParams.set("srt", "Relevance:decreasing");
      url.searchParams.set("format", "json");

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const json = await response.json();
      const hits = cordisProjectHits(json);
      if (!hits.length) {
        if (page === 1) querySummaries.push({ query, fetched: 0, note: "no hits in response" });
        break;
      }

      for (const hit of hits) {
        const project = hit.project;
        const id = String(project?.id ?? project?.rcn ?? "");
        if (!id) continue;
        const existing = projectsById.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, query]);
        } else {
          projectsById.set(id, { ...project, evidence_queries: [query] });
        }
      }

      fetched += hits.length;
      if (hits.length < 10) break;
    }
    if (!querySummaries.some((summary) => summary.query === query)) querySummaries.push({ query, fetched });
  }

  return {
    projects: [...projectsById.values()],
    query_summaries: querySummaries,
  };
}

async function fetchWikipediaChinaRoboticsSearch(source) {
  const results = [];
  for (const search of MEDIAWIKI_CHINA_ROBOTICS_QUERIES) {
    const url = new URL(`https://${search.wiki}.wikipedia.org/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", search.query);
    url.searchParams.set("srlimit", "50");
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    for (const result of json?.query?.search ?? []) {
      results.push({ ...result, wiki: search.wiki, search_query: search.query });
    }
  }

  return { results };
}

async function fetchWrcPastHighlightExhibits(source) {
  const pages = [];
  for (const year of WRC_HIGHLIGHT_YEARS) {
    const url = new URL(source.url);
    url.searchParams.set("ext_expo_year", year);

    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    pages.push({
      year,
      url: url.toString(),
      html: await response.text(),
    });
  }

  return { pages };
}

async function fetchCematAsiaRoboticsExhibitors(source) {
  const grouped = new Map();
  const querySummaries = [];

  for (const show of CEMAT_ASIA_SHOWS) {
    for (const query of CEMAT_ASIA_ROBOTICS_QUERIES) {
      const url = new URL(source.url);
      url.searchParams.set("showdetailsid", show.id);
      url.searchParams.set("page", "1");
      url.searchParams.set("size", "1000");
      url.searchParams.set("order", "name");
      url.searchParams.set("name", query.name ?? "");
      url.searchParams.set("type", query.type ?? "");

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          api: "2.0",
          "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const json = await response.json();
      const results = json?.data?.data;
      const total = Number(json?.data?.totals ?? 0);
      querySummaries.push({ year: show.year, query: query.label, total });
      if (!Array.isArray(results)) continue;

      for (const result of results) {
        const exhibitor = result.exhibitor ?? {};
        const exhibitorId = exhibitor.ID;
        if (!exhibitorId) continue;

        const key = `${show.year}:${exhibitorId}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, query.label]);
        } else {
          grouped.set(key, {
            year: show.year,
            show_code: show.code,
            showdetailsid: show.id,
            public_url: `https://service.cemat-asia.com/VSCENTER2/visitor/${show.code}/match/exhibitor?lang=zh-CN`,
            evidence_queries: [query.label],
            exhibitor,
          });
        }
      }
    }
  }

  return {
    exhibitors: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchOdenseRoboticsMembers(source) {
  const first = await fetchJsonSource(source);
  const members = [...(first.members ?? [])];
  const totalPages = Math.min(Number(first.totalPages ?? 1), 80);

  for (let page = 2; page <= totalPages; page += 1) {
    const url = new URL(source.url);
    url.searchParams.set("page", String(page));
    const json = await fetchJsonSource({ ...source, url: url.toString() });
    members.push(...(json.members ?? []));
  }

  return { ...first, members, fetchedPages: totalPages };
}

async function fetchStartupSgRobotics(source) {
  const first = await fetchJsonSource(source);
  const rows = [...(first.data ?? [])];
  const total = Math.min(Number(first.total ?? rows.length), 1000);
  const pageSize = Math.max(rows.length, 10);

  for (let from = pageSize; from < total; from += pageSize) {
    const url = new URL(source.url);
    url.searchParams.set("from", String(from));
    const json = await fetchJsonSource({ ...source, url: url.toString() });
    if (!Array.isArray(json.data) || !json.data.length) break;
    rows.push(...json.data);
  }

  return { ...first, data: rows, fetchedRows: rows.length };
}

async function fetchYcRoboticsStartups(source) {
  const grouped = new Map();
  const querySummaries = [];

  for (const query of YC_ROBOTICS_QUERIES) {
    let page = 0;
    let totalPages = 1;
    let found = 0;

    do {
      const params = new URLSearchParams({
        query,
        hitsPerPage: "100",
        page: String(page),
      });
      const response = await fetch(source.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
          "x-algolia-application-id": YC_ALGOLIA_APP_ID,
          "x-algolia-api-key": YC_ALGOLIA_SEARCH_KEY,
        },
        body: JSON.stringify({ params: params.toString() }),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const json = await response.json();
      found = Number(json.nbHits ?? found);
      totalPages = Math.min(Number(json.nbPages ?? 1), 25);
      for (const hit of json.hits ?? []) {
        const id = String(hit.id ?? hit.objectID ?? hit.slug ?? "");
        if (!id) continue;
        const existing = grouped.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, query]);
        } else {
          grouped.set(id, {
            ...hit,
            evidence_queries: [query],
          });
        }
      }
      page += 1;
    } while (page < totalPages);

    querySummaries.push({ query, found, fetched_pages: page });
  }

  return {
    companies: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchTechstarsRoboticsStartups(source) {
  const grouped = new Map();
  const searchDefinitions = [
    {
      label: `vertical: ${TECHSTARS_ROBOTICS_VERTICAL}`,
      params: {
        q: "*",
        query_by: "company_name,brief_description",
        filter_by: `industry_vertical:=[\`${TECHSTARS_ROBOTICS_VERTICAL}\`]`,
      },
    },
    ...TECHSTARS_ROBOTICS_QUERIES.map((query) => ({
      label: `keyword: ${query}`,
      params: {
        q: query,
        query_by: "company_name,brief_description",
      },
    })),
  ];
  const querySummaries = [];

  for (const definition of searchDefinitions) {
    let page = 1;
    let totalPages = 1;
    let found = 0;

    do {
      const json = await fetchTechstarsSearchPage(source, definition.params, page);
      found = Number(json.found ?? found);
      totalPages = Math.min(Math.ceil(found / 250) || 1, 25);

      for (const hit of json.hits ?? []) {
        const document = hit.document ?? {};
        const id = String(document.company_id ?? document.id ?? document.company_name ?? "");
        if (!id) continue;
        const existing = grouped.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, definition.label]);
        } else {
          grouped.set(id, {
            ...document,
            evidence_queries: [definition.label],
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    querySummaries.push({ query: definition.label, found, fetched_pages: page - 1 });
  }

  return {
    companies: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchTechstarsSearchPage(source, params, page) {
  const url = new URL(source.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("per_page", "250");
  url.searchParams.set("page", String(page));

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
      "x-typesense-api-key": TECHSTARS_TYPESENSE_SEARCH_KEY,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchHaxRoboticsStartups(source) {
  const companiesByProfile = new Map();
  const pageSummaries = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL(source.url);
    if (page > 1) url.searchParams.set("_paged", String(page));

    const html = await fetchHtmlText(url);
    const cards = parseHaxCards(html);
    for (const card of cards) {
      companiesByProfile.set(card.profile_url, {
        ...(companiesByProfile.get(card.profile_url) ?? {}),
        ...card,
      });
    }

    totalPages = Math.min(parseFacetWpTotalPages(html) ?? totalPages, 20);
    pageSummaries.push({ page, url: url.toString(), companies: cards.length });
    page += 1;
  } while (page <= totalPages);

  for (const company of companiesByProfile.values()) {
    try {
      const html = await fetchHtmlText(company.profile_url);
      Object.assign(company, parseHaxCompanyProfile(html));
    } catch (error) {
      company.profile_error = error.message;
    }
  }

  return {
    companies: [...companiesByProfile.values()],
    page_summaries: pageSummaries,
  };
}

async function fetchJStartupRobotics(source) {
  const listingHtml = await fetchHtmlText(source.url);
  const companies = parseJStartupCards(listingHtml);

  for (const company of companies) {
    try {
      const html = await fetchHtmlText(company.profile_url);
      Object.assign(company, parseJStartupProfile(html));
    } catch (error) {
      company.profile_error = error.message;
    }
  }

  return {
    companies,
    listing_url: source.url,
  };
}

async function fetchSosvRoboticsCompanies(source) {
  const grouped = new Map();
  const querySummaries = [];
  const definitions = [
    { label: "category: Robotics", params: { tx_category: SOSV_ROBOTICS_CATEGORY_ID } },
    ...PUBLIC_STARTUP_ROBOTICS_QUERIES.map((query) => ({ label: `keyword: ${query}`, params: { search: query } })),
  ];

  for (const definition of definitions) {
    let page = 1;
    let fetched = 0;
    while (page <= 10) {
      const url = new URL(source.url);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      for (const [key, value] of Object.entries(definition.params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const companies = await response.json();
      if (!Array.isArray(companies) || !companies.length) break;

      for (const company of companies) {
        const id = String(company.id ?? company.slug ?? "");
        if (!id) continue;
        const existing = grouped.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, definition.label]);
        } else {
          grouped.set(id, { ...company, evidence_queries: [definition.label] });
        }
      }

      fetched += companies.length;
      const totalPages = Math.min(Number(response.headers.get("x-wp-totalpages") ?? page), 10);
      if (page >= totalPages) break;
      page += 1;
    }
    querySummaries.push({ query: definition.label, fetched });
  }

  return {
    companies: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchPlugAndPlayRoboticsStartups(source) {
  const grouped = new Map();
  const querySummaries = [];

  for (const query of PUBLIC_STARTUP_ROBOTICS_QUERIES) {
    let offset = 0;
    let total = 1;
    let fetched = 0;
    const limit = 100;

    while (offset < Math.min(total, 1000)) {
      const url = new URL(source.url);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("startupIsActive", "true");
      url.searchParams.set("q", `*${query}*`);
      url.searchParams.set("orderBy", "startupTitle asc");

      const json = await fetchJsonSource({ ...source, url: url.toString() });
      const results = Array.isArray(json.results) ? json.results : [];
      total = Number(json.total ?? results.length);
      if (!results.length) break;

      for (const startup of results) {
        const id = String(startup["@id"] ?? startup.startupPlaybookID ?? startup.slug ?? "");
        if (!id) continue;
        const existing = grouped.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, query]);
        } else {
          grouped.set(id, { ...startup, evidence_queries: [query] });
        }
      }

      fetched += results.length;
      offset += limit;
    }

    querySummaries.push({ query, fetched, total });
  }

  return {
    companies: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchAlchemistRoboticsStartups(source) {
  const grouped = new Map();
  const querySummaries = [];

  for (const query of PUBLIC_STARTUP_ROBOTICS_QUERIES) {
    let page = 1;
    let fetched = 0;
    let available = 1;

    while (page <= 25 && fetched < Math.min(available, 1000)) {
      const url = new URL(source.url);
      url.searchParams.set("include", "aclass");
      url.searchParams.set("fields[alchemist_classes]", "number");
      url.searchParams.set("filter[aclass.class_type:eq]", "alchemist");
      url.searchParams.set("page[size]", "100");
      url.searchParams.set("page[number]", String(page));
      url.searchParams.set("filter[name,description,oneliner,startup_teamdescription,tags.text:search]", query);
      url.searchParams.set("sort", "-startup_totalraise");

      const json = await fetchJsonSource({ ...source, url: url.toString() });
      const results = Array.isArray(json.data) ? json.data : [];
      available = Number(json?.meta?.results?.available ?? results.length);
      if (!results.length) break;

      for (const company of results) {
        const id = String(company.id ?? company.attributes?.slug ?? company.attributes?.name ?? "");
        if (!id) continue;
        const existing = grouped.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, query]);
        } else {
          grouped.set(id, { ...company, evidence_queries: [query] });
        }
      }

      fetched += results.length;
      page += 1;
    }

    querySummaries.push({ query, fetched, available });
  }

  return {
    companies: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchSkydeckRoboticsStartups(source) {
  const grouped = new Map();
  const querySummaries = [];

  for (const query of PUBLIC_STARTUP_ROBOTICS_QUERIES) {
    let page = 0;
    let totalPages = 1;
    let found = 0;

    do {
      const response = await fetch(source.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
          "x-algolia-application-id": SKYDECK_ALGOLIA_APP_ID,
          "x-algolia-api-key": SKYDECK_ALGOLIA_SEARCH_KEY,
        },
        body: JSON.stringify({ query, hitsPerPage: 100, page }),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const json = await response.json();
      found = Number(json.nbHits ?? found);
      totalPages = Math.min(Number(json.nbPages ?? 1), 10);

      for (const hit of json.hits ?? []) {
        const id = String(hit.objectID ?? hit.post_id ?? hit.permalink ?? "");
        if (!id) continue;
        const existing = grouped.get(id);
        if (existing) {
          existing.evidence_queries = unique([...existing.evidence_queries, query]);
        } else {
          grouped.set(id, { ...hit, evidence_queries: [query] });
        }
      }
      page += 1;
    } while (page < totalPages);

    querySummaries.push({ query, found, fetched_pages: page });
  }

  return {
    companies: [...grouped.values()],
    query_summaries: querySummaries,
  };
}

async function fetchHtmlText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchSiliconValleyRoboticsMembers(source) {
  const response = await fetch(source.url, {
    headers: {
      accept: "application/json",
      "user-agent": "RoboticsMarketAtlas/0.1 public-data-research",
      "x-org": "13901",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function parseHaxCards(html) {
  const text = String(html ?? "");
  const linkMatches = [...text.matchAll(/<a\s+class="filtered-listing__item-link"\s+href="([^"]+)"><\/a>/gi)];
  const companies = [];

  for (let index = 0; index < linkMatches.length; index += 1) {
    const match = linkMatches[index];
    const next = linkMatches[index + 1];
    const segment = text.slice(match.index ?? 0, next?.index ?? text.length);
    const profileUrl = cleanUrl(match[1]);
    const companyName = cleanCompanyName(
      htmlToText(segment.match(/<h3[^>]*class="filtered-listing__item-title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""),
    );
    const shortDescription = htmlToText(
      segment.match(/<div[^>]*class="filtered-listing__item-content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
    );
    const imageUrl = cleanUrl(segment.match(/<img[^>]+src="([^"]+)"/i)?.[1]);
    const terms = parseHaxTerms(segment);

    if (!profileUrl || !companyName) continue;
    companies.push({
      company_name: companyName,
      profile_url: profileUrl,
      short_description: shortDescription,
      image_url: imageUrl,
      terms,
    });
  }

  return companies;
}

function parseHaxCompanyProfile(html) {
  const text = String(html ?? "");
  const detailsBlock = text.match(/<div[^>]*class="single-company-details"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)?.[1] ?? text;
  const companyName = cleanCompanyName(
    htmlToText(text.match(/<h1[^>]*class="single-company-header__title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
  );
  const tagline = htmlToText(
    text.match(/<p[^>]*class="single-company-header__tagline"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "",
  );
  const detailDescription = htmlToText(
    detailsBlock.match(/<div[^>]*class="single-company-details__content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
  );
  const websiteUrl = cleanUrl(
    text.match(/<div[^>]*class="single-company-header__website"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i)?.[1],
  );
  const linkedinUrl = cleanUrl(
    text.match(/<a[^>]+href="([^"]+)"[^>]+class="single-company-header__social-icon--linkedin"/i)?.[1],
  );
  const people = [...text.matchAll(/<h3[^>]*class="single-company-team__item-name"[^>]*>([\s\S]*?)<\/h3>\s*<div[^>]*class="single-company-team__item-position"[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => {
      const name = cleanCompanyName(htmlToText(match[1]));
      const position = cleanCompanyName(htmlToText(match[2]));
      return name && position ? `${name} - ${position}` : name;
    })
    .filter(Boolean);

  return {
    company_name: companyName,
    tagline,
    short_description: detailDescription || tagline,
    website_url: websiteUrl,
    linkedin_url: linkedinUrl,
    people: unique(people),
    terms: uniqueTerms([...parseHaxTerms(text)]),
  };
}

function parseHaxTerms(segment) {
  return [...String(segment ?? "").matchAll(/<a\s+href="([^"]*)"[^>]*data-taxonomy='([^']+)'[^>]*data-taxonomy-value='([^']+)'[^>]*data-facet='([^']+)'[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      href: cleanUrl(match[1]),
      taxonomy: match[2],
      value: match[3],
      facet: match[4],
      label: cleanCompanyName(htmlToText(match[5])),
    }))
    .filter((term) => term.label);
}

function parseFacetWpTotalPages(html) {
  const match = String(html ?? "").match(/"pager":\{"page":\d+,"per_page":\d+,"total_rows":\d+,"total_pages":(\d+)/);
  const pages = Number(match?.[1]);
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

function parseJStartupCards(html) {
  const companies = [];
  for (const match of String(html ?? "").matchAll(/<a\s+href="([^"]+)"\s+data-cats="([^"]*)"[\s\S]*?<p\s+class="company-name">([\s\S]*?)<\/p>/gi)) {
    const profileUrl = absoluteUrl(match[1], SOURCES.jStartupRobotics.url);
    const categories = unique(String(match[2] ?? "").split(",").map((category) => cleanCompanyName(category)));
    const companyName = cleanCompanyName(htmlToText(match[3]));
    const text = `${companyName} ${categories.join(" ")}`;
    if (!categories.some((category) => /^robot$/i.test(category)) && !isRoboticsText(text)) continue;

    companies.push({
      company_name: companyName,
      profile_url: profileUrl,
      categories,
    });
  }

  return dedupeBy(companies, (company) => company.profile_url ?? company.company_name);
}

function parseJStartupProfile(html) {
  const text = String(html ?? "");
  const main = text.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? text;
  const companyName = cleanCompanyName(
    htmlToText(main.match(/<h2[^>]*class="m-bottom30px"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""),
  );
  const categories = [...main.matchAll(/<ul[^>]*class="cats"[^>]*>([\s\S]*?)<\/ul>/gi)]
    .flatMap((match) => [...match[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => cleanCompanyName(htmlToText(item[1]))));
  const corporateNumber = cleanCompanyName(htmlToText(main.match(/Corporate Number[｜|]\s*([^<]+)/i)?.[1] ?? ""));
  const websiteUrl = cleanUrl(main.match(/<div[^>]*class="btm-arrow-blank[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"/i)?.[1]);
  const description = htmlToText(main.match(/<p[^>]*class="m-bottom0"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  const imageUrl = absoluteUrl(main.match(/<div[^>]*class="thumbnailBox"[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1] ?? "", SOURCES.jStartupRobotics.url);

  return {
    company_name: companyName,
    categories: unique(categories),
    corporate_number: corporateNumber,
    website_url: websiteUrl,
    short_description: description,
    image_url: imageUrl,
  };
}

function extractMassRobotics(html) {
  const pageUrl = SOURCES.massrobotics.url;
  const segments = html
    .split(/(?=<div class="post-wrap post-\d+)/g)
    .filter((segment) => segment.startsWith('<div class="post-wrap post-'));

  const rows = [];
  for (const segment of segments) {
    const classMatch = segment.match(/^<div class="([^"]+)"/);
    const postMatch = classMatch?.[1]?.match(/\bpost-(\d+)\b/);
    const linkMatch = segment.match(/<h1>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h1>/i);
    const headingMatch = segment.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!postMatch || !headingMatch) continue;

    const sourceRecordId = postMatch[1];
    const companyName = htmlToText(linkMatch?.[2] ?? headingMatch[1]);
    const websiteUrl = cleanUrl(linkMatch?.[1] ?? null);
    if (!companyName) continue;

    const classes = classMatch[1].split(/\s+/);
    const techSlugs = classes
      .filter((name) => name.startsWith("technology-"))
      .map((name) => name.replace("technology-", ""));
    const industrySlugs = classes
      .filter((name) => name.startsWith("industry-"))
      .map((name) => name.replace("industry-", ""));

    const technologies = unique(techSlugs.map((slug) => MASS_TECH_LABELS[slug] ?? labelFromSlug(slug)));
    const industries = unique(industrySlugs.map((slug) => MASS_INDUSTRY_LABELS[slug] ?? labelFromSlug(slug)));
    const description = firstParagraphAfterHeading(segment);
    const taxonomy = taxonomyFromMassRobotics(techSlugs);

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: websiteUrl,
        status: "Pending",
        short_description: description,
        product_type: taxonomy.productType,
        targeted_industries: industries,
        robot_or_automated_system_type: taxonomy.robotTypes,
        hardware_component_type: taxonomy.hardwareTypes,
        software_type: taxonomy.softwareTypes,
        tags: unique(["MassRobotics resident startup", ...technologies.map((label) => `Technology: ${label}`)]),
        source_namespace: "massrobotics_resident",
        source_record_id: sourceRecordId,
        source_name: "MassRobotics Resident Startup Directory",
        source_type: "robotics_startup_directory",
        source_url: `${pageUrl}#post-${sourceRecordId}`,
        source_confidence: 86,
        extraction_method: "html_directory_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractOsra(html) {
  const pageUrl = SOURCES.osra.url;
  const tierHeadings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => ({
      index: match.index ?? 0,
      tier: htmlToText(match[1]),
    }))
    .filter((heading) => OSRA_TIERS.has(heading.tier));

  const rows = [];
  for (const match of html.matchAll(/<figure class="wp-caption">([\s\S]*?)<\/figure>/gi)) {
    const block = match[1];
    const linkMatch = block.match(/<a\s+href="([^"]+)"/i);
    const captionMatch = block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (!linkMatch || !captionMatch) continue;

    const companyName = htmlToText(captionMatch[1]);
    const websiteUrl = cleanUrl(linkMatch[1]);
    if (!companyName || !websiteUrl) continue;

    const tier = nearestTier(tierHeadings, match.index ?? 0);
    const tierTag = tier ? `OSRA tier: ${tier}` : null;
    const description = `${companyName} is listed as${tier ? ` a ${tier}` : " an"} Open Source Robotics Alliance member.`;

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: websiteUrl,
        status: "Pending",
        short_description: description,
        targeted_industries: ["Robotics development"],
        tags: unique(["OSRA member", tierTag].filter(Boolean)),
        source_namespace: "osra_member",
        source_record_id: slugify(`${companyName}-${websiteUrl}`),
        source_name: "Open Source Robotics Alliance Members",
        source_type: "open_source_robotics_member_directory",
        source_url: pageUrl,
        source_confidence: 78,
        extraction_method: "html_member_logo_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractRosIndustrial(html) {
  const pageUrl = SOURCES.rosIndustrial.url;
  const headings = [...html.matchAll(/<h2\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi)].map((match) => ({
    id: match[1],
    name: htmlToText(match[2]),
    index: match.index ?? 0,
  }));

  const rows = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1]?.index ?? html.length;
    const segment = html.slice(heading.index, next);
    if (!/<strong>\s*Website\s*:?\s*<\/strong>/i.test(segment)) continue;

    const websiteUrl = extractWebsite(segment);
    if (!websiteUrl) continue;

    const memberType = extractStrongValue(segment, "Type");
    if (!memberType || !COMMERCIAL_ROS_TYPES.test(memberType) || NON_COMPANY_ROS_TYPES.test(memberType)) {
      continue;
    }

    const notes = extractStrongValue(segment, "Notes");
    const repositoryUrl = extractLabeledHref(segment, "ROS Repositories");
    const wikiUrl = extractLabeledHref(segment, "ROS Wiki page");
    const taxonomy = taxonomyFromRosType(memberType, repositoryUrl);
    const description = notes || rosDescription(heading.name, memberType);

    rows.push(
      compactRecord({
        company_name: heading.name,
        website_url: websiteUrl,
        github_url: repositoryUrl?.includes("github.com") ? repositoryUrl : null,
        status: "Pending",
        short_description: description,
        product_type: taxonomy.productType,
        targeted_industries: taxonomy.industries,
        robot_or_automated_system_type: taxonomy.robotTypes,
        hardware_component_type: taxonomy.hardwareTypes,
        software_type: taxonomy.softwareTypes,
        tags: unique(
          [
            "ROS-Industrial member",
            memberType ? `ROS-Industrial type: ${memberType}` : null,
            repositoryUrl ? "ROS repository" : null,
            wikiUrl ? "ROS wiki page" : null,
          ].filter(Boolean),
        ),
        source_namespace: "rosindustrial_member",
        source_record_id: heading.id,
        source_name: "ROS-Industrial Current Members",
        source_type: "industrial_robotics_member_directory",
        source_url: `${pageUrl}#${heading.id}`,
        source_confidence: 76,
        extraction_method: "html_member_directory_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractA3(html) {
  const sourceUrl = SOURCES.a3.url;
  const headings = [...html.matchAll(/<h3>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi)].map(
    (match) => ({
      index: match.index ?? 0,
      href: match[1],
      name: htmlToText(match[2]),
    }),
  );

  const rows = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const nextIndex = headings[index + 1]?.index ?? html.length;
    const segment = html.slice(heading.index, nextIndex);
    const profileUrl = absoluteUrl(heading.href, sourceUrl);
    const companyName = heading.name;
    const location = htmlToText(segment.match(/<p class="companyLocation">([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const locationFields = parseA3Location(location);
    if (!companyName || !profileUrl) continue;

    rows.push(
      compactRecord({
        company_name: companyName,
        status: "Pending",
        ...locationFields,
        product_type: ["Robot or automated system"],
        targeted_industries: ["Manufacturing", "Robotics development"],
        tags: ["A3 Automate member company"],
        source_namespace: "a3_company",
        source_record_id: slugify(profileUrl.replace(/^https?:\/\/www\.automate\.org\/companies\//, "")),
        source_name: "A3 Automate Company Directory",
        source_type: "automation_robotics_member_directory",
        source_url: profileUrl,
        source_confidence: 65,
        extraction_method: "html_directory_card_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractJaraMembers(html, options) {
  const sourceUrl = SOURCES[options.sourceKey].url;
  const content = html.match(/<div class="story-body">([\s\S]*?)<div class="column-secondary">/i)?.[1] ?? html;
  const rows = [];

  for (const match of content.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const block = match[1];
    const companyName = cleanCompanyName(htmlToText(block));
    const websiteUrl = cleanUrl(block.match(/<a\s+[^>]*href="([^"]+)"/i)?.[1] ?? null);
    if (!companyName || !isCompanyLikeName(companyName)) continue;

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: websiteUrl,
        status: "Pending",
        country: ["Japan"],
        product_type: ["Robot or automated system"],
        targeted_industries: ["Manufacturing", "Robotics development"],
        tags: [options.tag],
        source_namespace: options.namespace,
        source_record_id: slugify(`${companyName}-${websiteUrl ?? match.index ?? rows.length}`),
        source_name: options.sourceName,
        source_type: "robotics_automation_association_member_directory",
        source_url: sourceUrl,
        source_confidence: options.confidence,
        extraction_method: "html_member_list_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractTairoaMembers(html) {
  const sourceUrl = SOURCES.tairoaMembers.url;
  const rows = [];

  for (const match of html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
    const memberId = htmlToText(match[1]);
    if (!/^[GS]\d{3,4}$/i.test(memberId)) continue;

    const companyCell = match[2];
    const companyName = cleanCompanyName(htmlToText(companyCell));
    if (!companyName) continue;

    const websiteUrl = cleanUrl(companyCell.match(/<a\s+[^>]*href="([^"]+)"/i)?.[1] ?? null);
    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: websiteUrl,
        status: "Pending",
        country: ["Taiwan"],
        product_type: ["Robot or automated system"],
        targeted_industries: ["Manufacturing", "Robotics development"],
        tags: ["TAIROA group member"],
        source_namespace: "tairoa_group_member",
        source_record_id: memberId,
        source_name: "Taiwan Automation Intelligence and Robotics Association Group Members",
        source_type: "robotics_automation_association_member_directory",
        source_url: `${sourceUrl}#${memberId}`,
        source_confidence: 72,
        extraction_method: "html_member_table_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractWikipediaList(html) {
  const pageUrl = SOURCES.wikipediaList.url;
  const start = html.indexOf('id="Notable_examples"');
  const end = html.indexOf('id="See_also"', start);
  if (start < 0 || end < 0) return [];

  const section = html.slice(start, end);
  const rows = [];
  for (const match of section.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const linkMatch = block.match(/<a\s+(?:[^>]*?\s)?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const companyName = htmlToText(linkMatch[2]);
    const description = htmlToText(block);
    if (!companyName || !/robot/i.test(description)) continue;

    const sourceUrl = absoluteUrl(linkMatch[1], pageUrl);
    rows.push(
      compactRecord({
        company_name: companyName,
        status: "Pending",
        country: inferCountriesFromText(description),
        short_description: description,
        product_type: ["Robot or automated system"],
        tags: ["Wikipedia notable robotics company"],
        source_namespace: "wikipedia_robotics_list",
        source_record_id: slugify(companyName),
        source_name: "Wikipedia List of Robotics Companies",
        source_type: "encyclopedic_robotics_company_list",
        source_url: sourceUrl ?? pageUrl,
        source_confidence: 60,
        extraction_method: "html_list_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractWikipediaCategory(json) {
  const members = json?.query?.categorymembers;
  if (!Array.isArray(members)) return [];

  const rows = members
    .filter((member) => member.ns === 0 && member.title !== "List of robotics companies")
    .map((member) => {
      const companyName = cleanWikipediaTitle(member.title);
      return compactRecord({
        company_name: companyName,
        status: "Pending",
        product_type: ["Robot or automated system"],
        tags: ["Wikipedia robotics companies category"],
        source_namespace: "wikipedia_robotics_category",
        source_record_id: String(member.pageid),
        source_name: "Wikipedia Robotics Companies Category",
        source_type: "encyclopedic_robotics_company_category",
        source_url: `https://en.wikipedia.org/?curid=${member.pageid}`,
        source_confidence: 58,
        extraction_method: "mediawiki_category_api",
      });
    });

  return dedupeSourceRows(rows);
}

function extractWikidataRobotics(json) {
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) return [];

  const grouped = new Map();
  for (const binding of bindings) {
    const qid = binding.item?.value?.match(/Q\d+$/)?.[0];
    const label = binding.itemLabel?.value;
    if (!qid || !label || /^Q\d+$/.test(label)) continue;

    if (!grouped.has(qid)) {
      grouped.set(qid, {
        qid,
        label,
        countries: [],
        websites: [],
        inceptionYears: [],
      });
    }

    const row = grouped.get(qid);
    row.countries.push(countryLabelToDbValue(binding.countryLabel?.value));
    row.websites.push(binding.website?.value);
    const year = yearFromWikidataDate(binding.inception?.value);
    if (year) row.inceptionYears.push(year);
  }

  const rows = [];
  for (const entry of grouped.values()) {
    const countries = unique(entry.countries);
    const websites = unique(entry.websites.map(cleanUrl));
    const founded = entry.inceptionYears.length ? Math.min(...entry.inceptionYears) : null;

    rows.push(
      compactRecord({
        company_name: entry.label,
        website_url: preferredUrl(websites),
        country: countries,
        founded,
        status: "Pending",
        product_type: ["Robot or automated system"],
        targeted_industries: ["Robotics development"],
        tags: ["Wikidata industry: robotics"],
        source_namespace: "wikidata_robotics_industry",
        source_record_id: entry.qid,
        source_name: "Wikidata Robotics Industry",
        source_type: "open_knowledge_graph",
        source_url: `https://www.wikidata.org/wiki/${entry.qid}`,
        source_confidence: 68,
        extraction_method: "sparql_robotics_industry_query",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractUkriRoboticsOrganisations(json) {
  const organisations = json?.organisation;
  if (!Array.isArray(organisations)) return [];

  const rows = organisations
    .filter((organisation) => isCommercialOrganisationName(organisation.name))
    .map((organisation) => {
      const address = firstAddress(organisation.addresses?.address);
      const projectCount = organisation.links?.link?.filter((link) => link.rel === "PROJECT").length ?? 0;
      const country = countryFromUkriAddress(address);

      return compactRecord({
        company_name: cleanCompanyName(organisation.name),
        city: address?.city,
        state: address?.region && address.region !== "Unknown" ? [address.region] : [],
        country: country ? [country] : [],
        status: "Pending",
        short_description: `${cleanCompanyName(organisation.name)} appears as an organisation connected to UKRI Gateway to Research robotics project records.`,
        product_type: ["Robot or automated system"],
        targeted_industries: ["Robotics development"],
        tags: unique([
          "UKRI robotics project organisation",
          projectCount ? `UKRI project links: ${projectCount}` : null,
        ]),
        source_namespace: "ukri_robotics_organisation",
        source_record_id: organisation.id,
        source_name: "UKRI Gateway to Research Robotics Organisations",
        source_type: "public_research_funding_organisation_search",
        source_url: httpsUrl(organisation.href) ?? `https://gtr.ukri.org/gtr/api/organisations/${organisation.id}`,
        source_confidence: 56,
        extraction_method: "gtr_organisation_api_robotics_query",
      });
    });

  return dedupeSourceRows(rows);
}

function extractOpenAlexRoboticsCompanies(json) {
  const results = json?.results;
  if (!Array.isArray(results)) return [];

  const rows = results
    .filter((result) => result.type === "company" && result.display_name)
    .map((result) => {
      const country = countryCodeToName(result.country_code ?? result.geo?.country_code);
      const worksCount = Number(result.works_count ?? 0);
      const companyName = cleanOpenAlexName(result.display_name);

      return compactRecord({
        company_name: companyName,
        website_url: cleanUrl(result.homepage_url),
        city: result.geo?.city,
        state: result.geo?.region ? [result.geo.region] : [],
        country: country ? [country] : [],
        status: "Pending",
        short_description: `${companyName} is indexed by OpenAlex as a company institution matching robotics, with ${worksCount} works.`,
        product_type: ["Robot or automated system"],
        targeted_industries: ["Robotics development"],
        tags: unique(["OpenAlex company institution", "OpenAlex robotics search", worksCount ? `OpenAlex works: ${worksCount}` : null]),
        source_namespace: "openalex_robotics_company",
        source_record_id: String(result.id ?? "").replace(/^https:\/\/openalex\.org\//, ""),
        source_name: "OpenAlex Robotics Company Institutions",
        source_type: "open_research_index_company_search",
        source_url: result.id,
        source_confidence: 54,
        extraction_method: "openalex_institution_company_robotics_query",
      });
    })
    .filter((row) => row.source_record_id);

  return dedupeSourceRows(rows);
}

function extractEicFundRobotSearch(json) {
  const pages = json?.pages;
  if (!Array.isArray(pages)) return [];

  const rows = [];
  for (const page of pages) {
    for (const match of String(page.html ?? "").matchAll(/<article\s+class="ecl-card"[\s\S]*?<\/article>/gi)) {
      const card = match[0];
      const linkMatch = card.match(/<div class="ecl-content-block__title">\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      const companyName = cleanCompanyName(htmlToText(linkMatch[2]));
      const description = htmlToText(card.match(/<div class="ecl-content-block__description">([\s\S]*?)<\/div>/i)?.[1] ?? "");
      const sector = eicDescriptionValue(card, "Sector");
      const country = eicDescriptionValue(card, "Country");
      const text = `${companyName} ${description} ${sector}`;
      if (!isRoboticsText(text)) continue;

      const profileUrl = absoluteUrl(linkMatch[1], SOURCES.eicFundRobotSearch.url);
      rows.push(
        compactRecord({
          company_name: companyName,
          status: "Pending",
          country: country ? [countryLabelToDbValue(country)] : [],
          short_description: description,
          product_type: productTypesFromText(text),
          targeted_industries: industriesFromText(text),
          robot_or_automated_system_type: robotTypesFromText(text),
          hardware_component_type: hardwareTypesFromText(text),
          tags: unique(["EIC Fund portfolio company", sector ? `EIC sector: ${sector}` : null]),
          source_namespace: "eic_fund_robot_search",
          source_record_id: slugify(profileUrl ?? companyName),
          source_name: "EIC Fund Invested Companies Robot Search",
          source_type: "public_eu_fund_portfolio_directory",
          source_url: profileUrl ?? page.url,
          source_confidence: 66,
          extraction_method: "html_portfolio_card_robot_keyword_filter",
        }),
      );
    }
  }

  return dedupeSourceRows(rows);
}

function extractCordisRoboticsProjects(json) {
  const projects = json?.projects;
  if (!Array.isArray(projects)) return [];

  const rows = [];
  for (const project of projects) {
    const projectTitle = cleanCompanyName(project.title);
    const projectAcronym = cleanCompanyName(project.acronym);
    const projectText = [
      projectTitle,
      projectAcronym,
      project.teaser,
      project.objective,
      project.keywords,
      cordisCategoryLabels(project).join(" "),
    ].join(" ");
    if (!isRoboticsCompanyText(projectText)) continue;

    const projectUrl = `https://cordis.europa.eu/project/id/${project.id ?? project.rcn}`;
    const projectCategories = cordisCategoryLabels(project);
    const evidenceQueries = valuesList(project.evidence_queries);
    const projectGrant = numberFromValue(project.ecMaxContribution);
    const projectTotalCost = numberFromValue(project.totalCost);

    for (const organisation of cordisOrganizations(project)) {
      if (cordisOrgActivityCode(organisation) !== "PRC") continue;
      const companyName = cleanCompanyName(organisation.legalName || organisation.shortName);
      if (!companyName || !isCommercialOrganisationName(companyName)) continue;

      const attributes = organisation["@attributes"] ?? {};
      const address = organisation.address ?? {};
      const country = countryCodeToName(address.country) ?? countryLabelToDbValue(address.country);
      const orgGrant = numberFromValue(attributes.netEcContribution ?? attributes.ecContribution);
      const orgTotalCost = numberFromValue(attributes.totalCost);
      const text = `${companyName} ${projectText}`;

      rows.push(
        compactRecord({
          company_name: companyName,
          website_url: cleanUrl(address.url) ?? cordisProjectWebsite(project),
          city: cleanCompanyName(address.city),
          country: country ? [country] : [],
          status: "Pending",
          short_description: `${companyName} is a private for-profit CORDIS organisation on robotics-related EU project ${projectAcronym || project.id}.`,
          product_type: productTypesFromText(text),
          targeted_industries: unique([...projectCategories.map(mapIndustryLabel), ...industriesFromText(text)]),
          robot_or_automated_system_type: robotTypesFromText(text),
          hardware_component_type: hardwareTypesFromText(text),
          software_type: softwareTypesFromText(text),
          eu_grant_eur: orgGrant ?? projectGrant,
          eu_project_total_cost_eur: orgTotalCost ?? projectTotalCost,
          tags: unique([
            "CORDIS robotics project organisation",
            attributes.sme === "true" ? "CORDIS SME" : null,
            attributes.type ? `CORDIS role: ${attributes.type}` : null,
            projectAcronym ? `CORDIS project: ${projectAcronym}` : null,
            project.status ? `CORDIS project status: ${project.status}` : null,
            projectGrant ? `CORDIS project EC contribution EUR: ${projectGrant}` : null,
            orgGrant ? `CORDIS organisation EC contribution EUR: ${orgGrant}` : null,
            ...projectCategories.map((category) => `CORDIS category: ${category}`),
            ...evidenceQueries.map((query) => `CORDIS match ${query}`),
          ]),
          source_namespace: "cordis_robotics_project_organisation",
          source_record_id: `${project.id ?? project.rcn}:${organisation.id ?? organisation.rcn ?? slugify(companyName)}`,
          source_name: "CORDIS Robotics Project Organisations",
          source_type: "public_eu_research_funding_project_api",
          source_url: projectUrl,
          source_record_created_at: isoDateValue(project.contentCreationDate),
          source_record_last_edited_at: isoDateValue(project.lastUpdateDate),
          source_confidence: attributes.sme === "true" ? 64 : 58,
          extraction_method: "cordis_project_api_private_for_profit_robotics_filter",
        }),
      );
    }
  }

  return dedupeSourceRows(rows);
}

function extractWikipediaChinaRoboticsSearch(json) {
  const results = json?.results;
  if (!Array.isArray(results)) return [];

  const rows = [];
  for (const result of results) {
    const title = cleanWikipediaTitle(result.title);
    const description = htmlToText(result.snippet);
    const text = `${title} ${description}`;
    if (!isMediaWikiRoboticsCompanyResult(title, description)) continue;

    const countries = inferCountriesFromText(text);
    if (!countries.some((country) => ["China", "Hong Kong", "Taiwan"].includes(country))) continue;

    rows.push(
      compactRecord({
        company_name: title,
        status: "Pending",
        country: countries,
        short_description: description,
        product_type: productTypesFromText(text),
        targeted_industries: industriesFromText(text),
        robot_or_automated_system_type: robotTypesFromText(text),
        tags: [`${result.wiki}.wikipedia robotics company search result`],
        source_namespace: "wikipedia_china_robotics_search",
        source_record_id: `${result.wiki}-${result.pageid}`,
        source_name: "Wikipedia China Robotics Company Search",
        source_type: "encyclopedic_robotics_company_search",
        source_url: `https://${result.wiki}.wikipedia.org/?curid=${result.pageid}`,
        source_confidence: 52,
        extraction_method: "mediawiki_search_robotics_company_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractWrcPastHighlightExhibits(json) {
  const pages = json?.pages;
  if (!Array.isArray(pages)) return [];

  const rows = [];
  for (const page of pages) {
    const year = String(page.year ?? "");
    const pageUrl = page.url ?? SOURCES.wrcPastHighlightExhibits.url;
    const html = String(page.html ?? "");
    let recordIndex = 0;

    for (const match of html.matchAll(/<li>\s*<div class="zsld-img">([\s\S]*?)<\/li>/gi)) {
      const block = match[0];
      const productName = cleanCompanyName(htmlToText(block.match(/<h3[^>]*class="zsld-h3[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ""));
      const companyName = cleanCompanyName(htmlToText(block.match(/<p[^>]*class="zsld-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ""));
      const description = htmlToText(block.match(/<p[^>]*class="zsld-info[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
      const imageUrl = absoluteUrl(block.match(/<img\s+[^>]*src="([^"]+)"/i)?.[1] ?? "", pageUrl);
      recordIndex += 1;

      if (!companyName || !isCompanyLikeName(companyName)) continue;

      const text = `${companyName} ${productName} ${description}`;
      const countries = inferWrcCountries(companyName, text);
      const productTags = productName ? [`WRC product: ${productName}`] : [];

      rows.push(
        compactRecord({
          company_name: companyName,
          country: countries,
          status: "Pending",
          short_description: description || (productName ? `${companyName} exhibited ${productName} at World Robot Conference ${year}.` : null),
          featured_product: productName,
          image_url: imageUrl,
          product_type: productTypesFromText(text),
          targeted_industries: industriesFromText(text),
          robot_or_automated_system_type: robotTypesFromText(text),
          hardware_component_type: hardwareTypesFromText(text),
          software_type: softwareTypesFromText(text),
          tags: unique([
            "World Robot Conference highlight exhibit",
            year ? `WRC exhibit year: ${year}` : null,
            ...productTags,
          ]),
          source_namespace: "wrc_past_highlight_exhibit",
          source_record_id: `wrc_${year}_${recordIndex}_${hashString(`${companyName}|${productName}`)}`,
          source_name: "World Robot Conference Past Highlight Exhibits",
          source_type: "robotics_conference_exhibit_directory",
          source_url: pageUrl,
          source_confidence: 70,
          extraction_method: "html_past_highlight_exhibit_parse",
        }),
      );
    }
  }

  return dedupeSourceRows(rows);
}

function extractCematAsiaRoboticsExhibitors(json) {
  const exhibitors = json?.exhibitors;
  if (!Array.isArray(exhibitors)) return [];

  const rows = [];
  for (const entry of exhibitors) {
    const exhibitor = entry.exhibitor ?? {};
    const companyName = cleanCompanyName(exhibitor["Company Name"] || exhibitor["Company Name (EN)"]);
    if (!companyName || !isCompanyLikeName(companyName)) continue;

    const description = htmlToText(exhibitor.Description || exhibitor["Description (EN)"] || "");
    const englishName = cleanCompanyName(exhibitor["Company Name (EN)"] ?? "");
    const text = `${companyName} ${englishName} ${description} ${exhibitor.Address ?? ""} ${exhibitor["Address (EN)"] ?? ""}`;
    if (!isRoboticsText(text)) continue;

    const country = countryLabelToDbValue(exhibitor.Country) ?? inferCountriesFromText(text)[0];
    const city = cematCityFromText(text);
    const hall = cleanCompanyName(exhibitor.Hall);
    const stand = cleanCompanyName(exhibitor.Stand);
    const website = cleanUrl(exhibitor.WebSite);

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: website,
        city,
        country: country ? [country] : [],
        status: "Pending",
        short_description: description || `${companyName} is listed as a CeMAT ASIA ${entry.year} exhibitor matching robotics or logistics automation signals.`,
        product_type: productTypesFromText(text),
        targeted_industries: unique(["Logistics", "Manufacturing", ...industriesFromText(text)]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        tags: unique([
          "CeMAT ASIA robotics/logistics automation exhibitor",
          entry.year ? `CeMAT ASIA exhibit year: ${entry.year}` : null,
          hall ? `CeMAT hall: ${hall}` : null,
          stand ? `CeMAT stand: ${stand}` : null,
          ...((entry.evidence_queries ?? []).map((query) => `CeMAT match ${query}`)),
        ]),
        source_namespace: "cemat_asia_robotics_exhibitor",
        source_record_id: `${entry.year}_${exhibitor.ID}`,
        source_name: "CeMAT ASIA Robotics and Logistics Automation Exhibitors",
        source_type: "robotics_logistics_automation_exhibitor_api",
        source_url: entry.public_url ?? SOURCES.cematAsiaRoboticsExhibitors.url,
        source_confidence: 68,
        extraction_method: "official_exhibitor_api_robotics_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractOdenseRoboticsMembers(json) {
  const members = json?.members;
  if (!Array.isArray(members)) return [];

  const rows = members
    .filter((member) => /private company/i.test(member.organisationType ?? ""))
    .map((member) => {
      const technologies = termNames(member.technologyFields);
      const industries = termNames(member.industries).map(mapIndustryLabel);
      const hubs = termNames(member.hubs);
      const text = `${member.title} ${technologies.join(" ")} ${industries.join(" ")}`;

      return compactRecord({
        company_name: cleanCompanyName(member.title),
        status: "Pending",
        country: ["Denmark"],
        product_type: productTypesFromText(text),
        targeted_industries: unique(industries),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        tags: unique([
          "Odense Robotics member",
          member.organisationType ? `Odense organisation type: ${member.organisationType}` : null,
          ...technologies.map((technology) => `Technology: ${technology}`),
          ...hubs.map((hub) => `Odense hub: ${hub}`),
        ]),
        source_namespace: "odense_robotics_member",
        source_record_id: slugify(member.permalink ?? member.title),
        source_name: "Odense Robotics Member Directory",
        source_type: "robotics_cluster_member_directory_api",
        source_url: member.permalink ?? SOURCES.odenseRoboticsMembers.url,
        source_confidence: 72,
        extraction_method: "wp_json_member_api",
      });
    });

  return dedupeSourceRows(rows);
}

function extractStartupSgRobotics(json) {
  const startups = json?.data;
  if (!Array.isArray(startups)) return [];

  const rows = [];
  for (const startup of startups) {
    const sectors = termNames(startup.sectors);
    const tags = termNames(startup.tags);
    const description = cleanCompanyName(startup.companyDescription ?? startup.companyDescriptor);
    const text = `${startup.displayName} ${startup.registeredName} ${startup.companyDescriptor} ${description} ${sectors.join(" ")} ${tags.join(" ")}`;
    const strongTags = tags.filter((tag) =>
      /\b(drone|uav|ugv|agv|amr|cobot|humanoid|exoskeleton|robot arm|manipulator|gripper|slam|autonomous vehicle|self-driving)\b/i.test(tag),
    );
    const evidenceText = `${startup.displayName} ${startup.registeredName} ${description} ${strongTags.join(" ")}`;
    if (!isRoboticsCompanyText(evidenceText)) continue;

    rows.push(compactRecord({
      company_name: cleanCompanyName(startup.registeredName || startup.displayName),
      website_url: cleanUrl(startup.website?.url),
      founded: Number.isInteger(startup.yearEstablished) ? startup.yearEstablished : yearFromDate(startup.dateIncorporated),
      city: "Singapore",
      country: ["Singapore"],
      status: "Pending",
      short_description: description,
      product_type: productTypesFromText(text),
      targeted_industries: unique(sectors.map(mapIndustryLabel)),
      robot_or_automated_system_type: robotTypesFromText(text),
      hardware_component_type: hardwareTypesFromText(text),
      software_type: softwareTypesFromText(text),
      tags: unique([
        "StartupSG robotics startup",
        startup.uen ? `Singapore UEN: ${startup.uen}` : null,
        startup.rangeEmployee?.name ? `Employee range: ${startup.rangeEmployee.name}` : null,
        startup.investmentStage?.name ? `Investment stage: ${startup.investmentStage.name}` : null,
        ...sectors.map((sector) => `StartupSG sector: ${sector}`),
        ...tags.map((tag) => `StartupSG tag: ${tag}`),
      ]),
      source_namespace: "startupsg_robotics_startup",
      source_record_id: startup.uuid ?? startup.id ?? slugify(startup.registeredName || startup.displayName),
      source_name: "StartupSG Robotics Startup Directory",
      source_type: "public_startup_directory_api",
      source_url: "https://www.startupsg.gov.sg/directory/startups/",
      source_confidence: 76,
      extraction_method: "startupsg_search_api_robotics_query_filtered",
    }));
  }

  return dedupeSourceRows(rows);
}

function extractYcRoboticsStartups(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const companyName = cleanCompanyName(company.name);
    if (!companyName) continue;

    const ycTags = valuesList(company.tags);
    const ycIndustries = valuesList(company.industries);
    const evidenceQueries = valuesList(company.evidence_queries);
    const description = cleanCompanyName(company.long_description || company.one_liner);
    const text = [
      companyName,
      company.one_liner,
      company.long_description,
      company.industry,
      company.subindustry,
      ycTags.join(" "),
      ycIndustries.join(" "),
    ].join(" ");
    const ycRoboticsTag = ycTags.some((tag) =>
      /^(robotics|drones|autonomous vehicles|self-driving cars)$/i.test(tag),
    );
    const roboticsSignal = isRoboticsCompanyText(text) || ycRoboticsTag;
    if (!roboticsSignal) continue;

    const location = parseYcLocation(company);
    const launchYear = yearFromUnixTimestamp(company.launched_at);
    const teamSize = Number(company.team_size);
    const profileUrl = company.slug
      ? `https://www.ycombinator.com/companies/${company.slug}`
      : "https://www.ycombinator.com/companies?query=robotics";

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(company.website),
        city: location.city,
        state: location.state ? [location.state] : [],
        country: location.country ? [location.country] : [],
        status: "Pending",
        short_description: description,
        product_type: productTypesFromText(text),
        targeted_industries: unique([
          ...ycIndustries.map(mapIndustryLabel),
          company.industry ? mapIndustryLabel(company.industry) : null,
          company.subindustry ? mapIndustryLabel(company.subindustry) : null,
          ...industriesFromText(text),
        ]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        team_size: Number.isFinite(teamSize) ? teamSize : null,
        remote_first: /remote/i.test(String(company.location ?? "")),
        tags: unique([
          "Y Combinator company",
          "YC robotics keyword match",
          company.batch ? `YC batch: ${company.batch}` : null,
          company.stage ? `YC stage: ${company.stage}` : null,
          company.status ? `YC status: ${company.status}` : null,
          launchYear ? `YC launched: ${launchYear}` : null,
          Number.isFinite(teamSize) ? `YC team size: ${teamSize}` : null,
          company.isHiring ? "YC hiring" : null,
          company.top_company ? "YC top company" : null,
          ...ycTags.map((tag) => `YC tag: ${tag}`),
          ...ycIndustries.map((industry) => `YC industry: ${industry}`),
          ...evidenceQueries.map((query) => `YC match ${query}`),
        ]),
        source_namespace: "yc_robotics_startup",
        source_record_id: String(company.id ?? company.objectID ?? slugify(profileUrl)),
        source_name: "Y Combinator Robotics Startup Search",
        source_type: "public_accelerator_startup_directory_search_api",
        source_url: profileUrl,
        source_confidence: 74,
        extraction_method: "algolia_public_company_search_robotics_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractTechstarsRoboticsStartups(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const companyName = cleanCompanyName(company.company_name);
    if (!companyName) continue;

    const verticals = valuesList(company.industry_vertical);
    const programs = valuesList(company.program_names);
    const evidenceQueries = valuesList(company.evidence_queries);
    const description = cleanCompanyName(company.brief_description);
    const text = [
      companyName,
      description,
      programs.join(" "),
      company.city,
      company.country,
    ].join(" ");
    if (!isRoboticsCompanyText(text)) continue;

    const firstSessionYear = Number(company.first_session_year);
    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(company.website),
        linkedin_url: cleanUrl(company.linkedin_url),
        city: cleanCompanyName(company.city),
        state: company.state_province ? [cleanCompanyName(company.state_province)] : [],
        country: company.country ? [countryLabelToDbValue(company.country)] : [],
        status: "Pending",
        short_description: description,
        product_type: productTypesFromText(text),
        targeted_industries: unique([
          ...verticals.map(mapIndustryLabel),
          ...industriesFromText(text),
        ]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        tags: unique([
          "Techstars portfolio company",
          "Techstars robotics/drones match",
          Number.isInteger(firstSessionYear) ? `Techstars first session year: ${firstSessionYear}` : null,
          company.is_accelerator_company ? "Techstars accelerator company" : null,
          company.is_network_company ? "Techstars network company" : null,
          company.worldregion ? `Techstars world region: ${company.worldregion}` : null,
          company.worldsubregion ? `Techstars world subregion: ${company.worldsubregion}` : null,
          ...verticals.map((vertical) => `Techstars vertical: ${vertical}`),
          ...programs.map((program) => `Techstars program: ${program}`),
          ...evidenceQueries.map((query) => `Techstars match ${query}`),
        ]),
        source_namespace: "techstars_robotics_startup",
        source_record_id: String(company.company_id ?? slugify(companyName)),
        source_name: "Techstars Robotics and Drones Portfolio",
        source_type: "public_accelerator_startup_directory_search_api",
        source_url: "https://www.techstars.com/portfolio",
        source_confidence: 72,
        extraction_method: "typesense_public_portfolio_robotics_vertical_and_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractHaxRoboticsStartups(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const terms = uniqueTerms(Array.isArray(company.terms) ? company.terms : []);
    const categoryLabels = terms.filter((term) => term.facet === "categories").map((term) => term.label);
    if (!categoryLabels.some((label) => /robotics?/i.test(label))) continue;

    const companyName = cleanCompanyName(company.company_name);
    const description = cleanCompanyName(company.short_description || company.tagline);
    const text = `${companyName} ${description} ${terms.map((term) => term.label).join(" ")}`;
    const location = haxLocationFields(terms);

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(company.website_url),
        linkedin_url: cleanUrl(company.linkedin_url),
        city: location.city,
        state: location.state ? [location.state] : [],
        country: location.country ? [location.country] : [],
        status: "Pending",
        short_description: description,
        image_url: cleanUrl(company.image_url),
        product_type: unique(["Robot or automated system", ...productTypesFromText(text)]),
        targeted_industries: unique([
          ...terms
            .filter((term) => ["categories", "trends"].includes(term.facet))
            .map((term) => mapIndustryLabel(term.label)),
          ...industriesFromText(text),
        ]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        people: valuesList(company.people),
        tags: unique([
          "HAX robotics startup",
          "SOSV HAX portfolio company",
          ...terms.map((term) => `HAX ${term.facet}: ${term.label}`),
          company.profile_error ? `HAX profile fetch error: ${company.profile_error}` : null,
        ]),
        source_namespace: "hax_robotics_startup",
        source_record_id: slugify(company.profile_url ?? companyName),
        source_name: "HAX Robotics Startup Directory",
        source_type: "public_hardtech_accelerator_startup_directory",
        source_url: company.profile_url ?? SOURCES.haxRoboticsStartups.url,
        source_confidence: 78,
        extraction_method: "facetwp_robotics_category_profile_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractJStartupRobotics(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const categories = valuesList(company.categories);
    const companyName = cleanCompanyName(company.company_name);
    const description = cleanCompanyName(company.short_description);
    const text = `${companyName} ${description} ${categories.join(" ")}`;
    if (!categories.some((category) => /^robot$/i.test(category)) && !isRoboticsText(text)) continue;

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(company.website_url),
        city: null,
        country: ["Japan"],
        status: "Pending",
        short_description: description,
        image_url: cleanUrl(company.image_url),
        product_type: unique(["Robot or automated system", ...productTypesFromText(text)]),
        targeted_industries: industriesFromText(text),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        tags: unique([
          "J-Startup selected startup",
          "J-Startup robotics category",
          company.corporate_number ? `Japan corporate number: ${company.corporate_number}` : null,
          ...categories.map((category) => `J-Startup category: ${category}`),
          company.profile_error ? `J-Startup profile fetch error: ${company.profile_error}` : null,
        ]),
        source_namespace: "jstartup_robotics_startup",
        source_record_id: slugify(company.profile_url ?? companyName),
        source_name: "J-Startup Robotics Startup Directory",
        source_type: "public_national_startup_directory",
        source_url: company.profile_url ?? SOURCES.jStartupRobotics.url,
        source_confidence: 78,
        extraction_method: "official_jstartup_robot_category_profile_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractSosvRoboticsCompanies(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const companyName = cleanCompanyName(company.title?.rendered);
    if (!companyName) continue;

    const acf = company.acf ?? {};
    const evidenceQueries = valuesList(company.evidence_queries);
    const description = cleanCompanyName(
      acf.demo_day_description
        ? htmlToText(acf.demo_day_description)
        : acf.tagline || htmlToText(company.content?.rendered || company.excerpt?.rendered || ""),
    );
    const classValues = valuesList(company.class_list);
    const classLabels = classValues
      .filter((value) => /^tx_(cohort|category|trend|stage|region|location|program)-/i.test(value))
      .map((value) => labelFromSlug(String(value).replace(/^tx_[^-]+-/i, "")));
    const industryLabels = classValues
      .filter((value) => /^tx_(category|trend)-/i.test(value))
      .map((value) => labelFromSlug(String(value).replace(/^tx_[^-]+-/i, "")));
    const text = `${companyName} ${description} ${acf.tagline ?? ""} ${acf.demo_day_company_details ?? ""} ${classLabels.join(" ")}`;
    const roboticsSignal =
      valuesList(company.tx_category).map(String).includes(SOSV_ROBOTICS_CATEGORY_ID) || isRoboticsCompanyText(text);
    if (!roboticsSignal) continue;

    const location = sosvLocationFields(company);
    const founded = yearFromValue(acf.founded_year);
    const totalCapitalRaised = numberFromValue(acf.total_capital_raised);
    const dilutiveFunding = cleanCompanyName(acf.demo_day_dilutive_funding);
    const seeking = cleanCompanyName(acf.demo_day_seeking);

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(acf.website),
        linkedin_url: cleanUrl(acf.linked_in),
        city: location.city,
        state: location.state ? [location.state] : [],
        country: location.country ? [location.country] : [],
        founded,
        employee_range: cleanCompanyName(acf.employee_count_range),
        funding_raised_usd: totalCapitalRaised,
        status: "Pending",
        short_description: description || cleanCompanyName(acf.tagline),
        image_url: cleanUrl(acf.logo_url || acf.hero_url),
        product_type: productTypesFromText(text),
        targeted_industries: unique([...industryLabels.map(mapIndustryLabel), ...industriesFromText(text)]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        tags: unique([
          "SOSV portfolio company",
          valuesList(company.tx_category).map(String).includes(SOSV_ROBOTICS_CATEGORY_ID) ? "SOSV Robotics category" : null,
          ...classLabels.map((label) => `SOSV taxonomy: ${label}`),
          ...evidenceQueries.map((query) => `SOSV match ${query}`),
          acf.demo_day_investment_goal ? `SOSV investment goal: ${cleanCompanyName(acf.demo_day_investment_goal)}` : null,
          dilutiveFunding ? `SOSV dilutive funding: ${dilutiveFunding}` : null,
          seeking ? `SOSV seeking: ${seeking}` : null,
        ]),
        source_namespace: "sosv_robotics_company",
        source_record_id: String(company.id ?? company.slug ?? slugify(companyName)),
        source_name: "SOSV Robotics Portfolio",
        source_type: "public_accelerator_startup_directory_api",
        source_url: cleanUrl(company.link) ?? SOURCES.sosvRoboticsCompanies.url,
        source_confidence: 78,
        extraction_method: "wp_json_company_robotics_category_and_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractPlugAndPlayRoboticsStartups(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const startup of companies) {
    const companyName = cleanCompanyName(startup.startupTitle);
    if (!companyName) continue;

    const description = cleanCompanyName(startup.startupDescription || startup.startupOneLiner);
    const industries = unique([
      startup.startupMainIndustry?.industryTitle,
      ...extractNestedIndustryLabels(startup.startupIndustriesList),
    ].filter(Boolean).map(cleanCompanyName));
    const evidenceQueries = valuesList(startup.evidence_queries);
    const text = `${companyName} ${startup.startupOneLiner ?? ""} ${description} ${industries.join(" ")}`;
    if (!isRoboticsCompanyText(text)) continue;

    const country = countryLabelToDbValue(startup.startupCountry?.countryName);
    const city = cleanCompanyName(startup.startupLocation?.locationCity);
    const stateLabel = cleanCompanyName(startup.startupLocation?.locationState);
    const state = stateLabel && stateLabel !== country ? stateLabel : null;

    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(startup.startupWebsite),
        city,
        state: state ? [state] : [],
        country: country ? [country] : [],
        status: "Pending",
        short_description: description || cleanCompanyName(startup.startupOneLiner),
        image_url: cleanUrl(startup.startupLogo),
        product_type: productTypesFromText(text),
        targeted_industries: unique([...industries.map(mapIndustryLabel), ...industriesFromText(text)]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        tags: unique([
          "Plug and Play portfolio startup",
          startup.startupAccelerated ? "Plug and Play accelerated" : null,
          startup.startupPortfolio ? "Plug and Play portfolio" : null,
          startup.startupUnicorn ? "Plug and Play unicorn" : null,
          startup.startupExit ? "Plug and Play exit" : null,
          ...industries.map((industry) => `Plug and Play industry: ${industry}`),
          ...evidenceQueries.map((query) => `Plug and Play match ${query}`),
        ]),
        source_namespace: "plug_and_play_robotics_startup",
        source_record_id: String(startup["@id"] ?? startup.startupPlaybookID ?? startup.slug ?? slugify(companyName)),
        source_name: "Plug and Play Robotics Startup Search",
        source_type: "public_accelerator_startup_directory_api",
        source_url: cleanUrl(startup["@link"]) ?? SOURCES.plugAndPlayRoboticsStartups.url,
        source_confidence: 72,
        extraction_method: "magnolia_delivery_api_robotics_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractAlchemistRoboticsStartups(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const attributes = company.attributes ?? {};
    const meta = company.meta ?? {};
    const companyName = cleanCompanyName(attributes.name);
    if (!companyName) continue;

    const description = cleanCompanyName(meta.startup_solution || meta.oneliner || meta.description);
    const teamDescription = cleanCompanyName(meta.startup_teamdescription);
    const evidenceQueries = valuesList(company.evidence_queries);
    const text = `${companyName} ${description} ${teamDescription} ${meta.startup_problem ?? ""} ${meta.traction ?? ""}`;
    if (!isRoboticsCompanyText(text)) continue;

    const location = locationFieldsFromLabel(meta.location_formatted_address);
    const totalRaise = numberFromValue(meta.startup_totalraise);

    rows.push(
      compactRecord({
        company_name: companyName,
        city: location.city,
        state: location.state ? [location.state] : [],
        country: location.country ? [location.country] : [],
        employee_range: cleanCompanyName(meta.nrofemployees),
        funding_raised_usd: totalRaise,
        last_round_stage: cleanCompanyName(meta.last_round_stage),
        status: "Pending",
        short_description: description || cleanCompanyName(meta.oneliner),
        product_type: productTypesFromText(text),
        targeted_industries: industriesFromText(text),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        people: teamDescription ? valuesList(teamDescription.split(/;|\n/)) : [],
        tags: unique([
          "Alchemist Accelerator company",
          meta.status ? `Alchemist status: ${cleanCompanyName(meta.status)}` : null,
          meta.aclass_id ? `Alchemist class id: ${meta.aclass_id}` : null,
          meta.startup_lastraise_date ? `Alchemist last raise date: ${meta.startup_lastraise_date}` : null,
          totalRaise ? `Alchemist total raise USD: ${totalRaise}` : null,
          meta.last_round_stage ? `Alchemist round: ${cleanCompanyName(meta.last_round_stage)}` : null,
          ...evidenceQueries.map((query) => `Alchemist match ${query}`),
        ]),
        source_namespace: "alchemist_robotics_startup",
        source_record_id: String(company.id ?? attributes.slug ?? slugify(companyName)),
        source_name: "Alchemist Accelerator Robotics Startup Search",
        source_type: "public_accelerator_startup_directory_api",
        source_url: company.links?.self ?? SOURCES.alchemistRoboticsStartups.url,
        source_confidence: 72,
        extraction_method: "vault_api_robotics_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractSkydeckRoboticsStartups(json) {
  const companies = json?.companies;
  if (!Array.isArray(companies)) return [];

  const rows = [];
  for (const company of companies) {
    const companyName = cleanCompanyName(company.post_title);
    if (!companyName) continue;

    const description = cleanCompanyName(company.post_excerpt || company.content);
    const evidenceQueries = valuesList(company.evidence_queries);
    const text = `${companyName} ${description} ${evidenceQueries.join(" ")}`;
    if (!isRoboticsCompanyText(text)) continue;

    rows.push(
      compactRecord({
        company_name: companyName,
        status: "Pending",
        short_description: description,
        product_type: productTypesFromText(text),
        targeted_industries: industriesFromText(text),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        tags: unique([
          "Berkeley SkyDeck portfolio company",
          company.post_date_formatted ? `SkyDeck post date: ${company.post_date_formatted}` : null,
          ...evidenceQueries.map((query) => `SkyDeck match ${query}`),
        ]),
        source_namespace: "skydeck_robotics_startup",
        source_record_id: String(company.post_id ?? company.objectID ?? slugify(companyName)),
        source_name: "Berkeley SkyDeck Robotics Startup Search",
        source_type: "public_accelerator_startup_directory_search_api",
        source_url: cleanUrl(company.permalink) ?? SOURCES.skydeckRoboticsStartups.url,
        source_confidence: 62,
        extraction_method: "algolia_public_company_search_robotics_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractEntrepreneurFirstRoboticsPortfolio(html) {
  const cards = parseEntrepreneurFirstCards(html);
  const rows = [];

  for (const company of cards) {
    const companyName = cleanCompanyName(company.company_name);
    if (!companyName) continue;

    const text = `${companyName} ${company.short_description ?? ""} ${company.categories.join(" ")} ${company.people.join(" ")}`;
    const roboticsSignal = company.categories.some((category) => /robotics?/i.test(category)) || isRoboticsCompanyText(text);
    if (!roboticsSignal) continue;

    const location = locationFieldsFromLabel(company.location);
    rows.push(
      compactRecord({
        company_name: companyName,
        city: location.city ?? cleanCompanyName(company.location),
        state: location.state ? [location.state] : [],
        country: location.country ? [location.country] : [],
        founded: company.founded,
        status: "Pending",
        short_description: company.short_description,
        product_type: productTypesFromText(text),
        targeted_industries: unique([...company.categories.map(mapIndustryLabel), ...industriesFromText(text)]),
        robot_or_automated_system_type: robotTypesFromText(text),
        hardware_component_type: hardwareTypesFromText(text),
        software_type: softwareTypesFromText(text),
        people: company.people,
        tags: unique([
          "Entrepreneur First portfolio company",
          ...company.categories.map((category) => `EF industry: ${category}`),
          company.funded_by ? `EF funded by: ${company.funded_by}` : null,
          company.exited_to ? `EF exited to: ${company.exited_to}` : null,
        ]),
        source_namespace: "entrepreneur_first_robotics_company",
        source_record_id: company.slug ?? slugify(companyName),
        source_name: "Entrepreneur First Robotics Portfolio",
        source_type: "public_accelerator_startup_directory_html",
        source_url: `${SOURCES.entrepreneurFirstRoboticsPortfolio.url}#${company.slug ?? slugify(companyName)}`,
        source_confidence: 70,
        extraction_method: "portfolio_html_robotics_category_and_keyword_filter",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractBaraCategory(html, options) {
  const sourceUrl = SOURCES[options.sourceKey].url;
  const rows = [];

  for (const match of html.matchAll(/<a\s+href="(\/company-listings\/[^"]+)"\s+class="item">([\s\S]*?)<\/a>/gi)) {
    const companyName = cleanCompanyName(htmlToText(match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ""));
    if (!companyName) continue;

    const profileUrl = absoluteUrl(match[1], sourceUrl);
    rows.push(
      compactRecord({
        company_name: companyName,
        status: "Pending",
        country: ["United Kingdom"],
        product_type: ["Robot or automated system"],
        targeted_industries: ["Manufacturing", "Robotics development"],
        tags: [options.tag, "Automate UK product finder"],
        source_namespace: options.namespace,
        source_record_id: slugify(profileUrl ?? companyName),
        source_name: options.sourceName,
        source_type: "robotics_automation_product_finder_category",
        source_url: profileUrl ?? sourceUrl,
        source_confidence: 66,
        extraction_method: "html_product_finder_category_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractPittsburghRoboticsMembers(html) {
  const pageUrl = SOURCES.pittsburghRoboticsMembers.url;
  const headings = [...html.matchAll(/<h3[^>]*>([^<]*Members)<br\s*\/?><\/h3>/gi)].map((match) => ({
    tier: cleanCompanyName(htmlToText(match[1])),
    index: match.index ?? 0,
  }));
  const rows = [];

  for (const match of html.matchAll(/<a\s+aria-label="external link to partner"\s+href="([^"]+)"[^>]*class="partner-link[\s\S]*?<\/a>/gi)) {
    const block = match[0];
    const companyName = cleanCompanyName(
      htmlToText(block.match(/alt="([^"]+)"/i)?.[1] ?? block.match(/<div class="text-weight-bold">([\s\S]*?)<\/div>/i)?.[1] ?? ""),
    );
    if (!companyName || !isCommercialOrganisationName(companyName)) continue;

    const tier = nearestPittsburghTier(headings, match.index ?? 0);
    rows.push(
      compactRecord({
        company_name: companyName,
        website_url: cleanUrl(match[1]),
        status: "Pending",
        country: ["United States"],
        state: ["Pennsylvania"],
        product_type: productTypesFromText(companyName),
        targeted_industries: ["Robotics development"],
        tags: unique(["Pittsburgh Robotics Network member", tier ? `PRN tier: ${tier}` : null]),
        source_namespace: "pittsburgh_robotics_member",
        source_record_id: slugify(`${companyName}-${match[1]}`),
        source_name: "Pittsburgh Robotics Network Members",
        source_type: "regional_robotics_cluster_member_directory",
        source_url: pageUrl,
        source_confidence: 68,
        extraction_method: "webflow_member_logo_parse",
      }),
    );
  }

  return dedupeSourceRows(rows);
}

function extractSiliconValleyRoboticsMembers(json) {
  const members = json?.usr;
  if (!Array.isArray(members)) return [];

  const rows = members.map((member) =>
    compactRecord({
      company_name: cleanCompanyName(member.nam),
      status: "Pending",
      short_description: htmlToText(member.cnm ?? ""),
      country: ["United States"],
      state: ["California"],
      targeted_industries: ["Robotics development"],
      product_type: productTypesFromText(`${member.nam} ${member.cnm ?? ""}`),
      tags: ["Silicon Valley Robotics member"],
      source_namespace: "silicon_valley_robotics_member",
      source_record_id: member.uid,
      source_name: "Silicon Valley Robotics Member Directory",
      source_type: "regional_robotics_cluster_member_directory_api",
      source_url: "https://www.svrobo.org/membership/",
      source_confidence: 66,
      extraction_method: "membershipworks_directory_api",
    }),
  );

  return dedupeSourceRows(rows);
}

function taxonomyFromMassRobotics(techSlugs) {
  const productType = [];
  const robotTypes = [];
  const hardwareTypes = [];
  const softwareTypes = [];

  if (techSlugs.includes("ai")) softwareTypes.push("AI model");
  if (techSlugs.includes("autonomy")) softwareTypes.push("Autonomous mobility");
  if (techSlugs.includes("software")) productType.push("Software");
  if (techSlugs.includes("components")) hardwareTypes.push("Controller");
  if (techSlugs.includes("sensors")) hardwareTypes.push("Sensor – Misc");
  if (techSlugs.includes("arms-grippers")) {
    productType.push("Hardware component");
    hardwareTypes.push("End-effector");
    robotTypes.push("Robotic arm – Articulated");
  }
  if (techSlugs.includes("drones")) robotTypes.push("Aerial drone");
  if (techSlugs.includes("ground-vehicles")) robotTypes.push("Mobile robot");
  if (techSlugs.includes("marine")) robotTypes.push("Surface water drone");
  if (techSlugs.includes("automation")) robotTypes.push("Automated system – Other");

  if (robotTypes.length) productType.push("Robot or automated system");
  if (hardwareTypes.length && !productType.includes("Hardware component")) {
    productType.push("Hardware component");
  }
  if (softwareTypes.length && !productType.length) productType.push("Robot software");

  return {
    productType: unique(productType),
    robotTypes: unique(robotTypes),
    hardwareTypes: unique(hardwareTypes),
    softwareTypes: unique(softwareTypes),
  };
}

function taxonomyFromRosType(memberType, repositoryUrl) {
  const type = String(memberType ?? "").toLowerCase();
  const productType = [];
  const industries = ["Manufacturing", "Robotics development"];
  const robotTypes = [];
  const hardwareTypes = [];
  const softwareTypes = [];

  if (/\b(oem|robot manufacturer|robot oem|collaborative industrial robots|automation equipment)\b/i.test(type)) {
    productType.push("Robot or automated system");
    robotTypes.push("Automated system – Other");
  }
  if (/\b(system integrator|solution provider|consult|engineering services|training provider)\b/i.test(type)) {
    productType.push("On-demand robotics or automation development");
  }
  if (/\b(software|operating systems|middleware|development tools|it services)\b/i.test(type) || repositoryUrl) {
    productType.push("Robot software");
    softwareTypes.push("API");
  }
  if (/\b(component|semiconductor|sensor|motion|controller|equipment)\b/i.test(type)) {
    productType.push("Hardware component");
    hardwareTypes.push("Controller");
  }
  if (!productType.length) productType.push("Other");

  return {
    productType: unique(productType),
    industries: unique(industries),
    robotTypes: unique(robotTypes),
    hardwareTypes: unique(hardwareTypes),
    softwareTypes: unique(softwareTypes),
  };
}

function rosDescription(name, memberType) {
  if (!memberType) return `${name} is listed as a current ROS-Industrial member.`;
  return `${name} is listed as a current ROS-Industrial member with type "${memberType}".`;
}

function nearestTier(headings, index) {
  let tier = null;
  for (const heading of headings) {
    if (heading.index > index) break;
    tier = heading.tier;
  }
  return tier;
}

function extractWebsite(segment) {
  const websiteBlock = extractStrongBlock(segment, "Website");
  if (!websiteBlock) return null;

  const visibleText = htmlToText(websiteBlock);
  if (/^https?:?$/i.test(visibleText)) return null;
  if (/^https?:\/\/[^ ]+\.[^ ]+/i.test(visibleText)) return cleanUrl(visibleText);

  const href = websiteBlock.match(/href="([^"]+)"/i)?.[1];
  return cleanUrl(href ?? visibleText);
}

function extractLabeledHref(segment, label) {
  const block = extractStrongBlock(segment, label);
  if (!block) return null;
  return cleanUrl(block.match(/href="([^"]+)"/i)?.[1] ?? null);
}

function extractStrongValue(segment, label) {
  const block = extractStrongBlock(segment, label);
  return block ? htmlToText(block) : null;
}

function extractStrongBlock(segment, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<strong>\\s*${escaped}\\s*:?\\s*<\\/strong>\\s*([\\s\\S]*?)(?=<br\\s*\\/?>|<\\/p>|<strong>)`,
    "i",
  );
  return segment.match(pattern)?.[1] ?? null;
}

function firstParagraphAfterHeading(segment) {
  const afterHeading = segment.replace(/^[\s\S]*?<\/h1>/i, "");
  const match = afterHeading.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return match ? htmlToText(match[1]) : null;
}

function htmlToText(value) {
  return decodeHtml(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanUrl(value) {
  if (!value) return null;

  const cleaned = decodeHtml(value)
    .trim()
    .replace(/^["'[\s]+|["'\]\s]+$/g, "")
    .replace(/%5D%5B\d+$/i, "")
    .replace(/\]\[\d+$/i, "")
    .replace(/\/\]\[\d+$/i, "/");

  if (!cleaned || /^(mailto|tel|javascript|data):/i.test(cleaned)) return null;
  const normalized = normalizeUrl(cleaned);
  if (typeof normalized !== "string" || !/^https?:\/\//i.test(normalized)) return null;

  try {
    const url = new URL(normalized);
    if (!url.hostname.includes(".")) return null;
    return normalized;
  } catch {
    return null;
  }
}

function absoluteUrl(value, base) {
  if (!value) return null;
  const decoded = decodeHtml(value).trim();
  if (!decoded) return null;
  try {
    return new URL(decoded, base).toString();
  } catch {
    return null;
  }
}

function parseA3Location(location) {
  if (!location) return {};
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return {};

  const country = countryLabelToDbValue(parts.at(-1));
  const fields = {};
  if (country) fields.country = [country];
  if (parts.length === 2 && country === "United States") fields.state = [parts[0]];
  if (parts.length >= 3) {
    fields.city = parts[0];
    fields.state = [parts[1]];
  }
  return fields;
}

function inferCountriesFromText(text) {
  const countries = [];
  const rules = [
    [/\bAmerican\b|\bUS\b|\bUnited States\b/i, "United States"],
    [/\bChinese\b|\bChina\b/i, "China"],
    [/中国|中華人民共和國|中华人民共和国|中國|深圳|上海|杭州|北京|苏州|蘇州|广州|廣州|广东|廣東|浙江/i, "China"],
    [/\bHong Kong\b/i, "Hong Kong"],
    [/香港/i, "Hong Kong"],
    [/台灣|台湾|臺灣/i, "Taiwan"],
    [/\bCanadian\b|\bCanada\b/i, "Canada"],
    [/\bJapanese\b|\bJapan\b/i, "Japan"],
    [/日本/i, "Japan"],
    [/\bSouth Korean\b|\bKorean\b/i, "South Korea"],
    [/韩国|韓國/i, "South Korea"],
    [/\bFrench\b|\bFrance\b/i, "France"],
    [/\bBritish\b|\bUnited Kingdom\b|\bUK\b/i, "United Kingdom"],
    [/\bItalian\b|\bItaly\b/i, "Italy"],
    [/\bGerman\b|\bGermany\b/i, "Germany"],
    [/\bDanish\b|\bDenmark\b/i, "Denmark"],
    [/\bAustralian\b|\bAustralia\b|\bPerth\b/i, "Australia"],
    [/\bAustrian\b|\bAustria\b/i, "Austria"],
  ];

  for (const [pattern, country] of rules) {
    if (pattern.test(text)) countries.push(country);
  }

  return unique(countries);
}

function inferWrcCountries(companyName, text) {
  const countries = inferCountriesFromText(text);
  if (
    /[\u3400-\u9fff]/.test(companyName)
    && /(有限公司|股份|公司|科技|机器人|機器人|智能|智造|创新中心|創新中心|研究院)/.test(companyName)
  ) {
    countries.push("China");
  }

  return unique(countries);
}

function cordisProjectHits(json) {
  return toArray(json?.result?.hits?.hit).filter((hit) => hit?.project);
}

function cordisOrganizations(project) {
  return toArray(project?.relations?.associations?.organization);
}

function cordisCategoryLabels(project) {
  return toArray(project?.categories?.category)
    .map((category) => cleanCompanyName(category?.title))
    .filter(Boolean);
}

function cordisOrgActivityCode(organisation) {
  return toArray(organisation?.relations?.categories?.category)
    .map((category) => category?.code)
    .find(Boolean) ?? null;
}

function cordisProjectWebsite(project) {
  const links = toArray(project?.relations?.associations?.webLink);
  return links.map((link) => cleanUrl(link?.physUrl)).find(Boolean) ?? null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function isoDateValue(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countryCodeToName(value) {
  if (!value) return null;
  const countries = {
    AL: "Albania",
    AM: "Armenia",
    AT: "Austria",
    AU: "Australia",
    BA: "Bosnia and Herzegovina",
    BE: "Belgium",
    BG: "Bulgaria",
    BR: "Brazil",
    CA: "Canada",
    CH: "Switzerland",
    CN: "China",
    CY: "Cyprus",
    CZ: "Czechia",
    DE: "Germany",
    DK: "Denmark",
    EE: "Estonia",
    EL: "Greece",
    ES: "Spain",
    FI: "Finland",
    FR: "France",
    GB: "United Kingdom",
    GR: "Greece",
    HR: "Croatia",
    HU: "Hungary",
    IE: "Ireland",
    IL: "Israel",
    IN: "India",
    IS: "Iceland",
    IT: "Italy",
    JP: "Japan",
    KR: "South Korea",
    LT: "Lithuania",
    LU: "Luxembourg",
    LV: "Latvia",
    MT: "Malta",
    NL: "Netherlands",
    NO: "Norway",
    PL: "Poland",
    PT: "Portugal",
    RO: "Romania",
    RS: "Serbia",
    SE: "Sweden",
    SI: "Slovenia",
    SK: "Slovakia",
    TR: "Turkey",
    TW: "Taiwan",
    UA: "Ukraine",
    US: "United States",
    ZA: "South Africa",
  };
  return countries[String(value).toUpperCase()] ?? null;
}

function countryLabelToDbValue(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  const aliases = {
    中国: "China",
    中國: "China",
    美国: "United States",
    美國: "United States",
    德国: "Germany",
    德國: "Germany",
    日本: "Japan",
    韩国: "South Korea",
    韓國: "South Korea",
    新加坡: "Singapore",
    台湾: "Taiwan",
    台灣: "Taiwan",
    "People's Republic of China": "China",
    "United States of America": "United States",
    USA: "United States",
    US: "United States",
    "U.S.": "United States",
    UK: "United Kingdom",
    "Republic of Korea": "South Korea",
    "Korea, Republic of": "South Korea",
    "Viet Nam": "Vietnam",
    Türkiye: "Turkey",
  };
  return aliases[normalized] ?? normalized;
}

function cematCityFromText(value) {
  const text = String(value ?? "");
  const rules = [
    [/北京|Beijing/i, "Beijing"],
    [/上海|Shanghai/i, "Shanghai"],
    [/深圳|Shenzhen/i, "Shenzhen"],
    [/杭州|Hangzhou/i, "Hangzhou"],
    [/苏州|蘇州|Suzhou/i, "Suzhou"],
    [/广州|廣州|Guangzhou/i, "Guangzhou"],
    [/南京|Nanjing/i, "Nanjing"],
    [/宁波|寧波|Ningbo/i, "Ningbo"],
    [/青岛|青島|Qingdao/i, "Qingdao"],
    [/成都|Chengdu/i, "Chengdu"],
    [/无锡|無錫|Wuxi/i, "Wuxi"],
    [/常州|Changzhou/i, "Changzhou"],
    [/天津|Tianjin/i, "Tianjin"],
    [/重庆|重慶|Chongqing/i, "Chongqing"],
    [/郑州|鄭州|Zhengzhou/i, "Zhengzhou"],
    [/合肥|Hefei/i, "Hefei"],
    [/厦门|廈門|Xiamen/i, "Xiamen"],
  ];

  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function yearFromWikidataDate(value) {
  if (!value) return null;
  const year = Number(String(value).slice(0, 4));
  return Number.isInteger(year) && year > 1700 ? year : null;
}

function yearFromDate(value) {
  if (!value) return null;
  const year = Number(String(value).slice(0, 4));
  return Number.isInteger(year) && year > 1700 ? year : null;
}

function yearFromUnixTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10 ** 12 ? numeric * 1000 : numeric;
  const year = new Date(milliseconds).getUTCFullYear();
  return Number.isInteger(year) && year > 1970 ? year : null;
}

function preferredUrl(values) {
  const urls = unique(values).filter(Boolean);
  if (!urls.length) return null;

  return urls.sort((a, b) => {
    const aScore = urlPreferenceScore(a);
    const bScore = urlPreferenceScore(b);
    return bScore - aScore || a.length - b.length;
  })[0];
}

function urlPreferenceScore(value) {
  try {
    const url = new URL(value);
    let score = 0;
    if (url.protocol === "https:") score += 10;
    if (!/^([a-z]{2}|www)\./i.test(url.hostname)) score += 2;
    if (url.hostname.startsWith("www.")) score += 1;
    if (url.pathname === "/" || url.pathname === "") score += 4;
    return score;
  } catch {
    return 0;
  }
}

function cleanWikipediaTitle(value) {
  return String(value ?? "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .trim();
}

function cleanCompanyName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function isCompanyLikeName(value) {
  if (!value || value.length < 2) return false;
  if (/^(inquiry|tel|fax|member list|internal links)$/i.test(value)) return false;
  if (/kikaishinko bldg|shibakoen|minato-ku|tokyo 105/i.test(value)) return false;
  return true;
}

function isCommercialOrganisationName(value) {
  const name = cleanCompanyName(value);
  if (!name) return false;
  if (/\b(university|college|school|institute|laboratory|lab\b|hospital|nhs|foundation|association|society|council|catapult|centre|center|consortium|collaborative|research institute)\b/i.test(name)) {
    return false;
  }

  return /\b(robotics?|autonomous|automation|drone|uav|cobot|mechat|surgical|technology|technologies|engineering|systems?|solutions?|ai)\b/i.test(name)
    || /\b(ltd|limited|inc|incorporated|gmbh|srl|sas|bv|plc|llc|corp|corporation|company)\b/i.test(name);
}

function firstAddress(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function countryFromUkriAddress(address) {
  if (!address) return null;
  if (address.country) return countryLabelToDbValue(address.country);
  const postcode = String(address.postCode ?? "").trim();
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode)) return "United Kingdom";
  if (address.region && address.region !== "Unknown") return "United Kingdom";
  return null;
}

function httpsUrl(value) {
  const url = cleanUrl(value);
  return url?.replace(/^http:\/\//i, "https://") ?? null;
}

function cleanOpenAlexName(value) {
  return cleanCompanyName(String(value ?? "").replace(/\s*\((?:[^()]*)\)\s*$/g, ""));
}

function eicDescriptionValue(card, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<dt class="ecl-description-list__term">\\s*${escaped}\\s*<\\/dt>\\s*<dd[\\s\\S]*?<li class="ecl-description-list__definition-item">([\\s\\S]*?)<\\/li>`,
    "i",
  );
  return cleanCompanyName(htmlToText(card.match(pattern)?.[1] ?? ""));
}

function termNames(value) {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => (typeof item === "string" ? item : item?.name)));
}

function valuesList(value) {
  if (!Array.isArray(value)) {
    if (value === null || value === undefined || value === "") return [];
    return [String(value).trim()].filter(Boolean);
  }

  return unique(
    value.map((item) => {
      if (item === null || item === undefined) return null;
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        return String(item);
      }
      return item.name ?? item.label ?? item.title ?? null;
    }),
  );
}

function parseYcLocation(company) {
  const locations = valuesList(company.all_locations);
  const locationText = locations[0] || company.location || "";
  const parts = String(locationText)
    .split(",")
    .map((part) => cleanCompanyName(part))
    .filter(Boolean);
  const regions = valuesList(company.regions);
  const joined = `${parts.join(" ")} ${regions.join(" ")}`;
  const country =
    parseCountryFromLocationLabel(parts.at(-1))
    ?? regions.map(parseCountryFromLocationLabel).find(Boolean)
    ?? inferCountriesFromText(joined)[0];
  const state = parts.length >= 2 && country === "United States" ? parts.at(-2) : null;
  const city = parts.length >= 2 ? parts[0] : null;

  return {
    city: city && !/remote/i.test(city) ? city : null,
    state: state && !/usa|united states/i.test(state) ? state : null,
    country,
  };
}

function haxLocationFields(terms) {
  const labels = terms
    .filter((term) => term.facet === "location")
    .map((term) => cleanCompanyName(term.label));
  const country = labels.map(parseCountryFromLocationLabel).find(Boolean);
  const cityLabel = labels.find((label) => label && parseCountryFromLocationLabel(label) !== label);
  const city = cleanHaxCityLabel(cityLabel, country);
  const state = stateFromLocationLabel(cityLabel, country);

  return { city, state, country };
}

function parseCountryFromLocationLabel(value) {
  const label = cleanCompanyName(value);
  if (!label) return null;
  const normalized = countryLabelToDbValue(label);
  const directCountries = new Set([
    "Argentina",
    "Australia",
    "Austria",
    "Brazil",
    "Canada",
    "China",
    "Denmark",
    "Finland",
    "France",
    "Germany",
    "Hong Kong",
    "India",
    "Israel",
    "Italy",
    "Japan",
    "Netherlands",
    "Norway",
    "Peru",
    "Portugal",
    "Singapore",
    "South Korea",
    "Spain",
    "Sweden",
    "Switzerland",
    "Taiwan",
    "Turkey",
    "United Arab Emirates",
    "United Kingdom",
    "United States",
    "Vietnam",
  ]);
  if (directCountries.has(normalized)) return normalized;

  const rules = [
    [/\b(usa|u\.s\.|united states|california|new york|ny|nj|ma|md|ca|co|fl|georgia|delaware|boston|brooklyn|newark|miami|stonybrook|north bergen|palo alto|san francisco|los angeles|pasadena|pleasanton|fremont|superior|champaign|dayton|college park|oakland|san jose|atlanta|new haven|bloomington)\b/i, "United States"],
    [/\b(canada|vancouver|ottawa|bc)\b/i, "Canada"],
    [/\b(uk|united kingdom|england|london|edinburgh|bristol|oxford)\b/i, "United Kingdom"],
    [/\b(de|germany|berlin)\b/i, "Germany"],
    [/\b(au|australia|sydney)\b/i, "Australia"],
    [/\b(jpn|japan|tokyo)\b/i, "Japan"],
    [/\b(viet nam|vietnam)\b/i, "Vietnam"],
  ];

  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

function locationFieldsFromLabel(value) {
  const label = cleanCompanyName(value);
  if (!label) return {};

  const parts = label.split(",").map((part) => cleanCompanyName(part)).filter(Boolean);
  const country =
    parseCountryFromLocationLabel(label)
    ?? parseCountryFromLocationLabel(parts.at(-1))
    ?? inferCountriesFromText(label)[0];
  const state = stateFromLocationLabel(label, country) ?? (parts.length >= 3 && country === "United States" ? parts.at(-2) : null);
  const cityCandidate = parts[0];
  const city = cityCandidate && parseCountryFromLocationLabel(cityCandidate) !== cityCandidate ? cityCandidate : null;

  return {
    city: city && !/remote|global|worldwide/i.test(city) ? city : null,
    state: state && state !== country ? state : null,
    country,
  };
}

function sosvLocationFields(company) {
  const headquarters = cleanCompanyName(company?.acf?.demo_day_headquarters);
  const headquartersFields = locationFieldsFromLabel(headquarters);
  if (headquartersFields.country || headquartersFields.city) return headquartersFields;

  const labels = valuesList(company?.class_list)
    .filter((value) => /^tx_location-/i.test(value))
    .map((value) => labelFromSlug(String(value).replace(/^tx_location-/i, "")));
  const country = labels.map(parseCountryFromLocationLabel).find(Boolean);
  const cityLabel = labels.find((label) => label && parseCountryFromLocationLabel(label) !== label);

  return {
    city: cleanHaxCityLabel(cityLabel, country),
    state: stateFromLocationLabel(cityLabel, country),
    country,
  };
}

function cleanHaxCityLabel(value, country) {
  const label = cleanCompanyName(value);
  if (!label) return null;
  if (parseCountryFromLocationLabel(label) === label) return null;
  if (country === "United States") {
    return label
      .replace(/,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|IL|IN|MA|MD|MI|NJ|NY|OH|PA|TX|WA)$/i, "")
      .replace(/\s+(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|illinois|indiana|massachusetts|maryland|michigan|new jersey|new york|ohio|pennsylvania|texas|washington)$/i, "")
      .trim();
  }
  if (country === "United Kingdom") return label.replace(/,\s*UK$/i, "").replace(/\s+UK$/i, "").trim();
  if (country === "Canada") return label.replace(/,\s*(BC|Canada)$/i, "").trim();
  return label.replace(new RegExp(`,?\\s*${country}$`, "i"), "").trim() || null;
}

function stateFromLocationLabel(value, country) {
  if (country !== "United States") return null;
  const label = cleanCompanyName(value);
  const state = label.match(/,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|IL|IN|MA|MD|MI|NJ|NY|OH|PA|TX|WA)$/i)?.[1];
  if (state) return state.toUpperCase();

  const names = [
    [/california/i, "California"],
    [/new jersey/i, "New Jersey"],
    [/new york/i, "New York"],
    [/massachusetts/i, "Massachusetts"],
    [/maryland/i, "Maryland"],
    [/colorado/i, "Colorado"],
    [/florida/i, "Florida"],
    [/georgia/i, "Georgia"],
    [/indiana/i, "Indiana"],
    [/connecticut/i, "Connecticut"],
    [/delaware/i, "Delaware"],
  ];
  return names.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

function mapIndustryLabel(value) {
  const normalized = cleanCompanyName(value);
  const rules = [
    [/agriculture|food/i, "Agriculture"],
    [/energy/i, "Energy & Utilities"],
    [/environment/i, "Environmental"],
    [/health|medical|medtech|welfare/i, "Healthcare"],
    [/logistics|transport|maritime|marine/i, "Logistics"],
    [/manufactur|engineering|industrial electronics/i, "Manufacturing"],
    [/cloud|saas|ai|iot/i, "Robotics development"],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(normalized)) return label;
  }
  return normalized;
}

function extractNestedIndustryLabels(value, labels = []) {
  if (!value || typeof value !== "object") return labels;
  if (Array.isArray(value)) {
    for (const item of value) extractNestedIndustryLabels(item, labels);
    return unique(labels);
  }

  const industryTitle = cleanCompanyName(value.industryTitle);
  if (industryTitle) labels.push(industryTitle);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") extractNestedIndustryLabels(child, labels);
  }
  return unique(labels);
}

function parseEntrepreneurFirstCards(html) {
  const cards = [];
  for (const match of String(html ?? "").matchAll(/<div class="tile tile--company[\s\S]*?<\/div><!-- \/tile--company -->/gi)) {
    const block = match[0];
    const companyName = cleanCompanyName(block.match(/data-companyname="([^"]+)"/i)?.[1]);
    if (!companyName) continue;

    const slug = cleanCompanyName(block.match(/data-companyslug="([^"]+)"/i)?.[1]);
    const location = cleanCompanyName(htmlToText(block.match(/<a class='locationtag'[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""));
    const categories = [...block.matchAll(/<a class='categorytag'[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((category) => cleanCompanyName(htmlToText(category[1])))
      .filter(Boolean);
    const shortDescription = cleanCompanyName(
      htmlToText(block.match(/<div class="tile__description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""),
    );
    const founded = yearFromValue(
      block.match(/meta__row__name[^>]*>\s*Founded\s*<\/div>[\s\S]*?meta__row__name[^>]*>\s*([^<]+)\s*<\/div>/i)?.[1],
    );
    const fundedBy = cleanCompanyName(
      block.match(/meta__row__name[^>]*>\s*Funded by\s*<\/div>[\s\S]*?meta__row__name[^>]*>\s*([^<]+)\s*<\/div>/i)?.[1],
    );
    const exitedTo = cleanCompanyName(
      block.match(/meta__row__name[^>]*>\s*Exited to\s*<\/div>[\s\S]*?meta__row__name[^>]*>\s*([^<]+)\s*<\/div>/i)?.[1],
    );
    const people = [...block.matchAll(/meta__row__role[^>]*>\s*([\s\S]*?)<\/div>[\s\S]*?meta__row__founder[^>]*>\s*([\s\S]*?)<\/div>/gi)]
      .map((person) => {
        const role = cleanCompanyName(htmlToText(person[1]));
        const name = cleanCompanyName(htmlToText(person[2]));
        return name && role ? `${name} - ${role}` : name;
      })
      .filter(Boolean);

    cards.push({
      company_name: companyName,
      slug,
      location,
      categories: unique(categories),
      short_description: shortDescription,
      founded,
      funded_by: fundedBy,
      exited_to: exitedTo,
      people: unique(people),
    });
  }

  return cards;
}

function yearFromValue(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1800 && value <= 2100) return value;
  const match = String(value ?? "").match(/\b(18|19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function numberFromValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  if (/billion/i.test(text)) return Math.round(numeric * 1_000_000_000);
  if (/million/i.test(text)) return Math.round(numeric * 1_000_000);
  if (/\bk\b/i.test(text)) return Math.round(numeric * 1_000);
  return numeric;
}

function nearestPittsburghTier(headings, index) {
  let tier = null;
  for (const heading of headings) {
    if (heading.index > index) break;
    tier = heading.tier;
  }
  return tier;
}

function isRoboticsText(value) {
  return /\b(robotics?|autonomous systems?|autonomous robot|mobile robot|cobot|collaborative robot|manipulator|gripper|drone|uav|ugv|agv|amr|exoskeleton|mechatronic|robot vision|slam)\b/i.test(value)
    || /机器人|機器人|自動化|自动化|无人机|無人機|外骨骼|人形|四足/i.test(value);
}

function isRoboticsCompanyText(value) {
  const text = String(value ?? "");
  const softwareOnlyAutomation =
    /\b(robotic process automation|RPA\b|browser automation|desktop automation|workflow automation|computer use agents?|screen recording|AI agents?|sales reps?|tax workflow|back-office tasks?|browser based workflows?|clicking and typing)\b/i.test(text);
  const strongPhysicalSignal =
    /\b(autonomous (?:robot|vehicle|mobility|drone|aircraft|shuttle|truck|tractor|fleet)|mobile robot|industrial robot|service robot|surgical robot|warehouse robot(?:ics)?|robotic (?:arm|arms|cell|cells|station|stations|system|systems|platform|workcell|workcells|welding|sorter|sorters|inspection|picking|assembly|manipulation)|(?:builds?|building|develops?|developing|manufactures?|manufacturing|creates?|creating|makes?|making|designs?|designing|deploys?|deploying|produces?|producing) (?:\w+ ){0,4}robots?|robots? (?:for|that|to|in|with|using|navigate|operate|move|pick|sort|inspect|weld|assemble)|cobot|collaborative robot|manipulator|gripper|drone|uav|ugv|agv|amr|exoskeleton|humanoid|quadruped|robot arm|robotic arm|slam|unmanned (?:aerial|ground|surface|underwater)|self-driving (?:car|truck|shuttle|vehicle|tractor)|driverless vehicle)\b/i.test(text)
    || /机器人|機器人|无人机|無人機|外骨骼|人形|四足/i.test(text);
  if (strongPhysicalSignal) return true;
  if (softwareOnlyAutomation) return false;
  return /\brobotics\b/i.test(text);
}

function isMediaWikiRoboticsCompanyResult(title, description) {
  const text = `${title} ${description}`;
  if (!isRoboticsText(text)) return false;
  if (/^(机器人|機器人|送餐機器人|humanoid robot|android|optimos?|optimus|atlas机器人|qrio)$/i.test(title)) {
    return false;
  }
  if (/\b(list|competition|conference|tournament|sport|challenge|film|novel|character|person)\b/i.test(text)) {
    return false;
  }
  if (/functions related to|may refer to|disambiguation|比赛|大赛|大会|競賽|赛事|锦标赛|列表|名单|电影|電影|小说|人物|创始人|創始人|聊天機器人|聊天机器人|语言模型|語言模型|大模型/i.test(text)) {
    return false;
  }

  const titleLooksRoboticsCompany =
    /\b(robotics|robot|dobot|unitree|ecovacs|fourier|agibot|ubtech|autel|horizon|robomaster|engine ai|mech-mind|roborock|picea|leju|hanson|deeprobotics|deep robotics|sunseeker|dreame)\b/i.test(title)
    || /机器人|機器人|科技|智能|越疆|宇树|宇樹|云深处|雲深處|傅利叶|傅利葉|科沃斯|新松|众擎|眾擎|智元|乐聚|樂聚|地平线|地平線|小i/i.test(title);
  const textSaysCompany =
    /\b(company|manufacturer|startup|enterprise|headquartered|founded|established|officially known as)\b/i.test(text)
    || /公司|企業|企业|成立|总部|總部|創辦|创办/i.test(text);
  const textSaysChina =
    /\b(chinese|china|hong kong|taiwan|shenzhen|hangzhou|shanghai|beijing|suzhou|guangzhou)\b/i.test(text)
    || /中国|中國|中华人民共和国|中華人民共和國|香港|台灣|台湾|深圳|杭州|上海|北京|苏州|蘇州|广州|廣州|浙江|广东|廣東/i.test(text);

  return titleLooksRoboticsCompany && textSaysCompany && textSaysChina;
}

function productTypesFromText(value) {
  const productTypes = [];
  if (/\bsoftware|platform|api|controller|control system|slam|vision|navigation\b/i.test(value)) {
    productTypes.push("Robot software");
  }
  if (/\bgripper|sensor|controller|lidar|camera|actuator|motor|drive\b/i.test(value)) {
    productTypes.push("Hardware component");
  }
  if (isRoboticsText(value)) productTypes.push("Robot or automated system");
  return unique(productTypes.length ? productTypes : ["Other"]);
}

function industriesFromText(value) {
  const industries = ["Robotics development"];
  if (/\blogistics|warehouse|retail|supply chain\b/i.test(value)) industries.push("Logistics");
  if (/\bmanufactur|factory|industrial|production\b/i.test(value) || /制造|製造|工業|工业/i.test(value)) {
    industries.push("Manufacturing");
  }
  if (/\bmedical|surgical|rehab|health|therapy|hospital\b/i.test(value) || /医疗|醫療|康复|手术|手術/i.test(value)) {
    industries.push("Healthcare");
  }
  if (/\bagricultur|farm|crop\b/i.test(value)) industries.push("Agriculture");
  if (/\bconstruction|inspection|infrastructure\b/i.test(value)) industries.push("Construction");
  return unique(industries);
}

function robotTypesFromText(value) {
  const robotTypes = [];
  if (/\bhumanoid|biped\b/i.test(value) || /人形/i.test(value)) robotTypes.push("Humanoid robot");
  if (/\bquadruped|robot dog\b/i.test(value) || /四足/i.test(value)) robotTypes.push("Quadruped robot");
  if (/\bdrone|uav\b/i.test(value) || /无人机|無人機/i.test(value)) robotTypes.push("Aerial drone");
  if (/\bagv|amr|mobile robot|autonomous mobile\b/i.test(value)) robotTypes.push("Mobile robot");
  if (/\bmanipulator|robot arm|collaborative robot|cobot\b/i.test(value)) robotTypes.push("Robotic arm – Articulated");
  if (/\bexoskeleton\b/i.test(value) || /外骨骼/i.test(value)) robotTypes.push("Exoskeleton");
  if (/\bautomation|automated system\b/i.test(value) || /自動化|自动化/i.test(value)) {
    robotTypes.push("Automated system – Other");
  }
  return unique(robotTypes);
}

function hardwareTypesFromText(value) {
  const hardwareTypes = [];
  if (/\bgripper|end effector\b/i.test(value)) hardwareTypes.push("End-effector");
  if (/\bsensor|lidar|camera|vision\b/i.test(value)) hardwareTypes.push("Sensor – Misc");
  if (/\bcontroller|control system\b/i.test(value)) hardwareTypes.push("Controller");
  if (/\bmotor|actuator|drive\b/i.test(value)) hardwareTypes.push("Actuator");
  return unique(hardwareTypes);
}

function softwareTypesFromText(value) {
  const softwareTypes = [];
  if (/\bAI\b|artificial intelligence|machine learning|neural network|large model|foundation model/i.test(value) || /人工智能|大模型|神经网络|端到端/i.test(value)) {
    softwareTypes.push("AI model");
  }
  if (/\bslam|navigation|path planning|autonomous mobility\b/i.test(value) || /导航|導航|路径规划|路徑規劃|自主规划/i.test(value)) {
    softwareTypes.push("Autonomous mobility");
  }
  if (/\bvision|perception|camera|inspection\b/i.test(value) || /视觉|視覺|感知|检测|檢測/i.test(value)) {
    softwareTypes.push("Perception / vision");
  }
  if (/\bsimulation|developer|sdk|api|platform\b/i.test(value) || /仿真|开发者|開發者|平台|调度系统|調度系統/i.test(value)) {
    softwareTypes.push("Developer platform");
  }
  return unique(softwareTypes);
}

function compactRecord(record) {
  const compact = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    compact[key] = value;
  }
  return compact;
}

function dedupeSourceRows(rows) {
  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows) {
    const key = `${row.source_namespace}:${row.source_record_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }
  return uniqueRows;
}

function dedupeBy(rows, keyFn) {
  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }
  return uniqueRows;
}

function uniqueTerms(terms) {
  return dedupeBy(terms, (term) => `${term.facet}:${term.value}:${term.label}`.toLowerCase());
}

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function unique(values) {
  const seen = new Set();
  const uniqueValues = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const stringValue = String(value).trim();
    if (!stringValue) continue;
    const key = stringValue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueValues.push(stringValue);
  }
  return uniqueValues;
}

function sourceNamespaceFromId(value) {
  if (!value || typeof value !== "string") return null;
  const index = value.indexOf(":");
  return index > 0 ? value.slice(0, index) : null;
}

function labelFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function hashString(value) {
  let hash = 5381;
  for (const char of String(value ?? "")) {
    hash = ((hash << 5) + hash + char.codePointAt(0)) >>> 0;
  }
  return hash.toString(36);
}
