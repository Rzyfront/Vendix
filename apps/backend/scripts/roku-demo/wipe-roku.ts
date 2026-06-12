/**
 * ROKU Demo Seed - Wipe Script (tenant-preserving)
 *
 * Deletes ONLY business/demo data tied to the REAL "roku" tenant
 * (org 6 / store 10, owned by rzyfront@gmail.com in local dev).
 *
 * PRESERVES the tenant itself:
 *   - organizations / stores rows (never deleted)
 *   - real users (only @roku-demo.vendix.local demo users are removed)
 *   - organization_settings, organization_onboarding_state, store_settings
 *   - store_subscriptions + subscription billing tables
 *   - domain_settings (the store's real hostnames)
 * Also preserves system-wide PUC templates, withholding concepts, ICA rates,
 * permissions/roles, default templates, system payment methods, and any data
 * belonging to other organizations.
 *
 * Strategy:
 *   1. Discover (once) which tables have organization_id / store_id columns
 *      via information_schema, and wipe those with a scoped WHERE.
 *   2. Child tables without scope columns are wiped via subselects against
 *      their real parent FK (verified against prisma/schema.prisma).
 *   3. Demo users are resolved ONLY by @roku-demo.vendix.local email domain
 *      (NEVER by store membership or organization_id — that would match the
 *      real owner account).
 *   4. Order: deep children -> children -> parents -> demo users.
 *
 * Usage:
 *   npx tsx apps/backend/scripts/roku-demo/wipe-roku.ts
 *
 * Safety: refuses to run if the target org is not "roku".
 * No TRUNCATE, no CASCADE, no DROP, no DELETE without WHERE.
 */

import type { PrismaClient } from '@prisma/client';
import {
  getPrismaClient,
  disconnectPrisma,
} from '../../prisma/seeds/shared/client';
import { assertNotProduction, assertRokuOrg } from './lib/guards';

const ROKU_ORG_SLUG = 'roku';
const ROKU_STORE_SLUG = 'roku';
const ROKU_DEMO_EMAIL_DOMAIN = 'roku-demo.vendix.local';

