import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CCTV_SOURCE_FILE, CCTV_SOURCE_CACHE_MS } from './constants.js';
import { allocateSourceCap, resolveCatalogCap } from './cap.js';
import { loadGroundHeights, joinGroundHeights } from './groundHeights.js';
import { normalizeSourceItem } from './normalize.js';
import {
  loadAustinSourcesFromOpenData,
  loadCaltransSourcesFromOpenData,
  loadTflSourcesFromOpenData,
  loadOntarioSourcesFromOpenData,
  loadFintrafficSourcesFromOpenData,
  loadDriveBcSourcesFromOpenData,
  loadTxdotSourcesFromOpenData,
  loadTallinnSourcesFromCatalog,
  loadTarkteeSourcesFromDatex,
  loadWarendorfSourcesFromCatalog,
  loadNswSourcesFromOpenData,
  loadCalgarySourcesFromOpenData,
  loadDelDOTSourcesFromOpenData,
  loadWindySourcesFromOpenData,
} from './sources.js';

/** Env kill switch: unset or anything but "0" means enabled. */
const envEnabled = (name) => String(process.env[name] || '1').trim() !== '0';

/**
 * Live open-data packs, in merge order. Adding a region is one entry here
 * plus its loader in sources.js; the catalog cap is shared across entries
 * round-robin (cap.js), so a new pack never silently evicts an older one.
 * Each pack fails independently (allSettled) and is gated by its own env
 * kill switch.
 */
const LIVE_PACKS = [
  { name: 'austin', enabled: () => true, load: loadAustinSourcesFromOpenData },
  {
    name: 'caltrans',
    enabled: () => true,
    load: loadCaltransSourcesFromOpenData,
  },
  {
    name: 'tfl',
    enabled: () => envEnabled('CCTV_TFL_ENABLED'),
    load: loadTflSourcesFromOpenData,
  },
  {
    name: 'ontario',
    enabled: () => envEnabled('CCTV_ONTARIO_ENABLED'),
    load: loadOntarioSourcesFromOpenData,
  },
  {
    name: 'fintraffic',
    enabled: () => envEnabled('CCTV_FINTRAFFIC_ENABLED'),
    load: loadFintrafficSourcesFromOpenData,
  },
  {
    name: 'drivebc',
    enabled: () => envEnabled('CCTV_DRIVEBC_ENABLED'),
    load: loadDriveBcSourcesFromOpenData,
  },
  {
    name: 'txdot',
    enabled: () => envEnabled('CCTV_TXDOT_ENABLED'),
    load: loadTxdotSourcesFromOpenData,
  },
  {
    name: 'tallinn',
    enabled: () => envEnabled('CCTV_TALLINN_ENABLED'),
    load: loadTallinnSourcesFromCatalog,
  },
  {
    name: 'tarktee',
    enabled: () => envEnabled('CCTV_TARKTEE_ENABLED'),
    load: loadTarkteeSourcesFromDatex,
  },
  {
    name: 'warendorf',
    enabled: () => envEnabled('CCTV_WARENDORF_ENABLED'),
    load: loadWarendorfSourcesFromCatalog,
  },
  {
    name: 'nsw',
    enabled: () => envEnabled('CCTV_NSW_ENABLED'),
    load: loadNswSourcesFromOpenData,
  },
  {
    name: 'calgary',
    enabled: () => envEnabled('CCTV_CALGARY_ENABLED'),
    load: loadCalgarySourcesFromOpenData,
  },
  {
    name: 'deldot',
    enabled: () => envEnabled('CCTV_DELDOT_ENABLED'),
    load: loadDelDOTSourcesFromOpenData,
  },
  {
    name: 'windy',
    enabled: () => envEnabled('CCTV_WINDY_ENABLED'),
    load: loadWindySourcesFromOpenData,
  },
];
/**
 * Load CCTV sources from a local JSON file (CCTV_SOURCES_FILE env or default).
 *
 * @returns {Array<object>} Array of raw source objects, or [] on error.
 */
