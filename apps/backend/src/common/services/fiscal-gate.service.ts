import { Injectable, Logger } from '@nestjs/common';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { FiscalArea } from '../interfaces/fiscal-status.interface';
import { FiscalStatusResolverService } from './fiscal-status-resolver.service';

/**
 * FiscalGateService — única fuente de la regla "fiscal_status manda, module_flows refina".
 *
 * Consumido por:
 *  - ModuleFlowGuard (capa HTTP, vía @RequireModuleFlow)
 *  - AccountingEventsListener (capa de eventos / auto-asientos)
 *
 * Modelo de evaluación AND jerárquico:
 *  1. MAESTRO: fiscal_status.<area>.state ∈ {ACTIVE, LOCKED} habilita el área
 *     (LOCKED = histórico, sigue operando). El maestro corta primero.
 *  2. SUBFLOW (sólo dentro de `accounting`): module_flows.accounting.<subflow>
 *     refina hacia abajo. Nunca habilita lo que el maestro apagó.
 *
 * Default ESTRICTO: si el área no está ACTIVE/LOCKED no se habilita. Sólo cuando
 * fiscal_status aún no está materializado (`source_exists=false`, tenant legacy
 * pre-backfill) se cae al fallback histórico de module_flows, replicando la
 * semántica previa de ModuleFlowGuard para no introducir regresiones de transición.
 */
@Injectable()
export class FiscalGateService {
  private readonly logger = new Logger(FiscalGateService.name);

  /**
   * Mapa explícito subflow → área fiscal que lo gobierna. Los `flow_key` del
   * listener (payments, inventory, expenses, purchases, returns, …) son subflows
   * de `accounting`, NO áreas fiscales — por eso el default es `accounting`.
   * Sólo `invoicing` y `payroll` se gobiernan por su propia área.
   */
  private static readonly SUBFLOW_TO_AREA: Record<string, FiscalArea> = {
    invoicing: 'invoicing',
    payroll: 'payroll',
  };

  constructor(
    private readonly resolver: FiscalStatusResolverService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /** Resuelve el área fiscal maestra que gobierna un subflow del listener. */
  resolveArea(subflow: string): FiscalArea {
    return FiscalGateService.SUBFLOW_TO_AREA[subflow] ?? 'accounting';
  }

  /**
   * ¿Está habilitada el ÁREA fiscal maestra? (invoicing | accounting | payroll)
   * Fail-closed ante errores de resolución de scope (p.ej. STORE sin store_id).
   */
  async isAreaEnabled(
    organization_id: number,
    store_id: number | null | undefined,
    area: FiscalArea,
    tx?: any,
  ): Promise<boolean> {
    try {
      const { fiscal_status, source_exists, store_id: resolved_store_id } =
        await this.resolver.getStatusBlock(organization_id, store_id, tx);

      if (source_exists) {
        const state = fiscal_status[area]?.state;
        return state === 'ACTIVE' || state === 'LOCKED';
      }

      // Tenant legacy sin fiscal_status materializado (transición pre-backfill):
      // replicar la semántica histórica de module_flows del ModuleFlowGuard.
      return this.legacyAreaEnabled(resolved_store_id, area, tx);
    } catch (error) {
      this.logger.warn(
        `Fiscal gate fail-closed (org=${organization_id} store=${store_id ?? 'null'} area=${area}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * ¿Está habilitado un SUBFLOW concreto? Aplica el AND jerárquico:
   * el área maestra debe estar habilitada, y (sólo para accounting) el subflow
   * granular no debe estar explícitamente apagado en module_flows.
   */
  async isSubflowEnabled(
    organization_id: number,
    store_id: number | null | undefined,
    subflow: string,
    tx?: any,
  ): Promise<boolean> {
    const area = this.resolveArea(subflow);
    const areaEnabled = await this.isAreaEnabled(
      organization_id,
      store_id,
      area,
      tx,
    );
    if (!areaEnabled) return false;

    // invoicing/payroll no tienen subflows granulares hoy.
    if (area !== 'accounting') return true;

    try {
      const { store_id: resolved_store_id } = await this.resolver.getStatusBlock(
        organization_id,
        store_id,
        tx,
      );
      return this.subflowAllowed(resolved_store_id, subflow, tx);
    } catch (error) {
      this.logger.warn(
        `Fiscal gate subflow fail-closed (org=${organization_id} store=${store_id ?? 'null'} subflow=${subflow}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Fallback legacy para el ÁREA cuando fiscal_status no existe aún.
   * Reproduce ModuleFlowGuard (module-flow.guard.ts:122-133):
   *  - module_flows[area] presente → enabled !== false
   *  - sin module_flows (tienda legacy) → habilitado
   *  - module_flows presente pero área no configurada → deshabilitado
   *  - scope organización sin store concreto → habilitado (leniente, transición)
   */
  private async legacyAreaEnabled(
    resolved_store_id: number | null,
    area: FiscalArea,
    tx?: any,
  ): Promise<boolean> {
    if (!resolved_store_id) return true;

    const flows = await this.readModuleFlows(resolved_store_id, tx);
    if (!flows) return true;
    if (flows[area]) return flows[area].enabled !== false;
    if (area === 'accounting' && flows.accounting_flows) return true;
    return false;
  }

  /**
   * Refinamiento granular de un subflow de accounting:
   * module_flows.accounting.<subflow> !== false (default habilitado).
   */
  private async subflowAllowed(
    resolved_store_id: number | null,
    subflow: string,
    tx?: any,
  ): Promise<boolean> {
    if (!resolved_store_id) return true;

    const flows = await this.readModuleFlows(resolved_store_id, tx);
    const accounting = flows?.accounting;
    if (!accounting) return true;
    return accounting[subflow] !== false;
  }

  private async readModuleFlows(
    store_id: number,
    tx?: any,
  ): Promise<any | null> {
    const client = tx || this.globalPrisma.withoutScope();
    const row = await client.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });
    const settings = (row?.settings as any) || {};
    return settings.module_flows ?? null;
  }
}
