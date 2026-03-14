import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

export const DEFAULT_ACCOUNT_MAPPINGS: Record<string, { code: string; description: string }> = {
  'invoice.validated.accounts_receivable': { code: '1305', description: 'Cuentas por Cobrar' },
  'invoice.validated.revenue': { code: '4135', description: 'Ingresos' },
  'invoice.validated.vat_payable': { code: '2408', description: 'IVA por Pagar' },
  'payment.received.cash': { code: '1105', description: 'Caja/Banco' },
  'payment.received.accounts_receivable': { code: '1305', description: 'Cuentas por Cobrar' },
  'payment.received.revenue': { code: '4135', description: 'Ingresos por Ventas (venta directa sin factura)' },
  'expense.approved.expense': { code: '5195', description: 'Gastos Diversos' },
  'expense.approved.accounts_payable': { code: '2205', description: 'Proveedores' },
  'expense.paid.accounts_payable': { code: '2205', description: 'Proveedores' },
  'expense.paid.cash': { code: '1105', description: 'Caja/Banco' },
  'payroll.approved.payroll_expense': { code: '5105', description: 'Gastos de Personal' },
  'payroll.approved.social_security': { code: '5110', description: 'Seguridad Social' },
  'payroll.approved.salaries_payable': { code: '2505', description: 'Salarios por Pagar' },
  'payroll.approved.health_payable': { code: '2370', description: 'EPS' },
  'payroll.approved.pension_payable': { code: '2380', description: 'Pension' },
  'payroll.approved.withholdings': { code: '2365', description: 'Retenciones' },
  'payroll.paid.salaries_payable': { code: '2505', description: 'Salarios por Pagar' },
  'payroll.paid.bank': { code: '1110', description: 'Banco' },
  'order.completed.cogs': { code: '6135', description: 'Costo de Ventas' },
  'order.completed.inventory': { code: '1435', description: 'Inventario' },
  'refund.completed.revenue': { code: '4135', description: 'Ingresos (reversa)' },
  'refund.completed.cash': { code: '1105', description: 'Caja/Banco' },
  'purchase_order.received.inventory': { code: '1435', description: 'Inventario' },
  'purchase_order.received.accounts_payable': { code: '2205', description: 'Proveedores' },
  'inventory.adjusted.inventory': { code: '1435', description: 'Inventario' },
  'inventory.adjusted.shrinkage': { code: '5295', description: 'Faltantes de Inventario' },
  // Phase 1: IVA on direct POS sales
  'payment.received.bank': { code: '1110', description: 'Banco (Transferencia/Tarjeta)' },
  'payment.received.vat_payable': { code: '2408', description: 'IVA por Pagar (venta directa)' },
  // Phase 1: Credit sales
  'credit_sale.created.accounts_receivable': { code: '1305', description: 'Cuentas por Cobrar (venta a crédito)' },
  'credit_sale.created.revenue': { code: '4135', description: 'Ingresos por Ventas (venta a crédito)' },
  'credit_sale.created.vat_payable': { code: '2408', description: 'IVA por Pagar (venta a crédito)' },
  // Phase 1: Refund VAT reversal
  'refund.completed.vat_payable': { code: '2408', description: 'IVA por Pagar (reversa devolución)' },
};

interface CacheEntry {
  data: Map<string, { account_code: string; account_id?: number; source: 'store' | 'organization' | 'default' }>;
  expires_at: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AccountMappingService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private getCacheKey(org_id: number, store_id?: number): string {
    return `${org_id}:${store_id || 'org'}`;
  }

  private invalidateCache(org_id: number, store_id?: number): void {
    const key = this.getCacheKey(org_id, store_id);
    this.cache.delete(key);
    // Also invalidate the combined key if invalidating store-level
    if (store_id) {
      this.cache.delete(this.getCacheKey(org_id));
    }
  }

