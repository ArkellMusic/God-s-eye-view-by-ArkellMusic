import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

test('the indexed Vision-Environnement snapshot pack loads as configured CCTV sources', async () => {
  const saved = { ...process.env };
  const sourceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gev-cctv-vision-environnement-'),
  );
  try {
    process.env.CCTV_PREFER_AUSTIN = '0';
    process.env.CCTV_FORCE_AUSTIN = '0';
    process.env.CCTV_MAX_SOURCES = '5000';
    process.env.CCTV_SOURCES_FILE = path.join(
      projectRoot,
      'config',
      'cctv',
      'sources-not-configured.json',
    );
    delete process.env.CCTV_SOURCES_JSON;

    const pack = JSON.parse(
      fs.readFileSync(
        path.join(
          projectRoot,
          'config',
          'cctv',
          'live',
          'vision-environnement.json',
        ),
        'utf8',
      ),
    );
    const originalCatalog = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, 'config', 'cctvv_sources.camaras_espana.json'),
        'utf8',
      ),
    );
    const sourceIndex = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, 'config', 'cctv', 'index.json'),
        'utf8',
      ),
    );
    assert.ok(
      sourceIndex.packs.some(
        (entry) =>
          entry.id === 'vision-environnement-es' &&
          entry.file === 'live/vision-environnement.json' &&
          entry.enabled,
      ),
    );
    assert.deepEqual(
      pack.map((camera) => camera.name).sort(),
      originalCatalog.camaras
        .filter(
          (camera) =>
            camera.provider === 'ipcamlive' && camera.estado === 'confirmado',
        )
        .map((camera) => camera.nombre)
        .sort(),
    );
    assert.equal(pack.length, 25);

    const indexDirectory = path.join(sourceRoot, 'config', 'cctv');
    const packDirectory = path.join(indexDirectory, 'live');
    fs.mkdirSync(packDirectory, { recursive: true });
    fs.copyFileSync(
      path.join(
        projectRoot,
        'config',
        'cctv',
        'live',
        'vision-environnement.json',
      ),
      path.join(packDirectory, 'vision-environnement.json'),
    );
    fs.writeFileSync(
      path.join(indexDirectory, 'index.json'),
      JSON.stringify({
        packs: sourceIndex.packs.filter(
          (entry) => entry.id === 'vision-environnement-es',
        ),
      }),
    );
    delete process.env.CCTV_PACK_INDEX_FILE;
    const sources = await createCctvCatalog({ sourceRoot })();
    const loaded = sources.filter((source) =>
      source.id.startsWith('vision-es-'),
    );
    assert.equal(loaded.length, 25);
    for (const camera of loaded) {
      assert.equal(camera.provider, 'Vision-Environnement');
      assert.equal(camera.feedType, 'image');
      assert.equal(camera.sourceKind, 'vision-environnement-snapshot');
      assert.match(
        camera.url,
        /^https:\/\/www\.vision-environnement\.com\/live\/image\/webcam\/.+\.JPG$/,
      );
      assert.match(
        camera.sourceUrl,
        /^https:\/\/www\.vision-environnement\.com\/es\/webcam\/espana\/.+\/$/,
      );
      assert.ok(Number.isFinite(camera.lat));
      assert.ok(Number.isFinite(camera.lon));
    }
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});
