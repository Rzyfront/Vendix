import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import {
  OrganizationSettings,
  OrganizationInventorySettings,
} from '../../../../organization/settings/interfaces/organization-settings.interface';
import { StoreSettings } from '../../../settings/interfaces/store-settings.interface';

/**
 * Resolved costing method used everywhere downstream.
 * - LIFO is intentionally absent: rejected at DTO level and mapped defensively
 *   to `weighted_average` in this resolver.
 * - `cpp` (legacy store-level value) is mapped to `weighted_average` at
 *   runtime per Plan Unificado §13 #7.
 */
export type ResolvedCostingMethod = 'weighted_average' | 'fifo';

/**
 * Resolves the effective inventory `costing_method` for a given organization
 * and (optionally) a store, applying the precedence defined in the Plan
 * Unificado §6.4.2:
 *
 *   1. ORG-level setting (`organization_settings.settings.inventory.costing_method`)
 *   2. STORE-level setting (`store_settings.settings.inventory.costing_method`,
 *      with `cpp` mapped to `weighted_average` per decision §13#7)
 *   3. Default → `'weighted_average'`
 *
 * Defensive mappings:
 * - `'lifo'` (anywhere): mapped to `'weighted_average'`. The DTO rejects LIFO
 *   on writes, but stores/orgs persisted before this rule must still degrade
 *   safely.
 * - `'cpp'` at the STORE level: mapped to `'weighted_average'` (legacy alias
 *   per §13#7). Rejected at the ORG level by DTO validation, so we don't
 *   need to handle it there.
 *
 * Reads use `GlobalPrismaService.withoutScope()`-equivalent base accessors
 * because the resolver may be called from queue jobs or cross-store reports
 * where the AsyncLocalStorage context does not match the requested storeId.
 *
 * NOTE: this service is a CONFIG resolver only. It does NOT calculate COGS
 * or touch cost layers — that responsibility belongs to `CostingService`
 * (calculator) and the future P3.6 valuation service.
 */
@Injectable()
export class CostingMethodResolverService {
  private readonly logger = new Logger(CostingMethodResolverService.name);
  private static readonly DEFAULT: ResolvedCostingMethod = 'weighted_average';

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  /**
   * Resolve the effective costing method for an organization (and optional
   * storeId fallback). Never throws — falls back to `'weighted_average'` on
   * any DB or shape error.
   */
  async resolveCostingMethod(
    organizationId: number,
    storeId?: number,
  ): Promise<ResolvedCostingMethod> {
    // 1. ORG-level wins.
    const orgValue = await this.readOrgCostingMethod(organizationId);
    if (orgValue !== null) {
      return orgValue;
    }

    // 2. STORE-level fallback (with cpp/lifo defensive mapping).
    if (typeof storeId === 'number') {
      const storeValue = await this.readStoreCostingMethod(storeId);
      if (storeValue !== null) {
        return storeValue;
      }
    }

    // 3. Default.
    return CostingMethodResolverService.DEFAULT;
  }

  /**
   * Reads the ORG-level `costing_method` for an organization. Returns `null`
   * when there is no setting row, the section is missing, or the value is
   * absent. `'lifo'` is mapped defensively to `'weighted_average'`.
   */
  private async readOrgCostingMethod(
    organizationId: number,
  ): Promise<ResolvedCostingMethod | null> {
    try {
      const row = await this.globalPrisma.organization_settings.findUnique({
        where: { organization_id: organizationId },
        select: { settings: true },
      });
      const settings = row?.settings as OrganizationSettings | null;
      const inventory = settings?.inventory as
        | OrganizationInventorySettings
        | undefined;
      const value = inventory?.costing_method;
      if (!value) return null;

      // Defensive: stored values may pre-date validation. LIFO must never leak.
      if ((value as string) === 'lifo') {
        this.logger.warn(
          `Organization ${organizationId} has costing_method='lifo' persisted; mapping to weighted_average.`,
        );
        return 'weighted_average';
      }
      if (value === 'fifo') return 'fifo';
      if (value === 'weighted_average') return 'weighted_average';

      this.logger.warn(
        `Organization ${organizationId} has unknown costing_method='${String(value)}'; falling through.`,
      );
      return null;
    } catch (err) {
      this.logger.warn(
        `Failed to read org costing_method for organization ${organizationId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Reads the STORE-level `costing_method` for a store. Returns `null` when
   * there is no setting row, the section is missing, or the value is absent.
   * Mapping rules (Plan §13#7):
   * - `'cpp'`  → `'weighted_average'`
   * - `'lifo'` → `'weighted_average'`
   * - `'fifo'` → `'fifo'`
   * - `'weighted_average'` → `'weighted_average'`
   */
  private async readStoreCostingMethod(
    storeId: number,
  ): Promise<ResolvedCostingMethod | null> {
    try {
      const row = await this.globalPrisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      });
      const settings = row?.settings as StoreSettings | null;
      const value = settings?.inventory?.costing_method;
      if (!value) return null;

      const raw = String(value).toLowerCase();
      if (raw === 'cpp') return 'weighted_average';
      if (raw === 'lifo') {
        this.logger.warn(
          `Store ${storeId} has costing_method='lifo' persisted; mapping to weighted_average.`,
        );
        return 'weighted_average';
      }
      if (raw === 'fifo') return 'fifo';
      if (raw === 'weighted_average') return 'weighted_average';

      this.logger.warn(
        `Store ${storeId} has unknown costing_method='${raw}'; falling through.`,
      );
      return null;
    } catch (err) {
      this.logger.warn(
        `Failed to read store costing_method for store ${storeId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
