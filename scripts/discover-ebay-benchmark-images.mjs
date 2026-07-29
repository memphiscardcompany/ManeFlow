import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EbayProvider } from '../src/providers/ebay.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function has(name) {
  return args.includes(`--${name}`);
}

function safeSlug(value = 'ebay-benchmark') {
  return String(value || 'ebay-benchmark')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'ebay-benchmark';
}

function queryFromUrl(value = '') {
  if (!/^https?:\/\//i.test(value)) return '';
  const url = new URL(value);
  return url.searchParams.get('_nkw') || url.searchParams.get('q') || '';
}

function queryFromArgs() {
  const query = arg('query') || queryFromUrl(arg('url'));
  if (!query.trim()) throw new Error('Provide --query "shohei lot" or --url "https://www.ebay.com/sch/i.html?_nkw=shohei+lot".');
  return query.replace(/\+/g, ' ').trim();
}

function configFromEnv() {
  return {
    ebayClientId: process.env.EBAY_CLIENT_ID || process.env.MANEFLOW_EBAY_CLIENT_ID || '',
    ebayClientSecret: process.env.EBAY_CLIENT_SECRET || process.env.MANEFLOW_EBAY_CLIENT_SECRET || '',
    ebayEnvironment: process.env.EBAY_ENVIRONMENT || process.env.MANEFLOW_EBAY_ENVIRONMENT || 'production',
    ebayMarketplaceId: process.env.EBAY_MARKETPLACE_ID || process.env.MANEFLOW_EBAY_MARKETPLACE_ID || 'EBAY_US',
    ebayRequestTimeoutMs: process.env.EBAY_REQUEST_TIMEOUT_MS || '15000',
    ebayMaxRetries: process.env.EBAY_MAX_RETRIES || '3',
    ebayUserAgent: process.env.EBAY_USER_AGENT || 'ManeFlow/2.5 internal recognition benchmark',
  };
}

function ensureCredentials(config) {
  if (!config.ebayClientId || !config.ebayClientSecret) {
    throw new Error('eBay Browse image discovery requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET. The tool uses official eBay APIs only and does not scrape listing pages.');
  }
}

function imageFileName({ listingIndex, imageIndex, itemId, url }) {
  const ext = /\.(jpe?g|png|webp)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase() || 'jpg';
  return `${String(listingIndex + 1).padStart(3, '0')}-${String(imageIndex + 1).padStart(2, '0')}-${safeSlug(itemId || 'ebay-item')}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

function allowedImageHost(urlString) {
  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (host === 'i.ebayimg.com' || host.endsWith('.ebayimg.com'));
}

async function downloadImage({ url, destination }) {
  if (!allowedImageHost(url)) throw new Error(`Refusing to download non-eBay image host: ${url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'ManeFlow/2.5 internal recognition benchmark' },
    });
    if (!response.ok) throw new Error(`Image download failed ${response.status}: ${url}`);
    const body = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, body);
    return body.length;
  } finally {
    clearTimeout(timeout);
  }
}

function buildBenchmarkArtifacts(discovery, { download, downloadDir }) {
  const images = [];
  const cases = [];
  discovery.items.forEach((item, listingIndex) => {
    item.images.forEach((image, imageIndex) => {
      const fileName = imageFileName({ listingIndex, imageIndex, itemId: item.itemId, url: image.url });
      const imageRef = download ? fileName : image.url;
      images.push({
        imageName: fileName,
        imageRef,
        imageUrl: image.url,
        itemId: item.itemId,
        listingUrl: item.url,
        title: item.title,
        sceneType: item.sceneType,
        rights: image,
      });
      cases.push({
        id: `ebay_${item.itemId || listingIndex}_${imageIndex + 1}`,
        imageName: fileName,
        imageRef,
        imageUrl: image.url,
        sceneType: item.sceneType,
        manualText: item.title,
        sourceMode: 'production',
        authorizationBasis: 'ebay_api',
        dataRightsStatus: 'active_listing_images_internal_benchmark_only',
        rightsNotes: 'Official eBay Browse API listing-image benchmark scaffold. Fill expectedCards manually before using this as an accuracy benchmark.',
        expectedCards: [],
        labelStatus: 'needs_manual_labeling',
      });
    });
  });
  return {
    manifest: {
      ...discovery,
      imageFilesDownloaded: download,
      downloadDir: download ? downloadDir : null,
      benchmarkImages: images,
    },
    labels: {
      sourceName: `eBay Browse Listing Images: ${discovery.query}`,
      generatedAt: discovery.generatedAt,
      benchmarkOnly: true,
      notes: 'This file is a label scaffold. Add expectedCards before using it for accuracy metrics.',
      cases,
    },
  };
}

