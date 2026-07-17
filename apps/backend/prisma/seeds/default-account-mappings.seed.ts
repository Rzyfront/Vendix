import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedDefaultAccountMappingsResult {
  organizations_processed: number;
  mappings_created: number;
  mappings_skipped: number;
}

/**
 * Default PUC account code for each mapping key.
 * Defined locally to avoid cross-boundary imports from src/.
 */
const MAPPING_DEFAULTS: Record<string, string> = {
  'invoice.validated.accounts_receivable': '1305',
  'invoice.validated.revenue': '4135',
  'invoice.validated.shipping_income': '414505',
  'invoice.validated.vat_payable': '2408',
  'payment.received.cash': '1105',
  'payment.received.accounts_receivable': '1305',
  'payment.received.revenue': '4135',
  'payment.received.shipping_income': '414505',
  'expense.approved.expense': '5195',
  'expense.approved.accounts_payable': '2205',
  'expense.paid.accounts_payable': '2205',
  'expense.paid.cash': '1105',
  'expense.refunded.accounts_payable': '2205',
  'expense.refunded.cash': '1105',
  'expense.refunded.expense': '5195',
  'expense.cancelled.accounts_payable': '2205',
  'expense.cancelled.expense': '5195',
  'payroll.approved.payroll_expense': '5105',
  'payroll.approved.social_security': '5105',
  // Cost center: Administrative
  'payroll.approved.payroll_expense.administrative': '5105',
  'payroll.approved.social_security.administrative': '5105',
  // Cost center: Operational (Mano de Obra Directa - Costo)
  'payroll.approved.payroll_expense.operational': '7205',
  'payroll.approved.social_security.operational': '7205',
  // Cost center: Sales (Gastos de Personal - Ventas)
  'payroll.approved.payroll_expense.sales': '5205',
  'payroll.approved.social_security.sales': '5205',
  'payroll.approved.salaries_payable': '2505',
  'payroll.approved.health_payable': '2370',
  'payroll.approved.pension_payable': '2380',
  'payroll.approved.withholdings': '2365',
  // B1: segregación de retefuente laboral en 236505 (child of 2365).
  'payroll.approved.labor_withholding': '236505',
  'payroll.paid.salaries_payable': '2505',
  // Drenaje de aportes al pagar la nómina.
  'payroll.paid.health_social_payable': '2370',
  'payroll.paid.pension_social_payable': '2380',
  'payroll.paid.bank': '1110',
  'order.completed.cogs': '6135',
  'order.completed.inventory': '1435',
  // Remisiones bidireccionales (Fase 4) — mismas cuentas PUC que
  // order.completed / purchase_order.received, mapping key separada.
  'dispatch_note.delivered.cogs': '6135',
  'dispatch_note.delivered.inventory': '1435',
  'dispatch_note.received.inventory': '1435',
  'dispatch_note.received.accounts_payable': '2205',
  'dispatch_note.return.inventory': '1435',
  'dispatch_note.return.cogs': '6135',
  'refund.completed.revenue': '4135',
  'refund.completed.cash': '1105',
  'purchase_order.received.inventory': '1435',
  'purchase_order.received.accounts_payable': '2205',
  'support_document.accepted.expense': '5195',
  'support_document.accepted.vat_deductible': '240804',
  'support_document.accepted.iva_deductible': '240804',
  'support_document.accepted.withholding_payable': '2365',
  'support_document.accepted.accounts_payable': '2205',
  // F2 IVA lifecycle — VAT-only recognition of a POP purchase (dual-source
  // with DEFAULT_ACCOUNT_MAPPINGS): DR 240804 (IVA descontable) / CR 2205
  // (proveedores). Complements purchase_order.received (DR 1435 net / CR 2205
  // net) so the payable reaches gross without contabilizing expense (5195).
  'purchase.vat_recognized.iva_deductible': '240804',
  'purchase.vat_recognized.accounts_payable': '2205',
  'purchase_order.payment.accounts_payable': '2205',
  'purchase_order.payment.cash_bank': '1110',
  'inventory.adjusted.inventory': '1435',
  'inventory.adjusted.shrinkage': '5295',
  // Restaurant Suite Fase C — sub-recipe batch production.
  // Produccion is a value transfer between inventory buckets; the two
  // default to 1435 because the entry is intra-inventory. Orgs that split
  // sub-inventories (e.g. raw 1430 / in-process 1420 / finished 1435)
  // can override the mappings per store or org.
  'production.completed.finished_goods': '1435',
  'production.completed.ingredient_consumed': '1435',
  // Restaurant Suite Fase D — fire-to-kitchen COGS. Mirrors
  // DEFAULT_ACCOUNT_MAPPINGS so a custom org override in the UI flows
  // through the seed.
  'kitchen.fired.cogs': '6135',
  'kitchen.fired.inventory': '1435',
  // Phase 1: IVA on direct POS sales
  'payment.received.bank': '1110',
  'payment.received.vat_payable': '2408',
  // Phase 1: Credit sales
  'credit_sale.created.accounts_receivable': '1305',
  'credit_sale.created.revenue': '4135',
  'credit_sale.created.shipping_income': '414505',
  'credit_sale.created.vat_payable': '2408',
  // Phase 1: Refund VAT reversal
  'refund.completed.vat_payable': '2408',
  // Typed fiscal tax routing (per tax_type): IVA→240802, INC→2436, ICA→2412.
  // Mirrors DEFAULT_ACCOUNT_MAPPINGS so AutoEntryService.resolveTaxLines posts
  // each fiscal type to its own PUC account instead of collapsing into 2408.
  'invoice.validated.iva_payable': '240802',
  'invoice.validated.inc_payable': '2436',
  'invoice.validated.ica_payable': '2412',
  'payment.received.iva_payable': '240802',
  'payment.received.inc_payable': '2436',
  'payment.received.ica_payable': '2412',
  'credit_sale.created.iva_payable': '240802',
  'credit_sale.created.inc_payable': '2436',
  'credit_sale.created.ica_payable': '2412',
  'refund.completed.iva_payable': '240802',
  'refund.completed.inc_payable': '2436',
  'refund.completed.ica_payable': '2412',
  // Credit notes (nota crédito aceptada) — reversa espejo de la venta.
  // Mirrors DEFAULT_ACCOUNT_MAPPINGS (dual-source rule).
  'credit_note.accepted.sales_returns': '4175',
  'credit_note.accepted.iva_payable': '240802',
  'credit_note.accepted.inc_payable': '2436',
  'credit_note.accepted.ica_payable': '2412',
  'credit_note.accepted.accounts_receivable': '1305',
  // Phase 2: Sales discounts (POS coupons, manual discounts)
  'payment.received.sales_discount': '4175',
  'credit_sale.created.sales_discount': '4175',
  // GAP-6 (QR mesa dine-in): Propina POS = pasivo custodio (238005 Acreedores
  // Varios), sin IVA, no es ingreso. Dual-source con DEFAULT_ACCOUNT_MAPPINGS.
  'payment.received.tip_payable': '238005',
  // Layaway (Plan Separé)
  'layaway.payment.cash': '1105',
  'layaway.payment.bank': '1110',
  'layaway.payment.customer_advance': '2805',
  'layaway.completed.customer_advance': '2805',
  'layaway.completed.revenue': '4135',
  // Layaway cancellation — reversa anticipo, devolución y penalización
  'layaway.cancelled.advance': '2805',
  'layaway.cancelled.refund': '1105',
  'layaway.cancelled.forfeit_income': '4295',
  // Fixed Assets - Depreciation
  'depreciation.monthly.depreciation_expense': '5199',
  'depreciation.monthly.accumulated_depreciation': '1592',
  // Fixed Assets - Disposal
  'disposal.fixed_asset.asset_cost': '1520',
  'disposal.fixed_asset.accumulated_depreciation': '1592',
  'disposal.fixed_asset.loss': '5310',
  'disposal.fixed_asset.gain': '4245',
  'disposal.fixed_asset.cash': '1105',
  // Withholding Tax (Retención en la Fuente)
  'withholding.applied.expense': '5195',
  'withholding.applied.withholding_payable': '2365',
  'withholding.applied.accounts_payable': '2205',
  // Withholding ENGINE (Block B) — dual-role routing by withholding_type.
  // Mirrors DEFAULT_ACCOUNT_MAPPINGS. practiced → liability (2365/2367/2368),
  // suffered → asset (1355xx). Per-concept account_code overrides retefuente.
  'withholding.practiced.retefuente_payable': '236525',
  'withholding.practiced.reteiva_payable': '236705',
  'withholding.practiced.reteica_payable': '236805',
  'withholding.suffered.retefuente_receivable': '135510',
  'withholding.suffered.reteiva_receivable': '135515',
  'withholding.suffered.reteica_receivable': '135517',
  // Settlement ACCRUAL (causación al aprobar) — DRENA las provisiones 25xx
  // acumuladas por la causación de nómina (payroll.approved.*_payable). Mirrors
  // DEFAULT_ACCOUNT_MAPPINGS: mismos PUC que los pasivos de provisión
  // (2510/2515/2520/2525), NO las 26xx obsoletas. El exceso sobre lo
  // provisionado → 5105 (settlement.approved.provision_shortfall).
  'settlement.approved.severance': '2510',
  'settlement.approved.severance_interest': '2515',
  'settlement.approved.bonus': '2520',
  'settlement.approved.vacation': '2525',
  'settlement.approved.provision_shortfall': '5105',
  'settlement.approved.pending_salary': '5105',
  'settlement.approved.indemnification': '5105',
  'settlement.approved.salaries_payable': '2505',
  // Settlement (Liquidación por Terminación)
  'settlement.paid.severance': '2610',
  'settlement.paid.severance_interest': '2615',
  'settlement.paid.bonus': '2620',
  'settlement.paid.vacation': '2625',
  'settlement.paid.pending_salary': '5105',
  'settlement.paid.indemnification': '5105',
  'settlement.paid.social_deductions': '2370',
  'settlement.paid.bank': '1110',
  // Devengo: el pago drena el pasivo laboral 2505 causado en approved
  'settlement.paid.salaries_payable': '2505',
  // Stock Transfers
  'stock_transfer.completed.inventory_origin': '1435',
  'stock_transfer.completed.inventory_destination': '1435',
  'intercompany_transfer.shipped.receivable': '1365',
  'intercompany_transfer.shipped.inventory': '1435',
  'intercompany_transfer.received.inventory': '1435',
  'intercompany_transfer.received.payable': '2355',
  'commission.calculated.expense': '5295',
  'commission.calculated.payable': '2335',
  // Nómina individual — gastos de nómina (débitos)
  'payroll.approved.transport_subsidy': '5105',
  // Provisiones prestacionales GASTO (Decreto 2650: 5105 subcuentas por CC).
  'payroll.approved.provision_severance': '510530',
  'payroll.approved.provision_severance_interest': '510533',
  'payroll.approved.provision_vacation': '510539',
  'payroll.approved.provision_bonus': '510536',
  // Aportes patronales GASTO (Decreto 2650: 5105 subcuentas, antes 5110).
  'payroll.approved.health_employer': '510568',
  'payroll.approved.pension_employer': '510569',
  'payroll.approved.arl_expense': '510570',
  'payroll.approved.sena_expense': '510578',
  'payroll.approved.icbf_expense': '510575',
  'payroll.approved.compensation_fund_expense': '510572',
  // Provisiones prestacionales PASIVO (Decreto 2650: 2510/2515/2520/2525).
  // Claves nuevas: las liability_* 26xx quedan obsoletas.
  'payroll.approved.severance_payable': '2510',
  'payroll.approved.severance_interest_payable': '2515',
  'payroll.approved.vacation_payable': '2525',
  'payroll.approved.bonus_payable': '2520',
  // Reembolsables incapacidad/licencia (EPS/ARL) → CxC 1355.
  'payroll.approved.reimbursable_receivable': '1355',
  // Aportes patronales GASTO por centro de costo.
  'payroll.approved.health_employer.administrative': '510568',
  'payroll.approved.health_employer.sales': '520568',
  'payroll.approved.health_employer.operational': '720568',
  'payroll.approved.pension_employer.administrative': '510569',
  'payroll.approved.pension_employer.sales': '520569',
  'payroll.approved.pension_employer.operational': '720569',
  'payroll.approved.arl_expense.administrative': '510570',
  'payroll.approved.arl_expense.sales': '520570',
  'payroll.approved.arl_expense.operational': '720570',
  'payroll.approved.sena_expense.administrative': '510578',
  'payroll.approved.sena_expense.sales': '5205',
  'payroll.approved.sena_expense.operational': '7205',
  'payroll.approved.icbf_expense.administrative': '510575',
  'payroll.approved.icbf_expense.sales': '5205',
  'payroll.approved.icbf_expense.operational': '7205',
  'payroll.approved.compensation_fund_expense.administrative': '510572',
  'payroll.approved.compensation_fund_expense.sales': '520572',
  'payroll.approved.compensation_fund_expense.operational': '7205',
  // Provisiones prestacionales GASTO por centro de costo.
  'payroll.approved.provision_severance.administrative': '510530',
  'payroll.approved.provision_severance.sales': '520530',
  'payroll.approved.provision_severance.operational': '720530',
  'payroll.approved.provision_severance_interest.administrative': '510533',
  'payroll.approved.provision_severance_interest.sales': '520533',
  'payroll.approved.provision_severance_interest.operational': '720533',
  'payroll.approved.provision_vacation.administrative': '510539',
  'payroll.approved.provision_vacation.sales': '520539',
  'payroll.approved.provision_vacation.operational': '720539',
  'payroll.approved.provision_bonus.administrative': '510536',
  'payroll.approved.provision_bonus.sales': '520536',
  'payroll.approved.provision_bonus.operational': '720536',
  // Nómina individual — aportes patronales por pagar (créditos)
  'payroll.approved.health_employer_payable': '2370',
  'payroll.approved.pension_employer_payable': '2380',
  'payroll.approved.arl_payable': '2370',
  'payroll.approved.sena_payable': '2370',
  'payroll.approved.icbf_payable': '2370',
  'payroll.approved.compensation_fund_payable': '2370',
  'payroll.approved.advance_deduction': '1450',
  // Cash Register
  'cash_register.opened.cash': '1105',
  'cash_register.opened.cash_base': '1110',
  'cash_register.closed.cash': '1105',
  'cash_register.closed.bank': '1110',
  'cash_register.closed.surplus': '4295',
  'cash_register.closed.shortage': '5295',
  'cash_register.movement.cash': '1105',
  'cash_register.movement.other': '2805',
  // Dispatch routes (planillas DSD) — cuadre de efectivo del conductor al cierre
  'dispatch_route.closed.cash': '1105',
  'dispatch_route.closed.surplus': '4295',
  'dispatch_route.closed.shortage_receivable': '1365',
  // Plan Despacho Economía — FASE 5 paso 17. Costo del transportador al
  // liquidar la ruta. DR 523550 (gross), CR 2205→banco (pago neto).
  'dispatch_route.settlement.transport_cost': '523550',
  'dispatch_route.settlement.accounts_payable': '2205',
  // SaaS Subscription (RNC-31) — Store side: gasto admin del cliente
  'saas_subscription_expense.expense': '5135',
  'saas_subscription_expense.cash_bank': '1110',
  // SaaS Subscription (RNC-31) — Platform side: ingreso Vendix + partner payable
  'saas_revenue.cash_bank': '1110',
  'saas_revenue.revenue': '4135',
  'saas_revenue.partner_payable': '2335',
  // SaaS Refund (RNC-MF-3) — Reversa del ingreso cuando Vendix devuelve dinero a un tenant
  'saas_refund.revenue': '4175',
  'saas_refund.cash_bank': '1110',
  // SaaS Payment Failed (RNC-MF-3) — Provisión de incobrable cuando un cobro Wompi falla
  'saas_bad_debt.expense': '5295',
  'saas_bad_debt.receivable': '1305',
  // Partner Payout Paid (RNC-MF-3) — Pago de batch de comisiones a partner
  'saas_partner_payout.commissions_payable': '2335',
  'saas_partner_payout.cash_bank': '1110',
  // VAT settlement (liquidación de IVA al aprobar la declaración). Mirrors
  // DEFAULT_ACCOUNT_MAPPINGS (dual-source): DR 240802 (generado) / CR 240804
  // (descontable) + neto → CR 240810 (a pagar) o DR 135520 (a favor).
  'vat.declaration.settled.iva_generated': '240802',
  'vat.declaration.settled.iva_deductible': '240804',
  'vat.declaration.settled.vat_payable': '240810',
  'vat.declaration.settled.vat_favor': '135520',
};

