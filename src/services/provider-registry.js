import { DemoProvider } from '../providers/demo.js';
import { EbayProvider } from '../providers/ebay.js';
import { TcgplayerProvider } from '../providers/tcgplayer.js';
import { PartnerProvider } from '../providers/partner.js';
import { CardladderPartnerProvider } from '../providers/cardladder-partner.js';
import { FanaticsCollectPartnerProvider } from '../providers/fanatics-collect-partner.js';
import { GoldinPartnerProvider } from '../providers/goldin-partner.js';
import { HeritagePartnerProvider } from '../providers/heritage-partner.js';
import { ComcPartnerProvider } from '../providers/comc-partner.js';
import { WhatnotPartnerProvider } from '../providers/whatnot-partner.js';
import { JustTcgProvider } from '../providers/justtcg.js';
import { SportsCardsProProvider } from '../providers/sportscardspro.js';

export function createProviderRegistry(config, sales) {
  const providers = [
    new DemoProvider(sales),
    new PartnerProvider({
      name: 'OpenAI Vision',
      notes: config.openaiApiKey && config.openaiVisionModel
        ? `Configured for image understanding with model ${config.openaiVisionModel}. Images are sent only when the user explicitly submits a scan.`
        : 'Optional image-understanding adapter. Requires server-side OPENAI_API_KEY and OPENAI_VISION_MODEL.',
      capabilities: ['card_image_understanding', 'ocr'],
      authorizationBasis: config.openaiApiKey ? 'commercial_partner' : 'unknown',
      supportsCompletedSales: false,
      refreshPolicy: 'scan_submission_only',
      dataRightsStatus: config.openaiApiKey ? 'vision_only_configured' : 'credentials_required',
    }),
    new EbayProvider(config),
    new JustTcgProvider(config),
    new SportsCardsProProvider(config),
    new TcgplayerProvider(config),
    new PartnerProvider({ name: 'Fanatics Collect (formerly PWCC)', notes: 'No public developer feed identified. Use a commercial data agreement, approved export, or user-authorized account import.', supportsCompletedSales: true, supportsLiveAuctions: true }),
    new PartnerProvider({ name: 'Goldin', notes: 'No public market-data API identified. Use a commercial partnership or approved feed.', supportsCompletedSales: true, supportsLiveAuctions: true }),
    new PartnerProvider({ name: 'Heritage Auctions', notes: 'Auction archives may be viewable, but production ingestion should use written permission or a licensed feed.', supportsCompletedSales: true, supportsLiveAuctions: true }),
    new PartnerProvider({ name: 'Card Ladder', notes: 'Commercial pricing product; use a licensing agreement rather than copying protected data.', supportsCompletedSales: true, refreshPolicy: 'licensed_feed_required' }),
    new PartnerProvider({ name: 'COMC', notes: 'Use approved account exports, marketplace partnership, or licensed feed.', supportsCompletedSales: true, supportsActiveListings: true, supportsSellerOrders: true }),
    new PartnerProvider({ name: 'Whatnot', notes: 'Seller API is in developer preview and not onboarding new applicants; it is seller operations oriented, not a public market-wide sold-comps feed.', capabilities: ['seller_inventory', 'seller_orders'], supportsSellerOrders: true, supportsLiveAuctions: true, dataRightsStatus: 'developer_preview_or_partner_required' }),
    new PartnerProvider({ name: 'Fanatics Live', notes: 'No public market-wide sold-data API identified. Pursue direct partnership.', supportsLiveAuctions: true }),
    new PartnerProvider({ name: 'eBay Live', notes: 'Treat live-auction data as a separate licensed source unless eBay explicitly grants access.', supportsLiveAuctions: true }),
    new CardladderPartnerProvider(config),
    new FanaticsCollectPartnerProvider(config),
    new GoldinPartnerProvider(config),
    new HeritagePartnerProvider(config),
    new ComcPartnerProvider(config),
    new WhatnotPartnerProvider(config),
  ];
  const visionProvider = providers.find((provider) => provider.name === 'OpenAI Vision');
  if (visionProvider) {
    visionProvider.mode = config.openaiApiKey && config.openaiVisionModel ? 'configured' : 'credentials_required';
    visionProvider.freshnessMinutes = 0;
  }
  return {
    all: providers,
    byName: new Map(providers.map((provider) => [provider.name, provider])),
    status: () => providers.map((provider) => provider.status()),
  };
}
