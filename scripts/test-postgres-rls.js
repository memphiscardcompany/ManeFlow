import crypto from 'node:crypto';
import pg from 'pg';
import { InventoryRepository } from '../src/db/inventoryRepository.js';

const adminConnectionString = String(process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || '').trim();
const appConnectionString = String(process.env.DATABASE_APP_URL || '').trim();
if (!adminConnectionString || !appConnectionString) {
  console.error('DATABASE_ADMIN_URL (or DATABASE_URL) and DATABASE_APP_URL are required.');
  process.exit(64);
}

function pool(connectionString, applicationName) {
  return new pg.Pool({
    connectionString,
    max: 3,
    application_name: applicationName,
    ssl: /(?:sslmode=require|supabase\.co|neon\.tech)/i.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

const admin = pool(adminConnectionString, 'maneflow-rls-admin-test');
const app = pool(appConnectionString, 'maneflow-rls-app-test');
const shopA = crypto.randomUUID();
const shopB = crypto.randomUUID();
const ownerA = crypto.randomUUID();
const ownerB = crypto.randomUUID();
const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const cardId = crypto.randomUUID();
const vector = `[${Array.from({ length: 1152 }, (_, index) => index === 0 ? 1 : 0).join(',')}]`;

async function withTenant(shopId, work) {
  const client = await app.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(`SELECT set_config('app.current_shop_id', $1, true)`, [shopId]);
    const result = await work(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

try {
  await admin.query(
    `INSERT INTO public.shops (id, owner_user_id, name, slug)
     VALUES ($1, $2, 'RLS Test A', $3), ($4, $5, 'RLS Test B', $6)`,
    [shopA, ownerA, `rls-a-${shopA.slice(0, 8)}`, shopB, ownerB, `rls-b-${shopB.slice(0, 8)}`],
  );
  await admin.query(
    `INSERT INTO public.catalog_cards (
       id, canonical_key, sport_or_game, release_year, set_name, card_number, subject_name,
       parallel_name, language_code, source_namespace, source_record_id
     ) VALUES ($1, $2, 'baseball', 2018, 'RLS Test Set', '1', 'RLS Test Player', 'BASE', 'en', 'rls-test', $3)`,
    [cardId, `rls:${cardId}`, cardId],
  );
  await admin.query(
    `INSERT INTO public.catalog_card_embeddings (
       catalog_card_id, model_name, model_version, front_vector, front_quality_score
     ) VALUES ($1, 'siglip2-so400m-card-front-v1', '1', $2::vector, 1.0)`,
    [cardId, vector],
  );
  await admin.query(
    `INSERT INTO public.shop_inventory (
       shop_id, catalog_card_id, sku, quantity, condition_code, list_price,
       created_by_user_id, metadata
     ) VALUES
       ($1, $3, 'RLS-A-1', 1, 'NM', 100, $4, '{}'::jsonb),
       ($2, $3, 'RLS-B-1', 2, 'NM', 110, $5, '{}'::jsonb)`,
    [shopA, shopB, cardId, userA, userB],
  );

  const rowsA = await withTenant(shopA, async (client) => (
    await client.query(`SELECT shop_id, sku, quantity FROM public.shop_inventory ORDER BY sku`)
  ).rows);
  if (rowsA.length !== 1 || rowsA[0].shop_id !== shopA || rowsA[0].sku !== 'RLS-A-1') {
    throw new Error('Shop A RLS read isolation failed.');
  }

  const rowsB = await withTenant(shopB, async (client) => (
    await client.query(`SELECT shop_id, sku, quantity FROM public.shop_inventory ORDER BY sku`)
  ).rows);
  if (rowsB.length !== 1 || rowsB[0].shop_id !== shopB || rowsB[0].sku !== 'RLS-B-1') {
    throw new Error('Shop B RLS read isolation failed.');
  }

  let blocked = false;
  try {
    await withTenant(shopA, (client) => client.query(
      `INSERT INTO public.shop_inventory (
         shop_id, catalog_card_id, sku, quantity, condition_code, created_by_user_id
       ) VALUES ($1, $2, 'RLS-CROSS-SHOP', 1, 'NM', $3)`,
      [shopB, cardId, userA],
    ));
  } catch (error) {
    blocked = /row-level security|policy/i.test(String(error.message));
  }
  if (!blocked) throw new Error('Cross-shop inventory insert was not blocked by RLS.');

  const repository = new InventoryRepository(app, {
    embeddingModelName: 'siglip2-so400m-card-front-v1',
    embeddingModelVersion: '1',
    hnswEfSearch: 100,
    statementTimeoutMs: 10_000,
  });
  const matchesA = await repository.findVisualMatches(
    Array.from({ length: 1152 }, (_, index) => index === 0 ? 1 : 0),
    shopA,
    5,
  );
  if (matchesA.length !== 1 || Number(matchesA[0].inventory_quantity) !== 1) {
    throw new Error('Tenant-aware vector lookup returned incorrect Shop A inventory aggregation.');
  }
  const matchesB = await repository.findVisualMatches(
    Array.from({ length: 1152 }, (_, index) => index === 0 ? 1 : 0),
    shopB,
    5,
  );
  if (matchesB.length !== 1 || Number(matchesB[0].inventory_quantity) !== 2) {
    throw new Error('Tenant-aware vector lookup returned incorrect Shop B inventory aggregation.');
  }

  console.log(JSON.stringify({
    ok: true,
    readIsolation: true,
    writeIsolation: true,
    vectorSearchTenantAggregation: true,
  }, null, 2));
} finally {
  await admin.query(`DELETE FROM public.shops WHERE id = ANY($1::uuid[])`, [[shopA, shopB]]).catch(() => {});
  await admin.query(`DELETE FROM public.catalog_cards WHERE id = $1`, [cardId]).catch(() => {});
  await Promise.all([admin.end(), app.end()]);
}
