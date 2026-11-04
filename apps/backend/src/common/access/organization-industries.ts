import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ModuleIndustry, unionModuleIndustries } from './module-industries';

/**
 * apps-f4 S6: industry of an organization = union of its stores' industries.
 * No column, no migration. Inactive stores are excluded (`stores.is_active`);
 * no stores → `['retail']`.
 */
export async function resolveOrganizationIndustries(
  globalPrisma: GlobalPrismaService,
  organizationId: number,
): Promise<ModuleIndustry[]> {
  const stores = await globalPrisma.stores.findMany({
    where: { organization_id: organizationId, is_active: true },
    select: { industries: true },
  });
  return unionModuleIndustries(stores.map((s) => s.industries));
}
