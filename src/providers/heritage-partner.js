import { PartnerProvider } from './partner.js';

export class HeritagePartnerProvider extends PartnerProvider {
  constructor(config = {}) {
    super({
      name: 'heritage-partner',
      notes: 'Partner adapter stub. Completed-sale ingestion requires written authorization, credentials, and provider-specific field mapping before activation.',
      capabilities: ['completed_sales_partner_feed', 'batch_import'],
      authorizationBasis: 'written_license_required',
      sourceMode: 'production_ready_not_live',
      supportsCompletedSales: true,
      supportsActiveListings: false,
      supportsSellerOrders: false,
      supportsLiveAuctions: true,
      refreshPolicy: 'disabled_until_partner_agreement',
      requiresCredential: true,
      dataRightsStatus: 'not_connected',
    });
    this.mode = 'partner_stub';
  }
}