function renderReadme({ query, download, outDir }) {
  return `# eBay Listing Image Benchmark Set

Query: \`${query}\`

This folder was created by ManeFlow's official eBay Browse API image discovery tool.

Use:

\`\`\`bash
npm run recognition:benchmark:folder -- --images ${download ? '.' : '<downloaded-images-folder>'} --labels labels.scaffold.json --source "eBay Browse Listing Images" --out ./recognition-report.json --summary
\`\`\`

Before treating this as an accuracy benchmark, manually fill \`expectedCards\` in \`labels.scaffold.json\`.

Rules:

- These images are internal scanner QA inputs only.
- Do not redistribute them as catalog artwork.
- Do not treat active listings as completed-sale comps.
- Do not use this folder for public market-value claims.
- Completed-sale pricing still requires authorized sold-data feeds.

Output directory:

\`\`\`text
${outDir}
\`\`\`
`;
}

if (has('help') || has('h')) {
  console.log('Usage: node scripts/discover-ebay-benchmark-images.mjs --query "shohei lot" --out ./.runtime/benchmarks/ebay-shohei-lot --limit 50 --download');
  console.log('       node scripts/discover-ebay-benchmark-images.mjs --url "https://www.ebay.com/sch/i.html?_nkw=shohei+lot" --out ./.runtime/benchmarks/ebay-shohei-lot');
  process.exit(0);
}

const query = queryFromArgs();
const outDir = path.resolve(arg('out', path.join(root, '.runtime', 'recognition-benchmarks', `ebay-${safeSlug(query)}`)));
const limit = Math.max(1, Math.min(200, Number(arg('limit', '50')) || 50));
const categoryIds = arg('category-ids') || arg('categoryIds') || null;
const download = has('download');
const includeAdditionalImages = has('include-additional-images');
const binOnly = has('bin-only');
const config = configFromEnv();
ensureCredentials(config);

const provider = new EbayProvider(config);
const discovery = await provider.discoverListingImages({
  query,
  limit,
  categoryIds,
  includeAdditionalImages,
  binOnly,
});
const { manifest, labels } = buildBenchmarkArtifacts(discovery, { download, downloadDir: outDir });

await fs.mkdir(outDir, { recursive: true });
if (download) {
  for (const image of manifest.benchmarkImages) {
    try {
      const bytes = await downloadImage({ url: image.imageUrl, destination: path.join(outDir, image.imageName) });
      image.downloaded = true;
      image.bytes = bytes;
    } catch (error) {
      image.downloaded = false;
      image.downloadError = error.message;
    }
  }
}

await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(outDir, 'labels.scaffold.json'), `${JSON.stringify(labels, null, 2)}\n`);
await fs.writeFile(path.join(outDir, 'README.md'), renderReadme({ query, download, outDir }));

console.log(JSON.stringify({
  query,
  outDir,
  listings: discovery.totalListings,
  images: discovery.totalImages,
  downloaded: download ? manifest.benchmarkImages.filter((image) => image.downloaded).length : 0,
  labelScaffold: path.join(outDir, 'labels.scaffold.json'),
  manifest: path.join(outDir, 'manifest.json'),
  note: 'Fill expectedCards before using the scaffold as an accuracy benchmark.',
}, null, 2));
