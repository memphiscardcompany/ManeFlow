import { ProviderAdapter } from './base.js';

export class PartnerProvider extends ProviderAdapter {
  constructor({ name, notes, capabilities = ['sold_comps'], authorizationBasis = 'written_license', sourceMode = 'production', supportsCompletedSales = false, supportsActiveListings = false, supportsSellerOrders = false, supportsLiveAuctions = false, refreshPolicy = 'manual_partner_feed', requiresCredential = true, dataRightsStatus = 'partnership_required' }) {
    super({
      name,
      mode: 'partnership_required',
      freshnessMinutes: null,
      capabilities,
      notes,
      authorizationBasis,
      sourceMode,
      supportsCompletedSales,
      supportsActiveListings,
      supportsSellerOrders,
      supportsLiveAuctions,
      refreshPolicy,
      requiresCredential,
      dataRightsStatus,
    });
  }
}
