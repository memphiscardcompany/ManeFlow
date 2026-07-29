const LOCAL_ASSET_PATTERN = /^\/assets\/[a-z0-9._/-]+\.(svg|png|jpe?g|webp|avif)$/i;
const HTTPS_PATTERN = /^https:\/\//i;
const TOKEN_PATTERN = /\{([a-zA-Z0-9_.]+)\}/g;

export const CARD_IMAGE_PLACEHOLDER = '/assets/card-placeholder.svg';

const APPROVED_PROVIDER_AUTHORIZATION = new Set([
  'official_api',
  'ebay_api',
  'written_license',
  'commercial_partner',
  'user_authorized_export',
  'user_csv',
]);

export const BUILT_IN_IMAGE_SOURCES = Object.freeze([
  {
    key: 'pokemon_tcg_api',
    label: 'Pokemon TCG API',
    hosts: ['images.pokemontcg.io'],
    mode: 'catalog_image',
    rightsStatus: 'public_catalog_api_image',
    rightsNotes: 'Pokemon TCG API card objects include remote small/large image URLs. ManeFlow stores identity and URL references, not a local image catalog.',
  },
  {
    key: 'tcgdex_api',
    label: 'TCGdex API',
    hosts: ['assets.tcgdex.net'],
    mode: 'catalog_image',
    rightsStatus: 'public_catalog_api_image',
    rightsNotes: 'TCGdex card objects can include remote artwork URLs. ManeFlow stores identity and URL references, not a local image catalog.',
  },
  {
    key: 'scryfall_bulk',
    label: 'Scryfall Bulk Data',
    hosts: ['cards.scryfall.io'],
    mode: 'catalog_image',
    rightsStatus: 'public_catalog_api_image',
    rightsNotes: 'Scryfall card data can include image_uris. ManeFlow uses returned image URLs and does not scrape image pages.',
  },
  {
    key: 'lorcast_api',
    label: 'Lorcast API',
    hosts: ['cards.lorcast.io'],
    mode: 'catalog_image',
    rightsStatus: 'public_catalog_api_image',
    rightsNotes: 'Lorcast card objects include image_uris served from its image CDN. ManeFlow uses the returned URI rather than guessing paths.',
  },
  {
    key: 'ygoprodeck_api',
    label: 'YGOPRODeck API',
    hosts: ['images.ygoprodeck.com'],
    mode: 'catalog_image',
    rightsStatus: 'public_catalog_api_image',
    rightsNotes: 'YGOPRODeck card objects return image_url values. ManeFlow uses returned URLs and respects provider caching/rate guidance.',
  },
  {
    key: 'tcgplayer_media',
    label: 'TCGplayer Product Media',
    hosts: ['6d4be195623157e28848-7697ece4918e0a73861de0eb37d08968.ssl.cf1.rackcdn.com'],
    mode: 'approved_product_media',
    rightsStatus: 'approved_api_product_media',
    rightsNotes: 'TCGplayer product media is used only when approved API credentials or owner-authorized media exports provide the URL. Owners can add additional approved media hosts in configuration.',
  },
  {
    key: 'ebay_api',
    label: 'eBay API',
    hosts: ['i.ebayimg.com', 'thumbs.ebaystatic.com'],
    mode: 'provider_sale_image',
    rightsStatus: 'official_api_item_image_context',
    rightsNotes: 'eBay item images are used only when returned by authorized eBay API, seller-order, or owner-authorized import flows. Active listings remain context only.',
  },
]);

const DEFAULT_REMOTE_HOSTS = Object.freeze(
  [...new Set(BUILT_IN_IMAGE_SOURCES.flatMap((source) => source.hosts))]
);

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function safeSegment(value) {
  return encodeURIComponent(String(value ?? '').trim().replace(/\s+/g, ' '));
}

function fieldValue(card, key) {
  if (key.includes('.')) {
    return key.split('.').reduce((value, part) => value?.[part], card);
  }
  return card?.[key];
}

