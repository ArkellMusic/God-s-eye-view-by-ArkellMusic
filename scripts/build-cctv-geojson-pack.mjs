#!/usr/bin/env node
/**
 * Builds the CCTV geojson pack from cameras.geojson(.gz).
 *
 * Keeps EVERY camera that can actually give an image or video and drops the
 * ones that cannot:
 *   - web pages (feedType iframe, or a .html/.htm address)
 *   - TxDOT JSON endpoints (not an image)
 *   - rows with no http(s) address or with bad coordinates
 *   - duplicates of the same feed address
 *
 * Output (default config/cctv/geojson/):
 *   index.json            every group with its true total / m3u8 / snapshot
 *   shards/<group>.json.gz  the cameras of one group (loaded when it is ON)
 *
 * Usage: node scripts/build-cctv-geojson-pack.mjs [input] [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  MAX_CAMERAS_PER_GROUP,
  MIN_CAMERAS_PER_PLACE,
  countryName,
  featureToSource,
  geojsonFeedKind,
  geojsonFeedType,
  rawPlaceKey,
} from '../server/providers/cctv/geojsonGrouping.js';

const input = process.argv[2] || 'data/cameras.geojson.gz';
const outDir = process.argv[3] || 'config/cctv/geojson';

const buf = fs.readFileSync(input);
const raw = (input.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
const features = JSON.parse(raw).features || [];

const placeCounts = new Map();
for (const f of features) {
  if (!geojsonFeedType(f?.properties)) continue;
  const key = rawPlaceKey(f.properties);
  placeCounts.set(key, (placeCounts.get(key) || 0) + 1);
}
const bigPlaces = new Set(
  [...placeCounts]
    .filter(([key, n]) => key.split('|')[1] && n >= MIN_CAMERAS_PER_PLACE)
    .map(([key]) => key),
);

const dropped = { unsupported: 0, invalid: 0, duplicate: 0 };
const seenUrls = new Set();
const byBase = new Map();
for (const f of features) {
  if (!geojsonFeedType(f?.properties)) {
    dropped.unsupported += 1;
    continue;
  }
  const s = featureToSource(f, bigPlaces);
  if (!s) {
    dropped.invalid += 1;
    continue;
  }
  if (seenUrls.has(s.url)) {
    dropped.duplicate += 1;
    continue;
  }
  seenUrls.add(s.url);
  let g = byBase.get(s.cityId);
  if (!g) {
    g = { id: s.cityId, name: s.city, items: [] };
    byBase.set(s.cityId, g);
  }
  g.items.push(s);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'shards'), { recursive: true });

const groups = [];
for (const base of byBase.values()) {
  base.items.sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  const parts = Math.max(1, Math.ceil(base.items.length / MAX_CAMERAS_PER_GROUP));
  const size = Math.ceil(base.items.length / parts);
  for (let p = 0; p < parts; p++) {
    const items = base.items.slice(p * size, (p + 1) * size);
    const id = parts > 1 ? `${base.id}-${p + 1}` : base.id;
    const name = parts > 1 ? `${base.name} (${p + 1}/${parts})` : base.name;
    let m3u8 = 0;
    for (const s of items) if (geojsonFeedKind(s.feedType) === 'm3u8') m3u8 += 1;
    const file = `shards/${id.replace(/[^a-z0-9-]+/g, '_')}.json.gz`;
    // Compact rows: [origId, name, lat, lon, feedType, url]
    const rows = items.map((s) => [
      s.id,
      s.name,
      s.lat,
      s.lon,
      s.feedType,
      s.url,
    ]);
    fs.writeFileSync(path.join(outDir, file), zlib.gzipSync(JSON.stringify(rows), { level: 9 }));
    groups.push({ id, name, total: items.length, m3u8, snapshot: items.length - m3u8, file });
  }
}
groups.sort((a, b) => a.name.localeCompare(b.name, 'es'));
const usable = groups.reduce((n, g) => n + g.total, 0);
fs.writeFileSync(
  path.join(outDir, 'index.json'),
  JSON.stringify({
    generated: new Date().toISOString(),
    totalCameras: features.length,
    usableCameras: usable,
    dropped,
    groups,
  }),
);
console.log(
  `${features.length} en el geojson -> ${usable} útiles en ${groups.length} grupos. Descartadas: ${JSON.stringify(dropped)}`,
);
