import { makeId, normalizeText, roundMoney, safeDate } from './utils.js';

const GRADE_ALIASES = new Map([
  ['psa 10', { company: 'PSA', grade: '10' }],
  ['psa10', { company: 'PSA', grade: '10' }],
  ['bgs 9 5', { company: 'BGS', grade: '9.5' }],
  ['bgs95', { company: 'BGS', grade: '9.5' }],
  ['sgc 10', { company: 'SGC', grade: '10' }],
  ['cgc 10', { company: 'CGC', grade: '10' }],
  ['raw', { company: 'RAW', grade: 'Raw' }],
]);

export function normalizeGrade(input = {}) {
  if (typeof input === 'string') {
    const compact = normalizeText(input);
    return GRADE_ALIASES.get(compact) || { company: 'OTHER', grade: input.trim() };
  }
  const company = String(input.company || input.grader || 'RAW').toUpperCase();
  const grade = String(input.grade ?? (company === 'RAW' ? 'Raw' : '')).trim();
  return { company, grade: grade || 'Unknown' };
}

export function normalizeSale(raw, providerName = 'unknown') {
  const sourceTypeText = String(raw.sourceType || '').toLowerCase();
  const listingTypeText = String(raw.listingType || '').toLowerCase();
  const saleTypeText = String(raw.saleType || '').toLowerCase();
  const activeHint = ['active', 'asking', 'current', 'for_sale', 'live_listing'].includes(sourceTypeText)
    || ['active', 'asking', 'current', 'buy_it_now_asking'].includes(listingTypeText)
    || ['asking'].includes(saleTypeText);
  const explicitCompleted = raw.isCompletedSale === true
    || ['sold', 'completed_sale', 'completed'].includes(sourceTypeText)
    || ['sold', 'completed', 'completed_sale'].includes(listingTypeText)
    || ['auction', 'fixed_price', 'fixed price', 'best_offer', 'best offer', 'private'].includes(saleTypeText)
    || (Boolean(raw.soldAt || raw.date || raw.endedAt) && !activeHint);
  const sourceType = raw.sourceType || (explicitCompleted ? 'sold' : 'active_listing');
  const listingType = raw.listingType || (explicitCompleted ? 'completed' : 'active');
  const saleType = raw.saleType || (explicitCompleted ? 'fixed_price' : 'asking');
  const soldAt = explicitCompleted ? safeDate(raw.soldAt || raw.date || raw.endedAt) : null;
  const price = Number(raw.price ?? raw.amount ?? raw.salePrice);
  const shipping = Number(raw.shipping ?? raw.shippingPrice ?? 0);
  const buyerPremium = Number(raw.buyerPremium ?? 0);

  if (!Number.isFinite(price) || price < 0) throw new Error('Sale price must be a non-negative number');
  if (explicitCompleted && !soldAt) throw new Error('Sale date is invalid');
  if (!explicitCompleted && raw.isCompletedSale === true) throw new Error('Completed sales require a valid soldAt date');

  const grade = normalizeGrade(raw.grade || { company: raw.grader, grade: raw.numericGrade });
  const cardKey = raw.cardKey || [
    raw.year,
    raw.set,
    raw.player || raw.subject,
    raw.cardNumber,
    raw.parallel,
    grade.company,
    grade.grade,
  ].filter(Boolean).map(normalizeText).join('|');

  const provider = raw.provider || providerName;
  const sourceMode = raw.sourceMode || raw.mode || (provider === 'ManeFlow Demo Dataset' || provider === 'ManeFlow Demo' || raw.demo ? 'demo' : 'production');
  const authorizationBasis = raw.authorizationBasis || (sourceMode === 'demo' ? 'demo' : raw.verified ? 'user_authorized_export' : 'unknown');

  return {
    id: raw.id || makeId('sale'),
    provider,
    sourceType,
    sourceMode,
    authorizationBasis,
    saleType,
    listingType,
    isCompletedSale: Boolean(explicitCompleted),
    soldAt: soldAt ? soldAt.toISOString() : null,
    currency: raw.currency || 'USD',
    price: roundMoney(price),
    shipping: roundMoney(Number.isFinite(shipping) ? shipping : 0),
    buyerPremium: roundMoney(Number.isFinite(buyerPremium) ? buyerPremium : 0),
    taxKnown: Boolean(raw.taxKnown),
    allInPrice: roundMoney(price + (Number.isFinite(shipping) ? shipping : 0) + (Number.isFinite(buyerPremium) ? buyerPremium : 0)),
    title: String(raw.title || '').trim(),
    url: raw.url || raw.rawUrl || null,
    rawUrl: raw.rawUrl || raw.url || null,
    imageUrl: raw.imageUrl || null,
    cardId: raw.cardId || null,
    cardKey,
    player: raw.player || raw.subject || null,
    year: raw.year ? Number(raw.year) : null,
    set: raw.set || null,
    cardNumber: raw.cardNumber ? String(raw.cardNumber) : null,
    parallel: raw.parallel || null,
    productType: raw.productType || raw.sealedType || null,
    sealedType: raw.sealedType || null,
    configuration: raw.configuration || null,
    sku: raw.sku || null,
    upc: raw.upc || raw.barcode || null,
    serialNumber: raw.serialNumber || null,
    grade,
    condition: raw.condition || null,
    quantity: Number(raw.quantity || 1),
    verified: Boolean(raw.verified),
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.7,
    rawProviderId: raw.rawProviderId || raw.itemId || null,
    importedAt: raw.importedAt || new Date().toISOString(),
    importedBy: raw.importedBy || null,
    dataRightsStatus: raw.dataRightsStatus || null,
    refreshPolicy: raw.refreshPolicy || null,
    rightsNotes: raw.rightsNotes || null,
  };
}

export function cardSearchText(card) {
  return normalizeText([
    card.year,
    card.brand,
    card.set,
    card.player,
    card.team,
    card.cardNumber,
    card.parallel,
    card.productType,
    card.sealedType,
    card.configuration,
    card.sku,
    card.upc,
    card.productName,
    card.serialNumber,
    card.grade?.company,
    card.grade?.grade,
    ...(card.aliases || []),
  ].filter(Boolean).join(' '));
}
