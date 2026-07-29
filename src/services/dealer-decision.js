import { roundMoney, clamp } from './utils.js';
import { calculateValuation } from './valuation.js';

export function buildDealerDecision({ card, sales = [], valuation = null, askingListings = [], pricingRules = {}, demoMode = true, overrides = {} } = {}) {
  const market = valuation || calculateValuation(sales.filter((sale) => !card || sale.cardId === card.id), { card, demoMode, overrides, askingListings, includeCompDetails: true });
  const value = Number(market.value || 0);
  const confidence = Number(market.confidence || 0);
  const pricingConfidence = Number(market.pricingConfidence || confidence);
  const liquidity = Number(market.liquidityScore || 0);
  const askContext = market.askingPriceContext || null;
  const suggestedListAnchor = Number(askContext?.suggestedListAnchor || 0);
  const margin = Number(pricingRules.targetMarginPct ?? 35) / 100;
  const quickDiscount = Number(pricingRules.quickSaleDiscountPct ?? 10) / 100;
  const patientPremium = Number(pricingRules.patientPremiumPct ?? 15) / 100;
  const risk = [];
  if (!value) risk.push('Insufficient included comps for dealer pricing.');
  if (confidence < 55) risk.push('Low valuation confidence. Confirm identity, grade, condition, and source quality.');
  if (askContext?.count) risk.push(`Active BIN context is ${askContext.rating.replaceAll('_', ' ')} and is not a completed-sale value.`);
  if (liquidity < 40) risk.push('Lower liquidity. Consider consignment or patient listing instead of aggressive cash buy.');
  if (market.compQuality?.needsReviewCount) risk.push(`${market.compQuality.needsReviewCount} comps need review.`);
  const dealerBuyLow = value ? roundMoney(value * clamp(1 - margin - 0.08, 0.35, 0.95)) : null;
  const dealerBuyHigh = value ? roundMoney(value * clamp(1 - margin + 0.04, 0.45, 0.98)) : null;
  const listingBase = value || suggestedListAnchor || 0;
  const quickSalePrice = value ? roundMoney(value * (1 - quickDiscount)) : suggestedListAnchor ? roundMoney(suggestedListAnchor * 0.9) : null;
  const fairListPrice = listingBase ? roundMoney(listingBase * (value ? 1.05 : 1)) : null;
  const patientListPrice = listingBase ? roundMoney(listingBase * (1 + patientPremium)) : null;
  const suggestedAction = !value && suggestedListAnchor ? `No completed-sale value yet. Use BIN context only for a cautious starter listing near $${fairListPrice}; avoid cash-buy decisions until sold comps appear.`
    : !value ? 'Research manually before making an offer.'
    : confidence >= 75 && liquidity >= 60 ? `Buy under $${dealerBuyHigh} or list near $${fairListPrice}.`
    : liquidity < 40 ? 'Prefer consignment, grading review, or patient listing over a high cash offer.'
    : `Buy conservatively under $${dealerBuyLow} until more comps confirm the value.`;
  return {
    cardId: card?.id || null,
    estimatedMarketValue: value || null,
    confidenceScore: confidence,
    pricingConfidenceScore: pricingConfidence,
    pricingRating: market.pricingRating || 'insufficient_data',
    liquidityScore: liquidity,
    compQuality: market.compQuality || null,
    askingPriceContext: askContext,
    dealerBuyRange: { low: dealerBuyLow, high: dealerBuyHigh },
    quickSalePrice,
    fairListPrice,
    patientListPrice,
    consignmentRecommendation: value && confidence < 65 ? 'Recommend consignment review due to uncertainty.' : value ? 'Eligible for direct buy, listing draft, or consignment depending on seller expectations.' : 'Needs manual research first.',
    gradingReviewRecommendation: card?.grade ? 'Already graded; verify slab/cert and recent grade-specific comps.' : 'Consider pre-grading review if condition appears strong and PSA 10 upside is meaningful.',
    riskWarnings: risk,
    suggestedAction,
    disclaimer: 'Dealer pricing is a decision aid, not an appraisal, authentication, grade guarantee, or guaranteed sale price.',
  };
}