function loadSourcesFromFile(sourceRoot) {
  const sourceFile = process.env.CCTV_SOURCES_FILE || DEFAULT_CCTV_SOURCE_FILE;
  const resolved = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(sourceRoot, sourceFile);
  try {
    if (!fs.existsSync(resolved)) return [];
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(
      '[CCTV] failed to read source file:',
      resolved,
      error?.message || error,
    );
    return [];
  }
}

/**
 * Load CCTV sources from the CCTV_SOURCES_JSON env variable (inline JSON).
 *
 * @returns {Array<object>} Array of raw source objects, or [] if unset/invalid.
 */
function loadSourcesFromEnv() {
  const raw = process.env.CCTV_SOURCES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Load the master local CCTV pack index.
 *
 * The index lives at config/cctv/index.json by default and references
 * individual pack files relative to the index directory. Legacy
 * CCTV_SOURCES_FILE and CCTV_SOURCES_JSON remain supported separately.
 *
 * @returns {Array<{name: string, sources: Array<object>}>} Local packs.
 */
function loadLocalIndexPacks(sourceRoot) {
  const indexFile =
    process.env.CCTV_PACK_INDEX_FILE || 'config/cctv/index.json';
  const resolved = path.isAbsolute(indexFile)
    ? indexFile
    : path.resolve(sourceRoot, indexFile);

  try {
    if (!fs.existsSync(resolved)) return [];

    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.packs)
        ? parsed.packs
        : [];

    const indexDir = path.dirname(resolved);

    return entries
      .filter((entry) => entry && typeof entry === 'object')
      .filter((entry) => entry.enabled !== false)
      .filter((entry) => typeof entry.file === 'string' && entry.file.trim())
      .map((entry) => {
        const file = path.resolve(indexDir, entry.file);
        try {
          if (!fs.existsSync(file)) {
            console.warn('[CCTV] local pack file not found:', file);
            return {
              name: String(entry.name || entry.id || entry.file),
              sources: [],
            };
          }
          const packRaw = fs.readFileSync(file, 'utf8');
          const packParsed = JSON.parse(packRaw);
          return {
            name: String(entry.name || entry.id || entry.file),
            sources: Array.isArray(packParsed) ? packParsed : [],
          };
        } catch (error) {
          console.warn(
            '[CCTV] failed to read local CCTV pack:',
            file,
            error?.message || error,
          );
          return {
            name: String(entry.name || entry.id || entry.file),
            sources: [],
          };
        }
      });
  } catch (error) {
    console.warn(
      '[CCTV] failed to read CCTV pack index:',
      resolved,
      error?.message || error,
    );
    return [];
  }
}

