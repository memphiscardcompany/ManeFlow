import fs from 'node:fs/promises';
import path from 'node:path';

export const BUNDLED_CATALOG_FILES = Object.freeze([
  { name: 'cards.json', required: true },
  { name: 'cards.memphis-owned.json', required: false },
  { name: 'cards.tcg-imported.json', required: false },
]);

async function readCatalogArray(filePath, { required, readFile }) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new TypeError(`Catalog file must contain a JSON array: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function loadBundledCatalog(root, { readFile = fs.readFile } = {}) {
  const dataDirectory = path.join(path.resolve(root), 'src', 'data');
  const groups = await Promise.all(BUNDLED_CATALOG_FILES.map(({ name, required }) => (
    readCatalogArray(path.join(dataDirectory, name), { required, readFile })
  )));
  return groups.flat();
}
