import test from 'node:test';
import assert from 'node:assert/strict';
import { EbayProvider, ebayImageCandidates, inferEbayBenchmarkSceneType } from '../src/providers/ebay.js';
import { normalizeCatalogCard, rankCards } from '../src/services/catalog.js';
import { recognizeCardScene } from '../src/services/recognition-engine.js';

test('eBay listing image discovery uses official API payloads and labels images benchmark-only', async () => {
  const provider = new EbayProvider({
    ebayClientId: 'client',
    ebayClientSecret: 'secret',
    ebayFetch: async (url) => {
      if (String(url).includes('/identity/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).includes('/buy/browse/v1/item_summary/search')) {
        return new Response(JSON.stringify({
          itemSummaries: [{
            itemId: 'v1|123|0',
            title: 'Shohei Ohtani lot mixed Angels Dodgers cards',
            itemWebUrl: 'https://www.ebay.com/itm/123',
            price: { value: '24.99', currency: 'USD' },
            image: { imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg', width: 500, height: 500 },
            thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/thumbs/images/g/example/s-l225.jpg', width: 225, height: 225 }],
            buyingOptions: ['FIXED_PRICE'],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const report = await provider.discoverListingImages({ query: 'shohei lot', limit: 1 });
  assert.equal(report.provider, 'eBay Browse Listing Images');
  assert.equal(report.totalListings, 1);
  assert.equal(report.totalImages, 2);
  assert.equal(report.valuationUse, false);
  assert.equal(report.publicCatalogImage, false);
  assert.equal(report.items[0].sceneType, 'multi_card_table');
  assert.equal(report.items[0].images[0].benchmarkOnly, true);
  assert.match(report.items[0].images[0].rightsNotes, /internal scanner benchmarking/i);
});

test('eBay image and scene helpers support group lots and sealed wax products', () => {
  const images = ebayImageCandidates({
    image: { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg', width: 1600, height: 1200 },
    additionalImages: [
      { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg' },
      { imageUrl: 'http://not-secure.example/image.jpg' },
      { imageUrl: 'https://i.ebayimg.com/images/g/def/s-l1600.jpg' },
    ],
  });
  assert.equal(images.length, 2);
  assert.equal(inferEbayBenchmarkSceneType({ title: 'Shohei Ohtani lot collection mixed cards' }), 'multi_card_table');
  assert.equal(inferEbayBenchmarkSceneType({ title: '2024 Topps Chrome Baseball Hobby Box sealed pack lot' }), 'sealed_product');
  assert.equal(inferEbayBenchmarkSceneType({ title: 'PSA 10 Shohei Ohtani rookie card cert visible' }), 'mixed_raw_slab');
});

test('sealed products can be catalog matched and recognized without forcing single-card fields', () => {
  const sealed = normalizeCatalogCard({
    productName: '2024 Topps Chrome Baseball Hobby Box',
    productType: 'Hobby Box',
    configuration: '24 packs per box',
    year: 2024,
    brand: 'Topps',
    set: 'Chrome Baseball',
    sport: 'Baseball',
    upc: '887521129999',
    isSealedProduct: true,
  });
  const matches = rankCards([sealed], '2024 Topps Chrome Baseball hobby box 24 packs 887521129999', { limit: 3 });
  assert.equal(matches[0].id, sealed.id);
  assert.ok(matches[0].confidence > 0.7);

  const recognition = recognizeCardScene({
    cards: [sealed],
    body: { imageName: '2024-topps-chrome-hobby-box.jpg', manualText: '2024 Topps Chrome Baseball Hobby Box 24 packs UPC 887521129999' },
    sceneAnalysis: {
      scene: { type: 'sealed_product', cardCount: 1 },
      detectedCards: [{
        regionId: 'box_1',
        cardType: 'sealed',
        facts: {
          productName: '2024 Topps Chrome Baseball Hobby Box',
          productType: 'Hobby Box',
          configuration: '24 packs per box',
          year: 2024,
          brand: 'Topps',
          set: 'Chrome Baseball',
          upc: '887521129999',
        },
        fieldConfidence: { productName: 0.92, productType: 0.9, configuration: 0.86, year: 0.88, brand: 0.9, set: 0.86, upc: 0.94 },
      }],
    },
  });
  assert.equal(recognition.scene.type, 'sealed_product');
  assert.equal(recognition.primary.cardType, 'sealed');
  assert.equal(recognition.primary.matches[0].id, sealed.id);
  assert.ok(recognition.primary.explanation.whyMatched.some((item) => /sealed product type/i.test(item)));
});
