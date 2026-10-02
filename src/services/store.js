import fs from 'node:fs/promises';
import path from 'node:path';
import { makeId, normalizeText, roundMoney } from './utils.js';
import { normalizeEmail } from './auth.js';

const preferences = {
  defaultMarketWindow: '90d',
  includePrivateSalesInValuation: true,
  compactMode: false,
  currency: 'USD',
};

function emptyUserData() {
  return {
    collection: [],
    watchlist: [],
    imports: [],
    consignmentRequests: [],
    scanHistory: [],
    listingDrafts: [],
    savedSearches: [],
    alerts: [],
    portfolioSnapshots: [],
    taxReports: [],
    inventoryReports: [],
    preferences: structuredClone(preferences),
  };
}

export const DEFAULT_STORE_STATE = {
  schemaVersion: 9,
  users: [],
  sessions: [],
  accountTokens: [],
  outbox: [],
  dataByUser: { guest: emptyUserData() },
  customSales: [],
  customCards: [],
  cardImageOverrides: {},
  cardImageAuditLog: [],
  providerIngests: [],
  compReviewOverrides: {},
  compCorrections: {},
  compAuditLog: [],
  organizations: [],
  organizationMembers: [],
  organizationInvites: [],
  shopInventory: [],
  shopPricingRules: [],
  shopProviderSettings: [],
  shopAuditLog: [],
  scanSessions: [],
  scanCorrections: [],
  intakeBatches: [],
  importJobs: [],
  importJobHistory: [],
  embedIntakes: [],
  publicValuePages: [],
  usageRecords: [],
  billingEntitlements: [],
  sourcePolicies: [],
  acquisitionRuns: [],
  manualComps: [],
  evidenceRecords: [],
  oauthStateNonces: [],
  recognitionBenchmarks: [],
  auditLog: [],
};

export function createDefaultStoreState() {
  return structuredClone(DEFAULT_STORE_STATE);
}

function string(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

function nullableMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Price must be a non-negative number');
  return roundMoney(parsed);
}

function collectionMergeKey(input = {}) {
  const status = ['owned', 'listed', 'consigned', 'sold', 'grading'].includes(input.status) ? input.status : 'owned';
  const price = nullableMoney(input.purchasePrice) ?? 0;
  return [
    string(input.cardId, 160) || normalizeText(input.name),
    normalizeText(input.name),
    normalizeText(input.location),
    normalizeText(input.certNumber),
    status,
    price,
  ].join('|');
}

