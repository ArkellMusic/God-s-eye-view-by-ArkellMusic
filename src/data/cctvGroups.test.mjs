import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCctvCameraGroups,
  cctvCameraGroup,
  isCctvCameraGroupVisible,
} from './cctvGroups.js';

test('groups Spanish camera sources under the named regions and counts', () => {
  const cameras = [
    { city: 'Toledo', cityId: 'toledo', provider: 'Turriano' },
    { city: 'Madrid', cityId: 'madrid', provider: 'Ayuntamiento de Madrid' },
    { city: 'Madrid', cityId: 'madrid-m30', provider: 'Informo' },
    {
      city: 'Madrid',
      cityId: 'dgt-madrid',
      provider: 'DGT',
      sourceKind: 'dgt-spain',
    },
    { city: 'Málaga', cityId: 'malaga', provider: 'meteo365.es' },
  ];
  assert.deepEqual(
    buildCctvCameraGroups(cameras).map(({ id, name, count }) => ({
      id,
      name,
      count,
    })),
    [
      { id: 'toledo', name: 'Toledo', count: 1 },
      { id: 'madrid', name: 'Madrid', count: 1 },
      { id: 'madrid-m30', name: 'Madrid M-30', count: 1 },
      { id: 'dgt-espana', name: 'DGT España', count: 1 },
      { id: 'other:malaga', name: 'Málaga', count: 1 },
    ],
  );
});

test('classifies DGT sources separately from city packs and applies group visibility', () => {
  const dgt = {
    city: 'TOLEDO',
    cityId: 'dgt-toledo',
    provider: 'DGT',
    sourceKind: 'dgt-spain',
  };
  const m30 = {
    city: 'Madrid',
    cityId: 'madrid',
    sourceKind: 'm30-tunnel-cctv',
  };
  assert.equal(cctvCameraGroup(dgt).id, 'dgt-espana');
  assert.equal(cctvCameraGroup(m30).id, 'madrid-m30');
  assert.equal(isCctvCameraGroupVisible(dgt, new Set(['dgt-espana'])), true);
  assert.equal(isCctvCameraGroupVisible(dgt, new Set(['toledo'])), false);
  assert.equal(isCctvCameraGroupVisible(dgt, null), true);
});
