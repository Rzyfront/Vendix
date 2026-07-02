import { IsNumber, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query del endpoint GET /store/accounting/reports/inventory-reconciliation
 * (C5, Ola 3 — papel de trabajo read-only, ver skill vendix-inventory-valuation
 * + vendix-accounting-rules).
 *
 * `fiscal_period_id` es la vía principal: de ahí se derivan
 * `accounting_entity_id` (si el período lo trae) y `period_end` (=
 * `fiscal_periods.end_date`). Si el período no tiene `accounting_entity_id`
 * propio (comercios STORE-scope antiguos sin fiscal_scope migrado), se
 * puede forzar explícitamente con `accounting_entity_id`.
 */
export class InventoryReconciliationQueryDto {
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accounting_entity_id?: number;

  @IsOptional()
  @IsDateString()
  period_end?: string;
}
