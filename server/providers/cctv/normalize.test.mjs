import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceItem } from './normalize.js';

test('normalizes YouTube CCTV sources to the embed feed type', () => {
  const source = normalizeSourceItem({
    id: 'guardamar',
    name: 'Guardamar',
    sourceUrl: 'https://www.youtube.com/watch?v=VM61M-y3WoA',
    feedType: 'hls',
  });
  assert.equal(source.feedType, 'youtube');
  assert.equal(source.youtubeId, 'VM61M-y3WoA');
});

test('accepts an explicit YouTube id', () => {
  const source = normalizeSourceItem({ id: 'cam', youtubeId: 'VM61M-y3WoA' });
  assert.equal(source.feedType, 'youtube');
  assert.equal(source.youtubeId, 'VM61M-y3WoA');
});

test('recognizes a YouTube video id embedded in a Googlevideo HLS URL', () => {
  const source = normalizeSourceItem({
    id: 'guardamar-hls',
    feedType: 'hls',
    url: 'https://rr5---sn.example.googlevideo.com/api/manifest/hls_playlist/id/VM61M-y3WoA.9/itag/96/playlist/index.m3u8',
  });
  assert.equal(source.feedType, 'youtube');
  assert.equal(source.youtubeId, 'VM61M-y3WoA');
});
