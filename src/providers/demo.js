import { ProviderAdapter } from './base.js';

export class DemoProvider extends ProviderAdapter {
  constructor(sales) {
    super({
      name: 'ManeFlow Demo Dataset',
      mode: 'demo',
      freshnessMinutes: null,
      capabilities: ['sold_comps', 'historical_sales'],
      notes: 'Bundled synthetic dataset for interface and valuation-engine testing only.',
      authorizationBasis: 'demo',
      sourceMode: 'demo',
      supportsCompletedSales: true,
      supportsActiveListings: false,
      supportsSellerOrders: false,
      supportsLiveAuctions: false,
      refreshPolicy: 'static_demo_dataset',
      requiresCredential: false,
      dataRightsStatus: 'demo_only',
    });
    this.sales = sales;
  }

  async searchSales({ cardId }) {
    return this.sales.filter((sale) => sale.cardId === cardId);
  }
}
