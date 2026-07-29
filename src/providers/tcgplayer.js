import { ProviderAdapter } from './base.js';

export class TcgplayerProvider extends ProviderAdapter {
  constructor(config) {
    const enabled = Boolean(config.tcgplayerPublicKey && config.tcgplayerPrivateKey);
    super({
      name: 'TCGplayer',
      mode: enabled ? 'existing-key' : 'access_unavailable_for_new_keys',
      freshnessMinutes: enabled ? 15 : null,
      capabilities: enabled ? ['catalog', 'market_prices'] : [],
      notes: 'TCGplayer states it is not granting new API access. This adapter is reserved for organizations with existing approved keys.',
      authorizationBasis: enabled ? 'official_api' : 'unknown',
      sourceMode: 'production',
      supportsCompletedSales: false,
      supportsActiveListings: false,
      supportsSellerOrders: false,
      supportsLiveAuctions: false,
      refreshPolicy: enabled ? 'approved_existing_key_only' : 'not_accepting_new_api_access',
      requiresCredential: true,
      dataRightsStatus: enabled ? 'existing_key_configured' : 'access_unavailable_for_new_keys',
    });
    this.publicKey = config.tcgplayerPublicKey;
    this.privateKey = config.tcgplayerPrivateKey;
  }
}