export function migrateStoreState(parsed) {
  if (!parsed || typeof parsed !== 'object') return structuredClone(DEFAULT_STORE_STATE);
  if (parsed.schemaVersion >= 4 && parsed.dataByUser) {
    return {
      ...structuredClone(DEFAULT_STORE_STATE),
      ...parsed,
      dataByUser: Object.fromEntries(Object.entries(parsed.dataByUser).map(([id, data]) => [id, {
        ...emptyUserData(),
        ...data,
        preferences: { ...preferences, ...(data.preferences || {}) },
      }])),
    };
  }
  const guest = {
    ...emptyUserData(),
    collection: parsed.collection || [],
    watchlist: parsed.watchlist || [],
    imports: parsed.imports || [],
    consignmentRequests: parsed.consignmentRequests || [],
    scanHistory: parsed.scanHistory || [],
    preferences: { ...preferences, ...(parsed.preferences || {}) },
  };
  return {
    ...structuredClone(DEFAULT_STORE_STATE),
    customSales: parsed.customSales || [],
    customCards: parsed.customCards || [],
    dataByUser: { guest },
  };
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(DEFAULT_STORE_STATE);
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.state = migrateStoreState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.cleanupExpiredSessions();
    this.cleanupExpiredAccountTokens();
    await this.persist();
    return this;
  }

  async persist() {
    this.writeChain = this.writeChain.then(async () => {
      const payload = JSON.stringify(this.state, null, 2);
      const temp = `${this.filePath}.tmp`;
      await fs.writeFile(temp, payload, { mode: 0o600 });
      await fs.rename(temp, this.filePath);
    });
    return this.writeChain;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  userData(userId = 'guest') {
    if (!this.state.dataByUser[userId]) this.state.dataByUser[userId] = emptyUserData();
    return this.state.dataByUser[userId];
  }

  userSnapshot(userId = 'guest') {
    return structuredClone(this.userData(userId));
  }

  findUserByEmail(email) {
    const normalized = normalizeEmail(email);
    return this.state.users.find((user) => user.email === normalized) || null;
  }

  findUserById(id) {
    return this.state.users.find((user) => user.id === id) || null;
  }

  async createUser({ email, name, passwordHash, passwordSalt, passwordParams = null, role = 'collector' }) {
    if (this.findUserByEmail(email)) throw new Error('An account already exists for this email.');
    const user = {
      id: makeId('user'),
      email: normalizeEmail(email),
      name: string(name, 160) || 'Collector',
      passwordHash,
      passwordSalt,
      passwordParams: passwordParams ? structuredClone(passwordParams) : null,
      mfaTotpSecret: null,
      mfaTotpPendingSecret: null,
      mfaEnabledAt: null,
      role: ['collector', 'merchant', 'admin'].includes(role) ? role : 'collector',
      plan: 'free',
      emailVerifiedAt: null,
      disabledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.users.push(user);
    this.userData(user.id);
    await this.persist();
    return user;
  }

  async createSession({ tokenHash, userId, expiresAt, userAgent = '', ip = '' }) {
    this.cleanupExpiredSessions();
    this.state.sessions.push({
      id: makeId('session'), tokenHash, userId, expiresAt,
      userAgent: string(userAgent, 300), ip: string(ip, 100), createdAt: new Date().toISOString(),
      mfaVerifiedAt: null,
      reauthenticatedAt: null,
    });
    await this.persist();
  }

  async markSessionStepUp(tokenHash, { mfaVerifiedAt, reauthenticatedAt } = {}) {
    const session = this.findSession(tokenHash);
    if (!session) return null;
    if (mfaVerifiedAt !== undefined) session.mfaVerifiedAt = mfaVerifiedAt || null;
    if (reauthenticatedAt !== undefined) session.reauthenticatedAt = reauthenticatedAt || null;
    await this.persist();
    return structuredClone(session);
  }

  findSession(tokenHash) {
    this.cleanupExpiredSessions();
    return this.state.sessions.find((session) => session.tokenHash === tokenHash) || null;
  }

  cleanupExpiredSessions(now = Date.now()) {
    this.state.sessions = this.state.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  }

  async deleteSession(tokenHash) {
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => session.tokenHash !== tokenHash);
    if (this.state.sessions.length !== before) await this.persist();
  }

  listSessions(userId) {
    this.cleanupExpiredSessions();
    return this.state.sessions.filter((session) => session.userId === userId).map(({ tokenHash, ...safe }) => structuredClone(safe));
  }

  async deleteSessionById(userId, sessionId) {
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => !(session.userId === userId && session.id === sessionId));
    if (this.state.sessions.length !== before) await this.persist();
    return this.state.sessions.length !== before;
  }

  async deleteAllUserSessions(userId, exceptTokenHash = null) {
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => session.userId !== userId || (exceptTokenHash && session.tokenHash === exceptTokenHash));
    if (this.state.sessions.length !== before) await this.persist();
    return before - this.state.sessions.length;
  }

  cleanupExpiredAccountTokens(now = Date.now()) {
    this.state.accountTokens = (this.state.accountTokens || []).filter((token) => !token.usedAt && new Date(token.expiresAt).getTime() > now);
  }

  async createAccountToken({ userId, type, tokenHash, expiresAt }) {
    this.cleanupExpiredAccountTokens();
    this.state.accountTokens = this.state.accountTokens.filter((token) => !(token.userId === userId && token.type === type));
    const item = { id: makeId('account_token'), userId, type, tokenHash, expiresAt, createdAt: new Date().toISOString(), usedAt: null };
    this.state.accountTokens.push(item);
    await this.persist();
    return item;
  }

  async consumeAccountToken(type, tokenHash) {
    this.cleanupExpiredAccountTokens();
    const item = this.state.accountTokens.find((token) => token.type === type && token.tokenHash === tokenHash && !token.usedAt);
    if (!item) return null;
    item.usedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(item);
  }

  async markEmailVerified(userId) {
    const user = this.findUserById(userId);
    if (!user) return null;
    user.emailVerifiedAt = user.emailVerifiedAt || new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    await this.persist();
    return user;
  }

  async updatePassword(userId, { passwordHash, passwordSalt, passwordParams = null }) {
    const user = this.findUserById(userId);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.passwordParams = passwordParams ? structuredClone(passwordParams) : null;
    user.updatedAt = new Date().toISOString();
    await this.deleteAllUserSessions(userId);
    await this.persist();
    return user;
  }

  async beginTotpEnrollment(userId, secret) {
    const user = this.findUserById(userId);
    if (!user) return null;
    user.mfaTotpPendingSecret = string(secret, 256);
    user.updatedAt = new Date().toISOString();
    await this.persist();
    return user;
  }

  async completeTotpEnrollment(userId) {
    const user = this.findUserById(userId);
    if (!user?.mfaTotpPendingSecret) return null;
    user.mfaTotpSecret = user.mfaTotpPendingSecret;
    user.mfaTotpPendingSecret = null;
    user.mfaEnabledAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    await this.persist();
    return user;
  }

  async updateUser(userId, input) {
    const user = this.findUserById(userId);
    if (!user) return null;
    if (input.name !== undefined) user.name = string(input.name, 160) || user.name;
    if (input.plan !== undefined && ['free', 'collector', 'merchant', 'enterprise'].includes(input.plan)) user.plan = input.plan;
    if (input.role !== undefined && ['collector', 'merchant', 'admin'].includes(input.role)) user.role = input.role;
    if (input.disabledAt !== undefined) user.disabledAt = input.disabledAt || null;
    user.updatedAt = new Date().toISOString();
    await this.persist();
    return user;
  }

  exportUserData(userId) {
    const user = this.findUserById(userId);
    if (!user) return null;
    const { passwordHash, passwordSalt, passwordParams, mfaTotpSecret, mfaTotpPendingSecret, ...safeUser } = user;
    return { exportedAt: new Date().toISOString(), user: structuredClone(safeUser), data: this.userSnapshot(userId) };
  }

  async deleteUser(userId) {
    const exists = Boolean(this.findUserById(userId));
    if (!exists) return false;
    this.state.users = this.state.users.filter((user) => user.id !== userId);
    this.state.sessions = this.state.sessions.filter((session) => session.userId !== userId);
    this.state.accountTokens = this.state.accountTokens.filter((token) => token.userId !== userId);
    this.state.outbox = this.state.outbox.filter((message) => message.userId !== userId);
    this.state.organizationMembers = (this.state.organizationMembers || []).filter((membership) => membership.userId !== userId);
    this.state.organizationInvites = (this.state.organizationInvites || []).filter((invite) => invite.acceptedBy !== userId && invite.invitedBy !== userId);
    this.state.usageRecords = (this.state.usageRecords || []).filter((record) => record.userId !== userId);
    this.state.billingEntitlements = (this.state.billingEntitlements || []).filter((record) => record.userId !== userId);
    this.state.scanSessions = (this.state.scanSessions || []).filter((session) => session.userId !== userId);
    this.state.intakeBatches = (this.state.intakeBatches || []).filter((batch) => batch.userId !== userId && batch.createdBy !== userId);
    delete this.state.dataByUser[userId];
    await this.persist();
    return true;
  }

  async recordOutbox(message) {
    const item = { id: makeId('outbox'), status: 'queued', ...message, createdAt: new Date().toISOString() };
    this.state.outbox.unshift(item);
    this.state.outbox = this.state.outbox.slice(0, 1000);
    await this.persist();
    return item;
  }

  async addCollectionItem(userId, input) {
    const data = this.userData(userId);
    const mergeKey = collectionMergeKey(input);
    const mergeTarget = input.mergeDuplicates === false ? null : data.collection.find((entry) => collectionMergeKey(entry) === mergeKey);
    if (mergeTarget) {
      const quantityAdded = positiveInteger(input.quantity);
      mergeTarget.quantity += quantityAdded;
      const notes = string(input.notes, 2500);
      if (notes && !mergeTarget.notes.includes(notes)) mergeTarget.notes = [mergeTarget.notes, notes].filter(Boolean).join('\n');
      mergeTarget.updatedAt = new Date().toISOString();
      mergeTarget.lastMergedAt = mergeTarget.updatedAt;
      mergeTarget.mergeCount = Math.max(0, Number(mergeTarget.mergeCount || 0)) + 1;
      await this.persist();
      return { ...mergeTarget, merged: true, quantityAdded };
    }
    const item = {
      id: makeId('collection'),
      cardId: input.cardId || null,
      name: string(input.name, 240),
      quantity: positiveInteger(input.quantity),
      purchasePrice: nullableMoney(input.purchasePrice) ?? 0,
      purchaseDate: input.purchaseDate || null,
      notes: string(input.notes, 2500),
      acquiredFrom: string(input.acquiredFrom, 240),
      location: string(input.location, 160),
      certNumber: string(input.certNumber, 100),
      status: ['owned', 'listed', 'consigned', 'sold', 'grading'].includes(input.status) ? input.status : 'owned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.collection.push(item);
    await this.persist();
    return { ...item, merged: false, quantityAdded: item.quantity };
  }

  findMergeableCollectionItem(userId, input) {
    const key = collectionMergeKey(input);
    return this.userData(userId).collection.find((entry) => collectionMergeKey(entry) === key) || null;
  }

  async updateCollectionItem(userId, id, input) {
    const item = this.userData(userId).collection.find((entry) => entry.id === id);
    if (!item) return null;
    if (input.cardId !== undefined) item.cardId = input.cardId || null;
    if (input.name !== undefined) item.name = string(input.name, 240);
    if (input.quantity !== undefined) item.quantity = positiveInteger(input.quantity);
    if (input.purchasePrice !== undefined) item.purchasePrice = nullableMoney(input.purchasePrice) ?? 0;
    if (input.purchaseDate !== undefined) item.purchaseDate = input.purchaseDate || null;
    if (input.notes !== undefined) item.notes = string(input.notes, 2500);
    if (input.acquiredFrom !== undefined) item.acquiredFrom = string(input.acquiredFrom, 240);
    if (input.location !== undefined) item.location = string(input.location, 160);
    if (input.certNumber !== undefined) item.certNumber = string(input.certNumber, 100);
    if (input.status !== undefined && ['owned', 'listed', 'consigned', 'sold', 'grading'].includes(input.status)) item.status = input.status;
    item.updatedAt = new Date().toISOString();
    await this.persist();
    return item;
  }

  async removeCollectionItem(userId, id) {
    const data = this.userData(userId);
    const before = data.collection.length;
    data.collection = data.collection.filter((item) => item.id !== id);
    if (data.collection.length !== before) await this.persist();
    return data.collection.length !== before;
  }

  async addWatch(userId, input) {
    const data = this.userData(userId);
    const existing = data.watchlist.find((watch) => watch.cardId === input.cardId);
    if (existing) {
      if (input.targetPrice !== undefined) existing.targetPrice = nullableMoney(input.targetPrice);
      if (['above', 'below'].includes(input.direction)) existing.direction = input.direction;
      if (input.enabled !== undefined) existing.enabled = Boolean(input.enabled);
      existing.updatedAt = new Date().toISOString();
      await this.persist();
      return existing;
    }
    const watch = {
      id: makeId('watch'), cardId: input.cardId,
      targetPrice: nullableMoney(input.targetPrice),
      direction: input.direction === 'above' ? 'above' : 'below',
      enabled: input.enabled !== false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    data.watchlist.push(watch);
    await this.persist();
    return watch;
  }

  async updateWatch(userId, id, input) {
    const watch = this.userData(userId).watchlist.find((entry) => entry.id === id);
    if (!watch) return null;
    if (input.targetPrice !== undefined) watch.targetPrice = nullableMoney(input.targetPrice);
    if (['above', 'below'].includes(input.direction)) watch.direction = input.direction;
    if (input.enabled !== undefined) watch.enabled = Boolean(input.enabled);
    watch.updatedAt = new Date().toISOString();
    await this.persist();
    return watch;
  }

  async removeWatch(userId, id) {
    const data = this.userData(userId);
    const before = data.watchlist.length;
    data.watchlist = data.watchlist.filter((watch) => watch.id !== id);
    if (data.watchlist.length !== before) await this.persist();
    return data.watchlist.length !== before;
  }

  async recordImport(userId, summary) {
    const data = this.userData(userId);
    const item = { id: makeId('import'), ...summary, createdAt: new Date().toISOString() };
    data.imports.unshift(item);
    data.imports = data.imports.slice(0, 250);
    await this.persist();
    return item;
  }

  async addCustomSales(sales) {
    const result = await this.upsertCustomSales(sales, { updateExisting: false });
    return result.added;
  }

  async upsertCustomSales(sales, { updateExisting = true } = {}) {
    const byId = new Map(this.state.customSales.map((sale) => [sale.id, sale]));
    const byProviderRawId = new Map(this.state.customSales
      .filter((sale) => sale.provider && sale.rawProviderId)
      .map((sale) => [`${sale.provider}|${sale.rawProviderId}`, sale]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const sale of sales) {
      const providerRawKey = sale.provider && sale.rawProviderId ? `${sale.provider}|${sale.rawProviderId}` : null;
      const existing = byId.get(sale.id) || (providerRawKey ? byProviderRawId.get(providerRawKey) : null);
      if (existing) {
        if (updateExisting) {
          Object.assign(existing, sale, { updatedAt: new Date().toISOString() });
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      const item = { ...sale, createdAt: sale.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      this.state.customSales.push(item);
      byId.set(item.id, item);
      if (providerRawKey) byProviderRawId.set(providerRawKey, item);
      added += 1;
    }
    await this.persist();
    return { added, updated, skipped };
  }

  async addCustomCards(cards) {
    const byId = new Map(this.state.customCards.map((card) => [card.id, card]));
    let added = 0;
    let updated = 0;
    for (const card of cards) {
      if (byId.has(card.id)) {
        Object.assign(byId.get(card.id), card, { updatedAt: new Date().toISOString() });
        updated += 1;
      } else {
        const item = { ...card, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        this.state.customCards.push(item);
        byId.set(card.id, item);
        added += 1;
      }
    }
    await this.persist();
    return { added, updated };
  }

  async upsertCardImageOverrides(records = [], { actor = null } = {}) {
    this.state.cardImageOverrides = this.state.cardImageOverrides || {};
    this.state.cardImageAuditLog = this.state.cardImageAuditLog || [];
    let added = 0;
    let updated = 0;
    for (const record of records) {
      const cardId = string(record.cardId, 200);
      if (!cardId) continue;
      const existing = this.state.cardImageOverrides[cardId];
      const item = {
        ...(existing || {}),
        cardId,
        imageUrl: string(record.imageUrl || record.image, 1000),
        source: string(record.source || record.provider, 160),
        sourceMode: string(record.sourceMode || 'production', 60),
        authorizationBasis: string(record.authorizationBasis || 'user_csv', 80),
        dataRightsStatus: string(record.dataRightsStatus || 'image_display_authorized', 120),
        rightsNotes: string(record.rightsNotes, 1000),
        providerBatchId: string(record.providerBatchId, 160),
        importedBy: string(record.importedBy || actor?.userId, 200),
        disabledAt: null,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      this.state.cardImageOverrides[cardId] = item;
      if (existing) updated += 1; else added += 1;
      this.state.cardImageAuditLog.unshift({
        id: makeId('image_audit'),
        type: existing ? 'image_override_updated' : 'image_override_added',
        cardId,
        source: item.source,
        providerBatchId: item.providerBatchId,
        actorUserId: actor?.userId || null,
        createdAt: new Date().toISOString(),
      });
    }
    this.state.cardImageAuditLog = this.state.cardImageAuditLog.slice(0, 5000);
    await this.persist();
    return { added, updated };
  }

  async rollbackCardImageBatch(providerBatchId, { actor = null, reason = '' } = {}) {
    const batchId = string(providerBatchId, 160);
    if (!batchId) throw new Error('providerBatchId is required');
    const overrides = this.state.cardImageOverrides || {};
    let removed = 0;
    for (const [cardId, record] of Object.entries(overrides)) {
      if (record.providerBatchId === batchId) {
        delete overrides[cardId];
        removed += 1;
      }
    }
    this.state.cardImageAuditLog = this.state.cardImageAuditLog || [];
    this.state.cardImageAuditLog.unshift({
      id: makeId('image_audit'),
      type: 'image_batch_rollback',
      providerBatchId: batchId,
      removed,
      actorUserId: actor?.userId || null,
      reason: string(reason, 1000),
      createdAt: new Date().toISOString(),
    });
    this.state.cardImageAuditLog = this.state.cardImageAuditLog.slice(0, 5000);
    await this.persist();
    return { providerBatchId: batchId, removed };
  }

  async recordScan(userId, input) {
    const data = this.userData(userId);
    const item = {
      id: makeId('scan'), mode: input.mode || 'unknown', query: string(input.query, 1000),
      selectedCardId: input.selectedCardId || null,
      matchIds: Array.isArray(input.matchIds) ? input.matchIds.slice(0, 10) : [],
      imageProcessedRemotely: Boolean(input.imageProcessedRemotely),
      frontBack: Boolean(input.frontBack), warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 10) : [],
      createdAt: new Date().toISOString(),
    };
    data.scanHistory.unshift(item);
    data.scanHistory = data.scanHistory.slice(0, 250);
    await this.persist();
    return item;
  }

  async addConsignmentRequest(userId, input) {
    const data = this.userData(userId);
    const item = {
      id: makeId('consignment'), cardId: input.cardId || null,
      collectionItemId: input.collectionItemId || null,
      customerName: string(input.customerName, 160), email: string(input.email, 320),
      phone: string(input.phone, 80), notes: string(input.notes, 2500),
      status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    data.consignmentRequests.push(item);
    await this.persist();
    return item;
  }

  async updateConsignmentRequest(userId, id, input) {
    const item = this.userData(userId).consignmentRequests.find((entry) => entry.id === id);
    if (!item) return null;
    if (input.status !== undefined && ['new', 'reviewing', 'contacted', 'accepted', 'declined', 'closed'].includes(input.status)) item.status = input.status;
    if (input.notes !== undefined) item.notes = string(input.notes, 2500);
    if (input.internalNotes !== undefined) item.internalNotes = string(input.internalNotes, 2500);
    item.updatedAt = new Date().toISOString();
    await this.persist();
    return item;
  }

  async addListingDraft(userId, input) {
    const data = this.userData(userId);
    const item = {
      id: makeId('listing'), cardId: input.cardId || null, collectionItemId: input.collectionItemId || null,
      marketplace: string(input.marketplace, 80) || 'Unassigned',
      title: string(input.title, 160), description: string(input.description, 5000),
      price: nullableMoney(input.price), quantity: positiveInteger(input.quantity),
      status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    data.listingDrafts.unshift(item);
    await this.persist();
    return item;
  }

  async updateListingDraft(userId, id, input) {
    const item = this.userData(userId).listingDrafts.find((entry) => entry.id === id);
    if (!item) return null;
    if (input.marketplace !== undefined) item.marketplace = string(input.marketplace, 80);
    if (input.title !== undefined) item.title = string(input.title, 160);
    if (input.description !== undefined) item.description = string(input.description, 5000);
    if (input.price !== undefined) item.price = nullableMoney(input.price);
    if (input.quantity !== undefined) item.quantity = positiveInteger(input.quantity);
    if (['draft', 'ready', 'submitted', 'listed', 'sold', 'cancelled'].includes(input.status)) item.status = input.status;
    item.updatedAt = new Date().toISOString();
    await this.persist();
    return item;
  }

  async removeListingDraft(userId, id) {
    const data = this.userData(userId);
    const before = data.listingDrafts.length;
    data.listingDrafts = data.listingDrafts.filter((item) => item.id !== id);
    if (data.listingDrafts.length !== before) await this.persist();
    return data.listingDrafts.length !== before;
  }

  async upsertAlert(userId, input) {
    const data = this.userData(userId);
    const key = string(input.key, 300);
    let alert = data.alerts.find((entry) => entry.key === key && !entry.resolvedAt);
    if (!alert) {
      alert = {
        id: makeId('alert'), key, type: string(input.type, 80) || 'price_target',
        cardId: input.cardId || null, title: string(input.title, 240), message: string(input.message, 1000),
        value: nullableMoney(input.value), targetPrice: nullableMoney(input.targetPrice),
        readAt: null, resolvedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      data.alerts.unshift(alert);
      data.alerts = data.alerts.slice(0, 500);
    } else {
      alert.title = string(input.title, 240) || alert.title;
      alert.message = string(input.message, 1000) || alert.message;
      alert.value = nullableMoney(input.value);
      alert.targetPrice = nullableMoney(input.targetPrice);
      alert.updatedAt = new Date().toISOString();
    }
    await this.persist();
    return alert;
  }

  async markAlert(userId, id, input = {}) {
    const alert = this.userData(userId).alerts.find((entry) => entry.id === id);
    if (!alert) return null;
    if (input.read !== undefined) alert.readAt = input.read ? (alert.readAt || new Date().toISOString()) : null;
    if (input.resolved !== undefined) alert.resolvedAt = input.resolved ? (alert.resolvedAt || new Date().toISOString()) : null;
    alert.updatedAt = new Date().toISOString();
    await this.persist();
    return alert;
  }

  async setPreferences(userId, input) {
    const data = this.userData(userId);
    const next = { ...data.preferences };
    if (['7d', '30d', '90d', '180d', '365d'].includes(input.defaultMarketWindow)) next.defaultMarketWindow = input.defaultMarketWindow;
    if (input.includePrivateSalesInValuation !== undefined) next.includePrivateSalesInValuation = Boolean(input.includePrivateSalesInValuation);
    if (input.compactMode !== undefined) next.compactMode = Boolean(input.compactMode);
    if (input.currency !== undefined) next.currency = string(input.currency, 3).toUpperCase() || 'USD';
    data.preferences = next;
    await this.persist();
    return structuredClone(next);
  }


  async recordPortfolioSnapshot(userId, input = {}) {
    const data = this.userData(userId);
    const item = { id: makeId('portfolio_snapshot'), ...input, createdAt: new Date().toISOString() };
    data.portfolioSnapshots.unshift(item);
    data.portfolioSnapshots = data.portfolioSnapshots.slice(0, 500);
    await this.persist();
    return structuredClone(item);
  }

  async recordTaxReport(userId, input = {}) {
    const data = this.userData(userId);
    const item = { id: makeId('tax_report'), ...input, createdAt: new Date().toISOString() };
    data.taxReports.unshift(item);
    data.taxReports = data.taxReports.slice(0, 100);
    await this.persist();
    return structuredClone(item);
  }

  async recordInventoryReport(userId, input = {}) {
    const data = this.userData(userId);
    const item = { id: makeId('inventory_report'), ...input, createdAt: new Date().toISOString() };
    data.inventoryReports.unshift(item);
    data.inventoryReports = data.inventoryReports.slice(0, 100);
    await this.persist();
    return structuredClone(item);
  }

  async reviewComp(id, { decision, inclusionStatus = null, notes = '', adminUserId = null }) {
    const cleanDecision = ['approved', 'rejected', 'needs_review'].includes(decision) ? decision : 'needs_review';
    const item = {
      compId: string(id, 200),
      decision: cleanDecision,
      inclusionStatus: inclusionStatus ? string(inclusionStatus, 80) : null,
      notes: string(notes, 2500),
      adminUserId: string(adminUserId, 200),
      updatedAt: new Date().toISOString(),
    };
    this.state.compReviewOverrides[item.compId] = item;
    this.state.compAuditLog.unshift({ id: makeId('comp_audit'), type: 'comp_review', ...item, createdAt: new Date().toISOString() });
    this.state.compAuditLog = this.state.compAuditLog.slice(0, 5000);
    await this.persist();
    return structuredClone(item);
  }

  async correctComp(id, correction = {}, { adminUserId = null } = {}) {
    const safeCorrection = {};
    for (const key of ['cardId', 'soldAt', 'allInPrice', 'price', 'shipping', 'buyerPremium', 'grade', 'parallel', 'serialNumber', 'saleType', 'listingType', 'isCompletedSale', 'verified', 'confidence', 'rightsNotes']) {
      if (correction[key] !== undefined) safeCorrection[key] = correction[key];
    }
    const item = {
      compId: string(id, 200),
      correction: safeCorrection,
      adminUserId: string(adminUserId, 200),
      updatedAt: new Date().toISOString(),
    };
    this.state.compCorrections[item.compId] = item;
    this.state.compAuditLog.unshift({ id: makeId('comp_audit'), type: 'comp_correction', ...item, createdAt: new Date().toISOString() });
    this.state.compAuditLog = this.state.compAuditLog.slice(0, 5000);
    await this.persist();
    return structuredClone(item);
  }

  compOverrides() {
    return structuredClone(this.state.compReviewOverrides || {});
  }

  compCorrections() {
    return structuredClone(this.state.compCorrections || {});
  }

  async recordProviderIngest(summary) {
    const item = { id: makeId('ingest'), ...summary, createdAt: new Date().toISOString() };
    this.state.providerIngests.unshift(item);
    this.state.providerIngests = this.state.providerIngests.slice(0, 500);
    await this.persist();
    return item;
  }

  async audit(event) {
    this.state.auditLog.unshift({ id: makeId('audit'), ...event, createdAt: new Date().toISOString() });
    this.state.auditLog = this.state.auditLog.slice(0, 2000);
    await this.persist();
  }

  async recordRecognitionBenchmark(input = {}) {
    this.state.recognitionBenchmarks = this.state.recognitionBenchmarks || [];
    const item = {
      id: makeId('recognition_benchmark'),
      version: string(input.version, 120),
      sourceName: string(input.sourceName || input.dataset || 'Recognition Benchmark Dataset', 200),
      caseCount: positiveInteger(input.caseCount || input.metrics?.totalCases || 1, 1),
      metrics: input.metrics && typeof input.metrics === 'object' ? structuredClone(input.metrics) : {},
      recommendations: Array.isArray(input.recommendations) ? input.recommendations.map((entry) => string(entry, 500)).filter(Boolean) : [],
      policy: input.policy && typeof input.policy === 'object' ? structuredClone(input.policy) : {},
      actorUserId: string(input.actorUserId || input.userId, 200),
      createdAt: new Date().toISOString(),
    };
    this.state.recognitionBenchmarks.unshift(item);
    this.state.recognitionBenchmarks = this.state.recognitionBenchmarks.slice(0, 100);
    await this.audit({
      type: 'recognition_benchmark_run',
      userId: item.actorUserId || null,
      sourceName: item.sourceName,
      caseCount: item.caseCount,
      top1Accuracy: item.metrics.top1Accuracy ?? null,
      top3Accuracy: item.metrics.top3Accuracy ?? null,
      falseConfidentRate: item.metrics.falseConfidentRate ?? null,
    });
    await this.persist();
    return structuredClone(item);
  }


  async recordEmbedIntake(input = {}) {
    const item = {
      id: makeId('embed_intake'),
      type: string(input.type || 'scan_intake', 80),
      origin: string(input.origin, 500),
      cardId: input.cardId || null,
      customerName: string(input.customerName, 160),
      email: string(input.email, 320),
      notes: string(input.notes, 2500),
      payload: input.payload && typeof input.payload === 'object' ? structuredClone(input.payload) : {},
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.embedIntakes.unshift(item);
    this.state.embedIntakes = this.state.embedIntakes.slice(0, 1000);
    await this.persist();
    return structuredClone(item);
  }

  async publishValuePage(input = {}) {
    const slug = string(input.slug || input.cardId || makeId('value'), 160).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const existing = this.state.publicValuePages.find((page) => page.slug === slug);
    const item = existing || { id: makeId('value_page'), slug, createdAt: new Date().toISOString() };
    Object.assign(item, {
      cardId: input.cardId || item.cardId || null,
      title: string(input.title, 240),
      status: input.status === 'disabled' ? 'disabled' : 'published',
      notes: string(input.notes, 1000),
      updatedAt: new Date().toISOString(),
    });
    if (!existing) this.state.publicValuePages.push(item);
    await this.persist();
    return structuredClone(item);
  }

}
