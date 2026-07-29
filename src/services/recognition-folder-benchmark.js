import path from 'node:path';
import { normalizeBenchmarkCase } from './recognition-benchmark.js';
import { normalizeText } from './utils.js';

export const RECOGNITION_IMAGE_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

export function isSupportedBenchmarkImage(filePath = '') {
  return RECOGNITION_IMAGE_EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase());
}

export function benchmarkImageKey(value = '') {
  const name = path.basename(String(value || '').replaceAll('\\', '/'));
  const withoutExtension = name.replace(/\.[A-Za-z0-9]+$/, '');
  return normalizeText(withoutExtension).replace(/\s+/g, '');
}

function caseKeys(testCase = {}) {
  return [
    testCase.imageRef,
    testCase.body?.imageName,
    testCase.imageName,
    testCase.fileName,
    testCase.imagePath,
    testCase.id,
  ].map(benchmarkImageKey).filter(Boolean);
}

function imageRecord(input) {
  if (typeof input === 'string') {
    return {
      imagePath: input,
      imageName: path.basename(input),
      imageRef: input,
      key: benchmarkImageKey(input),
    };
  }
  return {
    imagePath: input.imagePath || input.fullPath || input.path || '',
    imageName: input.imageName || input.fileName || path.basename(input.imagePath || input.path || ''),
    imageRef: input.imageRef || input.relativePath || input.imagePath || input.path || '',
    key: benchmarkImageKey(input.imageRef || input.relativePath || input.imageName || input.fileName || input.imagePath || input.path || input.id),
  };
}

export function pairImagesWithBenchmarkCases(images = [], cases = [], { sourceName = 'Folder Recognition Benchmark' } = {}) {
  const normalizedImages = images.filter((item) => isSupportedBenchmarkImage(typeof item === 'string' ? item : item.imagePath || item.path || item.fileName || item.imageName)).map(imageRecord);
  const labelMap = new Map();
  const duplicateLabelKeys = [];
  const normalizedCases = cases.map((item) => normalizeBenchmarkCase(item, { sourceName }));

  for (const testCase of normalizedCases) {
    const keys = caseKeys(testCase);
    for (const key of keys) {
      if (!key) continue;
      if (labelMap.has(key) && labelMap.get(key) !== testCase) duplicateLabelKeys.push(key);
      else labelMap.set(key, testCase);
    }
  }

  const pairedCases = [];
  const matchedLabelIds = new Set();
  const unlabeledImages = [];
  for (const image of normalizedImages) {
    const label = labelMap.get(image.key);
    if (!label) {
      unlabeledImages.push(image);
      continue;
    }
    matchedLabelIds.add(label.id);
    pairedCases.push({
      ...label,
      imageRef: image.imageRef,
      body: {
        ...label.body,
        imageName: image.imageName || label.body?.imageName,
      },
      folderImage: {
        imagePath: image.imagePath,
        imageName: image.imageName,
        imageRef: image.imageRef,
      },
    });
  }

  const unmatchedLabels = normalizedCases.filter((testCase) => !matchedLabelIds.has(testCase.id));
  return {
    pairedCases,
    unlabeledImages,
    unmatchedLabels,
    duplicateLabelKeys: [...new Set(duplicateLabelKeys)],
    summary: {
      imagesFound: normalizedImages.length,
      labeledImages: pairedCases.length,
      unlabeledImages: unlabeledImages.length,
      labelsLoaded: normalizedCases.length,
      unmatchedLabels: unmatchedLabels.length,
      duplicateLabelKeys: new Set(duplicateLabelKeys).size,
    },
  };
}