/** Wipes all Roku demo data. Reusable from populate-roku.ts --reset. */
export async function wipeRoku(prisma: PrismaClient): Promise<void> {
  const org = await prisma.organizations.findUnique({
    where: { slug: ROKU_ORG_SLUG },
  });
  if (!org) {
    console.log('Nothing to wipe: "roku" org not found.');
    return;
  }
  const store = await prisma.stores.findFirst({
    where: { organization_id: org.id, slug: ROKU_STORE_SLUG },
  });
  if (!store) {
    console.log(`Org found but store "${ROKU_STORE_SLUG}" not present.`);
    return;
  }

  // Validated numeric DB ids (not user input) — safe to interpolate.
  const orgId = Number(org.id);
  const storeId = Number(store.id);

  console.log(
    `🧹 Wiping all data for org=${org.slug} (id=${orgId}) store=${store.slug} (id=${storeId})`,
  );

  // ── Resolve demo user ids (ONLY by demo email domain) ────────────────────
  // Never match by store membership or organization_id: the real owner
  // (rzyfront@gmail.com) belongs to this org/store and must survive.
  const demoUserRows = await prisma.users.findMany({
    where: { email: { endsWith: `@${ROKU_DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const demoUserIds = demoUserRows.map((r) => r.id);
  const userIdsCsv = demoUserIds.join(',');
  console.log(`  Demo users to remove: ${demoUserIds.length}`);

  // ── Discover scope columns once via information_schema ───────────────────
  const columnRows = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string }>
  >(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('organization_id','store_id')`,
  );
  const scopeCols = new Map<string, Set<string>>();
  for (const row of columnRows) {
    if (!scopeCols.has(row.table_name)) scopeCols.set(row.table_name, new Set());
    scopeCols.get(row.table_name)!.add(row.column_name);
  }

  const handled = new Set<string>();

  const logErr = (table: string, e: any): void => {
    console.log(
      '    ! ' +
        table +
        ': ' +
        String(e?.message ?? e)
          .split('\n')
          .filter(Boolean)
          .slice(-2)
          .join(' | ')
          .slice(0, 200),
    );
  };

  const exec = async (table: string, sql: string): Promise<boolean> => {
    try {
      const n = await prisma.$executeRawUnsafe(sql);
      if (n > 0) console.log(`    - ${table}: ${n}`);
      return true;
    } catch (e: any) {
      logErr(table, e);
      return false;
    }
  };

  /** DELETE with an explicit WHERE clause (for child tables via parent subselect). */
  const wipeWhere = async (table: string, where: string): Promise<void> => {
    handled.add(table);
    await exec(table, `DELETE FROM "${table}" WHERE ${where}`);
  };

  /** DELETE scoped by whatever org/store columns the table actually has. */
  const wipeScoped = async (table: string): Promise<void> => {
    handled.add(table);
    const cols = scopeCols.get(table);
    if (!cols || cols.size === 0) {
      console.log(`    ! ${table}: no organization_id/store_id column, skipped`);
      return;
    }
    const conds: string[] = [];
    if (cols.has('organization_id')) conds.push(`"organization_id" = ${orgId}`);
    if (cols.has('store_id')) conds.push(`"store_id" = ${storeId}`);
    await exec(table, `DELETE FROM "${table}" WHERE ${conds.join(' OR ')}`);
  };

  /** Scoped UPDATE used only to break circular/nullable FKs before deletes. */
  const updateWhere = async (table: string, set: string, where: string): Promise<void> => {
    await exec(table, `UPDATE "${table}" SET ${set} WHERE ${where}`);
  };

  // ── Reusable subselect fragments (FK columns verified in schema.prisma) ──
  const inOrders = `IN (SELECT "id" FROM "orders" WHERE "store_id" = ${storeId})`;
  const inOrderItems = `IN (SELECT "id" FROM "order_items" WHERE "order_id" ${inOrders})`;
  const inInvoices = `IN (SELECT "id" FROM "invoices" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`;
  const inProducts = `IN (SELECT "id" FROM "products" WHERE "store_id" = ${storeId})`;
  const inLocations = `IN (SELECT "id" FROM "inventory_locations" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`;
  const inBankAccounts = `IN (SELECT "id" FROM "bank_accounts" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`;
  const inAccountingEntries = `IN (SELECT "id" FROM "accounting_entries" WHERE "organization_id" = ${orgId})`;
  const inPurchaseOrders = `IN (SELECT "id" FROM "purchase_orders" WHERE "organization_id" = ${orgId})`;
  const inEmployeeAdvances = `IN (SELECT "id" FROM "employee_advances" WHERE "organization_id" = ${orgId})`;
  const inSupportTickets = `IN (SELECT "id" FROM "support_tickets" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`;

  // ════ Phase 1: deep accounting/banking children ═══════════════════════════
  console.log('  Phase 1: accounting/banking children');
  await wipeWhere('accounting_entry_lines', `"entry_id" ${inAccountingEntries}`);
  await wipeWhere(
    'bank_reconciliation_matches',
    `"reconciliation_id" IN (SELECT "id" FROM "bank_reconciliations" WHERE "bank_account_id" ${inBankAccounts})`,
  );
  await wipeWhere('bank_reconciliations', `"bank_account_id" ${inBankAccounts}`);
  await wipeWhere('bank_transactions', `"bank_account_id" ${inBankAccounts}`);
  await wipeWhere(
    'depreciation_entries',
    `"fixed_asset_id" IN (SELECT "id" FROM "fixed_assets" WHERE "organization_id" = ${orgId})`,
  );
  await wipeWhere(
    'budget_lines',
    `"budget_id" IN (SELECT "id" FROM "budgets" WHERE "organization_id" = ${orgId})`,
  );
  await wipeWhere(
    'consolidation_adjustments',
    `"session_id" IN (SELECT "id" FROM "consolidation_sessions" WHERE "organization_id" = ${orgId}) OR "store_id" = ${storeId}`,
  );
  await wipeScoped('intercompany_transactions');

  // ════ Phase 2: fiscal subsystem ═══════════════════════════════════════════
  console.log('  Phase 2: fiscal subsystem');
  await wipeWhere(
    'fiscal_close_checks',
    `"close_session_id" IN (SELECT "id" FROM "fiscal_close_sessions" WHERE "organization_id" = ${orgId})`,
  );
  await wipeWhere(
    'tax_declaration_lines',
    `"declaration_id" IN (SELECT "id" FROM "tax_declaration_drafts" WHERE "organization_id" = ${orgId})`,
  );
  await wipeWhere(
    'dian_audit_logs',
    `"dian_configuration_id" IN (SELECT "id" FROM "dian_configurations" WHERE "organization_id" = ${orgId})`,
  );
  await wipeScoped('fiscal_operation_events');
  await wipeScoped('fiscal_close_sessions');
  await wipeScoped('tax_declaration_drafts');
  await wipeScoped('fiscal_obligations');
  await wipeScoped('fiscal_evidences');
  await wipeScoped('fiscal_transmissions');
  await wipeScoped('fiscal_rule_sets');
  await wipeScoped('withholding_calculations');
  await wipeWhere(
    'exogenous_report_lines',
    `"report_id" IN (SELECT "id" FROM "exogenous_reports" WHERE "organization_id" = ${orgId})`,
  );
  await wipeScoped('exogenous_reports');
  await wipeScoped('withholding_concepts'); // only org-owned rows; global NULL-org rows untouched
  await wipeScoped('uvt_values');

  // ════ Phase 3: support tickets (reference orders) ═════════════════════════
  // SaaS subscription tables (store_subscriptions, subscription_invoices,
  // payments, events, partner commissions) are PRESERVED: they belong to the
  // real tenant's billing, not to the demo dataset.
  console.log('  Phase 3: support');
  await wipeWhere('support_attachments', `"ticket_id" ${inSupportTickets}`);
  await wipeWhere('support_comments', `"ticket_id" ${inSupportTickets}`);
  await wipeWhere('support_status_history', `"ticket_id" ${inSupportTickets}`);
  await wipeWhere('support_notifications', `"ticket_id" ${inSupportTickets}`);
  await wipeScoped('support_tickets');

  // ════ Phase 4: sales (orders, invoices, quotations, layaway, payments) ════
  console.log('  Phase 4: sales documents');
  await wipeWhere('invoice_retry_queue', `"org_id" = ${orgId} OR "store_id" = ${storeId}`);
  await wipeWhere(
    'refund_items',
    `"refund_id" IN (SELECT "id" FROM "refunds" WHERE "order_id" ${inOrders}) OR "order_item_id" ${inOrderItems}`,
  );
  await wipeWhere('order_item_taxes', `"order_item_id" ${inOrderItems}`);
  await wipeWhere(
    'coupon_uses',
    `"order_id" ${inOrders} OR "coupon_id" IN (SELECT "id" FROM "coupons" WHERE "store_id" = ${storeId})`,
  );
  await wipeScoped('cash_register_movements'); // refs payments/orders, store-scoped
  await wipeWhere('employee_advance_installments', `"advance_id" ${inEmployeeAdvances}`);
  await wipeWhere('employee_advance_payments', `"advance_id" ${inEmployeeAdvances}`);
  await wipeWhere(
    'ar_payments',
    `"accounts_receivable_id" IN (SELECT "id" FROM "accounts_receivable" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`,
  );
  await wipeWhere('refunds', `"order_id" ${inOrders}`);
  await wipeWhere('payments', `"order_id" ${inOrders}`);
  await wipeWhere('invoice_taxes', `"invoice_id" ${inInvoices}`);
  await wipeWhere('invoice_items', `"invoice_id" ${inInvoices}`);
  await wipeWhere(
    'dispatch_note_items',
    `"dispatch_note_id" IN (SELECT "id" FROM "dispatch_notes" WHERE "store_id" = ${storeId})`,
  );
  await wipeScoped('dispatch_notes'); // refs invoices + sales_orders -> before both
  await wipeScoped('invoice_data_requests'); // refs orders + invoices
  await wipeScoped('customer_queue'); // refs orders
  await wipeScoped('bookings'); // refs orders/products/variants
  await wipeScoped('payment_links'); // refs orders
  await wipeWhere(
    'quotation_items',
    `"quotation_id" IN (SELECT "id" FROM "quotations" WHERE "store_id" = ${storeId})`,
  );
  await wipeScoped('quotations'); // refs converted_order_id
  await wipeScoped('inventory_transactions'); // refs order_item_id -> before order_items
  await wipeWhere('order_promotions', `"order_id" ${inOrders}`);
  await wipeWhere('order_installments', `"order_id" ${inOrders}`);
  await wipeWhere('order_items', `"order_id" ${inOrders}`);
  await wipeScoped('invoices'); // before orders (invoices.order_id) and accounting_entries
  await wipeScoped('orders');
  await wipeWhere(
    'sales_order_items',
    `"sales_order_id" IN (SELECT "id" FROM "sales_orders" WHERE "organization_id" = ${orgId})`,
  );
  await wipeScoped('sales_orders');
  await wipeScoped('invoice_resolutions');
  // Layaway (layaway_items refs inventory_locations -> wipe before locations)
  const inLayawayPlans = `IN (SELECT "id" FROM "layaway_plans" WHERE "store_id" = ${storeId})`;
  await wipeWhere('layaway_payments', `"layaway_plan_id" ${inLayawayPlans}`);
  await wipeWhere('layaway_installments', `"layaway_plan_id" ${inLayawayPlans}`);
  await wipeWhere('layaway_items', `"layaway_plan_id" ${inLayawayPlans}`);
  await wipeScoped('layaway_plans');

  // ════ Phase 5: AR/AP, purchases, payroll, employees ═══════════════════════
  console.log('  Phase 5: AR/AP, purchases, payroll');
  await wipeWhere(
    'agreement_installments',
    `"payment_agreement_id" IN (SELECT "id" FROM "payment_agreements" WHERE "store_id" = ${storeId})`,
  );
  await wipeScoped('payment_agreements');
  await wipeScoped('accounts_receivable');
  const inAccountsPayable = `IN (SELECT "id" FROM "accounts_payable" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`;
  await wipeWhere('ap_payment_schedules', `"accounts_payable_id" ${inAccountsPayable}`);
  await wipeWhere('ap_payments', `"accounts_payable_id" ${inAccountsPayable}`);
  await wipeScoped('accounts_payable');
  await wipeWhere(
    'purchase_order_reception_items',
    `"reception_id" IN (SELECT "id" FROM "purchase_order_receptions" WHERE "purchase_order_id" ${inPurchaseOrders})`,
  );
  await wipeWhere('purchase_order_receptions', `"purchase_order_id" ${inPurchaseOrders}`);
  await wipeWhere('purchase_order_items', `"purchase_order_id" ${inPurchaseOrders}`);
  await wipeWhere('purchase_order_payments', `"purchase_order_id" ${inPurchaseOrders}`);
  await wipeWhere('purchase_order_attachments', `"purchase_order_id" ${inPurchaseOrders}`);
  await wipeScoped('inventory_cost_layers'); // refs purchase_orders -> before them
  await wipeScoped('purchase_orders');
  await wipeWhere(
    'payroll_items',
    `"payroll_run_id" IN (SELECT "id" FROM "payroll_runs" WHERE "organization_id" = ${orgId})`,
  );
  await wipeScoped('payroll_novelties');
  await wipeScoped('payroll_settlements');
  await wipeScoped('payroll_runs');
  await wipeScoped('employee_advances');
  await wipeScoped('service_providers'); // refs employees
  await wipeWhere(
    'employee_stores',
    `"store_id" = ${storeId} OR "employee_id" IN (SELECT "id" FROM "employees" WHERE "organization_id" = ${orgId})`,
  );
  await wipeScoped('employees');

  // ════ Phase 6: registers, wallets, expenses, assets ═══════════════════════
  console.log('  Phase 6: registers, wallets, expenses, assets');
  await wipeScoped('commission_calculations');
  await wipeScoped('commission_rules');
  await wipeScoped('cash_register_sessions');
  await wipeScoped('cash_registers');
  await wipeWhere(
    'wallet_transactions',
    `"wallet_id" IN (SELECT "id" FROM "wallets" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`,
  );
  await wipeScoped('wallets');
  await wipeScoped('expenses');
  await wipeScoped('expense_categories');
  await wipeScoped('fixed_assets');
  await wipeScoped('fixed_asset_categories');
  await wipeScoped('budgets');
  await wipeScoped('consolidation_sessions');
  await wipeScoped('bank_accounts'); // refs chart_of_accounts -> before chart wipe

  // ════ Phase 7: inventory + catalog ════════════════════════════════════════
  console.log('  Phase 7: inventory + catalog');
  await wipeScoped('stock_reservations');
  await wipeScoped('inventory_valuation_snapshots');
  await wipeScoped('inventory_adjustments'); // refs inventory_batches
  await wipeScoped('inventory_movements');
  await wipeWhere(
    'inventory_serial_numbers',
    `"product_id" ${inProducts} OR "location_id" ${inLocations}`,
  );
  await wipeWhere(
    'inventory_batches',
    `"product_id" ${inProducts} OR "location_id" ${inLocations}`,
  );
  await wipeWhere(
    'stock_levels',
    `"product_id" ${inProducts} OR "location_id" ${inLocations}`,
  );
  // stores.default_location_id blocks deleting inventory_locations
  await updateWhere('stores', `"default_location_id" = NULL`, `"organization_id" = ${orgId}`);
  await wipeScoped('inventory_locations');
  await wipeWhere(
    'cart_items',
    `"cart_id" IN (SELECT "id" FROM "carts" WHERE "store_id" = ${storeId}) OR "product_id" ${inProducts}`,
  );
  await wipeScoped('carts');
  await wipeWhere(
    'wishlist_items',
    `"wishlist_id" IN (SELECT "id" FROM "wishlists" WHERE "store_id" = ${storeId}) OR "product_id" ${inProducts}`,
  );
  await wipeScoped('wishlists');
  const inReviews = `IN (SELECT "id" FROM "reviews" WHERE "store_id" = ${storeId})`;
  await wipeWhere('review_responses', `"review_id" ${inReviews}`);
  await wipeWhere('review_votes', `"review_id" ${inReviews}`);
  await wipeWhere('review_reports', `"review_id" ${inReviews}`);
  await wipeScoped('reviews');
  const inPriceTiers = `IN (SELECT "id" FROM "price_tiers" WHERE "store_id" = ${storeId})`;
  await wipeWhere(
    'product_price_tier_overrides',
    `"product_id" ${inProducts} OR "price_tier_id" ${inPriceTiers}`,
  );
  await wipeWhere(
    'product_price_tier_assignments',
    `"product_id" ${inProducts} OR "price_tier_id" ${inPriceTiers}`,
  );
  await wipeWhere(
    'product_tax_assignments',
    `"product_id" ${inProducts} OR "tax_category_id" IN (SELECT "id" FROM "tax_categories" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`,
  );
  await wipeWhere(
    'product_categories',
    `"product_id" ${inProducts} OR "category_id" IN (SELECT "id" FROM "categories" WHERE "store_id" = ${storeId})`,
  );
  await wipeWhere('product_images', `"product_id" ${inProducts}`);
  await wipeWhere(
    'supplier_products',
    `"product_id" ${inProducts} OR "supplier_id" IN (SELECT "id" FROM "suppliers" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`,
  );
  await wipeWhere('product_variants', `"product_id" ${inProducts}`);
  await wipeScoped('products');
  await wipeScoped('brands');
  await wipeScoped('categories');
  await wipeScoped('suppliers');
  await wipeScoped('tax_rates');
  await wipeScoped('tax_categories');
  await wipeScoped('price_tiers');
  const inCoupons = `IN (SELECT "id" FROM "coupons" WHERE "store_id" = ${storeId})`;
  await wipeWhere('coupon_products', `"coupon_id" ${inCoupons}`);
  await wipeWhere('coupon_categories', `"coupon_id" ${inCoupons}`);
  await wipeScoped('coupons');
  const inPromotions = `IN (SELECT "id" FROM "promotions" WHERE "store_id" = ${storeId})`;
  await wipeWhere('promotion_products', `"promotion_id" ${inPromotions}`);
  await wipeWhere('promotion_categories', `"promotion_id" ${inPromotions}`);
  await wipeScoped('promotions');

  // ════ Phase 8: comms, AI, shipping, accounting core ═══════════════════════
  console.log('  Phase 8: comms, AI, shipping, accounting core');
  await wipeScoped('notifications');
  await wipeScoped('notification_subscriptions');
  await wipeScoped('push_subscriptions');
  await wipeWhere(
    'ai_messages',
    `"conversation_id" IN (SELECT "id" FROM "ai_conversations" WHERE "organization_id" = ${orgId} OR "store_id" = ${storeId})`,
  );
  await wipeScoped('ai_conversations');
  await wipeScoped('ai_embeddings');
  await wipeScoped('ai_engine_logs');
  await wipeWhere(
    'shipping_rates',
    `"shipping_zone_id" IN (SELECT "id" FROM "shipping_zones" WHERE "store_id" = ${storeId}) OR "shipping_method_id" IN (SELECT "id" FROM "shipping_methods" WHERE "store_id" = ${storeId})`,
  );
  await wipeScoped('shipping_methods');
  await wipeScoped('shipping_zones');
  await wipeScoped('store_payment_methods');
  await wipeScoped('audit_logs');
  await wipeScoped('fiscal_scope_audit_log');
  await wipeScoped('fiscal_status_audit_log');
  await wipeScoped('operating_scope_audit_log');
  await wipeScoped('accounting_account_mappings');
  await wipeScoped('accounting_entries');
  await wipeScoped('fiscal_periods');
  // chart_of_accounts is self-referencing (parent_id) — break tree first
  await updateWhere('chart_of_accounts', `"parent_id" = NULL`, `"organization_id" = ${orgId}`);
  await wipeScoped('chart_of_accounts');

  // ════ Phase 9: catch-all over remaining org/store-scoped tables ═══════════
  console.log('  Phase 9: catch-all scoped tables');
  // Tenant infrastructure the catch-all must NEVER touch. Some are handled
  // surgically in Phase 10 (demo users only); the rest are preserved outright.
  const preserved = new Set([
    'stores',
    'users',
    'organizations',
    'addresses',
    'store_users',
    'login_attempts',
    'organization_settings',
    'organization_onboarding_state',
    'store_settings',
    'store_subscriptions',
    'subscription_invoices',
    'subscription_payments',
    'subscription_payment_methods',
    'subscription_events',
    'partner_commissions',
    'commission_accrual_pending',
    'domain_settings',
  ]);
  let pending = [...scopeCols.keys()].filter(
    (t) => !handled.has(t) && !preserved.has(t),
  );
  for (let pass = 1; pass <= 3 && pending.length > 0; pass++) {
    const stillFailing: string[] = [];
    for (const table of pending) {
      const cols = scopeCols.get(table)!;
      const conds: string[] = [];
      if (cols.has('organization_id')) conds.push(`"organization_id" = ${orgId}`);
      if (cols.has('store_id')) conds.push(`"store_id" = ${storeId}`);
      try {
        const n = await prisma.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE ${conds.join(' OR ')}`,
        );
        if (n > 0) console.log(`    - ${table}: ${n}`);
      } catch (e: any) {
        if (pass === 3) logErr(table, e);
        else stillFailing.push(table);
      }
    }
    pending = stillFailing;
  }

  // ════ Phase 10: demo users only (tenant rows are preserved) ═══════════════
  console.log('  Phase 10: demo users');
  // after the catch-all so dian_configurations & friends are already gone
  await wipeScoped('accounting_entities');
  await wipeWhere(
    'login_attempts',
    `"email" LIKE '%@${ROKU_DEMO_EMAIL_DOMAIN}'`,
  );
  if (demoUserIds.length > 0) {
    const byUser = `"user_id" IN (${userIdsCsv})`;
    await wipeWhere('user_roles', byUser);
    await wipeWhere('user_sessions', byUser);
    await wipeWhere('refresh_tokens', byUser);
    await wipeWhere('password_reset_tokens', byUser);
    await wipeWhere('email_verification_tokens', byUser);
    await wipeWhere('api_keys', byUser);
    await wipeWhere('document_acceptances', byUser);
    await wipeWhere('support_notifications', byUser);
    await wipeWhere('user_settings', byUser);
    // Only addresses owned by demo users; org/store/real-user addresses stay.
    await wipeWhere('addresses', byUser);
    // Demo supplier addresses are org-scoped with type 'commercial' (stage 04).
    await wipeWhere(
      'addresses',
      `"organization_id" = ${orgId} AND "type" = 'commercial'`,
    );
    await wipeWhere('store_users', byUser);
    // users.main_store_id is fine to keep on real users; demo users go away.
    await wipeWhere('users', `"id" IN (${userIdsCsv})`);
  }
  // organizations, stores, organization_settings, organization_onboarding_state,
  // store_settings, subscriptions and domain_settings are intentionally NOT
  // touched: they are the real tenant, not demo data.

  console.log('✅ Wipe complete.');
}

async function main(): Promise<void> {
  assertNotProduction(false);
  const prisma = getPrismaClient();
  await assertRokuOrg(prisma, false);
  await wipeRoku(prisma);
  await disconnectPrisma();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('💥 Wipe failed:');
    console.error(err);
    process.exit(1);
  });
}
