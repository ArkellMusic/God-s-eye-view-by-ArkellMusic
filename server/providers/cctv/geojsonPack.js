import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GEO_ID_SEPARATOR } from './geojsonGrouping.js';
import { normalizeSourceItem } from './normalize.js';

/** Built by scripts/build-cctv-geojson-pack.mjs from cameras.geojson. */
export const DEFAULT_GEOJSON_PACK_DIR = 'config/cctv/geojson';
const MAX_CACHED_GROUPS = 40;
export const MAX_GROUPS_PER_REQUEST = 8;

/**
 * Serves the geojson camera pack on demand. The index (every group with its
 * true total / m3u8 / snapshot) is tiny and always available; the cameras of
 * a group are read from their shard only when that group is switched ON.
 */
export function createGeojsonPack({ sourceRoot = process.cwd() } = {}) {
  const dir = () => {
    const configured = process.env.CCTV_GEOJSON_PACK_DIR || DEFAULT_GEOJSON_PACK_DIR;
    return path.isAbsolute(configured) ? configured : path.resolve(sourceRoot, configured);
  };
  let index = null;
  const cache = new Map(); // groupId -> normalized sources (insertion = LRU order)

  function readIndex() {
    if (index) return index;
    index = { groups: [], byId: new Map() };
    if (String(process.env.CCTV_GEOJSON_ENABLED || '1').trim() === '0') return index;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir(), 'index.json'), 'utf8'));
      const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
      index = { groups, byId: new Map(groups.map((g) => [g.id, g])) };
    } catch (error) {
      if (error?.code !== 'ENOENT')
        console.warn('[CCTV] failed to read geojson index:', error?.message || error);
    }
    return index;
  }

  function listGroups() {
    return readIndex().groups.map(({ id, name, total, m3u8, snapshot }) => ({
      id,
      name,
      total,
      m3u8,
      snapshot,
    }));
  }

  function loadGroup(groupId) {
    const group = readIndex().byId.get(groupId);
    if (!group) return [];
    if (cache.has(groupId)) {
      const hit = cache.get(groupId);
      cache.delete(groupId);
      cache.set(groupId, hit);
      return hit;
    }
    let sources = [];
    try {
      const rows = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(path.join(dir(), group.file))).toString('utf8'),
      );
      sources = rows.map(([id, name, lat, lon, feedType, url]) =>
        normalizeSourceItem({
          id: `${groupId}${GEO_ID_SEPARATOR}${id}`,
          name,
          city: group.name,
          cityId: group.id,
          provider: 'OpenCCTV',
          lat,
          lon,
          feedType,
          url,
          snapshotUrl: feedType === 'image' ? url : '',
          sourceKind: 'geojson',
        }),
      );
    } catch (error) {
      console.warn('[CCTV] failed to read geojson group:', groupId, error?.message || error);
    }
    cache.set(groupId, sources);
    while (cache.size > MAX_CACHED_GROUPS) cache.delete(cache.keys().next().value);
    return sources;
  }

  /** Finds one geojson camera from its id (the group is encoded in the id). */
  function findSource(cameraId) {
    const id = String(cameraId || '');
    const at = id.indexOf(GEO_ID_SEPARATOR);
    if (at < 1) return undefined;
    return loadGroup(id.slice(0, at)).find((source) => source.id === id);
  }

  return { listGroups, loadGroup, findSource };
}
