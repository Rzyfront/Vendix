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
  'invoice.validated.vat_payable': '2408',
  'payment.received.cash': '1105',
  'payment.received.accounts_receivable': '1305',
  'payment.received.revenue': '4135',
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
  'payroll.paid.salaries_payable': '2505',
  'payroll.paid.bank': '1110',
  'order.completed.cogs': '6135',
  'order.completed.inventory': '1435',
  'refund.completed.revenue': '4135',
  'refund.completed.cash': '1105',
  'purchase_order.received.inventory': '1435',
  'purchase_order.received.accounts_payable': '2205',
  'purchase_order.payment.accounts_payable': '2205',
  'purchase_order.payment.cash_bank': '1110',
  'inventory.adjusted.inventory': '1435',
  'inventory.adjusted.shrinkage': '5295',
  // Phase 1: IVA on direct POS sales
  'payment.received.bank': '1110',
  'payment.received.vat_payable': '2408',
  // Phase 1: Credit sales
  'credit_sale.created.accounts_receivable': '1305',
  'credit_sale.created.revenue': '4135',
  'credit_sale.created.vat_payable': '2408',
  // Phase 1: Refund VAT reversal
  'refund.completed.vat_payable': '2408',
  // Phase 2: Sales discounts (POS coupons, manual discounts)
  'payment.received.sales_discount': '4175',
  'credit_sale.created.sales_discount': '4175',
  // Layaway (Plan Separé)
  'layaway.payment.cash': '1105',
  'layaway.payment.bank': '1110',
  'layaway.payment.customer_advance': '2805',
  'layaway.completed.customer_advance': '2805',
  'layaway.completed.revenue': '4135',
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
  // Settlement (Liquidación por Terminación)
  'settlement.paid.severance': '2610',
  'settlement.paid.severance_interest': '2615',
  'settlement.paid.bonus': '2620',
  'settlement.paid.vacation': '2625',
  'settlement.paid.pending_salary': '5105',
  'settlement.paid.indemnification': '5105',
  'settlement.paid.social_deductions': '2370',
  'settlement.paid.bank': '1110',
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
  'payroll.approved.provision_severance': '5205',
  'payroll.approved.provision_severance_interest': '5205',
  'payroll.approved.provision_vacation': '5205',
  'payroll.approved.provision_bonus': '5205',
  'payroll.approved.health_employer': '5110',
  'payroll.approved.pension_employer': '5110',
  'payroll.approved.arl_expense': '5110',
  'payroll.approved.sena_expense': '5110',
  'payroll.approved.icbf_expense': '5110',
  'payroll.approved.compensation_fund_expense': '5110',
  // Nómina individual — pasivos provisiones (créditos)
  'payroll.approved.liability_severance': '2610',
  'payroll.approved.liability_severance_interest': '2615',
  'payroll.approved.liability_vacation': '2620',
  'payroll.approved.liability_bonus': '2625',
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
  // SaaS Subscription (RNC-31) — Store side: gasto admin del cliente
  'saas_subscription_expense.expense': '5135',
  'saas_subscription_expense.cash_bank': '1110',
  // SaaS Subscription (RNC-31) — Platform side: ingreso Vendix + partner payable
  'saas_revenue.cash_bank': '1110',
  'saas_revenue.revenue': '4135',
  'saas_revenue.partner_payable': '2335',
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
        // Update existing mapping
        await client.accounting_account_mappings.update({
          where: { id: existing.id },
          data: {
            account_id,
            is_active: true,
          },
        });
      } else {
        // Create new mapping
        await client.accounting_account_mappings.create({
          data: {
            organization_id: org.id,
            store_id: null,
            mapping_key,
            account_id,
            is_active: true,
          },
        });
      }

      mappings_created++;
    }

    organizations_processed++;
  }

  console.log(
    `[Account Mappings] Processed ${organizations_processed} organizations: ` +
      `${mappings_created} mappings created/updated, ${mappings_skipped} skipped`,
  );

  return { organizations_processed, mappings_created, mappings_skipped };
}