  /**
   * Get a single mapping with cascade resolution:
   * 1. Store override (if store_id provided)
   * 2. Org base (store_id = null)
   * 3. Fallback to DEFAULT_ACCOUNT_MAPPINGS
   */
  async getMapping(
    org_id: number,
    mapping_key: string,
    store_id?: number,
  ): Promise<{ account_code: string; account_id?: number; source: 'store' | 'organization' | 'default' }> {
    const base_client = this.prisma.withoutScope();

    // 1. Check store override
    if (store_id) {
      const store_mapping = await base_client.accounting_account_mappings.findFirst({
        where: {
          organization_id: org_id,
          store_id: store_id,
          mapping_key: mapping_key,
          is_active: true,
        },
        include: { account: { select: { id: true, code: true } } },
      });

      if (store_mapping) {
        return {
          account_code: store_mapping.account.code,
          account_id: store_mapping.account.id,
          source: 'store',
        };
      }
    }

    // 2. Check org base (store_id = null)
    const org_mapping = await base_client.accounting_account_mappings.findFirst({
      where: {
        organization_id: org_id,
        store_id: null,
        mapping_key: mapping_key,
        is_active: true,
      },
      include: { account: { select: { id: true, code: true } } },
    });

    if (org_mapping) {
      return {
        account_code: org_mapping.account.code,
        account_id: org_mapping.account.id,
        source: 'organization',
      };
    }

    // 3. Fallback to defaults
    const default_mapping = DEFAULT_ACCOUNT_MAPPINGS[mapping_key];
    if (!default_mapping) {
      throw new NotFoundException(`Mapping key '${mapping_key}' not found`);
    }

    return {
      account_code: default_mapping.code,
      source: 'default',
    };
  }

  /**
   * List all mappings (merge store overrides + org base + defaults) with source indicator.
   * If prefix provided, filter by mapping_key starting with prefix.
   */
  async getMappings(
    org_id: number,
    prefix?: string,
    store_id?: number,
  ): Promise<Array<{
    mapping_key: string;
    account_code: string;
    account_id?: number;
    description: string;
    source: 'store' | 'organization' | 'default';
  }>> {
    const base_client = this.prisma.withoutScope();

    // Fetch org-level mappings
    const org_mappings = await base_client.accounting_account_mappings.findMany({
      where: {
        organization_id: org_id,
        store_id: null,
        is_active: true,
        ...(prefix && { mapping_key: { startsWith: prefix } }),
      },
      include: { account: { select: { id: true, code: true, name: true } } },
    });

    // Fetch store-level mappings if store_id provided
    let store_mappings: typeof org_mappings = [];
    if (store_id) {
      store_mappings = await base_client.accounting_account_mappings.findMany({
        where: {
          organization_id: org_id,
          store_id: store_id,
          is_active: true,
          ...(prefix && { mapping_key: { startsWith: prefix } }),
        },
        include: { account: { select: { id: true, code: true, name: true } } },
      });
    }

    // Build org map
    const org_map = new Map<string, { account_code: string; account_id: number; description: string }>();
    for (const m of org_mappings) {
      org_map.set(m.mapping_key, {
        account_code: m.account.code,
        account_id: m.account.id,
        description: m.account.name,
      });
    }

    // Build store map
    const store_map = new Map<string, { account_code: string; account_id: number; description: string }>();
    for (const m of store_mappings) {
      store_map.set(m.mapping_key, {
        account_code: m.account.code,
        account_id: m.account.id,
        description: m.account.name,
      });
    }

    // Merge: iterate all default keys and resolve with cascade
    const all_keys = Object.keys(DEFAULT_ACCOUNT_MAPPINGS).filter(
      (key) => !prefix || key.startsWith(prefix),
    );

    const result = all_keys.map((mapping_key) => {
      // Store override takes priority
      if (store_map.has(mapping_key)) {
        const store_entry = store_map.get(mapping_key)!;
        return {
          mapping_key,
          account_code: store_entry.account_code,
          account_id: store_entry.account_id,
          description: store_entry.description,
          source: 'store' as const,
        };
      }

      // Then org base
      if (org_map.has(mapping_key)) {
        const org_entry = org_map.get(mapping_key)!;
        return {
          mapping_key,
          account_code: org_entry.account_code,
          account_id: org_entry.account_id,
          description: org_entry.description,
          source: 'organization' as const,
        };
      }

      // Fallback to default
      const default_entry = DEFAULT_ACCOUNT_MAPPINGS[mapping_key];
      return {
        mapping_key,
        account_code: default_entry.code,
        description: default_entry.description,
        source: 'default' as const,
      };
    });

    return result;
  }

