/**
 * Pure helpers shared by the geojson pack builder script and the runtime
 * loader: how a raw cameras.geojson feature becomes a camera source, which
 * "place" (FILTER CAMERAS group) it belongs to, and whether it counts as
 * M3U8 (live video) or SNAPSHOT (still image).
 */

/** Places with fewer cameras than this are merged into "Otros · <país>". */
export const MIN_CAMERAS_PER_PLACE = 20;

/** A group never holds more cameras than this; bigger places are split (1/3, 2/3...). */
export const MAX_CAMERAS_PER_GROUP = 3000;

/** Prefix that ties a geojson camera id to its group shard. */
export const GEO_ID_SEPARATOR = '~';

/** Feed types the app cannot render as image or video (web pages / JSON). */
const UNSUPPORTED_FEED_TYPES = new Set(['iframe', 'txdot-json']);

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(code) {
  const cc = String(code || '').trim().toUpperCase();
  if (!cc) return 'Sin país';
  try {
    return regionNames?.of(cc) || cc;
  } catch {
    return cc;
  }
}

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalizes a geojson feedType into the app's feed types.
 * @returns {'hls'|'mp4'|'mjpeg'|'image'|null} null = unsupported, skip it.
 */
export function geojsonFeedType(props = {}) {
  const raw = String(props.feedType || '').trim().toLowerCase();
  if (UNSUPPORTED_FEED_TYPES.has(raw)) return null;
  if (raw === 'm3u8' || raw === 'hls') return 'hls';
  if (raw === 'mp4') return 'mp4';
  if (raw === 'mjpeg' || raw === 'mjpg') return 'mjpeg';
  return 'image';
}

/** 'm3u8' for live video (hls/mp4), 'snapshot' for everything else. */
export function geojsonFeedKind(feedType) {
  return feedType === 'hls' || feedType === 'mp4' ? 'm3u8' : 'snapshot';
}

/** Key identifying a camera's raw place: country + city ('' when unknown). */
export function rawPlaceKey(props = {}) {
  const country = String(props.country || '').trim().toUpperCase();
  const city = String(props.city || '').trim();
  const unknown = !city || city.toLowerCase() === 'unknown';
  return `${country}|${unknown ? '' : city}`;
}

/**
 * Group descriptor for a place. `bigPlaces` is the set of raw place keys that
 * reach MIN_CAMERAS_PER_PLACE; every other camera falls into its country's
 * "Otros" group.
 */
export function placeGroup(props, bigPlaces) {
  const key = rawPlaceKey(props);
  const [country, city] = key.split('|');
  const cname = countryName(country);
  if (city && bigPlaces.has(key)) {
    return {
      id: `geo:${slug(country)}:${slug(city)}`,
      label: `${city} · ${cname}`,
    };
  }
  return { id: `geo:${slug(country) || 'xx'}:otros`, label: `Otros · ${cname}` };
}

/** Human-friendly provider label from the raw `source` id. */
export function providerLabel(source) {
  const name = String(source || 'geojson')
    .replace(/^opencctv_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return `OpenCCTV ${name}`.trim();
}

/**
 * Converts one geojson feature into a raw source item (pre-normalizeSourceItem).
 * Returns null for unusable rows (bad coordinates, unsupported feed, no URL).
 */
export function featureToSource(feature, bigPlaces) {
  const props = feature?.properties || {};
  const coords = feature?.geometry?.coordinates;
  const lon = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const feedType = geojsonFeedType(props);
  if (!feedType) return null;
  const url = String(props.streamUrl || props.feedUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  // A .html/.htm address is a web page, not an image or a video stream.
  if (/\.html?(\?|#|$)/i.test(url.split('?')[0] + (url.includes('?') ? '?' : ''))) return null;
  const id = String(props.id || '').trim();
  if (!id) return null;
  const group = placeGroup(props, bigPlaces);
  return {
    id,
    name: String(props.name || id).trim(),
    city: group.label,
    cityId: group.id,
    provider: providerLabel(props.source),
    lat,
    lon,
    feedType,
    url,
    snapshotUrl: feedType === 'image' ? url : '',
    sourceKind: 'geojson',
    code: '',
  };
}