/** Create an independent catalog rooted in the consuming application. */
export function createCctvCatalog({ sourceRoot = process.cwd() } = {}) {
  /** @type {Array<object>} Cached merged + normalized CCTV source list. */
  let _cctvSourceCache = [];
  /** @type {number} Epoch-ms when the source cache was last refreshed. */
  let _cctvSourceCacheAt = 0;
  /** @type {Promise<Array<object>>|null} In-flight refresh, shared by concurrent
   * callers so a post-TTL burst launches ONE refetch, not one per request. */
  let _cctvSourceInflight = null;

  /**
   * Assemble and cache the merged CCTV source list.
   *
   * Merges every source pack (live open-data packs, indexed local packs,
   * legacy local file, env variable), deduplicates by ID, shares the catalog cap fairly across
   * packs, and caches for CCTV_SOURCE_CACHE_MS.
   *
   * @returns {Promise<Array<object>>} Deduplicated, capped source list.
   */
  async function getCctvSources() {
    const now = Date.now();
    if (
      _cctvSourceCache.length &&
      now - _cctvSourceCacheAt <= CCTV_SOURCE_CACHE_MS
    ) {
      return _cctvSourceCache;
    }
    // Single-flight: a burst of requests arriving past the TTL shares ONE refresh
    // instead of each launching the full multi-provider refetch. The `.finally`
    // clears the ref so the next post-TTL cycle starts fresh.
    if (_cctvSourceInflight) return _cctvSourceInflight;
    _cctvSourceInflight = refreshCctvSources().finally(() => {
      _cctvSourceInflight = null;
    });
    return _cctvSourceInflight;
  }

  /**
   * Assemble and cache the merged CCTV source list from live packs,
   * indexed local packs, legacy file/env sources.
   * Always resolves (loaders self-catch to []); on a fully-empty refresh with a
   * good prior catalog it serves stale rather than blanking the CCTV layer.
   *
   * @returns {Promise<Array<object>>} Deduplicated, capped source list.
   */
  async function refreshCctvSources() {
    const fromFile = loadSourcesFromFile(sourceRoot);
    const fromEnv = loadSourcesFromEnv();
    const localIndexPacks = loadLocalIndexPacks(sourceRoot);

    const forceAustin =
      String(process.env.CCTV_FORCE_AUSTIN || '').trim() === '1';
    const preferAustin =
      String(process.env.CCTV_PREFER_AUSTIN || '1').trim() !== '0';
    // Local packs, legacy file sources, and env sources can coexist with the
    // original live providers. CCTV_PREFER_AUSTIN=0 remains the explicit
    // switch for disabling live providers; CCTV_FORCE_AUSTIN=1 keeps the
    // historical force switch working as before.
    const needsLiveSources = forceAustin || preferAustin;
    const liveResults = needsLiveSources
      ? await Promise.allSettled(
          // Invoked inside the promise so a loader that throws synchronously
          // (a file-based pack on a malformed row) is isolated like any other
          // failed pack instead of rejecting the whole refresh.
          LIVE_PACKS.map((pack) =>
            Promise.resolve().then(() =>
              pack.enabled() ? pack.load({ sourceRoot }) : [],
            ),
          ),
        )
      : [];
    // Live packs first so file/env overrides win on duplicate IDs; each pack
    // keeps its own priority order and the catalog cap is shared fairly.
    const normalizePack = (name, items) => ({
      name,
      sources: items
        .filter((item) => item && typeof item === 'object')
        .map((item) => normalizeSourceItem(item))
        .filter((item) => item.id),
    });
    const packs = [
      ...LIVE_PACKS.map((pack, index) =>
        normalizePack(
          pack.name,
          liveResults[index]?.status === 'fulfilled'
            ? liveResults[index].value
            : [],
        ),
      ),
      ...localIndexPacks.map((pack) =>
        normalizePack(pack.name, pack.sources),
      ),
      normalizePack('file', fromFile),
      normalizePack('env', fromEnv),
    ];
    const maxCount = resolveCatalogCap(process.env.CCTV_MAX_SOURCES);
    const allocation = allocateSourceCap(packs, maxCount);
    // Shipped ground heights (src/data/local_data/cctv_ground_heights/, produced by
    // scripts/precompute-cctv-heights.mjs) ride along on the served source so
    // the client can place a camera and its monitor plane with zero sampling.
    const capped = joinGroundHeights(
      allocation.sources,
      loadGroundHeights(sourceRoot),
    );
    const trimmed = allocation.packs.filter((pack) => pack.kept < pack.offered);
    if (trimmed.length) {
      const detail = trimmed
        .map((pack) => `${pack.name} ${pack.kept}/${pack.offered}`)
        .join(', ');
      console.warn(
        `[CCTV] source catalog exceeds cap ${maxCount}; shared round-robin across packs (${detail}). Raise CCTV_MAX_SOURCES or lower a per-pack cap to change the mix.`,
      );
    }
    if (capped.length > 0 || _cctvSourceCache.length === 0) {
      _cctvSourceCache = capped;
    } else {
      // Every source came back empty (all live packs timed out / upstream outage)
      // but a good catalog is already cached — serve it stale rather than blanking
      // every CCTV route. Advancing the timestamp waits one TTL before retrying,
      // which (with single-flight) bounds load on a persistently-down upstream.
      console.warn(
        `[CCTV] source refresh returned empty; serving ${_cctvSourceCache.length} stale cameras`,
      );
    }
    _cctvSourceCacheAt = Date.now();
    return _cctvSourceCache;
  }

  return getCctvSources;
}
