export class ProviderAdapter {
  constructor({
    name,
    mode = 'disabled',
    freshnessMinutes = null,
    capabilities = [],
    notes = '',
    authorizationBasis = 'unknown',
    sourceMode = 'production',
    supportsCompletedSales = false,
    supportsActiveListings = false,
    supportsSellerOrders = false,
    supportsLiveAuctions = false,
    refreshPolicy = 'manual',
    requiresCredential = true,
    dataRightsStatus = 'not_configured',
  }) {
    this.name = name;
    this.mode = mode;
    this.freshnessMinutes = freshnessMinutes;
    this.capabilities = capabilities;
    this.notes = notes;
    this.authorizationBasis = authorizationBasis;
    this.sourceMode = sourceMode;
    this.supportsCompletedSales = Boolean(supportsCompletedSales);
    this.supportsActiveListings = Boolean(supportsActiveListings);
    this.supportsSellerOrders = Boolean(supportsSellerOrders);
    this.supportsLiveAuctions = Boolean(supportsLiveAuctions);
    this.refreshPolicy = refreshPolicy;
    this.requiresCredential = Boolean(requiresCredential);
    this.dataRightsStatus = dataRightsStatus;
  }

  trustScore() {
    if (this.sourceMode === 'demo') return 62;
    if (this.authorizationBasis === 'official_api' || this.authorizationBasis === 'ebay_api') return 96;
    if (this.authorizationBasis === 'written_license') return 92;
    if (this.authorizationBasis === 'commercial_partner') return 88;
    if (this.authorizationBasis === 'user_authorized_export') return 80;
    if (this.authorizationBasis === 'user_csv') return 72;
    return 25;
  }

  status() {
    return {
      name: this.name,
      mode: this.mode,
      freshnessMinutes: this.freshnessMinutes,
      capabilities: this.capabilities,
      notes: this.notes,
      authorizationBasis: this.authorizationBasis,
      sourceMode: this.sourceMode,
      supportsCompletedSales: this.supportsCompletedSales,
      supportsActiveListings: this.supportsActiveListings,
      supportsSellerOrders: this.supportsSellerOrders,
      supportsLiveAuctions: this.supportsLiveAuctions,
      refreshPolicy: this.refreshPolicy,
      requiresCredential: this.requiresCredential,
      dataRightsStatus: this.dataRightsStatus,
      providerTrustScore: this.trustScore(),
      publicPricingReady: this.supportsCompletedSales && ['official_api', 'ebay_api', 'written_license', 'commercial_partner', 'user_authorized_export', 'user_csv'].includes(this.authorizationBasis),
    };
  }

  async searchSales() {
    return [];
  }

  async searchActiveListings() {
    return [];
  }
}
