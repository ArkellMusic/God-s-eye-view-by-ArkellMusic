import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureToSource,
  geojsonFeedKind,
  geojsonFeedType,
  placeGroup,
} from './geojsonGrouping.js';
import { normalizeSourceItem } from './normalize.js';
import {
  buildCctvCameraGroups,
  cctvGroupLabel,
  mergeCctvGroupIndex,
  cctvCameraGroup,
} from '../../../src/data/cctvGroups.js';
import { createGeojsonPack } from './geojsonPack.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const feature = (props, coords = [-95.3, 29.7]) => ({
  geometry: { type: 'Point', coordinates: coords },
  properties: { id: 'a', name: 'Cam', country: 'US', city: 'Houston', ...props },
});

test('feed types map to m3u8 vs snapshot', () => {
  assert.equal(geojsonFeedType({ feedType: 'm3u8' }), 'hls');
  assert.equal(geojsonFeedType({ feedType: 'image/jpeg' }), 'image');
  assert.equal(geojsonFeedType({ feedType: 'iframe' }), null);
  assert.equal(geojsonFeedKind('hls'), 'm3u8');
  assert.equal(geojsonFeedKind('mp4'), 'm3u8');
  assert.equal(geojsonFeedKind('mjpeg'), 'snapshot');
});

test('small places fall into the country "Otros" group', () => {
  const big = new Set(['US|Houston']);
  assert.match(placeGroup({ country: 'US', city: 'Houston' }, big).label, /^Houston · /);
  assert.match(placeGroup({ country: 'US', city: 'Tinytown' }, big).label, /^Otros · /);
});

test('featureToSource skips unusable rows and keeps the rest', () => {
  const big = new Set(['US|Houston']);
  assert.equal(featureToSource(feature({ feedType: 'iframe', feedUrl: 'https://x/' }), big), null);
  assert.equal(featureToSource(feature({ feedType: 'image', feedUrl: '' }), big), null);
  const ok = featureToSource(
    feature({ feedType: 'm3u8', streamUrl: 'https://x/p.m3u8' }),
    big,
  );
  assert.equal(ok.feedType, 'hls');
  assert.equal(ok.url, 'https://x/p.m3u8');
  assert.equal(normalizeSourceItem(ok).feedType, 'hls');
});

test('unloaded geojson groups appear OFF with their true totals', () => {
  const loaded = buildCctvCameraGroups([
    { id: 'geo:us:houston~1', city: 'Houston · Estados Unidos', cityId: 'geo:us:houston', feedType: 'hls' },
  ]);
  const merged = mergeCctvGroupIndex(
    loaded,
    [
      { id: 'geo:us:houston', name: 'Houston · Estados Unidos', total: 100, m3u8: 30, snapshot: 70 },
      { id: 'geo:jp:kyoto', name: 'Kyoto · Japón', total: 126, m3u8: 6, snapshot: 120 },
    ],
    new Set(['geo:jp:kyoto']),
  );
  const kyoto = merged.find((g) => g.id === 'geo:jp:kyoto');
  assert.equal(kyoto.unloaded, true);
  assert.equal(kyoto.loading, true);
  assert.equal(
    cctvGroupLabel(kyoto),
    'KYOTO · JAPÓN (126) CAMERAS · 6 M3U8 · 120 SNAPSHOT · LOADING…',
  );
  const houston = merged.find((g) => g.id === 'geo:us:houston');
  assert.equal(houston.unloaded, undefined);
  assert.equal(houston.total, 100);
  assert.equal(cctvCameraGroup({ cityId: 'geo:us:houston', city: 'X' }).id, 'geo:us:houston');
});

test('pack serves a group on demand and finds cameras by id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-pack-'));
  fs.mkdirSync(path.join(dir, 'shards'));
  const rows = [
    ['cam-1', 'Uno', 35.0, 139.0, 'hls', 'https://x/a.m3u8'],
    ['cam-2', 'Dos', 35.1, 139.1, 'image', 'https://x/b.jpg'],
  ];
  fs.writeFileSync(path.join(dir, 'shards', 'geo_jp_tokyo.json.gz'), zlib.gzipSync(JSON.stringify(rows)));
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({ groups: [{ id: 'geo:jp:tokyo', name: 'Tokyo · Japón', total: 2, m3u8: 1, snapshot: 1, file: 'shards/geo_jp_tokyo.json.gz' }] }),
  );
  process.env.CCTV_GEOJSON_PACK_DIR = dir;
  try {
    const pack = createGeojsonPack();
    assert.equal(pack.listGroups()[0].total, 2);
    const cams = pack.loadGroup('geo:jp:tokyo');
    assert.equal(cams.length, 2);
    assert.equal(cams[0].id, 'geo:jp:tokyo~cam-1');
    assert.equal(cams[0].feedType, 'hls');
    assert.equal(cams[1].snapshotUrl, 'https://x/b.jpg');
    assert.equal(pack.findSource('geo:jp:tokyo~cam-2').name, 'Dos');
    assert.equal(pack.findSource('nope'), undefined);
    assert.deepEqual(pack.loadGroup('geo:zz:none'), []);
  } finally {
    delete process.env.CCTV_GEOJSON_PACK_DIR;
  }
});

test('web pages are dropped, videos and images are kept', () => {
  const big = new Set();
  assert.equal(featureToSource(feature({ feedType: 'image', feedUrl: 'https://x/cam.html' }), big), null);
  assert.notEqual(featureToSource(feature({ feedType: 'image', feedUrl: 'https://x/cam.php?id=3' }), big), null);
  assert.notEqual(featureToSource(feature({ feedType: 'mjpeg', feedUrl: 'https://x/live.mjpg' }), big), null);
});

test('plain packs (no totals) count their own cameras', () => {
  const [g] = buildCctvCameraGroups([
    { id: '1', city: 'Toledo', cityId: 'toledo', feedType: 'image' },
    { id: '2', city: 'Toledo', cityId: 'toledo', feedType: 'hls' },
  ]);
  assert.equal(cctvGroupLabel(g), 'TOLEDO (2) CAMERAS · 1 M3U8 · 1 SNAPSHOT');
});