function hostFor(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedRemote(value, allowedHosts) {
  if (!HTTPS_PATTERN.test(String(value || ''))) return false;
  const host = hostFor(value);
  return Boolean(host && allowedHosts.has(host));
}

function isLocalAsset(value) {
  return LOCAL_ASSET_PATTERN.test(String(value || ''));
}

function renderTemplate(template, card) {
  if (!template) return '';
  return template.replace(TOKEN_PATTERN, (_, key) => safeSegment(fieldValue(card, key)));
}

function sourceForHost(host) {
  return BUILT_IN_IMAGE_SOURCES.find((source) => source.hosts.includes(host)) || null;
}

function imageCandidatesFromSale(sale = {}) {
  return [
    sale.imageUrl,
    sale.imageURL,
    sale.image,
    sale.thumbnailUrl,
    sale.thumbnailURL,
    sale.thumbnail,
    sale.primaryImageUrl,
    sale.primaryImageURL,
    sale.mediaUrl,
    sale.pictureUrl,
  ].filter(Boolean);
}

function saleCanSupplyImage(sale = {}) {
  const authorizationBasis = String(sale.authorizationBasis || '').trim();
  const sourceMode = String(sale.sourceMode || '').trim();
  const completedSale = sale.isCompletedSale === true || ['sold', 'completed', 'completed_sale'].includes(String(sale.sourceType || sale.listingType || '').toLowerCase());
  if (sourceMode === 'demo') return completedSale;
  return completedSale && APPROVED_PROVIDER_AUTHORIZATION.has(authorizationBasis);
}

function dateValue(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function providerImageFromSales(card = {}, sales = [], options) {
  if (!Array.isArray(sales) || !sales.length) return null;
  const cardSales = sales
    .filter((sale) => !card.id || sale.cardId === card.id)
    .filter(saleCanSupplyImage)
    .sort((a, b) => dateValue(b.soldAt || b.importedAt) - dateValue(a.soldAt || a.importedAt));

  for (const sale of cardSales) {
    for (const candidate of imageCandidatesFromSale(sale)) {
      const normalized = normalizeCardImageUrl(candidate, options);
      if (!normalized?.remote) continue;
      const source = sourceForHost(normalized.host);
      return {
        url: normalized.url,
        kind: 'provider_sale_image',
        remote: true,
        host: normalized.host,
        sale,
        source,
      };
    }
  }
  return null;
}

function imageOverrideForCard(card = {}, overrides = {}, options) {
  const override = card.id ? overrides[card.id] : null;
  if (!override || override.disabledAt) return null;
  const normalized = normalizeCardImageUrl(override.imageUrl || override.image, options);
  if (!normalized?.remote) return null;
  const source = sourceForHost(normalized.host);
  return {
    url: normalized.url,
    kind: 'image_enrichment_override',
    remote: true,
    host: normalized.host,
    override,
    source,
  };
}

export function imageConfig(config = {}) {
  const remoteHosts = [
    ...DEFAULT_REMOTE_HOSTS,
    ...splitList(config.remoteImageHosts),
    ...splitList(config.cardImageAllowedHosts),
  ];
  return {
    allowedHosts: new Set(remoteHosts),
    template: String(config.cardImageTemplate || '').trim(),
    templateSource: String(config.cardImageSource || 'configured_remote_image_source').trim(),
    rightsNotes: String(config.cardImageRightsNotes || 'Catalog images are loaded remotely only from configured, rights-approved sources.').trim(),
  };
}

export function imageSourceStatus(config = {}) {
  const options = imageConfig(config);
  const configuredHosts = [...options.allowedHosts].sort();
  return {
    version: 'card-image-sources-v1.1',
    placeholder: CARD_IMAGE_PLACEHOLDER,
    configuredHosts,
    remoteTemplateEnabled: Boolean(options.template),
    builtInSources: BUILT_IN_IMAGE_SOURCES.map((source) => ({
      key: source.key,
      label: source.label,
      hosts: source.hosts,
      enabled: source.hosts.some((host) => options.allowedHosts.has(host)),
      mode: source.mode,
      rightsStatus: source.rightsStatus,
      rightsNotes: source.rightsNotes,
    })),
    policy: 'ManeFlow loads remote images only from configured/approved source hosts, stores catalog identity separately from image files, and falls back to a local placeholder when no usable image source exists.',
  };
}

export function normalizeCardImageUrl(value, options = imageConfig()) {
  const raw = String(value || '').trim();
  if (!raw || raw === CARD_IMAGE_PLACEHOLDER) return null;
  if (isLocalAsset(raw)) return { url: raw, kind: 'local_asset', remote: false };
  if (isAllowedRemote(raw, options.allowedHosts)) {
    return { url: raw, kind: 'remote_source', remote: true, host: hostFor(raw) };
  }
  return null;
}

function altText(card = {}) {
  return [card.year, card.brand, card.set, card.player, card.cardNumber ? `#${card.cardNumber}` : ''].filter(Boolean).join(' ');
}

export function resolveCardImage(card = {}, config = {}, context = {}) {
  const options = config.allowedHosts ? config : imageConfig(config);
  const overrideImage = imageOverrideForCard(card, context.imageOverrides || {}, options);
  if (overrideImage) {
    return {
      url: overrideImage.url,
      alt: altText(card),
      meta: {
        status: overrideImage.kind,
        source: overrideImage.source?.key || overrideImage.override.source || overrideImage.host,
        sourceLabel: overrideImage.source?.label || overrideImage.override.source || overrideImage.host,
        host: overrideImage.host,
        remote: true,
        placeholder: false,
        rightsStatus: overrideImage.override.dataRightsStatus || overrideImage.source?.rightsStatus || 'approved_image_override',
        rightsNotes: overrideImage.override.rightsNotes || overrideImage.source?.rightsNotes || 'Image URL came from an approved image enrichment record.',
        providerBatchId: overrideImage.override.providerBatchId || null,
        importedBy: overrideImage.override.importedBy || null,
      },
    };
  }

  const direct = normalizeCardImageUrl(card.image || card.imageUrl, options);
  if (direct) {
    const source = direct.remote ? sourceForHost(direct.host) : null;
    return {
      url: direct.url,
      alt: altText(card),
      meta: {
        status: direct.kind,
        source: direct.remote ? (source?.key || direct.host) : 'bundled_demo_asset',
        sourceLabel: direct.remote ? (source?.label || direct.host) : 'Bundled demo asset',
        host: direct.host || null,
        remote: direct.remote,
        placeholder: false,
        rightsStatus: direct.remote ? (source?.rightsStatus || 'configured_remote_source') : 'bundled_demo_asset',
        rightsNotes: direct.remote ? (source?.rightsNotes || options.rightsNotes) : 'Bundled demonstration artwork for example cards.',
      },
    };
  }

  const templated = renderTemplate(options.template, card);
  if (templated && isAllowedRemote(templated, options.allowedHosts)) {
    const host = hostFor(templated);
    const source = sourceForHost(host);
    return {
      url: templated,
      alt: altText(card),
      meta: {
        status: 'remote_template',
        source: options.templateSource || source?.key || host,
        sourceLabel: source?.label || options.templateSource,
        host,
        remote: true,
        placeholder: false,
        rightsStatus: source?.rightsStatus || 'configured_remote_source',
        rightsNotes: source?.rightsNotes || options.rightsNotes,
      },
    };
  }

  const providerImage = providerImageFromSales(card, context.sales, options);
  if (providerImage) {
    const sale = providerImage.sale;
    return {
      url: providerImage.url,
      alt: altText(card),
      meta: {
        status: providerImage.kind,
        source: providerImage.source?.key || sale.provider || providerImage.host,
        sourceLabel: providerImage.source?.label || sale.provider || providerImage.host,
        host: providerImage.host,
        remote: true,
        placeholder: false,
        rightsStatus: providerImage.source?.rightsStatus || sale.dataRightsStatus || 'authorized_provider_image',
        rightsNotes: sale.rightsNotes || providerImage.source?.rightsNotes || 'Image URL came from an authorized provider/import record associated with this card.',
        provider: sale.provider || null,
        providerRunId: sale.providerRunId || null,
        providerBatchId: sale.providerBatchId || null,
        saleId: sale.id || null,
      },
    };
  }

  return {
    url: CARD_IMAGE_PLACEHOLDER,
    alt: altText(card) || 'Card image pending',
    meta: {
      status: 'placeholder',
      source: 'maneflow_placeholder',
      sourceLabel: 'ManeFlow placeholder',
      host: null,
      remote: false,
      placeholder: true,
      rightsStatus: 'identity_only_no_image_source',
      rightsNotes: 'ManeFlow has catalog identity for this card, but no configured image source with usable rights.',
    },
  };
}

export function attachCardImage(card = {}, config = {}, context = {}) {
  const resolved = resolveCardImage(card, config, context);
  return {
    ...card,
    image: resolved.url,
    imageAlt: resolved.alt,
    imageMeta: resolved.meta,
  };
}
