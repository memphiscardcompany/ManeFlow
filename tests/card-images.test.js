import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCardImage, CARD_IMAGE_PLACEHOLDER, imageConfig, imageSourceStatus, resolveCardImage } from '../src/services/card-images.js';

const card = {
  id: 'card_test',
  year: 2026,
  brand: 'Topps',
  set: 'Chrome Baseball',
  player: 'Test Player',
  cardNumber: '101',
};

test('card image resolver keeps bundled local assets', () => {
  const resolved = resolveCardImage({ ...card, image: '/assets/ohtani-card.svg' });
  assert.equal(resolved.url, '/assets/ohtani-card.svg');
  assert.equal(resolved.meta.placeholder, false);
  assert.equal(resolved.meta.rightsStatus, 'bundled_demo_asset');
});

test('card image resolver falls back for identity-only cards', () => {
  const resolved = resolveCardImage({ ...card, image: '' });
  assert.equal(resolved.url, CARD_IMAGE_PLACEHOLDER);
  assert.equal(resolved.meta.placeholder, true);
  assert.equal(resolved.meta.rightsStatus, 'identity_only_no_image_source');
});

test('card image resolver allows approved remote image hosts only', () => {
  const allowed = resolveCardImage({ ...card, image: 'https://images.pokemontcg.io/sv1/1.png' });
  assert.equal(allowed.url, 'https://images.pokemontcg.io/sv1/1.png');
  assert.equal(allowed.meta.remote, true);
  assert.equal(allowed.meta.source, 'pokemon_tcg_api');

  const blocked = resolveCardImage({ ...card, image: 'https://unapproved.example.com/card.png' });
  assert.equal(blocked.url, CARD_IMAGE_PLACEHOLDER);
  assert.equal(blocked.meta.placeholder, true);
});

test('card image resolver supports configured remote templates', () => {
  const config = imageConfig({
    remoteImageHosts: ['cdn.example.com'],
    cardImageTemplate: 'https://cdn.example.com/cards/{year}/{brand}/{cardNumber}.jpg',
    cardImageSource: 'licensed_test_cdn',
  });
  const attached = attachCardImage(card, config);
  assert.equal(attached.image, 'https://cdn.example.com/cards/2026/Topps/101.jpg');
  assert.equal(attached.imageMeta.source, 'licensed_test_cdn');
  assert.equal(attached.imageMeta.placeholder, false);
});

test('card image resolver uses authorized provider sale images when catalog is identity-only', () => {
  const resolved = resolveCardImage(card, {}, {
    sales: [{
      id: 'sale_ebay_1',
      provider: 'eBay Seller Orders',
      cardId: 'card_test',
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      isCompletedSale: true,
      soldAt: '2026-07-01T00:00:00.000Z',
      imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg',
      rightsNotes: 'Authorized eBay API image context.',
    }],
  });
  assert.equal(resolved.url, 'https://i.ebayimg.com/images/g/example/s-l500.jpg');
  assert.equal(resolved.meta.status, 'provider_sale_image');
  assert.equal(resolved.meta.source, 'ebay_api');
  assert.equal(resolved.meta.saleId, 'sale_ebay_1');
});

test('card image resolver refuses active listing images as canonical card images', () => {
  const resolved = resolveCardImage(card, {}, {
    sales: [{
      id: 'active_ebay_1',
      provider: 'eBay Browse',
      cardId: 'card_test',
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      isCompletedSale: false,
      sourceType: 'active_listing',
      imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg',
    }],
  });
  assert.equal(resolved.url, CARD_IMAGE_PLACEHOLDER);
  assert.equal(resolved.meta.placeholder, true);
});

test('card image source status exposes built-in image sources', () => {
  const status = imageSourceStatus();
  assert.equal(status.placeholder, CARD_IMAGE_PLACEHOLDER);
  assert.ok(status.configuredHosts.includes('images.pokemontcg.io'));
  assert.ok(status.configuredHosts.includes('assets.tcgdex.net'));
  assert.ok(status.configuredHosts.includes('cards.lorcast.io'));
  assert.ok(status.configuredHosts.includes('images.ygoprodeck.com'));
  assert.ok(status.configuredHosts.includes('i.ebayimg.com'));
  assert.ok(status.builtInSources.some((source) => source.key === 'ebay_api' && source.enabled));
});
