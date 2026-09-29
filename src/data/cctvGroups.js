const REQUIRED_GROUPS = Object.freeze({
  'madrid-m30': 'Madrid M-30',
  toledo: 'Toledo',
  madrid: 'Madrid',
  'dgt-espana': 'DGT España',
});

const REQUIRED_ORDER = Object.freeze([
  'toledo',
  'madrid',
  'madrid-m30',
  'dgt-espana',
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-ES');
}

function slug(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function cctvCameraGroup(camera = {}) {
  // Geojson-pack cameras carry their place group (server-built id + label).
  if (String(camera.cityId || '').startsWith('geo:'))
    return { id: String(camera.cityId), name: String(camera.city || camera.cityId) };
  const cityId = normalize(camera.cityId);
  const city = normalize(camera.city);
  const provider = normalize(camera.provider);
  const sourceKind = normalize(camera.sourceKind);
  if (
    cityId.includes('m30') ||
    sourceKind.includes('m30') ||
    provider.includes('calle 30')
  ) {
    return { id: 'madrid-m30', name: REQUIRED_GROUPS['madrid-m30'] };
  }
  if (sourceKind === 'dgt-spain' || provider === 'dgt') {
    return { id: 'dgt-espana', name: REQUIRED_GROUPS['dgt-espana'] };
  }
  if (cityId === 'madrid' || city === 'madrid') {
    return { id: 'madrid', name: REQUIRED_GROUPS.madrid };
  }
  if (cityId === 'toledo' || city === 'toledo') {
    return { id: 'toledo', name: REQUIRED_GROUPS.toledo };
  }
  const fallback =
    camera.city && !['global', 'unknown'].includes(city)
      ? String(camera.city).trim()
      : String(camera.provider || camera.city || 'Other cameras').trim();
  return { id: `other:${slug(fallback) || 'unknown'}`, name: fallback };
}

export function buildCctvCameraGroups(cameras = []) {
  const groups = new Map();
  for (const camera of Array.isArray(cameras) ? cameras : []) {
    const group = cctvCameraGroup(camera);
    const entry = groups.get(group.id) || {
      ...group,
      count: 0,
      m3u8: 0,
      snapshot: 0,
      totalOverride: 0,
      m3u8Override: 0,
      snapshotOverride: 0,
    };
    entry.count += 1;
    if (cctvCameraFeedKind(camera) === 'm3u8') entry.m3u8 += 1;
    else entry.snapshot += 1;
    // Cameras from the geojson pack carry their place's TRUE totals, since
    // only a balanced sample of each place is loaded on the globe.
    entry.totalOverride = Math.max(entry.totalOverride, Number(camera.groupTotal) || 0);
    entry.m3u8Override = Math.max(entry.m3u8Override, Number(camera.groupM3u8) || 0);
    entry.snapshotOverride = Math.max(
      entry.snapshotOverride,
      Number(camera.groupSnapshot) || 0,
    );
    groups.set(group.id, entry);
  }
  for (const entry of groups.values()) {
    entry.loaded = entry.count;
    entry.total = Math.max(entry.count, entry.totalOverride);
    if (entry.totalOverride > 0) {
      entry.m3u8 = Math.max(entry.m3u8, entry.m3u8Override);
      entry.snapshot = Math.max(entry.snapshot, entry.snapshotOverride);
    }
    delete entry.totalOverride;
    delete entry.m3u8Override;
    delete entry.snapshotOverride;
  }
  const order = new Map(REQUIRED_ORDER.map((id, index) => [id, index]));
  return [...groups.values()].sort((a, b) => {
    const ai = order.get(a.id);
    const bi = order.get(b.id);
    if (ai !== undefined || bi !== undefined)
      return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER);
    return a.name.localeCompare(b.name, 'es');
  });
}

/**
 * One-line label for a FILTER CAMERAS row: place, how many cameras exist
 * there, and how many are M3U8 (live video) vs SNAPSHOT (still image).
 */
export function cctvGroupLabel(group) {
  const total = group.total ?? group.count ?? 0;
  const parts = [
    `${String(group.name || '').toLocaleUpperCase('es-ES')} (${total}) CAMERAS`,
    `${group.m3u8 ?? 0} M3U8`,
    `${group.snapshot ?? 0} SNAPSHOT`,
  ];
  if (group.loading) parts.push('LOADING…');
  return parts.join(' · ');
}

/**
 * Adds the geojson pack's groups that are not on the globe yet to the loaded
 * groups, with their true totals from the server index. Unloaded groups are
 * OFF until switched ON (which loads their cameras). Loaded geo groups take
 * their m3u8/snapshot split from the index too.
 */
export function mergeCctvGroupIndex(loadedGroups = [], index = [], loading = new Set()) {
  const byId = new Map(loadedGroups.map((group) => [group.id, group]));
  for (const info of Array.isArray(index) ? index : []) {
    const existing = byId.get(info.id);
    if (existing) {
      existing.total = Math.max(existing.total ?? 0, info.total);
      existing.m3u8 = Math.max(existing.m3u8 ?? 0, info.m3u8);
      existing.snapshot = Math.max(existing.snapshot ?? 0, info.snapshot);
      continue;
    }
    byId.set(info.id, {
      id: info.id,
      name: info.name,
      count: 0,
      loaded: 0,
      total: info.total,
      m3u8: info.m3u8,
      snapshot: info.snapshot,
      unloaded: true,
    });
  }
  for (const group of byId.values()) group.loading = loading.has(group.id);
  const order = new Map(REQUIRED_ORDER.map((id, index) => [id, index]));
  return [...byId.values()].sort((a, b) => {
    const ai = order.get(a.id);
    const bi = order.get(b.id);
    if (ai !== undefined || bi !== undefined)
      return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER);
    return a.name.localeCompare(b.name, 'es');
  });
}

export function isCctvCameraGroupVisible(camera, visibleGroupIds, feedKind = null) {
  if (
    (feedKind === 'snapshot' || feedKind === 'm3u8') &&
    cctvCameraFeedKind(camera) !== feedKind
  )
    return false;
  return (
    !(visibleGroupIds instanceof Set) ||
    visibleGroupIds.has(cctvCameraGroup(camera).id)
  );
}

/**
 * Buckets a camera into the two kinds the FILTER CAMERAS popup's quick
 * filters use: 'snapshot' for a periodically-refreshed still image, or
 * 'm3u8' for anything that plays as live video — real .m3u8/HLS (and
 * mp4/webm) decode plus YouTube-embedded live cameras, since a YouTube feed
 * is itself sourced from a live stream and reads to the user as "video",
 * even though it renders through an iframe rather than the HLS decode path.
 *
 * @param {object} camera
 * @returns {'snapshot'|'m3u8'}
 */
export function cctvCameraFeedKind(camera = {}) {
  const feedType = String(camera.feedType || '').toLowerCase();
  if (feedType === 'youtube') return 'm3u8';
  return feedType === 'hls' || feedType === 'mp4' || feedType === 'webm'
    ? 'm3u8'
    : 'snapshot';
}
