import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const IMAGE_MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
]);

const ALLOWED_SPLITS = new Set(['unassigned', 'train', 'validation', 'calibration', 'test', 'locked_test']);
const ALLOWED_RIGHTS = new Set([
  'owner-controlled',
  'explicitly-licensed',
  'partner-approved',
  'public-domain',
  'permissive-open-license',
  'transient-evaluation',
  'terms-unclear',
  'prohibited',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function parsePngDimensions(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function parseJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebpDimensions(bytes) {
  if (
    bytes.length < 30
    || bytes.subarray(0, 4).toString('ascii') !== 'RIFF'
    || bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) return null;
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  return null;
}

export function readImageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png') return parsePngDimensions(bytes);
  if (mimeType === 'image/jpeg') return parseJpegDimensions(bytes);
  if (mimeType === 'image/webp') return parseWebpDimensions(bytes);
  return null;
}

async function walk(root, current, output) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, fullPath, output);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (!IMAGE_MIME_BY_EXTENSION.has(extension)) continue;
    output.push(fullPath);
  }
}

export async function listBenchmarkImages(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const metadata = await stat(root);
  if (!metadata.isDirectory()) throw new Error('Benchmark root must be a directory.');
  const files = [];
  await walk(root, root, files);
  return files;
}

export async function buildBenchmarkManifest({
  rootDirectory,
  rightsStatus,
  split = 'unassigned',
  sourceType = 'owner-controlled-folder',
  trainingUseAllowed = false,
  manifestVersion = 'maneflow-benchmark-v1',
} = {}) {
  if (!rootDirectory) throw new Error('rootDirectory is required.');
  if (!ALLOWED_RIGHTS.has(rightsStatus)) throw new Error(`Unsupported rights status: ${rightsStatus}`);
  if (!ALLOWED_SPLITS.has(split)) throw new Error(`Unsupported split: ${split}`);
  if (trainingUseAllowed && ['transient-evaluation', 'terms-unclear', 'prohibited'].includes(rightsStatus)) {
    throw new Error(`Training use is not allowed for rights status: ${rightsStatus}`);
  }

  const root = path.resolve(rootDirectory);
  const files = await listBenchmarkImages(root);
  const rows = [];
  for (const filePath of files) {
    const bytes = await readFile(filePath);
    const digest = sha256(bytes);
    const relativePath = normalizeRelativePath(root, filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXTENSION.get(extension);
    const dimensions = readImageDimensions(bytes, mimeType);
    const sourceIdentity = sha256(Buffer.from(`${digest}:${relativePath}`, 'utf8'));
    rows.push({
      manifest_version: manifestVersion,
      asset_id: `asset_${sourceIdentity.slice(0, 24)}`,
      source_path: relativePath,
      source_type: sourceType,
      sha256: digest,
      perceptual_hash: null,
      mime_type: mimeType,
      byte_size: bytes.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      orientation: null,
      rights_status: rightsStatus,
      retention_policy: rightsStatus === 'transient-evaluation' ? 'delete_after_evaluation' : 'private_manifest_controlled',
      training_use_allowed: Boolean(trainingUseAllowed),
      scene_label: 'unlabeled',
      expected_card_count: null,
      physical_card_group_id: `exact_${digest.slice(0, 24)}`,
      identity_label_status: 'unlabeled',
      annotation_status: 'pending',
      split,
      locked: split === 'locked_test',
    });
  }
  return rows;
}

export function serializeBenchmarkManifest(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

export function benchmarkManifestDigest(rows) {
  return sha256(Buffer.from(serializeBenchmarkManifest(rows), 'utf8'));
}

export function validateBenchmarkManifest(rows) {
  const errors = [];
  const assetIds = new Set();
  const sourcePaths = new Set();
  const groups = new Map();
  const hashes = new Map();

  rows.forEach((row, index) => {
    const prefix = `row ${index + 1}`;
    for (const field of [
      'manifest_version', 'asset_id', 'source_path', 'source_type', 'sha256',
      'mime_type', 'byte_size', 'rights_status', 'physical_card_group_id',
      'identity_label_status', 'annotation_status', 'split',
    ]) {
      if (row?.[field] === null || row?.[field] === undefined || row?.[field] === '') {
        errors.push(`${prefix}: missing ${field}`);
      }
    }
    if (!/^[a-f0-9]{64}$/.test(String(row?.sha256 || ''))) errors.push(`${prefix}: invalid sha256`);
    if (!ALLOWED_RIGHTS.has(row?.rights_status)) errors.push(`${prefix}: invalid rights_status`);
    if (!ALLOWED_SPLITS.has(row?.split)) errors.push(`${prefix}: invalid split`);
    if (row?.training_use_allowed && ['transient-evaluation', 'terms-unclear', 'prohibited'].includes(row?.rights_status)) {
      errors.push(`${prefix}: training use conflicts with rights status`);
    }
    if (assetIds.has(row?.asset_id)) errors.push(`${prefix}: duplicate asset_id`);
    assetIds.add(row?.asset_id);
    if (sourcePaths.has(row?.source_path)) errors.push(`${prefix}: duplicate source_path`);
    sourcePaths.add(row?.source_path);

    if (!groups.has(row?.physical_card_group_id)) groups.set(row?.physical_card_group_id, new Set());
    if (row?.split !== 'unassigned') groups.get(row?.physical_card_group_id).add(row?.split);

    const priorGroup = hashes.get(row?.sha256);
    if (priorGroup && priorGroup !== row?.physical_card_group_id) {
      errors.push(`${prefix}: exact duplicate hash assigned to different physical-card groups`);
    }
    hashes.set(row?.sha256, row?.physical_card_group_id);
  });

  for (const [groupId, splits] of groups) {
    if (splits.size > 1) errors.push(`physical card group ${groupId} leaks across splits: ${[...splits].sort().join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      row_count: rows.length,
      unique_hash_count: hashes.size,
      exact_duplicate_count: Math.max(0, rows.length - hashes.size),
      physical_card_group_count: groups.size,
      training_eligible_count: rows.filter((row) => row.training_use_allowed).length,
      locked_test_count: rows.filter((row) => row.split === 'locked_test').length,
    },
  };
}
