import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  benchmarkManifestDigest,
  buildBenchmarkManifest,
  readImageDimensions,
  serializeBenchmarkManifest,
  validateBenchmarkManifest,
} from '../src/services/benchmark-manifest.js';

function png(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width, height) {
  const bytes = Buffer.alloc(23);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes[11] = 3;
  bytes.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9], 12);
  return bytes;
}

test('benchmark manifest recursively inventories supported images deterministically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maneflow-manifest-'));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'b.JPG'), jpeg(714, 1000));
  await writeFile(path.join(root, 'nested', 'a.png'), png(1320, 2868));
  await writeFile(path.join(root, 'ignore.txt'), 'not an image');

  const rows = await buildBenchmarkManifest({
    rootDirectory: root,
    rightsStatus: 'owner-controlled',
    split: 'locked_test',
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.source_path), ['b.JPG', 'nested/a.png']);
  assert.deepEqual(rows.map((row) => [row.width, row.height]), [[714, 1000], [1320, 2868]]);
  assert.ok(rows.every((row) => row.locked));
  assert.ok(rows.every((row) => row.training_use_allowed === false));
  assert.equal(validateBenchmarkManifest(rows).valid, true);
  assert.match(benchmarkManifestDigest(rows), /^[a-f0-9]{64}$/);
  assert.ok(serializeBenchmarkManifest(rows).endsWith('\n'));
});

test('exact duplicate image bytes share one physical-card group', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maneflow-manifest-'));
  const bytes = png(900, 1200);
  await writeFile(path.join(root, 'first.png'), bytes);
  await writeFile(path.join(root, 'second.png'), bytes);

  const rows = await buildBenchmarkManifest({
    rootDirectory: root,
    rightsStatus: 'owner-controlled',
  });

  assert.equal(rows[0].sha256, rows[1].sha256);
  assert.equal(rows[0].physical_card_group_id, rows[1].physical_card_group_id);
  const validation = validateBenchmarkManifest(rows);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /duplicate asset_id/);
});

test('manifest validator rejects physical-card leakage across splits', () => {
  const base = {
    manifest_version: 'maneflow-benchmark-v1',
    source_type: 'owner-controlled-folder',
    mime_type: 'image/png',
    byte_size: 24,
    rights_status: 'owner-controlled',
    identity_label_status: 'human-verified',
    annotation_status: 'locked',
    training_use_allowed: true,
  };
  const rows = [
    {
      ...base,
      asset_id: 'asset_a',
      source_path: 'front.png',
      sha256: 'a'.repeat(64),
      physical_card_group_id: 'physical-card-1',
      split: 'train',
    },
    {
      ...base,
      asset_id: 'asset_b',
      source_path: 'back.png',
      sha256: 'b'.repeat(64),
      physical_card_group_id: 'physical-card-1',
      split: 'locked_test',
    },
  ];

  const validation = validateBenchmarkManifest(rows);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /leaks across splits/);
});

test('training use is rejected for transient or unclear rights', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maneflow-manifest-'));
  await writeFile(path.join(root, 'card.png'), png(714, 1000));
  await assert.rejects(
    () => buildBenchmarkManifest({
      rootDirectory: root,
      rightsStatus: 'transient-evaluation',
      trainingUseAllowed: true,
    }),
    /Training use is not allowed/,
  );
});

test('dimension parsers handle supported headers', () => {
  assert.deepEqual(readImageDimensions(png(640, 480), 'image/png'), { width: 640, height: 480 });
  assert.deepEqual(readImageDimensions(jpeg(714, 1000), 'image/jpeg'), { width: 714, height: 1000 });
  assert.equal(readImageDimensions(Buffer.from('not-an-image'), 'image/png'), null);
});