  /**
   * Create or update a single mapping.
   * Validates mapping_key exists in DEFAULT_ACCOUNT_MAPPINGS.
   * Validates account_id exists in chart_of_accounts.
   */
  async upsertMapping(
    org_id: number,
    mapping_key: string,
    account_id: number,
    store_id?: number,
  ) {
    // Validate mapping_key
    if (!DEFAULT_ACCOUNT_MAPPINGS[mapping_key]) {
      throw new BadRequestException(
        `Invalid mapping_key '${mapping_key}'. Must be one of: ${Object.keys(DEFAULT_ACCOUNT_MAPPINGS).join(', ')}`,
      );
    }

    // Validate account_id exists in chart_of_accounts
    const account = await this.prisma.chart_of_accounts.findFirst({
      where: { id: account_id },
    });

    if (!account) {
      throw new NotFoundException(
        `Account with id ${account_id} not found in chart of accounts`,
      );
    }

    const base_client = this.prisma.withoutScope();

    // Use findFirst + create/update to handle nullable store_id safely
    // (PostgreSQL treats NULLs as distinct in unique constraints)
    const existing = await base_client.accounting_account_mappings.findFirst({
      where: {
        organization_id: org_id,
        store_id: store_id ?? null,
        mapping_key: mapping_key,
      },
    });

    let result;
    if (existing) {
      result = await base_client.accounting_account_mappings.update({
        where: { id: existing.id },
        data: {
          account_id: account_id,
          is_active: true,
          updated_at: new Date(),
        },
      });
    } else {
      result = await base_client.accounting_account_mappings.create({
        data: {
          organization_id: org_id,
          store_id: store_id ?? null,
          mapping_key: mapping_key,
          account_id: account_id,
        },
      });
    }

    this.invalidateCache(org_id, store_id);

    return result;
  }

  /**
   * Bulk create/update mappings.
   */
  async bulkUpsertMappings(
    org_id: number,
    mappings: Array<{ mapping_key: string; account_id: number }>,
    store_id?: number,
  ) {
    // Validate all mapping_keys
    const invalid_keys = mappings.filter((m) => !DEFAULT_ACCOUNT_MAPPINGS[m.mapping_key]);
    if (invalid_keys.length > 0) {
      throw new BadRequestException(
        `Invalid mapping_key(s): ${invalid_keys.map((k) => k.mapping_key).join(', ')}`,
      );
    }

    // Validate all account_ids exist
    const account_ids = [...new Set(mappings.map((m) => m.account_id))];
    const existing_accounts = await this.prisma.chart_of_accounts.findMany({
      where: { id: { in: account_ids } },
      select: { id: true },
    });

    const existing_ids = new Set(existing_accounts.map((a) => a.id));
    const missing_ids = account_ids.filter((id) => !existing_ids.has(id));

    if (missing_ids.length > 0) {
      throw new NotFoundException(
        `Account(s) not found in chart of accounts: ${missing_ids.join(', ')}`,
      );
    }

    const base_client = this.prisma.withoutScope();

    // Fetch existing mappings for this org/store combination
    const existing_mappings = await base_client.accounting_account_mappings.findMany({
      where: {
        organization_id: org_id,
        store_id: store_id ?? null,
        mapping_key: { in: mappings.map((m) => m.mapping_key) },
      },
    });

    const existing_map = new Map(existing_mappings.map((m) => [m.mapping_key, m]));

    // Execute creates and updates in a transaction
    const operations = mappings.map((m) => {
      const existing = existing_map.get(m.mapping_key);
      if (existing) {
        return base_client.accounting_account_mappings.update({
          where: { id: existing.id },
          data: {
            account_id: m.account_id,
            is_active: true,
            updated_at: new Date(),
          },
        });
      }
      return base_client.accounting_account_mappings.create({
        data: {
          organization_id: org_id,
          store_id: store_id ?? null,
          mapping_key: m.mapping_key,
          account_id: m.account_id,
        },
      });
    });

    const results = await base_client.$transaction(operations);

    this.invalidateCache(org_id, store_id);

    return results;
  }

  /**
   * Delete custom mappings (all for org, or just store-level overrides).
   */
  async resetToDefaults(org_id: number, store_id?: number) {
    const base_client = this.prisma.withoutScope();

    if (store_id) {
      // Delete only store-level overrides
      await base_client.accounting_account_mappings.deleteMany({
        where: {
          organization_id: org_id,
          store_id: store_id,
        },
      });
    } else {
      // Delete all custom mappings for the organization (both org-level and all store overrides)
      await base_client.accounting_account_mappings.deleteMany({
        where: {
          organization_id: org_id,
        },
      });
    }

    this.invalidateCache(org_id, store_id);
  }
}
