import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { InventoryReconciliationQueryDto } from './dto/inventory-reconciliation-query.dto';

/**
 * Papel de trabajo de auditoría READ-ONLY: concilia el auxiliar de inventario
 * (1435 + descendientes, asientos `posted`) contra el mayor operativo
 * (`inventory_valuation_snapshots`), agrupando SIEMPRE por
 * `accounting_entity_id` — nunca por `store_id` a secas, porque
 * `fiscal_scope` puede ser STORE u ORGANIZATION y agrupar por store rompe la
 * consolidación cuando varias tiendas comparten una entidad fiscal.
 *
 * No persiste nada. No hay sesión de conciliación, no hay "match" 1:1: es un
 * comparativo de dos totales + drill-down para que el contador explique la
 * diferencia (decisión de negocio ya tomada, ver vendix-inventory-valuation
 * y vendix-accounting-rules).
 */
@Injectable()
export class InventoryReconciliationService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getInventoryReconciliation(query: InventoryReconciliationQueryDto) {
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: { id: query.fiscal_period_id },
    });

    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    // accounting_entity_id: explícito en query > el que trae el período.
    // Nunca cae a store_id — si ninguno de los dos existe, es un dato
    // faltante real (fiscal_scope sin migrar) y se reporta como tal, no se
    // adivina agrupando por tienda.
    const accounting_entity_id =
      query.accounting_entity_id ?? fiscal_period.accounting_entity_id ?? undefined;

    if (!accounting_entity_id) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        'fiscal_period sin accounting_entity_id: pase accounting_entity_id explícito para conciliar (nunca se agrupa por store_id a secas)',
      );
    }

    // period_end: override explícito > fin del período fiscal.
    const period_end = query.period_end
      ? new Date(query.period_end)
      : new Date(fiscal_period.end_date);

    const [inventory_side, accounting_side] = await Promise.all([
      this.getInventorySideTotal(accounting_entity_id, period_end),
      this.getAccountingSideTotal(accounting_entity_id, period_end),
    ]);

    const difference = inventory_side.total_value - accounting_side.total_balance;

    return {
      fiscal_period: {
        id: fiscal_period.id,
        name: fiscal_period.name,
        start_date: fiscal_period.start_date,
        end_date: fiscal_period.end_date,
      },
      accounting_entity_id,
      period_end,
      inventory_side: {
        total_value: inventory_side.total_value,
        snapshot_count: inventory_side.snapshot_count,
        snapshots: inventory_side.snapshots,
      },
      accounting_side: {
        total_balance: accounting_side.total_balance,
        accounts: accounting_side.accounts,
      },
      difference,
      is_reconciled: Math.abs(difference) < 0.01,
      entries_detail: accounting_side.entries_detail,
    };
  }

  /**
   * Lado inventario: último snapshot con `snapshot_at <= period_end` por
   * combinación (location, product, variant). Usa el índice
   * `inventory_valuation_snapshots_entity_snapshot_idx` (accounting_entity_id,
   * snapshot_at) — sin migración, ya existente.
   *
   * Estrategia: traer todos los snapshots de la entidad con
   * snapshot_at <= period_end ordenados desc, y quedarnos con el primero por
   * clave (location_id, product_id, product_variant_id) en JS — el volumen
   * por entidad fiscal es razonable para un papel de trabajo puntual (no un
   * job masivo), y evita SQL crudo con DISTINCT ON fuera de Prisma.
   */
  private async getInventorySideTotal(
    accounting_entity_id: number,
    period_end: Date,
  ) {
    const snapshots = await this.prisma.inventory_valuation_snapshots.findMany(
      {
        where: {
          accounting_entity_id,
          snapshot_at: { lte: period_end },
        },
        include: {
          inventory_location: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, sku: true } },
          product_variant: { select: { id: true, name: true, sku: true } },
        },
        orderBy: { snapshot_at: 'desc' },
      },
    );

    const latest_by_key = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) {
      const key = `${snap.location_id}:${snap.product_id}:${snap.product_variant_id ?? 'base'}`;
      // Ya viene ordenado desc por snapshot_at — el primero visto por key es
      // el más reciente <= period_end.
      if (!latest_by_key.has(key)) {
        latest_by_key.set(key, snap);
      }
    }

    const latest_snapshots = Array.from(latest_by_key.values());

    const total_value = latest_snapshots.reduce(
      (sum, s) => sum + Number(s.total_value),
      0,
    );

    return {
      total_value,
      snapshot_count: latest_snapshots.length,
      snapshots: latest_snapshots
        .map((s) => ({
          location_id: s.location_id,
          location_name: s.inventory_location?.name ?? null,
          product_id: s.product_id,
          product_name: s.product?.name ?? null,
          product_sku: s.product?.sku ?? null,
          product_variant_id: s.product_variant_id,
          product_variant_name: s.product_variant?.name ?? null,
          snapshot_at: s.snapshot_at,
          quantity_on_hand: Number(s.quantity_on_hand),
          unit_cost: Number(s.unit_cost),
          total_value: Number(s.total_value),
          costing_method: s.costing_method,
        }))
        .sort((a, b) => {
          const loc = (a.location_name ?? '').localeCompare(b.location_name ?? '');
          if (loc !== 0) return loc;
          return (a.product_name ?? '').localeCompare(b.product_name ?? '');
        }),
    };
  }

  /**
   * Lado contable: saldo de 1435 + descendientes (chart_of_accounts.code LIKE
   * '1435%'), solo asientos `posted`, `entry_date <= period_end`, agrupado
   * por accounting_entity_id. Mismo patrón de signo por naturaleza que
   * getTrialBalance (débito - crédito, cuenta de activo = debit-nature).
   */
  private async getAccountingSideTotal(
    accounting_entity_id: number,
    period_end: Date,
  ) {
    const accounts = await this.prisma.chart_of_accounts.findMany({
      where: {
        accounting_entity_id,
        code: { startsWith: '1435' },
      },
      orderBy: { code: 'asc' },
    });

    if (accounts.length === 0) {
      return { total_balance: 0, accounts: [], entries_detail: [] };
    }

    const account_ids = accounts.map((a) => a.id);
    const account_map = new Map(accounts.map((a) => [a.id, a]));

    const entry_where: Prisma.accounting_entriesWhereInput = {
      accounting_entity_id,
      status: 'posted',
      entry_date: { lte: period_end },
    };

    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        total_balance: 0,
        accounts: accounts.map((a) => ({
          account_id: a.id,
          account_code: a.code,
          account_name: a.name,
          total_debit: 0,
          total_credit: 0,
          balance: 0,
        })),
        entries_detail: [],
      };
    }

    const lines = await this.prisma.accounting_entry_lines.findMany({
      where: {
        account_id: { in: account_ids },
        entry_id: { in: entry_ids },
      },
      include: {
        account: { select: { id: true, code: true, name: true } },
        entry: {
          select: {
            id: true,
            entry_number: true,
            entry_date: true,
            description: true,
            entry_type: true,
            source_type: true,
            source_id: true,
            store: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { entry: { entry_date: 'asc' } },
    });

    const balance_by_account = new Map<
      number,
      { total_debit: number; total_credit: number }
    >();

    for (const line of lines) {
      const debit = Number(line.debit_amount);
      const credit = Number(line.credit_amount);
      const acc = balance_by_account.get(line.account_id) ?? {
        total_debit: 0,
        total_credit: 0,
      };
      acc.total_debit += debit;
      acc.total_credit += credit;
      balance_by_account.set(line.account_id, acc);
    }

    // 1435 es debit-nature (activo): balance = DR - CR. Mismo criterio que
    // el resto del módulo (ver signedBalance en AccountingReportsService) —
    // nunca Math.abs, un saldo negativo es una señal real para el contador.
    let total_balance = 0;
    const accounts_detail = accounts.map((a) => {
      const agg = balance_by_account.get(a.id) ?? {
        total_debit: 0,
        total_credit: 0,
      };
      const balance = agg.total_debit - agg.total_credit;
      total_balance += balance;
      return {
        account_id: a.id,
        account_code: a.code,
        account_name: a.name,
        total_debit: agg.total_debit,
        total_credit: agg.total_credit,
        balance,
      };
    });

    // Drill-down: todas las líneas que tocan 1435* en el período, para que
    // el contador pueda explicar cualquier diferencia contra el snapshot.
    const entries_detail = lines.map((line) => ({
      line_id: line.id,
      entry_id: line.entry_id,
      entry_number: line.entry.entry_number,
      entry_date: line.entry.entry_date,
      entry_description: line.entry.description,
      entry_type: line.entry.entry_type,
      source_type: line.entry.source_type,
      source_id: line.entry.source_id,
      store: line.entry.store,
      account_code: line.account.code,
      account_name: line.account.name,
      line_description: line.description,
      debit_amount: Number(line.debit_amount),
      credit_amount: Number(line.credit_amount),
    }));

    return {
      total_balance,
      accounts: accounts_detail,
      entries_detail,
    };
  }
}