/**
 * DEPENDENCIES: Requires organizations and chart_of_accounts to exist.
 *
 * Seeds default accounting account mappings for all organizations.
 * For each organization, resolves PUC account codes from chart_of_accounts
 * and creates org-level (store_id = null) mapping records.
 *
 * Uses findFirst + create/update instead of upsert because the composite
 * unique constraint @@unique([organization_id, store_id, mapping_key])
 * does not work reliably with NULL store_id in Prisma upsert.
 *
 * Idempotent: can run multiple times safely.
 */
export async function seedDefaultAccountMappings(
  prisma?: PrismaClient,
): Promise<SeedDefaultAccountMappingsResult> {
  const client = prisma || getPrismaClient();

  const organizations = await client.organizations.findMany({
    select: { id: true, name: true },
  });

  let organizations_processed = 0;
  let mappings_created = 0;
  let mappings_skipped = 0;

  for (const org of organizations) {
    const accounts = await client.chart_of_accounts.findMany({
      where: { organization_id: org.id },
      select: { id: true, code: true },
    });

    const account_by_code = new Map(accounts.map((a) => [a.code, a.id]));

    for (const [mapping_key, account_code] of Object.entries(
      MAPPING_DEFAULTS,
    )) {
      const account_id = account_by_code.get(account_code);

      if (!account_id) {
        console.warn(
          `  [Account Mappings] Skipping "${mapping_key}" for org "${org.name}" (id=${org.id}): ` +
            `account code "${account_code}" not found in chart_of_accounts`,
        );
        mappings_skipped++;
        continue;
      }

      // Check if mapping already exists (findFirst because store_id is NULL)
      const existing = await client.accounting_account_mappings.findFirst({
        where: {
          organization_id: org.id,
          store_id: null,
          mapping_key,
        },
      });

      if (existing) {
        // Preserve user-edited mapping — never overwrite account_id once set.
        mappings_skipped++;
        continue;
      }

      await client.accounting_account_mappings.create({
        data: {
          organization_id: org.id,
          store_id: null,
          mapping_key,
          account_id,
          is_active: true,
        },
      });
      mappings_created++;
    }

    organizations_processed++;
  }

  console.log(
    `[Account Mappings] Processed ${organizations_processed} organizations: ` +
      `${mappings_created} mappings created, ${mappings_skipped} skipped (preserved existing)`,
  );

  return { organizations_processed, mappings_created, mappings_skipped };
}
